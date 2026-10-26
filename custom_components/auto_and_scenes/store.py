"""Read and write automations.yaml / scenes.yaml safely."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util.file import write_utf8_file_atomic
from homeassistant.util.yaml import dump, load_yaml

from .const import AUTOMATIONS_FILE, SCENES_FILE

_LOGGER = logging.getLogger(__name__)

AUTOMATION_KEY_ORDER = (
    "id",
    "alias",
    "description",
    "mode",
    "triggers",
    "conditions",
    "actions",
)
SCENE_KEY_ORDER = ("id", "name", "icon", "entities", "metadata")


def _read(path: str) -> list[dict[str, Any]]:
    if not os.path.isfile(path):
        return []
    data = load_yaml(path)
    if data is None or data == {}:
        return []
    if not isinstance(data, list):
        raise HomeAssistantError(
            f"{os.path.basename(path)} is not a list, so Auto & Scenes cannot edit it"
        )
    return [dict(item) for item in data if isinstance(item, dict)]


def _write(path: str, data: list[dict[str, Any]]) -> None:
    contents = dump(data)
    write_utf8_file_atomic(path, contents)


def _ordered(config: dict[str, Any], order: tuple[str, ...]) -> dict[str, Any]:
    result = {key: config[key] for key in order if key in config}
    result.update({k: v for k, v in config.items() if k not in result})
    return result


class ConfigStore:
    """Thin, locked wrapper around the two YAML files."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._lock = asyncio.Lock()

    def _path(self, kind: str) -> str:
        return self.hass.config.path(AUTOMATIONS_FILE if kind == "automation" else SCENES_FILE)

    async def async_list(self, kind: str) -> list[dict[str, Any]]:
        """Return all items from the file."""
        return await self.hass.async_add_executor_job(_read, self._path(kind))

    async def async_upsert(self, kind: str, item_id: str, config: dict[str, Any]) -> None:
        """Insert or replace one item, then reload the domain."""
        order = AUTOMATION_KEY_ORDER if kind == "automation" else SCENE_KEY_ORDER
        config = _ordered({**config, "id": item_id}, order)
        path = self._path(kind)
        async with self._lock:
            data = await self.hass.async_add_executor_job(_read, path)
            for index, existing in enumerate(data):
                if str(existing.get("id")) == item_id:
                    data[index] = config
                    break
            else:
                data.append(config)
            await self.hass.async_add_executor_job(_write, path, data)
        await self._reload(kind)

    async def async_delete(self, kind: str, item_id: str) -> bool:
        """Remove one item. Returns False if it did not exist."""
        path = self._path(kind)
        async with self._lock:
            data = await self.hass.async_add_executor_job(_read, path)
            new_data = [item for item in data if str(item.get("id")) != item_id]
            if len(new_data) == len(data):
                return False
            await self.hass.async_add_executor_job(_write, path, new_data)
        await self._reload(kind)
        return True

    async def _reload(self, kind: str) -> None:
        domain = "automation" if kind == "automation" else "scene"
        if not self.hass.services.has_service(domain, "reload"):
            raise HomeAssistantError(
                f"Saved, but '{domain}' is not set up in configuration.yaml so it "
                "could not be reloaded"
            )
        await self.hass.services.async_call(domain, "reload", blocking=True)
