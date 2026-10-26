/*
 * Auto & Scenes – sidebar panel for Home Assistant
 * Lets regular (non-admin) users build simple automations and scenes on their phone.
 * https://github.com/marsh4200/auto-and-scenes
 */

const WS = "auto_and_scenes";

const DOMAIN_ICONS = {
  light: "mdi:lightbulb",
  switch: "mdi:toggle-switch-variant",
  fan: "mdi:fan",
  input_boolean: "mdi:toggle-switch-outline",
  cover: "mdi:window-shutter",
  climate: "mdi:thermostat",
  media_player: "mdi:speaker",
  lock: "mdi:lock",
  scene: "mdi:palette",
  binary_sensor: "mdi:motion-sensor",
  sensor: "mdi:eye",
  person: "mdi:account",
  device_tracker: "mdi:map-marker-account",
};

const DAYS = [
  ["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"],
  ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"],
];

const SCENE_ICONS = [
  "mdi:palette", "mdi:weather-night", "mdi:white-balance-sunny", "mdi:sofa",
  "mdi:movie-open", "mdi:silverware-fork-knife", "mdi:bed", "mdi:party-popper",
  "mdi:home-export-outline", "mdi:home-import-outline", "mdi:book-open-variant", "mdi:candle",
];

const TOGGLE_CMDS = [
  { s: "turn_on", l: "Turn on" },
  { s: "turn_off", l: "Turn off" },
  { s: "toggle", l: "Toggle" },
];

const COMMANDS = {
  light: [
    { s: "turn_on", l: "Turn on", v: { key: "brightness_pct", label: "Brightness", unit: "%", min: 1, max: 100, step: 1, def: 100 } },
    { s: "turn_off", l: "Turn off" },
    { s: "toggle", l: "Toggle" },
  ],
  switch: TOGGLE_CMDS,
  fan: TOGGLE_CMDS,
  input_boolean: TOGGLE_CMDS,
  cover: [
    { s: "open_cover", l: "Open" },
    { s: "close_cover", l: "Close" },
    { s: "stop_cover", l: "Stop" },
    { s: "set_cover_position", l: "Set position", v: { key: "position", label: "Position", unit: "%", min: 0, max: 100, step: 1, def: 50 } },
  ],
  climate: [
    { s: "set_temperature", l: "Set temperature", v: { key: "temperature", label: "Temperature", unit: "°", min: 10, max: 32, step: 0.5, def: 22 } },
    { s: "turn_on", l: "Turn on" },
    { s: "turn_off", l: "Turn off" },
  ],
  media_player: [
    { s: "turn_on", l: "Turn on" },
    { s: "turn_off", l: "Turn off" },
    { s: "media_play", l: "Play" },
    { s: "media_pause", l: "Pause" },
    { s: "volume_set", l: "Set volume", v: { key: "volume_level", label: "Volume", unit: "%", min: 0, max: 100, step: 1, def: 30, scale: 0.01 } },
  ],
  lock: [
    { s: "lock", l: "Lock" },
    { s: "unlock", l: "Unlock" },
  ],
};

const BINARY_LABELS = {
  door: ["Opens", "Closes"], window: ["Opens", "Closes"], opening: ["Opens", "Closes"],
  garage_door: ["Opens", "Closes"], motion: ["Detects motion", "Motion clears"],
  occupancy: ["Detects someone", "Becomes empty"], presence: ["Detects someone", "Becomes empty"],
  moisture: ["Detects water", "Becomes dry"], smoke: ["Detects smoke", "Clears"],
  vibration: ["Detects vibration", "Clears"], lock: ["Unlocks", "Locks"],
};

const TRIGGER_DOMAINS = ["binary_sensor", "person", "device_tracker", "sensor"];
const CONDITION_DOMAINS = ["binary_sensor", "person", "device_tracker"];

/* ---------- small helpers ---------- */

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const asList = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const clone = (o) => JSON.parse(JSON.stringify(o));
const domainOf = (eid) => String(eid || "").split(".")[0];
const pad = (n) => String(n).padStart(2, "0");

function durationToMinutes(d) {
  if (d === undefined || d === null || d === "") return 0;
  if (typeof d === "number") return d / 60;
  if (typeof d === "object") return (d.hours || 0) * 60 + (d.minutes || 0) + (d.seconds || 0) / 60;
  const neg = String(d).trim().startsWith("-");
  const parts = String(d).replace("-", "").split(":").map(Number);
  if (parts.some((p) => Number.isNaN(p))) throw new Error("bad duration");
  const [h = 0, m = 0, s = 0] = parts;
  const total = h * 60 + m + s / 60;
  return neg ? -total : total;
}

function minutesToOffset(min) {
  const neg = min < 0;
  const abs = Math.abs(Math.round(min));
  return `${neg ? "-" : ""}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}:00`;
}

