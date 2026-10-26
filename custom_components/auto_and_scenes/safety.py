"""Safety checks for automations and scenes saved by non-admin users.

The panel only ever builds "simple" automations and scenes. Everything that
comes in over the websocket is checked here before it is written to disk, so a
user cannot use this integration to sneak in templates, shell commands or
services outside the whitelist.
"""

from __future__ import annotations

from typing import Any

from .const import (
    ALLOWED_CONDITIONS,
    ALLOWED_MODES,
    ALLOWED_TRIGGERS,
    SERVICE_WHITELIST,
)


class UnsafeConfig(ValueError):
    """Raised when a config is outside what the panel allows."""


def _no_templates(value: Any) -> None:
    """Reject any Jinja template anywhere in the structure."""
    if isinstance(value, str):
        if "{{" in value or "{%" in value or "{#" in value:
            raise UnsafeConfig("Templates are not allowed")
    elif isinstance(value, dict):
        for key, item in value.items():
            _no_templates(key)
            _no_templates(item)
    elif isinstance(value, list):
        for item in value:
            _no_templates(item)
    elif value is None or isinstance(value, (int, float, bool)):
        return
    else:
        raise UnsafeConfig(f"Unsupported value type: {type(value).__name__}")


def _as_list(value: Any) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _entity_ids(value: Any) -> list[str]:
    ids = _as_list(value)
    for eid in ids:
        if not isinstance(eid, str) or "." not in eid:
            raise UnsafeConfig(f"Invalid entity id: {eid}")
    return ids


def _check_trigger(trig: Any) -> None:
    if not isinstance(trig, dict):
        raise UnsafeConfig("Trigger must be a mapping")
    kind = trig.get("trigger", trig.get("platform"))
    if kind not in ALLOWED_TRIGGERS:
        raise UnsafeConfig(f"Trigger type not allowed: {kind}")
    allowed_keys = {
        "time": {"trigger", "platform", "at", "id", "alias"},
        "sun": {"trigger", "platform", "event", "offset", "id", "alias"},
        "state": {
            "trigger",
            "platform",
            "entity_id",
            "to",
            "from",
            "for",
            "attribute",
            "id",
            "alias",
        },
    }[kind]
    extra = set(trig) - allowed_keys
    if extra:
        raise UnsafeConfig(f"Unsupported trigger option(s): {', '.join(sorted(extra))}")
    if kind == "state":
        _entity_ids(trig.get("entity_id"))


def _check_condition(cond: Any) -> None:
    if not isinstance(cond, dict):
        raise UnsafeConfig("Condition must be a mapping")
    kind = cond.get("condition")
    if kind not in ALLOWED_CONDITIONS:
        raise UnsafeConfig(f"Condition type not allowed: {kind}")
    allowed_keys = {
        "time": {"condition", "after", "before", "weekday", "alias"},
        "sun": {"condition", "after", "before", "after_offset", "before_offset", "alias"},
        "state": {"condition", "entity_id", "state", "for", "attribute", "alias"},
    }[kind]
    extra = set(cond) - allowed_keys
    if extra:
        raise UnsafeConfig(f"Unsupported condition option(s): {', '.join(sorted(extra))}")
    if kind == "state":
        _entity_ids(cond.get("entity_id"))


def _check_service(service: str, allowed_domains: set[str], allow_notify: bool) -> str:
    if not isinstance(service, str) or service.count(".") != 1:
        raise UnsafeConfig(f"Invalid action: {service}")
    domain, name = service.split(".")
    if domain == "scene":
        if name != "turn_on":
            raise UnsafeConfig(f"Action not allowed: {service}")
        return domain
    if domain == "notify":
        if not allow_notify:
            raise UnsafeConfig("Notifications are disabled")
        return domain
    if domain not in allowed_domains or name not in SERVICE_WHITELIST.get(domain, set()):
        raise UnsafeConfig(f"Action not allowed: {service}")
    return domain


