"""Constants for Auto & Scenes."""

from __future__ import annotations

DOMAIN = "auto_and_scenes"
VERSION = "1.1.0"

PANEL_URL_PATH = "auto-scenes"
PANEL_COMPONENT = "auto-and-scenes-panel"
STATIC_URL = "/auto_and_scenes_static"

# Items created from the panel get this id prefix. Only items with this prefix
# are ever shown in the panel; anything made in Settings stays hidden.
ID_PREFIX = "aas_"

AUTOMATIONS_FILE = "automations.yaml"
SCENES_FILE = "scenes.yaml"

CONF_SIDEBAR_TITLE = "sidebar_title"
CONF_SIDEBAR_ICON = "sidebar_icon"
CONF_ALLOWED_USERS = "allowed_users"
CONF_ALLOWED_DOMAINS = "allowed_domains"
CONF_ALLOW_NOTIFY = "allow_notify"

DEFAULT_SIDEBAR_TITLE = "Auto & Scenes"
DEFAULT_SIDEBAR_ICON = "mdi:robot-happy-outline"
DEFAULT_ALLOW_NOTIFY = True

# Which services a non-admin may use, per entity domain. Anything outside this
# list is rejected by the backend, whatever the panel sends.
SERVICE_WHITELIST: dict[str, set[str]] = {
    "light": {"turn_on", "turn_off", "toggle"},
    "switch": {"turn_on", "turn_off", "toggle"},
    "fan": {"turn_on", "turn_off", "toggle"},
    "input_boolean": {"turn_on", "turn_off", "toggle"},
    "cover": {"open_cover", "close_cover", "stop_cover", "set_cover_position"},
    "climate": {"turn_on", "turn_off", "set_temperature", "set_hvac_mode"},
    "media_player": {"turn_on", "turn_off", "media_play", "media_pause", "volume_set"},
    "lock": {"lock", "unlock"},
}

ALL_DOMAINS = list(SERVICE_WHITELIST)
DEFAULT_ALLOWED_DOMAINS = [
    "light",
    "switch",
    "fan",
    "input_boolean",
    "cover",
    "climate",
    "media_player",
]

ALLOWED_TRIGGERS = {"time", "sun", "state"}
ALLOWED_CONDITIONS = {"time", "state", "sun"}
ALLOWED_MODES = {"single", "restart", "queued", "parallel"}
