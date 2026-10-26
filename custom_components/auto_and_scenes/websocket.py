"""Websocket API used by the panel.

None of these commands require admin. Access is controlled by the
integration's options (allowed users) and every save goes through the
checks in safety.py.
"""

from __future__ import annotations

import logging
from typing import Any
import uuid

try:  # Home Assistant 2026.10+ replaced voluptuous with probatio
    import probatio as vol
except ImportError:  # pragma: no cover - older Home Assistant
    import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er

from .const import (
    CONF_ALLOW_NOTIFY,
    CONF_ALLOWED_DOMAINS,
    CONF_ALLOWED_USERS,
    CONF_OWN_ONLY,
    DEFAULT_ALLOW_NOTIFY,
    DEFAULT_ALLOWED_DOMAINS,
    DEFAULT_OWN_ONLY,
    DOMAIN,
    ID_PREFIX,
    SERVICE_WHITELIST,
    VERSION,
)
from .safety import UnsafeConfig, check_automation, check_scene

_LOGGER = logging.getLogger(__name__)

KINDS = {"automation": ("automation", "automation"), "scene": ("scene", "homeassistant")}


@callback
def async_register_websocket(hass: HomeAssistant) -> None:
    """Register all panel commands."""
    websocket_api.async_register_command(hass, ws_info)
    websocket_api.async_register_command(hass, ws_list)
    websocket_api.async_register_command(hass, ws_save)
    websocket_api.async_register_command(hass, ws_delete)


def _settings(hass: HomeAssistant) -> dict[str, Any] | None:
    entry = hass.data.get(DOMAIN, {}).get("entry")
    if entry is None:
        return None
    opts = entry.options
    return {
        "allowed_users": list(opts.get(CONF_ALLOWED_USERS, [])),
        "own_only": bool(opts.get(CONF_OWN_ONLY, DEFAULT_OWN_ONLY)),
        "allowed_domains": list(opts.get(CONF_ALLOWED_DOMAINS, DEFAULT_ALLOWED_DOMAINS)),
        "allow_notify": bool(opts.get(CONF_ALLOW_NOTIFY, DEFAULT_ALLOW_NOTIFY)),
    }


def _access(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> dict[str, Any] | None:
    """Return settings if the user may use the panel, otherwise send an error."""
    settings = _settings(hass)
    if settings is None:
        connection.send_error(msg["id"], "not_loaded", "Auto & Scenes is not set up")
        return None
    user = connection.user
    if user is None:
        connection.send_error(msg["id"], websocket_api.ERR_UNAUTHORIZED, "No user")
        return None
    if not user.is_admin and settings["allowed_users"] and user.id not in settings["allowed_users"]:
        connection.send_error(
            msg["id"],
            websocket_api.ERR_UNAUTHORIZED,
            "Your account has not been given access to Auto & Scenes",
        )
        return None
    return settings


def _can_manage(item_id: str, settings: dict[str, Any], is_admin: bool) -> bool:
    if is_admin or not settings["own_only"]:
        return True
    return item_id.startswith(ID_PREFIX)


def _safe(kind: str, config: dict, settings: dict[str, Any]) -> str | None:
    """Return None if safe for the simple editor, otherwise the reason."""
    domains = set(settings["allowed_domains"])
    try:
        if kind == "automation":
            check_automation(config, domains, settings["allow_notify"])
        else:
            check_scene(config, domains)
    except UnsafeConfig as err:
        return str(err)
    return None


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/info"})
@websocket_api.async_response
async def ws_info(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Return the panel settings for this user."""
    settings = _access(hass, connection, msg)
    if settings is None:
        return
    connection.send_result(
        msg["id"],
        {
            "version": VERSION,
            "is_admin": connection.user.is_admin,
            "user_name": connection.user.name,
            "own_only": settings["own_only"],
            "allowed_domains": settings["allowed_domains"],
            "allow_notify": settings["allow_notify"],
            "services": {
                d: sorted(SERVICE_WHITELIST[d])
                for d in settings["allowed_domains"]
                if d in SERVICE_WHITELIST
            },
        },
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/list",
        vol.Required("kind"): vol.In(list(KINDS)),
    }
)
@websocket_api.async_response
async def ws_list(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """List automations or scenes the user may see."""
    settings = _access(hass, connection, msg)
    if settings is None:
        return
    kind = msg["kind"]
    store = hass.data[DOMAIN]["store"]
    try:
        items = await store.async_list(kind)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "read_failed", str(err))
        return

    registry = er.async_get(hass)
    domain, platform = KINDS[kind]
    is_admin = connection.user.is_admin
    result = []
    for item in items:
        item_id = str(item.get("id", ""))
        if not item_id or not _can_manage(item_id, settings, is_admin):
            continue
        reason = _safe(kind, item, settings)
        result.append(
            {
                "id": item_id,
                "name": item.get("alias") if kind == "automation" else item.get("name"),
                "entity_id": registry.async_get_entity_id(domain, platform, item_id),
                "config": item,
                "editable": reason is None,
                "reason": reason,
                "own": item_id.startswith(ID_PREFIX),
            }
        )
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/save",
        vol.Required("kind"): vol.In(list(KINDS)),
        vol.Optional("item_id"): str,
        vol.Required("config"): dict,
    }
)
@websocket_api.async_response
async def ws_save(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Create or update an automation or scene."""
    settings = _access(hass, connection, msg)
    if settings is None:
        return
    kind = msg["kind"]
    is_admin = connection.user.is_admin
    item_id = msg.get("item_id") or f"{ID_PREFIX}{uuid.uuid4().hex[:12]}"
    if not _can_manage(item_id, settings, is_admin):
        connection.send_error(msg["id"], websocket_api.ERR_UNAUTHORIZED, "You cannot edit this item")
        return

    config = dict(msg["config"])
    config["id"] = item_id
    if reason := _safe(kind, config, settings):
        connection.send_error(msg["id"], "invalid_config", reason)
        return

    store = hass.data[DOMAIN]["store"]
    try:
        await store.async_upsert(kind, item_id, config)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "save_failed", str(err))
        return

    _LOGGER.info("%s saved %s %s", connection.user.name, kind, item_id)
    domain, platform = KINDS[kind]
    connection.send_result(
        msg["id"],
        {
            "id": item_id,
            "entity_id": er.async_get(hass).async_get_entity_id(domain, platform, item_id),
        },
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/delete",
        vol.Required("kind"): vol.In(list(KINDS)),
        vol.Required("item_id"): str,
    }
)
@websocket_api.async_response
async def ws_delete(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Delete an automation or scene."""
    settings = _access(hass, connection, msg)
    if settings is None:
        return
    kind = msg["kind"]
    item_id = msg["item_id"]
    if not _can_manage(item_id, settings, connection.user.is_admin):
        connection.send_error(msg["id"], websocket_api.ERR_UNAUTHORIZED, "You cannot delete this item")
        return
    store = hass.data[DOMAIN]["store"]
    try:
        found = await store.async_delete(kind, item_id)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "delete_failed", str(err))
        return
    if not found:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "Not found")
        return
    _LOGGER.info("%s deleted %s %s", connection.user.name, kind, item_id)
    connection.send_result(msg["id"], {"id": item_id})
