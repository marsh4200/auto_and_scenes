"""Config flow for Auto & Scenes."""

from __future__ import annotations

from typing import Any

try:  # Home Assistant 2026.10+ replaced voluptuous with probatio
    import probatio as vol
except ImportError:  # pragma: no cover - older Home Assistant
    import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    BooleanSelector,
    IconSelector,
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TextSelector,
)

from .const import (
    ALL_DOMAINS,
    CONF_ALLOW_NOTIFY,
    CONF_ALLOWED_DOMAINS,
    CONF_ALLOWED_USERS,
    CONF_OWN_ONLY,
    CONF_SIDEBAR_ICON,
    CONF_SIDEBAR_TITLE,
    DEFAULT_ALLOW_NOTIFY,
    DEFAULT_ALLOWED_DOMAINS,
    DEFAULT_OWN_ONLY,
    DEFAULT_SIDEBAR_ICON,
    DEFAULT_SIDEBAR_TITLE,
    DOMAIN,
)

DEFAULT_OPTIONS = {
    CONF_SIDEBAR_TITLE: DEFAULT_SIDEBAR_TITLE,
    CONF_SIDEBAR_ICON: DEFAULT_SIDEBAR_ICON,
    CONF_ALLOWED_USERS: [],
    CONF_OWN_ONLY: DEFAULT_OWN_ONLY,
    CONF_ALLOWED_DOMAINS: DEFAULT_ALLOWED_DOMAINS,
    CONF_ALLOW_NOTIFY: DEFAULT_ALLOW_NOTIFY,
}


class AutoAndScenesConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle the initial setup."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Create the single entry."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(
                title="Auto & Scenes",
                data={},
                options={**DEFAULT_OPTIONS, CONF_SIDEBAR_TITLE: user_input[CONF_SIDEBAR_TITLE]},
            )
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {vol.Required(CONF_SIDEBAR_TITLE, default=DEFAULT_SIDEBAR_TITLE): TextSelector()}
            ),
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        """Return the options flow."""
        return AutoAndScenesOptionsFlow()


class AutoAndScenesOptionsFlow(OptionsFlow):
    """Change who can use the panel and what they can control."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Show the options form."""
        if user_input is not None:
            return self.async_create_entry(data=user_input)

        opts = {**DEFAULT_OPTIONS, **self.config_entry.options}
        users = [
            user
            for user in await self.hass.auth.async_get_users()
            if not user.system_generated and user.is_active
        ]
        user_options = [
            SelectOptionDict(
                value=user.id,
                label=f"{user.name}{' (admin)' if user.is_admin else ''}",
            )
            for user in users
        ]
        known_ids = {user.id for user in users}
        allowed_users = [uid for uid in opts[CONF_ALLOWED_USERS] if uid in known_ids]

        schema = vol.Schema(
            {
                vol.Required(CONF_SIDEBAR_TITLE, default=opts[CONF_SIDEBAR_TITLE]): TextSelector(),
                vol.Required(CONF_SIDEBAR_ICON, default=opts[CONF_SIDEBAR_ICON]): IconSelector(),
                vol.Optional(CONF_ALLOWED_USERS, default=allowed_users): SelectSelector(
                    SelectSelectorConfig(
                        options=user_options,
                        multiple=True,
                        mode=SelectSelectorMode.LIST,
                    )
                ),
                vol.Required(CONF_OWN_ONLY, default=opts[CONF_OWN_ONLY]): BooleanSelector(),
                vol.Required(
                    CONF_ALLOWED_DOMAINS, default=opts[CONF_ALLOWED_DOMAINS]
                ): SelectSelector(
                    SelectSelectorConfig(
                        options=ALL_DOMAINS,
                        multiple=True,
                        mode=SelectSelectorMode.LIST,
                        translation_key="domains",
                    )
                ),
                vol.Required(CONF_ALLOW_NOTIFY, default=opts[CONF_ALLOW_NOTIFY]): BooleanSelector(),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