def _check_action(act: Any, allowed_domains: set[str], allow_notify: bool) -> None:
    if not isinstance(act, dict):
        raise UnsafeConfig("Action must be a mapping")
    if "delay" in act:
        extra = set(act) - {"delay", "alias"}
        if extra:
            raise UnsafeConfig("Unsupported delay option(s)")
        delay = act["delay"]
        if isinstance(delay, dict):
            if set(delay) - {"hours", "minutes", "seconds"}:
                raise UnsafeConfig("Unsupported delay format")
            for val in delay.values():
                if not isinstance(val, (int, float)) or val < 0:
                    raise UnsafeConfig("Delay must be a positive number")
        elif not isinstance(delay, (str, int, float)):
            raise UnsafeConfig("Unsupported delay format")
        return

    service = act.get("action", act.get("service"))
    if service is None:
        raise UnsafeConfig("Unsupported action")
    extra = set(act) - {"action", "service", "target", "data", "entity_id", "alias"}
    if extra:
        raise UnsafeConfig(f"Unsupported action option(s): {', '.join(sorted(extra))}")
    domain = _check_service(service, allowed_domains, allow_notify)

    target = act.get("target") or {}
    if not isinstance(target, dict) or set(target) - {"entity_id"}:
        raise UnsafeConfig("Only entity targets are allowed")
    entity_ids = _entity_ids(target.get("entity_id")) + _entity_ids(act.get("entity_id"))
    if domain != "notify":
        if not entity_ids:
            raise UnsafeConfig("Action needs at least one entity")
        for eid in entity_ids:
            if eid.split(".")[0] != domain:
                raise UnsafeConfig(f"{eid} cannot be used with {service}")
    data = act.get("data") or {}
    if not isinstance(data, dict):
        raise UnsafeConfig("Action data must be a mapping")


def check_automation(
    config: Any, allowed_domains: set[str], allow_notify: bool
) -> None:
    """Raise UnsafeConfig if the automation is not a 'simple' one."""
    if not isinstance(config, dict):
        raise UnsafeConfig("Automation must be a mapping")
    _no_templates(config)
    allowed_keys = {
        "id",
        "alias",
        "description",
        "mode",
        "triggers",
        "trigger",
        "conditions",
        "condition",
        "actions",
        "action",
    }
    extra = set(config) - allowed_keys
    if extra:
        raise UnsafeConfig(f"Unsupported option(s): {', '.join(sorted(extra))}")
    if not isinstance(config.get("alias"), str) or not config["alias"].strip():
        raise UnsafeConfig("A name is required")
    if config.get("mode", "single") not in ALLOWED_MODES:
        raise UnsafeConfig("Unsupported mode")

    triggers = _as_list(config.get("triggers", config.get("trigger")))
    actions = _as_list(config.get("actions", config.get("action")))
    conditions = _as_list(config.get("conditions", config.get("condition")))
    if not triggers:
        raise UnsafeConfig("Add at least one 'When'")
    if not actions:
        raise UnsafeConfig("Add at least one 'Then do'")
    for trig in triggers:
        _check_trigger(trig)
    for cond in conditions:
        _check_condition(cond)
    for act in actions:
        _check_action(act, allowed_domains, allow_notify)


def check_scene(config: Any, allowed_domains: set[str]) -> None:
    """Raise UnsafeConfig if the scene uses anything not allowed."""
    if not isinstance(config, dict):
        raise UnsafeConfig("Scene must be a mapping")
    _no_templates(config)
    extra = set(config) - {"id", "name", "icon", "entities", "metadata"}
    if extra:
        raise UnsafeConfig(f"Unsupported option(s): {', '.join(sorted(extra))}")
    if not isinstance(config.get("name"), str) or not config["name"].strip():
        raise UnsafeConfig("A name is required")
    entities = config.get("entities")
    if not isinstance(entities, dict) or not entities:
        raise UnsafeConfig("Add at least one device to the scene")
    for eid, value in entities.items():
        _entity_ids(eid)
        if eid.split(".")[0] not in allowed_domains:
            raise UnsafeConfig(f"{eid} is not allowed in scenes")
        if not isinstance(value, (dict, str, bool)):
            raise UnsafeConfig(f"Invalid state for {eid}")
