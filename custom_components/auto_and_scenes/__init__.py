"""Auto & Scenes.

Adds a sidebar panel where regular (non-admin) Home Assistant users can create,
edit, run and delete simple automations and scenes from their phone.
"""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import (
    CONF_SIDEBAR_ICON,
    CONF_SIDEBAR_TITLE,
    DEFAULT_SIDEBAR_ICON,
    DEFAULT_SIDEBAR_TITLE,
    DOMAIN,
    PANEL_COMPONENT,
    PANEL_URL_PATH,
    STATIC_URL,
    VERSION,
)
from .store import ConfigStore
from .websocket import async_register_websocket

_LOGGER = logging.getLogger(__name__)

DATA_STATIC = f"{DOMAIN}_static_registered"
DATA_WS = f"{DOMAIN}_ws_registered"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Auto & Scenes from a config entry."""
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN]["entry"] = entry
    if "store" not in hass.data[DOMAIN]:
        hass.data[DOMAIN]["store"] = ConfigStore(hass)

    if not hass.data.get(DATA_STATIC):
        frontend_dir = Path(__file__).parent / "frontend"
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL, str(frontend_dir), False)]
        )
        hass.data[DATA_STATIC] = True

    if not hass.data.get(DATA_WS):
        async_register_websocket(hass)
        hass.data[DATA_WS] = True

    # Re-register the panel so a changed title/icon shows straight away.
    if PANEL_URL_PATH in hass.data.get(frontend.DATA_PANELS, {}):
        frontend.async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)

    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_COMPONENT,
        sidebar_title=entry.options.get(CONF_SIDEBAR_TITLE, DEFAULT_SIDEBAR_TITLE),
        sidebar_icon=entry.options.get(CONF_SIDEBAR_ICON, DEFAULT_SIDEBAR_ICON),
        module_url=f"{STATIC_URL}/auto-and-scenes-panel.js?v={VERSION}",
        embed_iframe=False,
        require_admin=False,
        config={"version": VERSION},
    )

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    _LOGGER.debug("Auto & Scenes panel registered at /%s", PANEL_URL_PATH)
    return True


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload when options change."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    frontend.async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)
    hass.data.get(DOMAIN, {}).pop("entry", None)
    return True
