# Auto & Scenes

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz)
[![Validate](https://github.com/marsh4200/auto-and-scenes/actions/workflows/validate.yml/badge.svg)](https://github.com/marsh4200/auto-and-scenes/actions/workflows/validate.yml)

A sidebar panel for Home Assistant that lets your **clients (non-admin users) create their own automations and scenes from their phone** – without giving them admin access.

Built for installers: hand over a system, let the homeowner set up "Porch light at sunset" or "Movie night" themselves, and stay confident they can't break your setup.

## Features

**Automations**
- Start on a **time of day**, **sunrise / sunset** (with offset) or **when a device changes** (door opens, motion, someone arrives home…)
- Limit to **certain days** (weekdays / weekends / pick days) and an **"only between" time window**
- Extra "only if a device is…" checks
- Steps: **control a device** (on/off/toggle, brightness, cover position, aircon temperature, volume…), **activate a scene**, **wait**, **send a phone notification**
- Reorder steps, enable/disable with a switch, **run now** button, "last ran" time

**Scenes**
- Big tap-to-activate tiles
- Add devices and choose on/off, brightness, position, aircon mode and temperature
- **"Use how they are now"** – set things up the way you like, then capture it
- **"Try it"** preview before saving
- Pick an icon

**Made for phones** – works in the Home Assistant Companion app, follows your Home Assistant theme (light and dark).

## How it stays safe

Non-admin users can't use Home Assistant's built-in automation editor. Auto & Scenes adds its own small API that **doesn't need admin**, but only accepts "simple" automations and scenes:

- Only the device types you allow (lights, switches, covers, aircons…) – locks are off by default
- Only a fixed list of actions per device type (e.g. `light.turn_on`, `cover.open_cover`) – no scripts, shell commands, restarts, etc.
- No templates anywhere
- The panel **only ever shows automations and scenes made in the panel** (ids start with `aas_`). Anything you create in **Settings → Automations & Scenes** is always hidden from the panel and can't be changed or deleted from it – for every user, admins included.
- Optionally limit the panel to specific users

Everything is checked on the server, not just in the app.

## Installation

### HACS (recommended)
1. HACS → ⋮ → **Custom repositories**
2. Add `https://github.com/marsh4200/auto-and-scenes` with category **Integration**
3. Install **Auto & Scenes** and restart Home Assistant

### Manual
Copy `custom_components/auto_and_scenes` into your `config/custom_components/` folder and restart.

### Set up
1. **Settings → Devices & services → Add integration → Auto & Scenes**
2. The **Auto & Scenes** panel appears in the sidebar for every user
3. Click **Configure** on the integration to change settings (see below)

## Requirements

Your `configuration.yaml` must load the UI automation and scene files (it does by default):

```yaml
automation: !include automations.yaml
scene: !include scenes.yaml
```

Home Assistant 2024.12 or newer.

## Settings

| Option | What it does | Default |
|---|---|---|
| Sidebar title / icon | Name and icon in the sidebar | Auto & Scenes |
| Users who may use the panel | Leave empty for everyone. Admins always have access | everyone |
| Device types users can control | Lights, switches, fans, toggle helpers, covers, climate, media players, locks | all except locks |
| Allow phone notifications | Lets clients add "Send a notification" steps | on |

## Tips for installers

- Create the client a normal (non-admin) user: **Settings → People → Add person → Allow login**, leave *Administrator* off.
- Hide entities you don't want clients to pick (Settings → Entities → *Visible* off). Hidden entities don't show in the device picker.
- Automations made by clients show up in the normal admin automation editor too, so you can always help them out.
- Want to hand a client one of your automations to play with? Build it in the panel instead of in Settings.

## Troubleshooting

- **"Your account has not been given access"** – add the user under *Configure → Users who may use the panel*, or leave that list empty.
- **"'scene' is not set up in configuration.yaml"** – add `scene: !include scenes.yaml` and restart.
- **Panel doesn't update after an upgrade** – pull down to refresh in the app, or clear the app's frontend cache (Companion app → Settings → Troubleshooting → Reset frontend cache).

## License

MIT © marsh4200