function relTime(iso) {
  if (!iso) return "Never ran";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "Ran just now";
  if (diff < 3600) return `Ran ${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `Ran ${Math.round(diff / 3600)} h ago`;
  return `Ran ${Math.round(diff / 86400)} d ago`;
}

/* ---------- automation <-> simple model ---------- */

function parseAutomation(cfg) {
  const m = {
    alias: cfg.alias || "",
    description: cfg.description || "",
    mode: cfg.mode || "single",
    triggers: [],
    days: [],
    window: { on: false, after: "18:00", before: "23:00" },
    conds: [],
    actions: [],
  };

  for (const t of asList(cfg.triggers ?? cfg.trigger)) {
    const kind = t.trigger ?? t.platform;
    if (kind === "time" && typeof t.at === "string" && /^\d{1,2}:\d{2}/.test(t.at)) {
      m.triggers.push({ type: "time", at: t.at.slice(0, 5).padStart(5, "0") });
    } else if (kind === "sun" && (t.event === "sunset" || t.event === "sunrise")) {
      m.triggers.push({ type: "sun", event: t.event, offset: Math.round(durationToMinutes(t.offset)) });
    } else if (kind === "state" && asList(t.entity_id).length === 1 && !t.attribute && !t.from) {
      m.triggers.push({ type: "state", entity_id: asList(t.entity_id)[0], to: t.to ?? "", for_min: Math.round(durationToMinutes(t.for)) });
    } else {
      throw new Error("unsupported trigger");
    }
  }

  let timeSeen = false;
  for (const c of asList(cfg.conditions ?? cfg.condition)) {
    if (c.condition === "time" && !timeSeen) {
      timeSeen = true;
      m.days = asList(c.weekday);
      if (c.after || c.before) {
        if (typeof c.after !== "string" || typeof c.before !== "string") throw new Error("unsupported time window");
        m.window = { on: true, after: c.after.slice(0, 5), before: c.before.slice(0, 5) };
      }
    } else if (c.condition === "state" && asList(c.entity_id).length === 1 && !c.attribute && !c.for) {
      m.conds.push({ entity_id: asList(c.entity_id)[0], state: asList(c.state)[0] ?? "" });
    } else {
      throw new Error("unsupported condition");
    }
  }

  for (const a of asList(cfg.actions ?? cfg.action)) {
    if ("delay" in a) {
      m.actions.push({ type: "delay", minutes: Math.max(0, Math.round(durationToMinutes(a.delay) * 10) / 10) });
      continue;
    }
    const svc = a.action ?? a.service;
    if (typeof svc !== "string") throw new Error("unsupported action");
    const [domain, name] = svc.split(".");
    const ids = [...asList(a.target?.entity_id), ...asList(a.entity_id)];
    const data = a.data || {};
    if (domain === "notify") {
      m.actions.push({ type: "notify", service: svc, title: data.title || "", message: data.message || "" });
    } else if (svc === "scene.turn_on") {
      if (ids.length !== 1) throw new Error("multi scene");
      m.actions.push({ type: "scene", entity_id: ids[0] });
    } else {
      if (ids.length !== 1) throw new Error("multi entity");
      const cmd = (COMMANDS[domain] || []).find((c) => c.s === name);
      if (!cmd) throw new Error("unknown command");
      const keys = Object.keys(data);
      if (keys.length > (cmd.v ? 1 : 0) || (keys.length && keys[0] !== cmd.v.key)) throw new Error("extra data");
      let value = cmd.v ? (data[cmd.v.key] ?? cmd.v.def) : undefined;
      if (cmd.v?.scale && value !== undefined && cmd.v.key in data) value = Math.round(value / cmd.v.scale);
      m.actions.push({ type: "device", entity_id: ids[0], service: name, value });
    }
  }
  return m;
}

function buildAutomation(m) {
  const triggers = m.triggers.map((t) => {
    if (t.type === "time") return { trigger: "time", at: `${t.at}:00` };
    if (t.type === "sun") {
      const out = { trigger: "sun", event: t.event };
      if (Number(t.offset)) out.offset = minutesToOffset(Number(t.offset));
      return out;
    }
    const out = { trigger: "state", entity_id: t.entity_id };
    if (t.to !== "" && t.to !== undefined) out.to = t.to;
    if (Number(t.for_min) > 0) out.for = { minutes: Number(t.for_min) };
    return out;
  });

  const conditions = [];
  const days = m.days.filter((d) => DAYS.some(([k]) => k === d));
  if ((days.length && days.length < 7) || m.window.on) {
    const c = { condition: "time" };
    if (m.window.on) {
      c.after = `${m.window.after}:00`;
      c.before = `${m.window.before}:00`;
    }
    if (days.length && days.length < 7) c.weekday = DAYS.map(([k]) => k).filter((k) => days.includes(k));
    conditions.push(c);
  }
  for (const c of m.conds) conditions.push({ condition: "state", entity_id: c.entity_id, state: c.state });

  const actions = m.actions.map((a) => {
    if (a.type === "delay") {
      const total = Math.round(Number(a.minutes) * 60);
      const d = {};
      if (total >= 3600) d.hours = Math.floor(total / 3600);
      if (total % 3600 >= 60) d.minutes = Math.floor((total % 3600) / 60);
      if (total % 60) d.seconds = total % 60;
      return { delay: Object.keys(d).length ? d : { seconds: 0 } };
    }
    if (a.type === "scene") return { action: "scene.turn_on", target: { entity_id: a.entity_id } };
    if (a.type === "notify") {
      const data = { message: a.message };
      if (a.title) data.title = a.title;
      return { action: a.service, data };
    }
    const domain = domainOf(a.entity_id);
    const cmd = (COMMANDS[domain] || []).find((c) => c.s === a.service);
    const out = { action: `${domain}.${a.service}`, target: { entity_id: a.entity_id } };
    if (cmd?.v) {
      let v = Number(a.value ?? cmd.v.def);
      if (cmd.v.scale) v = Math.round(v * cmd.v.scale * 100) / 100;
      out.data = { [cmd.v.key]: v };
    }
    return out;
  });

  return {
    alias: m.alias.trim(),
    description: m.description || "Created with Auto & Scenes",
    mode: m.mode || "single",
    triggers,
    conditions,
    actions,
  };
}

/* ---------- scene <-> simple model ---------- */

const SCENE_STATES = {
  light: [["on", "On"], ["off", "Off"]],
  switch: [["on", "On"], ["off", "Off"]],
  fan: [["on", "On"], ["off", "Off"]],
  input_boolean: [["on", "On"], ["off", "Off"]],
  media_player: [["on", "On"], ["off", "Off"]],
  cover: [["open", "Open"], ["closed", "Closed"]],
  lock: [["locked", "Locked"], ["unlocked", "Unlocked"]],
};

function parseScene(cfg) {
  const m = { name: cfg.name || "", icon: cfg.icon || "mdi:palette", entities: [] };
  for (const [eid, raw] of Object.entries(cfg.entities || {})) {
    const val = typeof raw === "object" && raw !== null ? { ...raw } : { state: raw === true ? "on" : raw === false ? "off" : raw };
    const row = { entity_id: eid, state: String(val.state ?? "on"), extra: {} };
    delete val.state;
    if ("brightness" in val) { row.brightness_pct = Math.max(1, Math.round(Number(val.brightness) / 2.55)); delete val.brightness; }
    if ("current_position" in val) { row.position = Number(val.current_position); delete val.current_position; }
    if ("temperature" in val) { row.temperature = Number(val.temperature); delete val.temperature; }
    row.extra = val;
    m.entities.push(row);
  }
  return m;
}

function buildScene(m) {
  const entities = {};
  for (const row of m.entities) {
    const d = domainOf(row.entity_id);
    const out = { state: row.state };
    const isOff = row.state === "off" || row.state === "closed";
    if (!isOff) Object.assign(out, row.extra || {});
    if (d === "light" && row.state === "on" && row.brightness_pct) out.brightness = Math.round(Number(row.brightness_pct) * 2.55);
    if (d === "cover" && row.state === "open" && row.position !== undefined && row.position !== "") out.current_position = Number(row.position);
    if (d === "climate" && row.state !== "off" && row.temperature) out.temperature = Number(row.temperature);
    entities[row.entity_id] = out;
  }
  const cfg = { name: m.name.trim(), entities };
  if (m.icon) cfg.icon = m.icon;
  return cfg;
}

/* ---------- the panel ---------- */

class AutoAndScenesPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._tab = "automations";
    this._view = "list";
    this._info = null;
    this._error = null;
    this._items = { automation: null, scene: null };
    this._draft = null;
    this._editing = null;
    this._picker = null;
    this._menu = null;
    this._confirm = null;
    this._busy = false;
    this._started = false;
    this.shadowRoot.addEventListener("click", (e) => this._onClick(e));
    this.shadowRoot.addEventListener("input", (e) => this._onInput(e));
    this.shadowRoot.addEventListener("change", (e) => this._onInput(e));
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first && !this._started) {
      this._started = true;
      this._load();
    } else {
      this._updateLive();
    }
  }
  get hass() { return this._hass; }

  set narrow(v) {
    const changed = this._narrow !== v;
    this._narrow = v;
    if (changed && this._started) this._render();
  }

  set panel(p) { this._panel = p; }

  /* ----- data ----- */

  async _load() {
    this._render();
    try {
      this._info = await this._hass.callWS({ type: `${WS}/info` });
      await Promise.all([this._loadKind("automation"), this._loadKind("scene")]);
      this._error = null;
    } catch (err) {
      this._error = err?.message || String(err);
    }
    this._render();
  }

  async _loadKind(kind) {
    const items = await this._hass.callWS({ type: `${WS}/list`, kind });
    items.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    this._items[kind] = items;
  }

  _entityFor(kind, item) {
    if (item.entity_id && this._hass.states[item.entity_id]) return item.entity_id;
    const domain = kind === "automation" ? "automation" : "scene";
    const hit = Object.keys(this._hass.states).find(
      (eid) => eid.startsWith(`${domain}.`) && this._hass.states[eid].attributes.id === item.id,
    );
    return hit || item.entity_id || null;
  }

  _name(eid) {
    const st = this._hass.states[eid];
    return st?.attributes?.friendly_name || eid || "Pick a device";
  }

  _icon(eid) {
    const st = this._hass.states[eid];
    return st?.attributes?.icon || DOMAIN_ICONS[domainOf(eid)] || "mdi:help-circle-outline";
  }

  _allowed() {
    return this._info?.allowed_domains || [];
  }

  _commandsFor(domain) {
    const allowed = this._info?.services?.[domain] || [];
    return (COMMANDS[domain] || []).filter((c) => allowed.includes(c.s));
  }

  /* ----- summaries ----- */

  _stateLabel(eid, state) {
    if (state === "" || state === undefined) return "changes";
    const opts = this._stateOptions(eid);
    const hit = opts.find(([v]) => v === state);
    return hit ? hit[1].toLowerCase() : `becomes ${state}`;
  }

  _stateOptions(eid) {
    const d = domainOf(eid);
    const st = this._hass.states[eid];
    if (d === "binary_sensor") {
      const lbl = BINARY_LABELS[st?.attributes?.device_class] || ["Turns on", "Turns off"];
      return [["on", lbl[0]], ["off", lbl[1]]];
    }
    if (d === "person" || d === "device_tracker") return [["home", "Arrives home"], ["not_home", "Leaves home"]];
    if (d === "cover") return [["open", "Opens"], ["closed", "Closes"]];
    if (d === "lock") return [["locked", "Locks"], ["unlocked", "Unlocks"]];
    if (d === "media_player") return [["playing", "Starts playing"], ["paused", "Pauses"], ["off", "Turns off"]];
    if (d === "climate") return (st?.attributes?.hvac_modes || ["off", "heat", "cool"]).map((x) => [x, `Set to ${x}`]);
    if (d === "sensor") return [];
    return [["on", "Turns on"], ["off", "Turns off"]];
  }

  _summary(m) {
    const parts = m.triggers.map((t) => {
      if (t.type === "time") return `At ${t.at}`;
      if (t.type === "sun") {
        const o = Number(t.offset) || 0;
        const when = o === 0 ? "At" : `${Math.abs(o)} min ${o < 0 ? "before" : "after"}`;
        return `${when} ${t.event}`;
      }
      return `When ${this._name(t.entity_id)} ${this._stateLabel(t.entity_id, t.to)}`;
    });
    let text = parts.join(" or ") || "No trigger";
    if (m.days.length && m.days.length < 7) {
      const wk = ["mon", "tue", "wed", "thu", "fri"];
      if (m.days.length === 5 && wk.every((d) => m.days.includes(d))) text += " · Weekdays";
      else if (m.days.length === 2 && m.days.includes("sat") && m.days.includes("sun")) text += " · Weekends";
      else text += ` · ${DAYS.filter(([k]) => m.days.includes(k)).map(([, l]) => l).join(", ")}`;
    }
    if (m.window.on) text += ` · ${m.window.after}–${m.window.before}`;
    return text;
  }

  /* ----- events ----- */

  _onClick(e) {
    const el = e.target.closest("[data-act]");
    if (!el || el.hasAttribute("disabled")) return;
    const act = el.dataset.act;
    const i = el.dataset.i !== undefined ? Number(el.dataset.i) : undefined;
    const handler = this[`_act_${act}`];
    if (handler) {
      e.stopPropagation();
      handler.call(this, el, i);
    }
  }

  _onInput(e) {
    const el = e.target;
    if (!el.dataset?.bind || !this._draft) return;
    let value = el.type === "checkbox" ? el.checked : el.value;
    if (el.dataset.type === "number") value = value === "" ? "" : Number(value);
    const path = el.dataset.bind.split(".");
    let obj = this._draft;
    for (const key of path.slice(0, -1)) obj = obj[key];
    obj[path[path.length - 1]] = value;
    if (el.dataset.out) {
      const out = this.shadowRoot.getElementById(el.dataset.out);
      if (out) out.textContent = `${value}${el.dataset.unit || ""}`;
    }
    if (el.dataset.rerender && e.type === "change") this._render();
  }

  _act_menu() {
    this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true }));
  }

  _act_tab(el) {
    this._tab = el.dataset.tab;
    this._render();
  }

  _act_reload() {
    this._load();
  }

  _act_toggle_auto(el) {
    const eid = el.dataset.eid;
    if (!eid) return;
    const on = this._hass.states[eid]?.state === "on";
    this._hass.callService("automation", on ? "turn_off" : "turn_on", { entity_id: eid });
  }

  async _act_run_auto(el) {
    const eid = el.dataset.eid;
    if (!eid) return this._toast("Still loading – try again in a moment");
    await this._hass.callService("automation", "trigger", { entity_id: eid, skip_condition: true });
    this._toast("Automation started");
  }

  async _act_run_scene(el) {
    const eid = el.dataset.eid;
    if (!eid) return this._toast("Still loading – try again in a moment");
    el.classList.add("pulse");
    setTimeout(() => el.classList.remove("pulse"), 700);
    await this._hass.callService("scene", "turn_on", { entity_id: eid });
    this._toast(`${el.dataset.name || "Scene"} activated`);
  }

  _act_new() {
    if (this._tab === "automations") {
      this._editing = { kind: "automation", id: null, editable: true };
      this._draft = {
        alias: "", description: "", mode: "single",
        triggers: [{ type: "time", at: "07:00" }],
        days: [], window: { on: false, after: "18:00", before: "23:00" },
        conds: [], actions: [],
      };
      this._view = "auto";
    } else {
      this._editing = { kind: "scene", id: null, editable: true };
      this._draft = { name: "", icon: "mdi:palette", entities: [] };
      this._view = "scene";
    }
    this._render();
    this._scrollTop();
  }

  _act_edit(el) {
    const kind = el.dataset.kind;
    const item = this._items[kind].find((x) => x.id === el.dataset.id);
    if (!item) return;
    let draft = null;
    let editable = item.editable;
    try {
      draft = kind === "automation" ? parseAutomation(item.config) : parseScene(item.config);
    } catch (err) {
      editable = false;
    }
    if (!editable) {
      this._toast(item.reason ? `Advanced item – ${item.reason}. Ask your installer to change it.` : "This one is too advanced for the simple editor. Ask your installer to change it.", 4500);
      return;
    }
    this._editing = { kind, id: item.id, editable };
    this._draft = draft;
    this._view = kind === "automation" ? "auto" : "scene";
    this._render();
    this._scrollTop();
  }

  _act_back() {
    this._view = "list";
    this._draft = null;
    this._editing = null;
    this._render();
  }

  _act_add_menu(el) {
    this._menu = el.dataset.menu;
    this._render();
  }

  _act_close_menu() {
    this._menu = null;
    this._render();
  }

  _act_add_trigger(el) {
    const type = el.dataset.type;
    this._menu = null;
    if (type === "time") this._draft.triggers.push({ type: "time", at: "07:00" });
    if (type === "sun") this._draft.triggers.push({ type: "sun", event: "sunset", offset: 0 });
    if (type === "state") {
      return this._openPicker([...TRIGGER_DOMAINS, ...this._allowed()], (eid) => {
        const opts = this._stateOptions(eid);
        this._draft.triggers.push({ type: "state", entity_id: eid, to: opts[0]?.[0] ?? "", for_min: 0 });
      });
    }
    this._render();
  }

  _act_add_cond() {
    this._openPicker([...CONDITION_DOMAINS, ...this._allowed()], (eid) => {
      const opts = this._stateOptions(eid);
      this._draft.conds.push({ entity_id: eid, state: opts[0]?.[0] ?? "on" });
    });
  }

  _act_add_action(el) {
    const type = el.dataset.type;
    this._menu = null;
    if (type === "device") {
      return this._openPicker(this._allowed().filter((d) => this._commandsFor(d).length), (eid) => {
        const cmd = this._commandsFor(domainOf(eid))[0];
        this._draft.actions.push({ type: "device", entity_id: eid, service: cmd.s, value: cmd.v?.def });
      });
    }
    if (type === "scene") return this._openPicker(["scene"], (eid) => this._draft.actions.push({ type: "scene", entity_id: eid }));
    if (type === "delay") this._draft.actions.push({ type: "delay", minutes: 5 });
    if (type === "notify") {
      const svc = this._notifyServices()[0];
      if (!svc) {
        this._toast("No phones found. Install the Home Assistant app and log in first.", 4000);
        return this._render();
      }
      this._draft.actions.push({ type: "notify", service: svc, title: "", message: "" });
    }
    this._render();
  }

  _act_remove(el, i) {
    const list = el.dataset.list;
    const arr = list.split(".").reduce((o, k) => o[k], this._draft);
    arr.splice(i, 1);
    this._render();
  }

  _act_move(el, i) {
    const arr = this._draft.actions;
    const j = i + Number(el.dataset.dir);
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    this._render();
  }

  _act_day(el) {
    const d = el.dataset.day;
    const days = this._draft.days;
    const idx = days.indexOf(d);
    if (idx >= 0) days.splice(idx, 1);
    else days.push(d);
    this._render();
  }

  _act_days_preset(el) {
    const p = el.dataset.preset;
    this._draft.days = p === "weekdays" ? ["mon", "tue", "wed", "thu", "fri"] : p === "weekends" ? ["sat", "sun"] : [];
    this._render();
  }

  _act_set(el, i) {
    // generic segmented-control setter: data-list, data-field, data-value
    const arr = el.dataset.list.split(".").reduce((o, k) => o[k], this._draft);
    const target = i === undefined ? arr : arr[i];
    let value = el.dataset.value;
    if (el.dataset.type === "number") value = Number(value);
    target[el.dataset.field] = value;
    if (el.dataset.field === "service") {
      const cmd = (COMMANDS[domainOf(target.entity_id)] || []).find((c) => c.s === value);
      if (cmd?.v && (target.value === undefined || target.value === "")) target.value = cmd.v.def;
    }
    this._render();
  }

  _act_change_entity(el, i) {
    const list = el.dataset.list;
    const domains = list === "triggers"
      ? [...TRIGGER_DOMAINS, ...this._allowed()]
      : list === "conds"
      ? [...CONDITION_DOMAINS, ...this._allowed()]
      : el.dataset.domains ? el.dataset.domains.split(",") : this._allowed();
    this._openPicker(domains, (eid) => {
      const row = this._draft[list][i];
      row.entity_id = eid;
      if (list === "actions" && row.type === "device") {
        const cmd = this._commandsFor(domainOf(eid))[0];
        row.service = cmd.s;
        row.value = cmd.v?.def;
      }
      if (list === "triggers") row.to = this._stateOptions(eid)[0]?.[0] ?? "";
      if (list === "conds") row.state = this._stateOptions(eid)[0]?.[0] ?? "on";
    });
  }

  _act_scene_icon(el) {
    this._draft.icon = el.dataset.icon;
    this._render();
  }

  _act_scene_add() {
    const taken = new Set(this._draft.entities.map((r) => r.entity_id));
    this._openPicker(this._allowed(), (eid) => {
      if (taken.has(eid)) return;
      this._draft.entities.push(this._captureRow(eid));
    });
  }

  _act_scene_capture() {
    this._draft.entities = this._draft.entities.map((r) => ({ ...this._captureRow(r.entity_id), extra: r.extra || {} }));
    this._toast("Copied how your devices are set right now");
    this._render();
  }

  async _act_scene_preview() {
    const cfg = buildScene(this._draft);
    if (!Object.keys(cfg.entities).length) return this._toast("Add a device first");
    try {
      await this._hass.callService("scene", "apply", { entities: cfg.entities });
      this._toast("Previewing on your devices");
    } catch (err) {
      this._toast(`Preview failed: ${err.message || err}`);
    }
  }

  _captureRow(eid) {
    const st = this._hass.states[eid];
    const d = domainOf(eid);
    const row = { entity_id: eid, state: "on", extra: {} };
    if (!st) return row;
    if (d === "climate") {
      row.state = st.state;
      if (st.attributes.temperature) row.temperature = st.attributes.temperature;
      return row;
    }
    const valid = (SCENE_STATES[d] || []).map(([v]) => v);
    row.state = valid.includes(st.state) ? st.state : valid[0] || st.state;
    if (d === "light" && st.state === "on" && st.attributes.brightness) row.brightness_pct = Math.max(1, Math.round(st.attributes.brightness / 2.55));
    if (d === "cover" && st.attributes.current_position !== undefined) row.position = st.attributes.current_position;
    return row;
  }

  async _act_save() {
    if (this._busy) return;
    const { kind, id } = this._editing;
    const problem = kind === "automation" ? this._checkAuto() : this._checkScene();
    if (problem) return this._toast(problem, 3500);
    const config = kind === "automation" ? buildAutomation(this._draft) : buildScene(this._draft);
    this._busy = true;
    this._render();
    try {
      const msg = { type: `${WS}/save`, kind, config };
      if (id) msg.item_id = id;
      await this._hass.callWS(msg);
      await this._loadKind(kind);
      this._toast(kind === "automation" ? "Automation saved" : "Scene saved");
      this._view = "list";
      this._draft = null;
      this._editing = null;
    } catch (err) {
      this._toast(`Could not save: ${err.message || err}`, 5000);
    }
    this._busy = false;
    this._render();
  }

  _act_delete() {
    const { kind } = this._editing;
    const name = kind === "automation" ? this._draft.alias : this._draft.name;
    this._confirm = {
      text: `Delete “${name || "this " + kind}”? This can't be undone.`,
      onYes: async () => {
        try {
          await this._hass.callWS({ type: `${WS}/delete`, kind, item_id: this._editing.id });
          await this._loadKind(kind);
          this._toast("Deleted");
          this._view = "list";
          this._draft = null;
          this._editing = null;
        } catch (err) {
          this._toast(`Could not delete: ${err.message || err}`, 5000);
        }
      },
    };
    this._render();
  }

  async _act_confirm_yes() {
    const c = this._confirm;
    this._confirm = null;
    this._render();
    if (c) await c.onYes();
    this._render();
  }

  _act_confirm_no() {
    this._confirm = null;
    this._render();
  }

  /* ----- validation ----- */

  _checkAuto() {
    const m = this._draft;
    if (!m.alias.trim()) return "Give your automation a name";
    if (!m.triggers.length) return "Add at least one 'When'";
    if (m.triggers.some((t) => t.type === "state" && !t.entity_id)) return "Pick a device for every 'When'";
    if (m.triggers.some((t) => t.type === "time" && !t.at)) return "Set a time";
    if (m.window.on && (!m.window.after || !m.window.before)) return "Set both times for 'Only between'";
    if (!m.actions.length) return "Add at least one 'Then do'";
    if (m.actions.some((a) => a.type === "notify" && !String(a.message).trim())) return "Type a message for your notification";
    return null;
  }

  _checkScene() {
    const m = this._draft;
    if (!m.name.trim()) return "Give your scene a name";
    if (!m.entities.length) return "Add at least one device";
    return null;
  }

  /* ----- picker ----- */

  _notifyServices() {
    const svcs = this._hass.services?.notify || {};
    return Object.keys(svcs).filter((s) => s.startsWith("mobile_app_")).map((s) => `notify.${s}`);
  }

  _openPicker(domains, onPick) {
    this._menu = null;
    this._picker = { domains: new Set(domains), onPick, filter: "" };
    this._render();
    setTimeout(() => this.shadowRoot.getElementById("pick-search")?.focus(), 50);
  }

  _act_pick(el) {
    const p = this._picker;
    this._picker = null;
    if (p) p.onPick(el.dataset.eid);
    this._render();
  }

  _act_close_picker() {
    this._picker = null;
    this._render();
  }

  _pickerList() {
    const p = this._picker;
    const q = p.filter.trim().toLowerCase();
    return Object.keys(this._hass.states)
      .filter((eid) => p.domains.has(domainOf(eid)))
      .filter((eid) => !this._hass.entities?.[eid]?.hidden)
      .map((eid) => ({ eid, name: this._name(eid) }))
      .filter((x) => !q || x.name.toLowerCase().includes(q) || x.eid.includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 200);
  }

  _renderPickerList() {
    const box = this.shadowRoot.getElementById("pick-list");
    if (!box) return;
    const list = this._pickerList();
    box.innerHTML = list.length
      ? list.map((x) => `
        <button class="pick-row" data-act="pick" data-eid="${esc(x.eid)}">
          <ha-icon icon="${esc(this._icon(x.eid))}"></ha-icon>
          <span class="pick-text"><span>${esc(x.name)}</span><small>${esc(this._prettyState(x.eid))}</small></span>
        </button>`).join("")
      : `<div class="empty small">Nothing found</div>`;
  }

  _prettyState(eid) {
    const st = this._hass.states[eid];
    if (!st) return "";
    const unit = st.attributes.unit_of_measurement ? ` ${st.attributes.unit_of_measurement}` : "";
    return `${st.state.replace(/_/g, " ")}${unit}`;
  }

  /* ----- live updates ----- */

  _updateLive() {
    if (this._view !== "list" || !this.shadowRoot) return;
    this.shadowRoot.querySelectorAll("[data-live-toggle]").forEach((el) => {
      const st = this._hass.states[el.dataset.liveToggle];
      el.classList.toggle("on", st?.state === "on");
    });
    this.shadowRoot.querySelectorAll("[data-live-last]").forEach((el) => {
      const st = this._hass.states[el.dataset.liveLast];
      el.textContent = relTime(st?.attributes?.last_triggered);
    });
  }

  _toast(text, ms = 2500) {
    const t = this.shadowRoot.getElementById("toast");
    if (!t) return;
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.shadowRoot.getElementById("toast")?.classList.remove("show"), ms);
  }

  _scrollTop() {
    this.scrollTop = 0;
  }

  /* ----- rendering ----- */

  _render() {
    if (!this._hass) return;
    const scroll = this.scrollTop;
    const toastText = this.shadowRoot.getElementById("toast")?.textContent || "";
    const toastShown = this.shadowRoot.getElementById("toast")?.classList.contains("show");

    let body;
    if (this._error) body = this._renderError();
    else if (!this._info || !this._items.automation || !this._items.scene) body = `<div class="empty"><div class="spinner"></div>Loading…</div>`;
    else if (this._view === "auto") body = this._renderAutoEditor();
    else if (this._view === "scene") body = this._renderSceneEditor();
    else body = this._renderList();

    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      ${this._renderHeader()}
      <div class="content">${body}</div>
      ${this._view === "list" && this._info && !this._error ? `
        <button class="fab" data-act="new">
          <ha-icon icon="mdi:plus"></ha-icon>${this._tab === "automations" ? "New automation" : "New scene"}
        </button>` : ""}
      ${this._menu ? this._renderMenu() : ""}
      ${this._picker ? this._renderPicker() : ""}
      ${this._confirm ? this._renderConfirm() : ""}
      <div id="toast" class="toast ${toastShown ? "show" : ""}">${esc(toastText)}</div>
    `;

    if (this._picker) {
      this._renderPickerList();
      const input = this.shadowRoot.getElementById("pick-search");
      input?.addEventListener("input", (e) => {
        this._picker.filter = e.target.value;
        this._renderPickerList();
      });
    }
    this.scrollTop = this._view !== "list" || this._lastView === "list" ? scroll : 0;
    this._lastView = this._view;
  }

  _renderHeader() {
    const editing = this._view !== "list";
    const title = editing
      ? `${this._editing?.id ? "Edit" : "New"} ${this._view === "auto" ? "automation" : "scene"}`
      : this._panel?.title || "Auto & Scenes";
    return `
      <div class="header">
        <div class="toolbar">
          ${editing
            ? `<button class="icon-btn" data-act="back" aria-label="Back"><ha-icon icon="mdi:arrow-left"></ha-icon></button>`
            : this._narrow ? `<button class="icon-btn" data-act="menu" aria-label="Menu"><ha-icon icon="mdi:menu"></ha-icon></button>` : ""}
          <div class="title">${esc(title)}</div>
          ${editing
            ? `<button class="save-btn" data-act="save" ${this._busy ? "disabled" : ""}>${this._busy ? "Saving…" : "Save"}</button>`
            : `<button class="icon-btn" data-act="reload" aria-label="Refresh"><ha-icon icon="mdi:refresh"></ha-icon></button>`}
        </div>
        ${editing ? "" : `
        <div class="tabs">
          <button class="tab ${this._tab === "automations" ? "active" : ""}" data-act="tab" data-tab="automations">
            <ha-icon icon="mdi:robot-outline"></ha-icon>Automations
          </button>
          <button class="tab ${this._tab === "scenes" ? "active" : ""}" data-act="tab" data-tab="scenes">
            <ha-icon icon="mdi:palette-outline"></ha-icon>Scenes
          </button>
        </div>`}
      </div>`;
  }

  _renderError() {
    return `
      <div class="empty">
        <ha-icon class="big" icon="mdi:lock-alert-outline"></ha-icon>
        <div class="empty-title">Can't open Auto & Scenes</div>
        <div>${esc(this._error)}</div>
        <button class="btn" data-act="reload">Try again</button>
      </div>`;
  }

  _renderList() {
    if (this._tab === "automations") {
      const items = this._items.automation;
      if (!items.length) {
        return `
          <div class="empty">
            <ha-icon class="big" icon="mdi:robot-happy-outline"></ha-icon>
            <div class="empty-title">No automations yet</div>
            <div>Make your home do things on its own – like turning the porch light on at sunset.</div>
          </div>`;
      }
      return `<div class="list">${items.map((it) => this._renderAutoCard(it)).join("")}</div>`;
    }
    const items = this._items.scene;
    if (!items.length) {
      return `
        <div class="empty">
          <ha-icon class="big" icon="mdi:palette-outline"></ha-icon>
          <div class="empty-title">No scenes yet</div>
          <div>Save how you like your lights and devices – like “Movie night” – and set them all with one tap.</div>
        </div>`;
    }
    return `<div class="grid">${items.map((it) => this._renderSceneTile(it)).join("")}</div>`;
  }

  _renderAutoCard(item) {
    const eid = this._entityFor("automation", item);
    const st = eid ? this._hass.states[eid] : null;
    let summary;
    try {
      summary = this._summary(parseAutomation(item.config));
    } catch (e) {
      summary = "Advanced automation";
    }
    const on = st?.state === "on";
    return `
      <div class="card auto-card">
        <button class="card-main" data-act="edit" data-kind="automation" data-id="${esc(item.id)}">
          <span class="avatar"><ha-icon icon="${item.editable ? "mdi:robot-outline" : "mdi:cog-outline"}"></ha-icon></span>
          <span class="card-text">
            <span class="card-title">${esc(item.name || "Unnamed")}</span>
            <span class="card-sub">${esc(summary)}</span>
            <span class="card-meta" ${eid ? `data-live-last="${esc(eid)}"` : ""}>${esc(relTime(st?.attributes?.last_triggered))}</span>
          </span>
        </button>
        <div class="card-side">
          <button class="switch ${on ? "on" : ""}" ${eid ? `data-live-toggle="${esc(eid)}"` : ""} data-act="toggle_auto" data-eid="${esc(eid || "")}" aria-label="Enable or disable"><span></span></button>
          <button class="run-btn" data-act="run_auto" data-eid="${esc(eid || "")}" aria-label="Run now"><ha-icon icon="mdi:play"></ha-icon></button>
        </div>
      </div>`;
  }

  _renderSceneTile(item) {
    const eid = this._entityFor("scene", item);
    const icon = item.config.icon || (eid && this._hass.states[eid]?.attributes?.icon) || "mdi:palette";
    const count = Object.keys(item.config.entities || {}).length;
    return `
      <div class="tile">
        <button class="tile-main" data-act="run_scene" data-eid="${esc(eid || "")}" data-name="${esc(item.name)}">
          <span class="tile-icon"><ha-icon icon="${esc(icon)}"></ha-icon></span>
          <span class="tile-title">${esc(item.name || "Unnamed")}</span>
          <span class="tile-sub">${count} device${count === 1 ? "" : "s"}</span>
        </button>
        <button class="tile-edit" data-act="edit" data-kind="scene" data-id="${esc(item.id)}" aria-label="Edit"><ha-icon icon="mdi:pencil"></ha-icon></button>
      </div>`;
  }

  _seg(list, i, field, options, current, extra = "") {
    return `<div class="seg">${options.map(([v, l]) => `
      <button class="${String(current) === String(v) ? "active" : ""}" data-act="set" data-list="${list}" ${i === undefined ? "" : `data-i="${i}"`} data-field="${field}" data-value="${esc(v)}" ${extra}>${esc(l)}</button>`).join("")}</div>`;
  }

  _entityBtn(list, i, eid, domains) {
    return `
      <button class="entity-btn" data-act="change_entity" data-list="${list}" data-i="${i}" ${domains ? `data-domains="${domains}"` : ""}>
        <ha-icon icon="${esc(this._icon(eid))}"></ha-icon>
        <span>${esc(this._name(eid))}</span>
        <ha-icon class="chev" icon="mdi:chevron-down"></ha-icon>
      </button>`;
  }

  _slider(bind, value, v, id) {
    return `
      <div class="slider-row">
        <span>${esc(v.label)}</span>
        <input type="range" min="${v.min}" max="${v.max}" step="${v.step || 1}" value="${esc(value ?? v.def)}"
          data-bind="${bind}" data-type="number" data-out="${id}" data-unit="${esc(v.unit)}">
        <output id="${id}">${esc(value ?? v.def)}${esc(v.unit)}</output>
      </div>`;
  }

  _removeBtn(list, i) {
    return `<button class="icon-btn small" data-act="remove" data-list="${list}" data-i="${i}" aria-label="Remove"><ha-icon icon="mdi:close"></ha-icon></button>`;
  }

  _renderAutoEditor() {
    const m = this._draft;
    const trig = m.triggers.map((t, i) => {
      let inner = "";
      let icon = "mdi:clock-outline";
      let label = "Time of day";
      if (t.type === "time") {
        inner = `<input class="input" type="time" value="${esc(t.at)}" data-bind="triggers.${i}.at">`;
      } else if (t.type === "sun") {
        icon = t.event === "sunset" ? "mdi:weather-sunset-down" : "mdi:weather-sunset-up";
        label = "Sunrise or sunset";
        inner = `
          ${this._seg("triggers", i, "event", [["sunrise", "Sunrise"], ["sunset", "Sunset"]], t.event)}
          <div class="row">
            <span>Offset</span>
            <select class="input" data-bind="triggers.${i}.offset" data-type="number">
              ${[-120, -90, -60, -45, -30, -15, 0, 15, 30, 45, 60, 90, 120].map((o) => `<option value="${o}" ${Number(t.offset) === o ? "selected" : ""}>${o === 0 ? "Exactly at" : `${Math.abs(o)} min ${o < 0 ? "before" : "after"}`}</option>`).join("")}
            </select>
          </div>`;
      } else {
        icon = "mdi:gesture-tap";
        label = "A device changes";
        const opts = this._stateOptions(t.entity_id);
        inner = `
          ${this._entityBtn("triggers", i, t.entity_id)}
          ${opts.length ? this._seg("triggers", i, "to", [...opts, ["", "Any change"]], t.to) : `<div class="hint">Runs whenever this changes.</div>`}
          <div class="row">
            <span>For at least</span>
            <select class="input" data-bind="triggers.${i}.for_min" data-type="number">
              ${[0, 1, 2, 5, 10, 15, 30, 60].map((n) => `<option value="${n}" ${Number(t.for_min) === n ? "selected" : ""}>${n === 0 ? "Straight away" : `${n} min`}</option>`).join("")}
            </select>
          </div>`;
      }
      return `
        <div class="block">
          <div class="block-head"><ha-icon icon="${icon}"></ha-icon><span>${label}</span>${this._removeBtn("triggers", i)}</div>
          ${inner}
        </div>`;
    }).join(m.triggers.length > 1 ? `<div class="or">or</div>` : "");

    const conds = m.conds.map((c, i) => `
      <div class="block">
        <div class="block-head"><ha-icon icon="mdi:check-circle-outline"></ha-icon><span>Only if</span>${this._removeBtn("conds", i)}</div>
        ${this._entityBtn("conds", i, c.entity_id)}
        ${this._seg("conds", i, "state", this._stateOptions(c.entity_id).map(([v]) => [v, v.replace(/_/g, " ")]), c.state)}
      </div>`).join("");

    const actions = m.actions.map((a, i) => {
      let inner = "";
      let icon = "mdi:flash";
      let label = "";
      if (a.type === "device") {
        const domain = domainOf(a.entity_id);
        const cmds = this._commandsFor(domain);
        const cmd = cmds.find((c) => c.s === a.service);
        label = "Control a device";
        icon = this._icon(a.entity_id);
        inner = `
          ${this._entityBtn("actions", i, a.entity_id)}
          ${this._seg("actions", i, "service", cmds.map((c) => [c.s, c.l]), a.service)}
          ${cmd?.v ? this._slider(`actions.${i}.value`, a.value, cmd.v, `out-a${i}`) : ""}`;
      } else if (a.type === "scene") {
        label = "Activate a scene";
        icon = "mdi:palette";
        inner = this._entityBtn("actions", i, a.entity_id, "scene");
      } else if (a.type === "delay") {
        label = "Wait";
        icon = "mdi:timer-sand";
        inner = `
          <div class="row">
            <input class="input num" type="number" min="0" step="0.5" value="${esc(a.minutes)}" data-bind="actions.${i}.minutes" data-type="number">
            <span>minutes</span>
          </div>`;
      } else if (a.type === "notify") {
        label = "Send a notification";
        icon = "mdi:cellphone-message";
        const phones = this._notifyServices();
        inner = `
          <select class="input" data-bind="actions.${i}.service">
            ${phones.map((p) => `<option value="${esc(p)}" ${p === a.service ? "selected" : ""}>${esc(p.replace("notify.mobile_app_", "").replace(/_/g, " "))}</option>`).join("")}
          </select>
          <input class="input" placeholder="Title (optional)" value="${esc(a.title)}" data-bind="actions.${i}.title">
          <input class="input" placeholder="Message" value="${esc(a.message)}" data-bind="actions.${i}.message">`;
      }
      return `
        <div class="block step">
          <div class="block-head">
            <span class="num-badge">${i + 1}</span><ha-icon icon="${esc(icon)}"></ha-icon><span>${label}</span>
            <button class="icon-btn small" data-act="move" data-i="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Move up"><ha-icon icon="mdi:arrow-up"></ha-icon></button>
            <button class="icon-btn small" data-act="move" data-i="${i}" data-dir="1" ${i === m.actions.length - 1 ? "disabled" : ""} aria-label="Move down"><ha-icon icon="mdi:arrow-down"></ha-icon></button>
            ${this._removeBtn("actions", i)}
          </div>
          ${inner}
        </div>`;
    }).join("");

    const dayChips = DAYS.map(([k, l]) => `<button class="chip ${m.days.includes(k) ? "active" : ""}" data-act="day" data-day="${k}">${l}</button>`).join("");

    return `
      <div class="editor">
        <label class="field">
          <span>Name</span>
          <input class="input big" placeholder="e.g. Porch light at sunset" value="${esc(m.alias)}" data-bind="alias">
        </label>

        <div class="section">
          <div class="section-title"><ha-icon icon="mdi:lightning-bolt-outline"></ha-icon>When</div>
          ${trig || `<div class="hint">Choose what starts this automation.</div>`}
          <button class="add-btn" data-act="add_menu" data-menu="trigger"><ha-icon icon="mdi:plus"></ha-icon>Add a 'When'</button>
        </div>

        <div class="section">
          <div class="section-title"><ha-icon icon="mdi:filter-outline"></ha-icon>Only when <small>optional</small></div>
          <div class="block">
            <div class="block-head"><ha-icon icon="mdi:calendar-week"></ha-icon><span>On these days</span></div>
            <div class="chips">${dayChips}</div>
            <div class="chips presets">
              <button class="link" data-act="days_preset" data-preset="all">Every day</button>
              <button class="link" data-act="days_preset" data-preset="weekdays">Weekdays</button>
              <button class="link" data-act="days_preset" data-preset="weekends">Weekends</button>
            </div>
          </div>
          <div class="block">
            <label class="block-head check">
              <ha-icon icon="mdi:clock-time-four-outline"></ha-icon><span>Only between</span>
              <input type="checkbox" ${m.window.on ? "checked" : ""} data-bind="window.on" data-rerender="1">
            </label>
            ${m.window.on ? `
              <div class="row">
                <input class="input" type="time" value="${esc(m.window.after)}" data-bind="window.after">
                <span>and</span>
                <input class="input" type="time" value="${esc(m.window.before)}" data-bind="window.before">
              </div>` : ""}
          </div>
          ${conds}
          <button class="add-btn" data-act="add_cond"><ha-icon icon="mdi:plus"></ha-icon>Only if a device is…</button>
        </div>

        <div class="section">
          <div class="section-title"><ha-icon icon="mdi:play-circle-outline"></ha-icon>Then do</div>
          ${actions || `<div class="hint">Add what should happen, in order.</div>`}
          <button class="add-btn" data-act="add_menu" data-menu="action"><ha-icon icon="mdi:plus"></ha-icon>Add a step</button>
        </div>

        ${this._editing?.id ? `<button class="danger-btn" data-act="delete"><ha-icon icon="mdi:delete-outline"></ha-icon>Delete automation</button>` : ""}
      </div>`;
  }

  _renderSceneEditor() {
    const m = this._draft;
    const rows = m.entities.map((r, i) => {
      const d = domainOf(r.entity_id);
      let stateOpts = SCENE_STATES[d];
      if (d === "climate") {
        stateOpts = (this._hass.states[r.entity_id]?.attributes?.hvac_modes || ["off", "heat", "cool"]).map((x) => [x, x.replace(/_/g, " ")]);
      }
      let extra = "";
      if (d === "light" && r.state === "on") {
        extra = this._slider(`entities.${i}.brightness_pct`, r.brightness_pct ?? 100, { label: "Brightness", unit: "%", min: 1, max: 100, def: 100 }, `out-s${i}`);
      }
      if (d === "cover" && r.state === "open") {
        extra = this._slider(`entities.${i}.position`, r.position ?? 100, { label: "Position", unit: "%", min: 0, max: 100, def: 100 }, `out-s${i}`);
      }
      if (d === "climate" && r.state !== "off") {
        extra = this._slider(`entities.${i}.temperature`, r.temperature ?? 22, { label: "Temperature", unit: "°", min: 10, max: 32, step: 0.5, def: 22 }, `out-s${i}`);
      }
      return `
        <div class="block">
          <div class="block-head">
            <ha-icon icon="${esc(this._icon(r.entity_id))}"></ha-icon><span>${esc(this._name(r.entity_id))}</span>
            ${this._removeBtn("entities", i)}
          </div>
          ${this._seg("entities", i, "state", stateOpts || [["on", "On"], ["off", "Off"]], r.state)}
          ${extra}
        </div>`;
    }).join("");

    return `
      <div class="editor">
        <label class="field">
          <span>Name</span>
          <input class="input big" placeholder="e.g. Movie night" value="${esc(m.name)}" data-bind="name">
        </label>
        <div class="section">
          <div class="section-title"><ha-icon icon="mdi:emoticon-outline"></ha-icon>Icon</div>
          <div class="icon-pick">
            ${SCENE_ICONS.map((ic) => `<button class="${m.icon === ic ? "active" : ""}" data-act="scene_icon" data-icon="${ic}"><ha-icon icon="${ic}"></ha-icon></button>`).join("")}
          </div>
        </div>
        <div class="section">
          <div class="section-title"><ha-icon icon="mdi:devices"></ha-icon>Devices in this scene</div>
          ${rows || `<div class="hint">Add the lights and devices this scene should set. Tip: set them up the way you like first, then tap “Use how they are now”.</div>`}
          <button class="add-btn" data-act="scene_add"><ha-icon icon="mdi:plus"></ha-icon>Add a device</button>
          ${m.entities.length ? `
          <div class="two">
            <button class="btn ghost" data-act="scene_capture"><ha-icon icon="mdi:camera-outline"></ha-icon>Use how they are now</button>
            <button class="btn ghost" data-act="scene_preview"><ha-icon icon="mdi:eye-outline"></ha-icon>Try it</button>
          </div>` : ""}
        </div>
        ${this._editing?.id ? `<button class="danger-btn" data-act="delete"><ha-icon icon="mdi:delete-outline"></ha-icon>Delete scene</button>` : ""}
      </div>`;
  }

  _renderMenu() {
    const items = this._menu === "trigger"
      ? [
          ["add_trigger", "time", "mdi:clock-outline", "Time of day", "e.g. every morning at 07:00"],
          ["add_trigger", "sun", "mdi:weather-sunset", "Sunrise or sunset", "e.g. 15 minutes before sunset"],
          ["add_trigger", "state", "mdi:gesture-tap", "A device changes", "e.g. a door opens or someone gets home"],
        ]
      : [
          ["add_action", "device", "mdi:lightbulb-on-outline", "Control a device", "Turn on, off, open, set temperature…"],
          ["add_action", "scene", "mdi:palette", "Activate a scene", "Set lots of devices at once"],
          ["add_action", "delay", "mdi:timer-sand", "Wait", "Pause before the next step"],
          ...(this._info?.allow_notify ? [["add_action", "notify", "mdi:cellphone-message", "Send a notification", "To a phone with the Home Assistant app"]] : []),
        ];
    return `
      <div class="overlay" data-act="close_menu">
        <div class="sheet" data-act="noop">
          <div class="sheet-title">${this._menu === "trigger" ? "Start this automation when…" : "Add a step"}</div>
          ${items.map(([act, type, icon, title, sub]) => `
            <button class="menu-row" data-act="${act}" data-type="${type}">
              <span class="avatar"><ha-icon icon="${icon}"></ha-icon></span>
              <span class="card-text"><span class="card-title">${title}</span><span class="card-sub">${sub}</span></span>
            </button>`).join("")}
        </div>
      </div>`;
  }

  _act_noop() {}

  _renderPicker() {
    return `
      <div class="overlay" data-act="close_picker">
        <div class="sheet tall" data-act="noop">
          <div class="pick-head">
            <input id="pick-search" class="input" placeholder="Search devices…" autocomplete="off" value="${esc(this._picker.filter)}">
            <button class="icon-btn" data-act="close_picker" aria-label="Close"><ha-icon icon="mdi:close"></ha-icon></button>
          </div>
          <div id="pick-list" class="pick-list"></div>
        </div>
      </div>`;
  }

  _renderConfirm() {
    return `
      <div class="overlay center" data-act="confirm_no">
        <div class="dialog" data-act="noop">
          <div>${esc(this._confirm.text)}</div>
          <div class="dialog-actions">
            <button class="btn ghost" data-act="confirm_no">Cancel</button>
            <button class="btn danger" data-act="confirm_yes">Delete</button>
          </div>
        </div>
      </div>`;
  }
}

const STYLES = `
  :host {
    display: block; height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch;
    --as-primary: var(--primary-color, #03a9f4);
    --as-bg: var(--primary-background-color, #f5f5f5);
    --as-card: var(--card-background-color, var(--ha-card-background, #fff));
    --as-text: var(--primary-text-color, #212121);
    --as-sub: var(--secondary-text-color, #727272);
    --as-divider: var(--divider-color, rgba(0,0,0,.12));
    --as-radius: var(--ha-card-border-radius, 16px);
    background: var(--as-bg); color: var(--as-text);
    font-family: var(--paper-font-body1_-_font-family, var(--ha-font-family-body, Roboto, system-ui, sans-serif));
    -webkit-tap-highlight-color: transparent;
  }
  * { box-sizing: border-box; }
  button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; padding: 0; }
  button[disabled] { opacity: .35; cursor: default; }
  ha-icon { --mdc-icon-size: 22px; display: inline-flex; }

  .header { position: sticky; top: 0; z-index: 3; background: var(--app-header-background-color, var(--as-primary)); color: var(--app-header-text-color, #fff); }
  .toolbar { display: flex; align-items: center; gap: 4px; height: 56px; padding: 0 8px; }
  .title { flex: 1; font-size: 20px; font-weight: 500; padding: 0 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .icon-btn { width: 44px; height: 44px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; flex: none; }
  .icon-btn:active { background: rgba(127,127,127,.2); }
  .icon-btn.small { width: 36px; height: 36px; color: var(--as-sub); }
  .icon-btn.small ha-icon { --mdc-icon-size: 20px; }
  .save-btn { background: rgba(255,255,255,.2); padding: 8px 18px; border-radius: 20px; font-weight: 600; }
  .tabs { display: flex; padding: 0 8px; }
  .tab { flex: 1; display: flex; gap: 8px; align-items: center; justify-content: center; padding: 12px 8px; opacity: .75; border-bottom: 3px solid transparent; font-weight: 500; }
  .tab.active { opacity: 1; border-bottom-color: currentColor; }

  .content { padding: 16px 16px 120px; }
  .list, .editor { max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }

  .card { background: var(--as-card); border-radius: var(--as-radius); display: flex; align-items: center; box-shadow: var(--ha-card-box-shadow, 0 1px 3px rgba(0,0,0,.12)); border: var(--ha-card-border-width, 0) solid var(--ha-card-border-color, var(--as-divider)); }
  .card-main { flex: 1; display: flex; gap: 14px; align-items: center; padding: 14px 4px 14px 14px; text-align: left; min-width: 0; }
  .avatar { width: 42px; height: 42px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex: none; background: color-mix(in srgb, var(--as-primary) 15%, transparent); color: var(--as-primary); }
  .card-text { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
  .card-title { font-weight: 600; font-size: 16px; }
  .card-sub { color: var(--as-sub); font-size: 14px; }
  .card-meta { color: var(--as-sub); font-size: 12px; opacity: .8; }
  .card-side { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 10px 14px 10px 4px; }
  .run-btn { width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--as-primary) 12%, transparent); color: var(--as-primary); }
  .run-btn:active { transform: scale(.92); }

  .switch { width: 46px; height: 28px; border-radius: 14px; background: var(--as-divider); position: relative; transition: background .2s; }
  .switch span { position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.3); transition: transform .2s; }
  .switch.on { background: var(--as-primary); }
  .switch.on span { transform: translateX(18px); }

  .grid { max-width: 720px; margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
  .tile { position: relative; background: var(--as-card); border-radius: var(--as-radius); box-shadow: var(--ha-card-box-shadow, 0 1px 3px rgba(0,0,0,.12)); }
  .tile-main { width: 100%; padding: 18px 14px 16px; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; text-align: left; border-radius: var(--as-radius); transition: transform .15s; }
  .tile-main:active { transform: scale(.96); }
  .tile-main.pulse .tile-icon { animation: pulse .7s; }
  @keyframes pulse { 0% { transform: scale(1); } 40% { transform: scale(1.25); background: var(--as-primary); color: #fff; } 100% { transform: scale(1); } }
  .tile-icon { width: 48px; height: 48px; border-radius: 14px; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--as-primary) 15%, transparent); color: var(--as-primary); margin-bottom: 8px; }
  .tile-icon ha-icon { --mdc-icon-size: 28px; }
  .tile-title { font-weight: 600; font-size: 16px; }
  .tile-sub { font-size: 13px; color: var(--as-sub); }
  .tile-edit { position: absolute; top: 6px; right: 6px; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--as-sub); }
  .tile-edit ha-icon { --mdc-icon-size: 18px; }

  .fab { position: fixed; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom)); z-index: 4; display: flex; gap: 8px; align-items: center; background: var(--as-primary); color: var(--text-primary-color, #fff); padding: 14px 20px 14px 16px; border-radius: 28px; font-weight: 600; box-shadow: 0 4px 12px rgba(0,0,0,.25); }
  .fab:active { transform: scale(.96); }

  .empty { text-align: center; color: var(--as-sub); padding: 48px 24px; display: flex; flex-direction: column; align-items: center; gap: 10px; max-width: 420px; margin: 0 auto; line-height: 1.5; }
  .empty.small { padding: 24px; }
  .empty .big { --mdc-icon-size: 64px; color: var(--as-primary); opacity: .6; }
  .empty-title { font-size: 18px; font-weight: 600; color: var(--as-text); }
  .spinner { width: 32px; height: 32px; border: 3px solid var(--as-divider); border-top-color: var(--as-primary); border-radius: 50%; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--as-sub); font-weight: 500; }
  .input { width: 100%; font: inherit; font-size: 16px; color: var(--as-text); background: var(--as-card); border: 1px solid var(--as-divider); border-radius: 12px; padding: 12px 14px; min-height: 46px; }
  .input:focus { outline: 2px solid var(--as-primary); outline-offset: -1px; }
  .input.big { font-size: 18px; font-weight: 500; }
  .input.num { width: 100px; }
  select.input { appearance: auto; }
  .section { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
  .section-title { display: flex; gap: 8px; align-items: center; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--as-primary); }
  .section-title small { text-transform: none; letter-spacing: 0; color: var(--as-sub); font-weight: 400; }
  .block { background: var(--as-card); border-radius: var(--as-radius); padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 10px; box-shadow: var(--ha-card-box-shadow, 0 1px 3px rgba(0,0,0,.12)); }
  .block-head { display: flex; align-items: center; gap: 10px; font-weight: 600; min-height: 36px; }
  .block-head > span:not(.num-badge) { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .block-head > ha-icon { color: var(--as-primary); }
  .block-head.check input { width: 22px; height: 22px; accent-color: var(--as-primary); }
  .num-badge { width: 24px; height: 24px; border-radius: 50%; background: var(--as-primary); color: var(--text-primary-color, #fff); font-size: 13px; display: flex; align-items: center; justify-content: center; flex: none; }
  .or { text-align: center; font-size: 12px; color: var(--as-sub); text-transform: uppercase; letter-spacing: .1em; }
  .row { display: flex; align-items: center; gap: 10px; }
  .row > span { white-space: nowrap; color: var(--as-sub); }
  .row .input { flex: 1; }
  .row .input.num { flex: none; }
  .hint { color: var(--as-sub); font-size: 14px; padding: 4px 2px; line-height: 1.45; }

  .seg { display: flex; flex-wrap: wrap; gap: 6px; }
  .seg button, .chip { padding: 9px 14px; border-radius: 20px; border: 1px solid var(--as-divider); font-size: 14px; min-height: 38px; text-transform: capitalize; }
  .seg button.active, .chip.active { background: var(--as-primary); border-color: var(--as-primary); color: var(--text-primary-color, #fff); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { min-width: 52px; }
  .presets { gap: 16px; }
  .link { color: var(--as-primary); font-size: 14px; padding: 4px 0; }

  .entity-btn { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; border: 1px solid var(--as-divider); border-radius: 12px; text-align: left; min-height: 46px; }
  .entity-btn span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .entity-btn ha-icon { color: var(--as-primary); }
  .entity-btn .chev { color: var(--as-sub); }

  .slider-row { display: grid; grid-template-columns: auto 1fr 52px; align-items: center; gap: 12px; color: var(--as-sub); font-size: 14px; }
  .slider-row input { width: 100%; accent-color: var(--as-primary); height: 28px; }
  .slider-row output { text-align: right; color: var(--as-text); font-weight: 600; }

  .add-btn { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 14px; border: 2px dashed var(--as-divider); border-radius: var(--as-radius); color: var(--as-primary); font-weight: 600; }
  .add-btn:active { background: color-mix(in srgb, var(--as-primary) 8%, transparent); }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 18px; border-radius: 12px; background: var(--as-primary); color: var(--text-primary-color, #fff); font-weight: 600; }
  .btn.ghost { background: transparent; color: var(--as-primary); border: 1px solid var(--as-divider); }
  .btn.danger { background: var(--error-color, #db4437); color: #fff; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .danger-btn { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 24px; padding: 14px; color: var(--error-color, #db4437); font-weight: 600; border-radius: var(--as-radius); }
  .icon-pick { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
  .icon-pick button { aspect-ratio: 1; border-radius: 12px; background: var(--as-card); display: flex; align-items: center; justify-content: center; border: 2px solid transparent; }
  .icon-pick button.active { border-color: var(--as-primary); color: var(--as-primary); }

  .overlay { position: fixed; inset: 0; z-index: 10; background: rgba(0,0,0,.45); display: flex; align-items: flex-end; justify-content: center; animation: fade .15s; }
  .overlay.center { align-items: center; padding: 24px; }
  @keyframes fade { from { opacity: 0; } }
  .sheet { background: var(--as-card); width: 100%; max-width: 560px; border-radius: 20px 20px 0 0; padding: 8px 8px calc(16px + env(safe-area-inset-bottom)); animation: up .2s ease-out; max-height: 85%; display: flex; flex-direction: column; }
  .sheet.tall { height: 85%; }
  @keyframes up { from { transform: translateY(40px); opacity: .5; } }
  .sheet-title { padding: 14px 14px 8px; font-weight: 700; font-size: 17px; }
  .menu-row { display: flex; gap: 14px; align-items: center; padding: 12px 14px; border-radius: 14px; text-align: left; }
  .menu-row:active, .pick-row:active { background: color-mix(in srgb, var(--as-primary) 10%, transparent); }
  .pick-head { display: flex; gap: 4px; padding: 8px 6px; align-items: center; }
  .pick-list { overflow-y: auto; flex: 1; -webkit-overflow-scrolling: touch; }
  .pick-row { display: flex; align-items: center; gap: 14px; width: 100%; padding: 12px 14px; border-radius: 12px; text-align: left; }
  .pick-row ha-icon { color: var(--as-primary); }
  .pick-text { display: flex; flex-direction: column; min-width: 0; }
  .pick-text small { color: var(--as-sub); text-transform: capitalize; }
  .dialog { background: var(--as-card); border-radius: 20px; padding: 22px; max-width: 380px; width: 100%; display: flex; flex-direction: column; gap: 20px; font-size: 16px; line-height: 1.45; }
  .dialog-actions { display: flex; justify-content: flex-end; gap: 10px; }

  .toast { position: fixed; left: 50%; bottom: calc(88px + env(safe-area-inset-bottom)); transform: translate(-50%, 20px); background: #323232; color: #fff; padding: 12px 18px; border-radius: 12px; font-size: 14px; max-width: calc(100% - 32px); opacity: 0; pointer-events: none; transition: all .25s; z-index: 20; text-align: center; }
  .toast.show { opacity: 1; transform: translate(-50%, 0); }
`;

if (!customElements.get("auto-and-scenes-panel")) {
  customElements.define("auto-and-scenes-panel", AutoAndScenesPanel);
}
