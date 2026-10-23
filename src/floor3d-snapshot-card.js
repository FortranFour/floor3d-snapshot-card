/* floor3d-snapshot-card — a static, tappable floor plan made from a floor3d-family
 * 3D model. Guests' devices load one small module and two images; the 3D work runs
 * only in the card editor (see snapshot.js, loaded on demand).
 */
import { solarPosition, sunVector, northVector, compassName } from "./sun.js";
import { decodeLight, shade, compose, nextUpdateMinutes, phase } from "./sunlight.js";
export const VERSION = typeof __VERSION__ !== "undefined" ? __VERSION__ : "dev";
export const SUN_PREVIEW_EVENT = "floor3d-snapshot-sun-preview";
const EDIT_ROOM_EVENT = "floor3d-snapshot-edit-room";

const BAD = new Set(["unknown", "unavailable", "none", ""]);
const available = (s) => !!s && !BAD.has(s.state);
const isOn = (s) => available(s) && !["off", "standby", "idle", "closed", "locked", "paused"].includes(s.state);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const domainOf = (id) => String(id || "").split(".")[0];
const num = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
const titleCase = (v) => String(v ?? "").replace(/(^|[\s/-])([a-z])/g, (m, p, c) => p + c.toUpperCase());
const icon = (name) => `<ha-icon icon="${esc(name)}" aria-hidden="true"></ha-icon>`;
const ACTIVE_DOMAINS = new Set(["light", "switch", "fan", "input_boolean", "media_player"]);
const DEFAULT_ICONS = { light: "mdi:lightbulb-outline", switch: "mdi:toggle-switch-outline", fan: "mdi:fan", cover: "mdi:window-shutter", climate: "mdi:thermostat", media_player: "mdi:television", lock: "mdi:lock-outline", scene: "mdi:palette-outline", script: "mdi:script-text-outline", sensor: "mdi:eye-outline", binary_sensor: "mdi:checkbox-blank-circle-outline", input_boolean: "mdi:toggle-switch-outline", button: "mdi:gesture-tap-button", input_button: "mdi:gesture-tap-button", alarm_control_panel: "mdi:shield-home-outline", vacuum: "mdi:robot-vacuum" };
const SENSITIVE_COVERS = new Set(["garage", "gate", "door"]);
// weather states → [label, icon]
const WEATHER = { "clear-night": ["Clear", "mdi:weather-night"], cloudy: ["Cloudy", "mdi:weather-cloudy"], exceptional: ["Unusual", "mdi:alert-circle-outline"], fog: ["Fog", "mdi:weather-fog"], hail: ["Hail", "mdi:weather-hail"], lightning: ["Lightning", "mdi:weather-lightning"], "lightning-rainy": ["Storms", "mdi:weather-lightning-rainy"], partlycloudy: ["Partly cloudy", "mdi:weather-partly-cloudy"], pouring: ["Heavy rain", "mdi:weather-pouring"], rainy: ["Rain", "mdi:weather-rainy"], snowy: ["Snow", "mdi:weather-snowy"], "snowy-rainy": ["Sleet", "mdi:weather-snowy-rainy"], sunny: ["Sunny", "mdi:weather-sunny"], windy: ["Windy", "mdi:weather-windy"], "windy-variant": ["Windy", "mdi:weather-windy-variant"] };
const COLOR_MODES = ["hs", "xy", "rgb", "rgbw", "rgbww"];
// color wheel: white in the middle, eight pastel hues clockwise from red at the top.
// [label, hue, saturation sent to the bulb]; the swatch shows the same hue as a pastel.
const WHEEL_WHITE = ["White", 0, 0];
const WHEEL = [["Red", 0, 55], ["Orange", 30, 55], ["Yellow", 52, 55], ["Green", 130, 50], ["Cyan", 185, 50], ["Blue", 220, 55], ["Purple", 270, 50], ["Pink", 325, 50]];
const SWATCHES = [WHEEL_WHITE, ...WHEEL];
const hsCss = (h, s) => (s ? `hsl(${h},62%,77%)` : "#fbfbf8");
const mixHex = (a, b, t) => { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const x = p(a), y = p(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",")})`; };

const STYLE = `
:host{display:block;--f3s-blue:rgb(var(--rgb-primary-color,3,169,244));--f3s-ink:var(--primary-text-color,#233246);--f3s-muted:var(--secondary-text-color,#677587);--f3s-surface:var(--ha-card-background,var(--card-background-color,#fff));--f3s-line:rgba(var(--rgb-primary-text-color,33,33,33),.1);--f3s-amber:#dfac2a}
*{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}button:disabled{cursor:default;opacity:.45}button:focus-visible,input:focus-visible{outline:3px solid var(--f3s-blue);outline-offset:3px}ha-icon{width:22px;height:22px;flex:none;color:inherit}
ha-card{padding:16px;color:var(--f3s-ink);overflow:hidden}
.head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:8px 16px;margin:0 2px 10px}.head .titles{flex:1 1 220px;min-width:0}.status{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:0 1 auto;min-width:0}.when{color:var(--f3s-muted);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}.schips{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px}.schip{display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:4px 11px 4px 9px;border:1px solid var(--f3s-line);border-radius:16px;background:var(--f3s-surface);color:var(--f3s-ink);font-size:13px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.04)}.schip ha-icon{width:18px;height:18px;color:var(--f3s-blue)}.schip[aria-disabled=true]{cursor:default}.schip.guest{color:var(--f3s-muted)}.schip.guest[aria-pressed=true]{color:var(--f3s-ink);border-color:rgba(var(--rgb-primary-color,3,169,244),.45);background:rgba(var(--rgb-primary-color,3,169,244),.07)}
:host(.narrow) .status{flex:1 1 100%;flex-direction:row;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 10px}:host(.narrow) .schips{justify-content:flex-start}:host(.narrow) .when{flex:1 1 100%}.head h2{margin:0;font-size:20px;font-weight:500;letter-spacing:-.3px}.head p{margin:2px 0 0;color:var(--f3s-muted);font-size:13px}
.layout{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(280px,1fr);gap:16px;align-items:start}:host(.stacked) .layout{grid-template-columns:minmax(0,1fr)}.layout>*{min-width:0}
.map{position:relative;width:min(100%,calc((100vh - 260px) * var(--aspect,1.2)));min-width:min(100%,280px);margin:0 auto;aspect-ratio:var(--aspect,1.2);-webkit-user-select:none;user-select:none;touch-action:manipulation;-webkit-tap-highlight-color:transparent;cursor:default}.map.hovering{cursor:pointer}
.map{isolation:isolate}.map img,.map canvas{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}.map img,.map canvas.sun{-webkit-mask-size:100% 100%;mask-size:100% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat}.map canvas.sun{mix-blend-mode:multiply;opacity:0;transition:opacity 2.4s ease}.map canvas.sun.show{opacity:1}.map.preview canvas.sun{transition-duration:.2s}
.compass{position:absolute;left:4px;bottom:4px;width:30px;height:30px;border-radius:50%;border:1px solid var(--f3s-line);background:var(--f3s-surface);color:var(--f3s-muted);display:grid;place-items:center;box-shadow:0 1px 3px rgba(0,0,0,.08)}.compass svg{width:24px;height:24px;transform:rotate(var(--north,0deg))}:host(.dark) .map:not(.staged) img{filter:brightness(.8) contrast(1.05)}.map.staged{border-radius:14px;background:var(--f3s-stage)}
.pins{position:absolute;inset:0}.pin{position:absolute;transform:translate(-15px,-50%);display:flex;align-items:center;gap:5px;height:30px;min-width:30px;padding:0 5px;border-radius:15px;border:1px solid var(--f3s-line);background:var(--f3s-surface);color:var(--f3s-muted);box-shadow:0 1px 4px rgba(0,0,0,.12);font-size:12px;font-weight:500;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .2s ease}.pin:before{content:"";position:absolute;inset:-8px}.pin ha-icon{width:18px;height:18px}.pin-name{display:none;padding-right:3px}.pin.on{color:var(--f3s-amber);border-color:rgba(223,172,42,.55)}.pin[aria-pressed=true]{background:var(--f3s-blue);border-color:var(--f3s-blue);color:#fff;z-index:2}.pin-count{position:absolute;top:-6px;right:-6px;min-width:16px;height:16px;border-radius:8px;background:var(--f3s-amber);color:#fff;font-size:10px;line-height:16px;text-align:center;padding:0 4px;font-weight:600}
.pin.always,.map.labels .pin,.pin:focus-visible,.pin.hover{opacity:1;pointer-events:auto}.pin.flash{animation:f3s-flash 2.6s ease forwards}@keyframes f3s-flash{0%,65%{opacity:1}100%{opacity:0}}.pin.hover .pin-name,.pin.flash .pin-name,.map.labels .pin[aria-pressed=true] .pin-name{display:inline}
.legend{display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:8px;color:var(--f3s-muted);font-size:12px}.swatch{display:inline-block;width:11px;height:11px;border-radius:4px;margin-right:6px;vertical-align:-1px}.swatch.sel{background:rgba(var(--rgb-primary-color,3,169,244),.5)}.swatch.on{background:rgba(255,193,7,.5)}.toggle{margin-left:auto;display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:3px 10px;border:1px solid var(--f3s-line);border-radius:10px;background:transparent;color:var(--f3s-muted);font-size:12px}.toggle[aria-pressed=true]{color:var(--f3s-blue);border-color:rgba(var(--rgb-primary-color,3,169,244),.5);background:rgba(var(--rgb-primary-color,3,169,244),.07)}.toggle ha-icon{width:16px;height:16px}
.chips{display:flex;gap:6px;overflow-x:auto;padding:2px 1px 8px;max-width:100%;scrollbar-width:thin}.chip{display:inline-flex;align-items:center;gap:6px;flex:none;min-height:38px;padding:4px 12px;border:1px solid var(--f3s-line);border-radius:12px;background:transparent;color:var(--f3s-ink);font-size:13px}.chip[aria-pressed=true]{border-color:rgba(var(--rgb-primary-color,3,169,244),.6);background:rgba(var(--rgb-primary-color,3,169,244),.08);color:var(--f3s-blue)}.chip ha-icon{width:18px;height:18px}
.panel{border:1px solid var(--f3s-line);border-radius:16px;padding:16px;min-width:0}.roomhead{display:flex;gap:12px;align-items:center;margin-bottom:14px}.roomicon{display:grid;place-items:center;width:44px;height:44px;border-radius:14px;background:rgba(var(--rgb-primary-color,3,169,244),.075);color:var(--f3s-blue)}.roomhead h3{margin:0 0 3px;font-size:20px;font-weight:500}.roomhead p{margin:0;color:var(--f3s-muted);font-size:13px}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:9px}.tile{border:1px solid var(--f3s-line);border-radius:14px;overflow:hidden;min-width:0}.tile.on{background:rgba(var(--rgb-primary-color,3,169,244),.06)}.row{display:flex;align-items:center;gap:10px;width:100%;min-height:68px;padding:12px;border:0;background:transparent;color:inherit;text-align:left}.ticon{display:grid;place-items:center;width:36px;height:36px;flex:none;border-radius:11px;background:rgba(var(--rgb-primary-text-color,33,33,33),.05);color:var(--f3s-muted)}.tile.on .ticon{color:#d7a329;background:rgba(255,193,7,.13)}.ttext{flex:1;min-width:0}.tname{display:block;font-size:14px;font-weight:500;line-height:1.3;overflow-wrap:anywhere}.tstate{display:block;color:var(--f3s-muted);font-size:12px;margin-top:3px}.sw{flex:none;width:28px;height:17px;border-radius:10px;background:rgba(var(--rgb-primary-text-color,33,33,33),.14);padding:3px}.sw:before{content:"";display:block;width:11px;height:11px;border-radius:50%;background:var(--f3s-surface)}.tile.on .sw{background:var(--f3s-blue)}.tile.on .sw:before{margin-left:11px}
.extra{padding:0 12px 12px}.ctl{margin-top:2px}.ctl-l{display:block;font-size:11px;color:var(--f3s-muted);margin:2px 0 -2px}.range.warmth{accent-color:#e9a65a}.wheel{position:relative;width:136px;height:136px;margin:4px auto 0}.swatch-b{position:absolute;width:32px;height:32px;margin:-16px 0 0 -16px;border-radius:50%;border:1px solid rgba(0,0,0,.14);background:var(--sw);padding:0}.swatch-b[aria-pressed=true]{box-shadow:0 0 0 2px var(--f3s-surface),0 0 0 4px var(--f3s-blue)}.range{display:block;width:100%;height:30px;margin:0;accent-color:var(--f3s-blue);touch-action:pan-x}.seg{display:flex;gap:5px}.seg button{flex:1;min-height:38px;border:1px solid var(--f3s-line);border-radius:10px;background:transparent;color:var(--f3s-muted);font-size:12px}.seg button[aria-pressed=true]{color:var(--f3s-blue);border-color:rgba(var(--rgb-primary-color,3,169,244),.5);background:rgba(var(--rgb-primary-color,3,169,244),.07)}.temp{display:flex;align-items:center;gap:10px;justify-content:space-between}.temp .val{font-size:20px}.step{width:42px;height:40px;border:1px solid var(--f3s-line);border-radius:11px;background:rgba(var(--rgb-primary-color,3,169,244),.05);color:var(--f3s-blue);font-size:22px}
.foot{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:12px}.quiet{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:6px 12px;border:1px solid var(--f3s-line);border-radius:11px;background:transparent;color:var(--f3s-muted);font-size:12px}.quiet ha-icon{width:17px;height:17px}.hint{color:var(--f3s-muted);font-size:11px}
.empty{padding:20px;text-align:center;color:var(--f3s-muted);font-size:14px;line-height:1.6;border:1px dashed var(--f3s-line);border-radius:14px}.toast{position:fixed;z-index:10;bottom:24px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 32px);border:1px solid var(--f3s-line);border-radius:14px;background:var(--f3s-surface);padding:12px 16px;box-shadow:0 4px 18px rgba(0,0,0,.12);font-size:13px}
@media(max-width:600px){.pin{height:26px;min-width:26px;padding:0 4px;transform:translate(-13px,-50%);font-size:11px}.pin ha-icon{width:16px;height:16px}.pin:before{inset:-9px}}
`;
let SHEET = null;
const adoptStyle = (root) => {
  try { if (!SHEET) { SHEET = new CSSStyleSheet(); SHEET.replaceSync(STYLE); } root.adoptedStyleSheets = [SHEET]; }
  catch { const s = document.createElement("style"); s.textContent = STYLE; root.appendChild(s); }
};

export class Floor3dSnapshotCard extends HTMLElement {
  static async getConfigElement() {
    await import("./editor.js");
    return document.createElement("floor3d-snapshot-card-editor");
  }
  static getStubConfig() { return { title: "Home", rooms: [] }; }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    adoptStyle(this.shadowRoot);
    this._card = document.createElement("ha-card");
    this.shadowRoot.appendChild(this._card);
    try { this._labels = localStorage.getItem("floor3d-snapshot-labels") === "1"; } catch { this._labels = false; }
    this._busy = new Set();
    this._confirm = null;
    this.shadowRoot.addEventListener("click", (e) => this._click(e));
    this.shadowRoot.addEventListener("change", (e) => this._change(e));
    // Touch safety: never replace the tapped node between pointerdown and click (iOS drops it).
    this.shadowRoot.addEventListener("pointerdown", (e) => { if (e.target.matches?.("input[type=range]")) this._dragging = true; this._pointer = true; clearTimeout(this._pt); this._pt = setTimeout(() => this._release(), 1500); });
    this.shadowRoot.addEventListener("pointerup", () => this._release());
    this.shadowRoot.addEventListener("pointercancel", () => this._release());
    this._ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => this._layout()) : null;
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    const rooms = Array.isArray(config.rooms) ? config.rooms : [];
    const ids = rooms.map((r) => r.id);
    if (new Set(ids).size !== ids.length) throw new Error("Room ids must be unique");
    this._config = { guest_mode: true, ...config, rooms };
    if (!ids.includes(this._room)) this._room = ids.includes(config.default_room) ? config.default_room : ids[0];
    this._followEditor();
    this._mapEl = null; this._index = null; this._tintKey = ""; this._light = null; this._direct = null; this._shadeKey = ""; this._directKey = ""; this._sunKey = "";
    this._allowAll();
    this._request();
  }
  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    this.classList.toggle("dark", !!hass?.themes?.darkMode);
    const theme = `${hass?.themes?.theme}|${hass?.themes?.darkMode}`;
    if (theme !== this._theme) { this._theme = theme; this._primary = ""; this._tintKey = ""; }
    if (this._config && this._guest() !== this._guestNow) this._allowAll();   // the guest-mode switch flipped
    const watch = [this._config?.weather_entity, this._config?.indoor_entity, this._config?.guest_mode_entity].filter(Boolean);
    if (!old || [...this._entities, ...watch].some((id) => old.states[id] !== hass.states[id])) this._request();
    if (!old) this._updateSun();
  }
  get hass() { return this._hass; }
  getCardSize() { return 10; }
  getGridOptions() { return { columns: "full", rows: "auto" }; }
  // In the card editor's preview, show the room being edited, also on a preview card that a host
  // (a wrapper card, say) builds anew for every change.
  set preview(v) { this._isPreview = !!v; this._followEditor(); }
  get preview() { return !!this._isPreview; }
  _inEditDialog() {
    for (let n = this; n; n = n.parentNode || n.host) if (n.localName === "hui-dialog-edit-card" || n.localName === "hui-card-preview") return true;
    return false;
  }
  _followEditor() {
    const id = window.__floor3dSnapshotEditRoom;
    if (!(this._isPreview || (this.isConnected && this._inEditDialog())) || !id || !this._config?.rooms.some((r) => r.id === id) || id === this._room) return;
    this._room = id; this._request();
  }
  connectedCallback() {
    this._onEditRoom ||= () => this._followEditor();
    window.addEventListener(EDIT_ROOM_EVENT, this._onEditRoom);
    this._ro?.observe(this); this._layout(); this._request();
    this._onPreview ||= (e) => { this._sunPreview = Number.isFinite(e.detail?.time) ? e.detail.time : null; this._mapEl?.classList.toggle("preview", this._sunPreview !== null); this._updateSun(); };
    this._onVisible ||= () => { if (document.visibilityState === "visible") this._updateSun(); };
    window.addEventListener(SUN_PREVIEW_EVENT, this._onPreview); document.addEventListener("visibilitychange", this._onVisible);
    this._updateSun();
  }
  disconnectedCallback() {
    this._ro?.disconnect(); clearTimeout(this._pt); clearTimeout(this._toastTimer); clearTimeout(this._sunTimer); clearTimeout(this._clockTimer); this._clockTimer = null; this._pointer = false;
    window.removeEventListener(SUN_PREVIEW_EVENT, this._onPreview); window.removeEventListener(EDIT_ROOM_EVENT, this._onEditRoom); document.removeEventListener("visibilitychange", this._onVisible);
  }

  _layout() {
    const w = this.getBoundingClientRect().width;
    if (!w) return;
    const mode = this._config?.layout;
    this.classList.toggle("stacked", mode === "stacked" || (mode !== "side" && w < 760));
    this.classList.toggle("narrow", w < 560);
  }
  _request() {
    if (this._queued || !this.isConnected) return;
    this._queued = true;
    requestAnimationFrame(() => {
      this._queued = false;
      if (!this.isConnected || !this._config) return;
      if (this._pointer || this._dragging) { this._held = true; return; }
      this._render();
    });
  }
  _release() {
    clearTimeout(this._pt);
    if (!this._pointer && !this._dragging) return;
    this._pointer = false; this._dragging = false;
    if (this._held) { this._held = false; setTimeout(() => this._request(), 60); }
  }

  // ---- state helpers --------------------------------------------------------
  _s(id) { return this._hass?.states?.[id]; }
  _room_(id = this._room) { return this._config.rooms.find((r) => r.id === id); }
  /** Guest mode: the guest-mode switch (guest_mode_entity) when set and available, else the
   *  card's own guest_mode (on unless set to false). */
  _guest() {
    const id = this._config?.guest_mode_entity, s = id ? this._s(id) : null;
    if (s && available(s)) return s.state === "on";
    return this._config?.guest_mode !== false;
  }
  /** The entities the card may control, as shown now (guest mode hides some). */
  _allowAll() {
    const rooms = this._config?.rooms || [];
    this._guestNow = this._guest();
    this._entities = new Set(rooms.flatMap((r) => this._ents(r).flatMap((e) => [e.entity, ...(e.dimmer ? [e.dimmer] : [])])));
  }
  /** A room's entities as shown: in guest mode, without those marked guest_hidden. */
  _ents(room) { const g = this._guest(); return (room?.entities || []).filter((e) => !(g && e.guest_hidden)); }
  _activeCount(room) { return this._ents(room).filter((e) => ACTIVE_DOMAINS.has(domainOf(e.entity)) && isOn(this._s(e.entity))).length; }
  _name(e, room = this._room_()) {
    if (e.name) return e.name;
    // "Kitchen Counter Light" inside the Kitchen panel reads as "Counter Light".
    let n = titleCase(this._s(e.entity)?.attributes?.friendly_name || e.entity);
    const r = String(room?.name || "").trim();
    if (r && n.toLowerCase().startsWith(r.toLowerCase() + " ") && n.length > r.length + 2) n = n.slice(r.length + 1);
    return n.charAt(0).toUpperCase() + n.slice(1);
  }
  _icon(e) { return e.icon || this._s(e.entity)?.attributes?.icon || DEFAULT_ICONS[domainOf(e.entity)] || "mdi:circle-outline"; }
  _snap() { const s = this._config.snapshot; return s && typeof s.image === "string" && s.rooms ? s : null; }

  // ---- render ---------------------------------------------------------------
  _render() {
    const c = this._config, rooms = c.rooms;
    const focus = this.shadowRoot.activeElement?.dataset?.focus;
    const scrollChips = this.shadowRoot.querySelector(".chips")?.scrollLeft || 0;
    if (!rooms.length) {
      this._card.innerHTML = `${this._header()}<div class="empty">Open the card editor to choose a floor3d model, set up rooms and render a snapshot.</div>`;
      return;
    }
    const snap = this._snap();
    const room = this._room_() || rooms[0];
    // Room buttons: all rooms without a snapshot (or with room_list: always); otherwise only the
    // rooms the map can't show (no floor and no anchor), so every room stays reachable.
    const chipRooms = c.room_list === "always" || (!snap && c.room_list !== "never") ? rooms : snap ? rooms.filter((r) => !Array.isArray(snap.rooms?.[r.id]?.pin)) : [];
    const showChips = chipRooms.length > 0;
    this._card.innerHTML = `${this._header()}<div class="layout"><div class="mapcol">${snap ? `<div class="map-slot"></div><div class="legend"><span><i class="swatch sel"></i>Selected</span><span><i class="swatch on"></i>On</span><button class="toggle" data-action="labels" data-focus="labels" aria-pressed="${!!this._labels}">${icon("mdi:label-outline")}Labels</button></div>` : ""}${showChips ? `<div class="chips" role="tablist">${chipRooms.map((r) => `<button class="chip" data-action="room" data-room="${esc(r.id)}" data-focus="chip-${esc(r.id)}" aria-pressed="${r.id === room.id}">${icon(r.icon || "mdi:door-open")}${esc(titleCase(r.name || r.id))}</button>`).join("")}</div>` : ""}</div>${this._panel(room)}</div>${this._toast ? `<div class="toast" role="status">${esc(this._toast)}</div>` : ""}`;
    const slot = this._card.querySelector(".map-slot");
    if (slot) { slot.appendChild(this._ensureMap(snap)); this._updateMap(snap); }
    const chips = this._card.querySelector(".chips"); if (chips) chips.scrollLeft = scrollChips;
    if (focus) this.shadowRoot.querySelector(`[data-focus="${CSS.escape(focus)}"]`)?.focus({ preventScroll: true });
    if (this._scrollPanel) { this._scrollPanel = false; this._card.querySelector(".panel")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  }
  _header() {
    const c = this._config, status = this._status();
    if (!c.title && !c.subtitle && !status) return "";
    return `<div class="head"><div class="titles">${c.title ? `<h2>${esc(c.title)}</h2>` : ""}${c.subtitle !== "" ? `<p>${esc(c.subtitle ?? (this._snap() ? "Tap a room on the map to see its controls." : ""))}</p>` : ""}</div>${status}</div>`;
  }

  // ---- header status: indoor temperature, weather, date and time --------------
  _status() {
    const c = this._config, parts = [];
    const fmtT = (v, unit) => (num(v) ? `${Math.round(Number(v))}${unit || "°"}` : null);
    const tUnit = String(this._hass?.config?.unit_system?.temperature || "°");
    if (c.indoor_entity) {
      const s = this._s(c.indoor_entity), a = s?.attributes || {};
      const v = domainOf(c.indoor_entity) === "climate" ? fmtT(a.current_temperature, a.temperature_unit || tUnit) : available(s) ? fmtT(s.state, a.unit_of_measurement || tUnit) : null;
      if (v) parts.push(this._statusChip(c.indoor_entity, "mdi:home-thermometer-outline", `Inside ${v}`));
    }
    if (c.weather_entity) {
      const s = this._s(c.weather_entity), a = s?.attributes || {};
      if (available(s)) {
        const [label, ic] = WEATHER[s.state] || [titleCase(String(s.state).replace(/[-_]/g, " ")), "mdi:weather-partly-cloudy"];
        const t = fmtT(a.temperature, a.temperature_unit || tUnit);
        parts.push(this._statusChip(c.weather_entity, ic, t ? `${label} · ${t}` : label));
      }
    }
    // the guest-mode switch, for administrators only: guests never see or reach it
    if (c.guest_mode_entity && this._hass?.user?.is_admin && available(this._s(c.guest_mode_entity))) {
      const on = this._guest();
      parts.push(`<button class="schip guest" data-action="guest-toggle" data-focus="s-guest" aria-pressed="${on}" title="Guest mode (${esc(c.guest_mode_entity)}); only administrators see this">${icon(on ? "mdi:account-lock-outline" : "mdi:account-lock-open-outline")}<span>Guest mode ${on ? "on" : "off"}</span></button>`);
    }
    const clock = c.clock ? `<span class="when" aria-live="off">${esc(this._when())}</span>` : "";
    if (c.clock) this._tick();
    return parts.length || clock ? `<div class="status">${clock}${parts.length ? `<div class="schips">${parts.join("")}</div>` : ""}</div>` : "";
  }
  _statusChip(entity, ic, text) {
    // read-only information: a tap opens Home Assistant's details, except a thermostat in guest mode
    const open = !(this._guest() && domainOf(entity) === "climate");
    return `<button class="schip" ${open ? `data-action="more-info" data-entity="${esc(entity)}"` : 'tabindex="-1" aria-disabled="true"'} data-focus="s-${esc(entity)}">${icon(ic)}<span>${esc(text)}</span></button>`;
  }
  _when(d = new Date()) {
    const date = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return `${date} · ${time}`;
  }
  _tick() {
    if (this._clockTimer || !this.isConnected) return;
    const next = 60000 - (Date.now() % 60000) + 50;
    this._clockTimer = setTimeout(() => {
      this._clockTimer = null;
      const el = this.shadowRoot.querySelector(".when"); if (el) el.textContent = this._when();
      if (this._config?.clock) this._tick();
    }, next);
  }

  _panel(room) {
    const ents = this._ents(room);
    const active = this._activeCount(room);
    const offable = ents.filter((e) => ["light", "switch", "input_boolean", "fan"].includes(domainOf(e.entity)) && !e.read_only);
    return `<section class="panel" aria-labelledby="f3s-room"><div class="roomhead"><div class="roomicon">${icon(room.icon || "mdi:door-open")}</div><div><h3 id="f3s-room">${esc(titleCase(room.name || room.id))}</h3><p>${esc(room.description || (active ? `${active} on` : ents.length ? "Everything is off" : "Nothing to control here"))}</p></div></div><div class="tiles">${ents.map((e) => this._tile(e)).join("")}</div>${offable.length ? `<div class="foot"><button class="quiet" data-action="room-off" data-focus="room-off" ${offable.some((e) => isOn(this._s(e.entity))) ? "" : "disabled"}>${icon("mdi:power")}All off in this room</button><span class="hint">Shows each device's current state.</span></div>` : ""}</section>`;
  }

  _tile(e) {
    const id = e.entity, s = this._s(id), d = domainOf(id), a = s?.attributes || {}, g = this._guest();
    const name = esc(this._name(e)), ic = icon(this._icon(e));
    const busy = this._busy.has(id);
    const dis = !available(s) || busy ? "disabled" : "";
    // a dimmer is the light behind a switch: the switch powers it, the light sets the brightness
    const dimId = e.dimmer || (d === "light" ? id : null), ds = dimId ? this._s(dimId) : null, da = ds?.attributes || {};
    // A switched bulb may report off, or briefly unavailable, while its switch is on: its controls
    // still show (setting them turns the bulb on); an unavailable bulb is named in the state line.
    const dimReady = !!ds && (e.dimmer ? available(ds) : isOn(ds));
    const dimmable = dimReady && (num(da.brightness) || (da.supported_color_modes || []).some((m) => m !== "onoff"));
    const pct = dimmable ? (num(da.brightness) && isOn(ds) ? Math.max(1, Math.round(da.brightness / 2.55)) : 100) : null;
    const dimNote = e.dimmer && isOn(s) ? (!ds ? " · bulb not found" : !available(ds) ? " · bulb unavailable" : !isOn(ds) ? " · bulb off" : pct ? ` · ${pct}%` : "") : "";
    const stateText = !s ? "Not found" : !available(s) ? "Unavailable" : busy || this._busy.has(dimId) ? "Changing…" : e.dimmer && isOn(s) ? `On${dimNote}` : this._stateText(s);
    const on = isOn(s);
    const ro = e.read_only || ["sensor", "binary_sensor", "weather", "alarm_control_panel", "person", "device_tracker"].includes(d) || (g && d === "alarm_control_panel");
    const head = (action, sw = true) => `<button class="row" ${action ? `data-action="${action}" data-entity="${esc(id)}" data-focus="t-${esc(id)}"` : "tabindex=-1"} ${action ? dis : ""}><span class="ticon">${ic}</span><span class="ttext"><span class="tname">${name}</span><span class="tstate">${esc(this._confirm?.entity === id ? this._confirm.text : stateText)}</span></span>${sw && action ? '<span class="sw" aria-hidden="true"></span>' : ""}</button>`;
    if (ro || !s) return `<div class="tile">${head(null, false)}</div>`;
    let extra = "";
    if (on && dimReady) {
      // which light controls this tile may show: the entity's own `controls`, else the card's switches
      const c = this._config, modes = da.supported_color_modes || [];
      const want = Array.isArray(e.controls) ? new Set(e.controls) : new Set([
        ...(c.brightness_slider !== false ? ["brightness"] : []),
        ...(c.white_slider !== false ? ["white"] : []),
        ...((c.color_swatches ?? !this._guest()) ? ["color"] : []),
      ]);
      const parts = [];
      if (want.has("brightness") && dimmable) parts.push(["Brightness", `<input class="range" type="range" min="1" max="100" value="${pct}" data-action="brightness" data-entity="${esc(dimId)}" data-focus="b-${esc(id)}" aria-label="${name} brightness">`]);
      if (want.has("white") && modes.includes("color_temp")) {
        const lo = Number(da.min_color_temp_kelvin) || 2000, hi = Number(da.max_color_temp_kelvin) || 6500;
        const k = num(da.color_temp_kelvin) ? Math.min(hi, Math.max(lo, Number(da.color_temp_kelvin))) : Math.round((lo + hi) / 2);
        parts.push(["Warmth", `<input class="range warmth" type="range" min="${lo}" max="${hi}" step="50" value="${k}" data-action="kelvin" data-entity="${esc(dimId)}" data-focus="k-${esc(id)}" aria-label="${name} white warmth">`]);
      }
      if (want.has("color") && modes.some((m) => COLOR_MODES.includes(m))) {
        const cur = COLOR_MODES.includes(da.color_mode) && Array.isArray(da.hs_color) ? da.hs_color.map(Number) : null;
        const isSel = (h, sat) => cur && (sat === 0 ? cur[1] < 12 : cur[1] >= 25 && Math.min(Math.abs(cur[0] - h), 360 - Math.abs(cur[0] - h)) < 22);
        const btn = ([label, h, sat], x, y) => `<button class="swatch-b" data-action="color" data-entity="${esc(dimId)}" data-h="${h}" data-s="${sat}" data-focus="c-${esc(id)}-${label}" style="--sw:${hsCss(h, sat)};left:${x}%;top:${y}%" aria-label="${label}" title="${label}" aria-pressed="${!!isSel(h, sat)}"></button>`;
        parts.push(["Color", `<div class="wheel" role="group" aria-label="${name} color">${btn(WHEEL_WHITE, 50, 50)}${WHEEL.map((s, n) => { const a = (n * 45 - 90) * Math.PI / 180; return btn(s, 50 + 34 * Math.cos(a), 50 + 34 * Math.sin(a)); }).join("")}</div>`]);
      }
      if (parts.length) extra = `<div class="extra">${parts.map(([label, html]) => parts.length > 1 ? `<div class="ctl"><span class="ctl-l">${label}</span>${html}</div>` : html).join("")}</div>`;
    }
    if (d === "fan" && (Number(a.supported_features) & 1)) {
      const p = on ? Number(a.percentage ?? 100) : 0;
      const opts = [["Off", 0], ["Low", 33], ["Med", 67], ["High", 100]];
      const sel = opts.reduce((b, o) => Math.abs(o[1] - p) < Math.abs(b[1] - p) ? o : b)[1];
      extra = `<div class="extra"><div class="seg">${opts.map(([n, v]) => `<button data-action="fan" data-entity="${esc(id)}" data-value="${v}" data-focus="f-${esc(id)}-${v}" aria-pressed="${v === sel}" ${dis}>${n}</button>`).join("")}</div></div>`;
    }
    if (d === "media_player" && on && (Number(a.supported_features) & 4) && num(a.volume_level)) {
      const cap = Math.min(1, Number(this._config.max_volume ?? (g ? 0.6 : 1)));
      extra = `<div class="extra"><input class="range" type="range" min="0" max="${cap}" step="0.02" value="${Math.min(cap, a.volume_level)}" data-action="volume" data-entity="${esc(id)}" data-focus="v-${esc(id)}" aria-label="${name} volume"></div>`;
    }
    if (d === "cover") {
      const sensitive = g && SENSITIVE_COVERS.has(a.device_class);
      const btn = (svc, label) => `<button data-action="cover" data-service="${svc}" data-entity="${esc(id)}" data-focus="c-${esc(id)}-${svc}" ${dis}>${label}</button>`;
      return `<div class="tile ${on ? "on" : ""}">${head(null, false)}<div class="extra"><div class="seg">${sensitive ? btn("close_cover", "Close") : btn("open_cover", "Open") + btn("stop_cover", "Stop") + btn("close_cover", "Close")}</div></div></div>`;
    }
    if (d === "climate") {
      const range = this._config.temperature_range;
      const step = Number(a.target_temp_step) || (String(this._hass?.config?.unit_system?.temperature).includes("C") ? 0.5 : 1);
      const t = a.temperature;
      const ctl = num(t) ? `<div class="temp"><button class="step" data-action="temp" data-entity="${esc(id)}" data-value="${-step}" data-focus="tm-${esc(id)}" ${dis || (range && t - step < range[0] ? "disabled" : "")} aria-label="Lower">−</button><span class="val">${t}°</span><button class="step" data-action="temp" data-entity="${esc(id)}" data-value="${step}" data-focus="tp-${esc(id)}" ${dis || (range && t + step > range[1] ? "disabled" : "")} aria-label="Raise">+</button></div>` : "";
      return `<div class="tile ${on ? "on" : ""}">${head(null, false)}${ctl ? `<div class="extra">${ctl}</div>` : ""}</div>`;
    }
    if (d === "lock") {
      const locked = s.state === "locked";
      if (g && locked) return `<div class="tile">${head(null, false)}</div>`;
      return `<div class="tile">${head(g ? "lock" : locked ? "unlock" : "lock", false)}</div>`;
    }
    if (["scene", "script", "button", "input_button"].includes(d)) return `<div class="tile">${head("run", false)}</div>`;
    if (["light", "switch", "input_boolean", "fan", "media_player", "remote", "humidifier"].includes(d)) return `<div class="tile ${on ? "on" : ""}">${head("toggle")}${extra}</div>`;
    return `<div class="tile">${head(null, false)}</div>`;
  }
  _stateText(s) {
    const d = domainOf(s.entity_id), a = s.attributes;
    if (d === "light" && isOn(s) && num(a.brightness)) return `On · ${Math.round(a.brightness / 2.55)}%`;
    if (d === "climate") return `${titleCase(String(s.state).replace(/_/g, " "))}${num(a.current_temperature) ? ` · ${a.current_temperature}°` : ""}`;
    if (d === "media_player" && isOn(s) && num(a.volume_level)) return `On · vol ${Math.round(a.volume_level * 100)}%`;
    if (d === "sensor") return `${s.state}${a.unit_of_measurement ? ` ${a.unit_of_measurement}` : ""}`;
    if (d === "binary_sensor") return isOn(s) ? "Detected" : "Clear";
    if (["scene", "script", "button", "input_button"].includes(d)) return "Tap to run";
    if (d === "lock" && s.state === "unlocked") return this._guest() ? "Unlocked · tap to lock" : "Unlocked";
    return titleCase(String(s.state).replace(/_/g, " "));
  }

  // ---- map ------------------------------------------------------------------
  _ensureMap(snap) {
    if (this._mapEl && this._mapEl.dataset.src === snap.image) return this._mapEl;
    const el = document.createElement("div");
    el.className = "map"; el.dataset.src = snap.image;
    if (snap.stage?.night) { el.classList.add("staged"); el.style.setProperty("--f3s-stage", snap.stage.night); }
    el.style.setProperty("--aspect", String(Number(snap.aspect) > 0 ? Number(snap.aspect) : 1.2));
    const sun = this._sunOn(snap);
    el.innerHTML = `<img alt="" decoding="async" draggable="false">${sun ? '<canvas class="sun" aria-hidden="true"></canvas><canvas class="sun" aria-hidden="true"></canvas>' : ""}<canvas class="tint" aria-hidden="true"></canvas>${sun && this._config.sun.compass !== false ? '<div class="compass" role="img"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l4 9h-8z" fill="#d9534f"/><path d="M8 12h8l-4 9z" fill="currentColor" opacity=".35"/><text x="12" y="13.6" font-size="5.2" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="700">N</text></svg></div>' : ""}<div class="pins"></div>`;
    el.classList.toggle("preview", this._sunPreview != null);
    const img = el.querySelector("img");
    if (snap.index) for (const m of el.querySelectorAll("img,canvas.sun")) { m.style.webkitMaskImage = `url("${snap.index}")`; m.style.maskImage = `url("${snap.index}")`; }
    img.src = snap.image;
    let down = null, frame = 0;
    el.addEventListener("pointerdown", (e) => { down = e.target.closest("button") ? null : { x: e.clientX, y: e.clientY, t: Date.now(), type: e.pointerType }; });
    el.addEventListener("pointerup", (e) => {
      const s = down; down = null;
      if (!s || s.type === "mouse" || Math.abs(e.clientX - s.x) > 12 || Math.abs(e.clientY - s.y) > 12 || Date.now() - s.t > 700) return;
      this._touchAt = Date.now(); this._tap(e);
    });
    el.addEventListener("pointercancel", () => { down = null; });
    el.addEventListener("click", (e) => { if (e.target.closest("button")) return; if (Date.now() - (this._touchAt || 0) < 800) return; this._tap(e); });
    el.addEventListener("pointermove", (e) => { if (e.pointerType !== "mouse" || frame) return; frame = requestAnimationFrame(() => { frame = 0; this._hover(e); }); });
    el.addEventListener("pointerleave", (e) => this._hover(e));
    this._mapEl = el; this._index = null; this._tintKey = "";
    if (snap.index) this._loadIndex(snap, el);
    if (sun) this._loadLight(snap, el);
    return el;
  }
  _loadIndex(snap, el) {
    const image = new Image();
    image.onload = () => {
      if (this._mapEl !== el) return;
      const cv = document.createElement("canvas"); cv.width = image.naturalWidth; cv.height = image.naturalHeight;
      const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(image, 0, 0);
      const px = cx.getImageData(0, 0, cv.width, cv.height).data;
      const ids = this._config.rooms.map((r) => r.id), byCode = new Map();
      for (const [id, r] of Object.entries(snap.rooms)) if (ids.includes(id) && Number(r?.code)) byCode.set(Number(r.code), ids.indexOf(id) + 1);
      const codes = new Uint8Array(cv.width * cv.height), behind = new Uint8Array(cv.width * cv.height);
      for (let i = 0, p = 0; p < px.length; i++, p += 4) if (px[p + 3] > 200 && px[p]) { codes[i] = byCode.get(px[p]) || 0; behind[i] = px[p + 1] > 127 ? 1 : 0; }
      // The tint canvas is half size: plenty for a soft wash, quarter of the work.
      const w = Math.ceil(cv.width / 2), h = Math.ceil(cv.height / 2), half = new Uint8Array(w * h), halfBehind = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = (y * 2) * cv.width + x * 2; half[y * w + x] = codes[s]; halfBehind[y * w + x] = behind[s]; }
      this._index = { w: cv.width, h: cv.height, codes, ids, tw: w, th: h, half, halfBehind };
      const t = el.querySelector("canvas.tint"); t.width = w; t.height = h;
      this._tintKey = ""; this._sunKey = ""; this._paint();
    };
    image.src = snap.index;
  }
  _updateMap(snap) {
    const el = this._mapEl;
    const pins = this._config.rooms.filter((r) => Array.isArray(snap.rooms[r.id]?.pin)).map((r) => {
      const [x, y] = snap.rooms[r.id].pin.map(Number), n = this._activeCount(r);
      const elapsed = this._flash?.room === r.id ? Date.now() - this._flash.at : Infinity, flash = elapsed < 2600;
      const cls = ["pin", n && "on", !snap.rooms[r.id].code && "always", r.id === this._hoverRoom && "hover", flash && "flash"].filter(Boolean).join(" ");
      return `<button class="${cls}" data-action="room" data-room="${esc(r.id)}" data-focus="pin-${esc(r.id)}" aria-pressed="${r.id === this._room}" aria-label="${esc(titleCase(r.name || r.id))}${n ? `, ${n} on` : ""}" style="left:${x}%;top:${y}%${flash ? `;animation-delay:-${elapsed}ms` : ""}">${icon(r.icon || "mdi:door-open")}<span class="pin-name">${esc(titleCase(r.name || r.id))}</span>${n ? `<span class="pin-count" aria-hidden="true">${n}</span>` : ""}</button>`;
    }).join("");
    el.querySelector(".pins").innerHTML = pins;
    el.classList.toggle("labels", !!this._labels);
    this._paint();
  }
  _paint() {
    this._composeSun();
    const ix = this._index, cv = this._mapEl?.querySelector("canvas.tint");
    if (!ix || !cv) return;
    if (!this._primary) this._primary = (getComputedStyle(this).getPropertyValue("--rgb-primary-color") || "").trim() || "3,169,244";
    const on = this._config.rooms.filter((r) => this._activeCount(r)).map((r) => r.id);
    const key = `${this._room}|${this._hoverRoom || ""}|${on}|${this._primary}`;
    if (key === this._tintKey) return;
    this._tintKey = key;
    const [pr, pg, pb] = this._primary.split(",").map((v) => Number(v) || 0);
    const sel = ix.ids.indexOf(this._room) + 1, hov = this._hoverRoom ? ix.ids.indexOf(this._hoverRoom) + 1 : -1;
    const lit = new Uint8Array(ix.ids.length + 1); ix.ids.forEach((id, i) => { if (on.includes(id)) lit[i + 1] = 1; });
    const ctx = cv.getContext("2d"), img = ctx.createImageData(ix.tw, ix.th), d = img.data, c = ix.half;
    const through = 1 - (Number(this._snap()?.wall_alpha) || 1);   // how much a see-through wall lets through
    for (let i = 0; i < c.length; i++) {
      const v = c[i]; if (!v) continue;
      const o = i * 4, k = ix.halfBehind[i] ? through : 1;
      if (v === sel) { d[o] = pr; d[o + 1] = pg; d[o + 2] = pb; d[o + 3] = 120 * k; }
      else if (v === hov) { d[o] = pr; d[o + 1] = pg; d[o + 2] = pb; d[o + 3] = 55 * k; }
      else if (lit[v]) { d[o] = 255; d[o + 1] = 193; d[o + 2] = 7; d[o + 3] = 105 * k; }
    }
    ctx.putImageData(img, 0, 0);
  }
  // ---- sunlight ---------------------------------------------------------------
  _sunOn(snap = this._snap()) { return !!(this._config?.sun?.enabled && snap?.light && snap.lighting?.depth); }
  _location() {
    const s = this._config?.sun || {}, c = this._hass?.config || {};
    const lat = Number(s.latitude ?? c.latitude), lon = Number(s.longitude ?? c.longitude);
    return Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon) ? [lat, lon] : null;
  }
  _loadLight(snap, el) {
    decodeLight(snap.light, snap.lighting).then((L) => {
      if (this._mapEl !== el) return;
      this._light = L;
      for (const cv of el.querySelectorAll("canvas.sun")) { cv.width = L.w; cv.height = L.h; }
      this._updateSun();
    }).catch(() => { /* picture stays as rendered */ });
  }
  /** Recompute the sun position; re-shade when it moved, then schedule the next update. */
  async _updateSun() {
    clearTimeout(this._sunTimer);
    if (!this._config) return;
    const snap = this._snap(), loc = this._location();
    if (!this.isConnected || !this._sunOn(snap) || !loc) return;
    const cfg = this._config.sun, north = Number(cfg.north) || 0;
    const pos = solarPosition(new Date(this._sunPreview ?? Date.now()), loc[0], loc[1]);
    this._sunPos = pos;
    if (this._sunPreview == null) this._sunTimer = setTimeout(() => this._updateSun(), nextUpdateMinutes(pos.elevation) * 60000);
    this._updateCompass(snap, north, pos);
    const L = this._light; if (!L) return;
    const key = `${Math.round(pos.azimuth)}|${Math.round(pos.elevation * 2)}|${north}|${cfg.shadows !== false}`;
    if (key === this._shadeKey) return this._composeSun();
    this._shadeKey = key;
    const gen = (this._shadeGen = (this._shadeGen || 0) + 1);
    const direct = pos.elevation > -3 ? await shade(L, sunVector(pos, north), { shadows: cfg.shadows !== false, isStale: () => gen !== this._shadeGen || this._light !== L }) : null;
    if (gen !== this._shadeGen || this._light !== L) return;
    this._direct = direct; this._directKey = key; this._sunKey = "";
    this._composeSun();
  }
  _composeSun() {
    // keep showing the previous frame until the new sun position has been shaded
    const L = this._light, el = this._mapEl; if (!L || !el || !this._shadeKey || this._directKey !== this._shadeKey) return;
    const cfg = this._config.sun, ix = this._index, glow = cfg.night_glow !== false;
    const on = glow ? this._config.rooms.filter((r) => this._activeCount(r)).map((r) => r.id) : [];
    const elev = this._sunPos?.elevation ?? 30;
    const key = `${this._shadeKey}|${Math.round(elev * 2)}|${on}|${cfg.strength ?? ""}|${!!ix}|${this._direct ? 1 : 0}`;
    if (key === this._sunKey) return;
    this._sunKey = key;
    let lit = null;
    if (ix && on.length && ix.tw === L.w && ix.th === L.h) {
      const rooms = new Uint8Array(ix.ids.length + 1); ix.ids.forEach((id, i) => { if (on.includes(id)) rooms[i + 1] = 1; });
      lit = new Uint8Array(L.w * L.h); for (let i = 0; i < lit.length; i++) lit[i] = rooms[ix.half[i]];
    }
    const [a, b] = el.querySelectorAll("canvas.sun"); if (!a || !b) return;
    const next = a.classList.contains("show") ? b : a, prev = next === a ? b : a;
    compose(next.getContext("2d"), L, this._direct, elev, { strength: Number(cfg.strength ?? 0.6), lit });
    const stage = this._snap()?.stage;     // a themed snapshot's stage runs from its night to its day color
    if (stage?.night && stage.day) el.style.setProperty("--f3s-stage", mixHex(stage.night, stage.day, phase(elev).day));
    next.classList.add("show"); prev.classList.remove("show");
  }
  _updateCompass(snap, north, pos) {
    const c = this._mapEl?.querySelector(".compass"); if (!c) return;
    const m = snap.lighting, n = northVector(north);
    const sx = n[0] * m.right[0] + n[1] * m.right[1] + n[2] * m.right[2], sy = -(n[0] * m.up[0] + n[1] * m.up[1] + n[2] * m.up[2]);
    c.style.setProperty("--north", `${(Math.atan2(sx, -sy) * 180 / Math.PI).toFixed(1)}deg`);
    const label = pos.elevation > 0 ? `Sun ${Math.round(pos.elevation)}° up in the ${compassName(pos.azimuth)}` : pos.elevation > -6 ? "Twilight" : "Night";
    c.setAttribute("aria-label", `North arrow. ${label}`); c.title = `North · ${label}`;
  }

  _roomAt(e, reach = 0.035, pinFallback = true) {
    const rect = this._mapEl?.getBoundingClientRect(); if (!rect?.width) return undefined;
    const u = (e.clientX - rect.left) / rect.width, v = (e.clientY - rect.top) / rect.height;
    const ix = this._index; let room;
    if (ix) {
      const cx = Math.floor(u * ix.w), cy = Math.floor(v * ix.h), R = Math.round(ix.w * reach); let best = Infinity;
      for (let dy = -R; dy <= R; dy += 2) for (let dx = -R; dx <= R; dx += 2) {
        const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= ix.w || y >= ix.h) continue;
        const k = ix.codes[y * ix.w + x]; if (k && dx * dx + dy * dy < best) { best = dx * dx + dy * dy; room = ix.ids[k - 1]; }
      }
    }
    if (!room && pinFallback) {
      const snap = this._snap(), aspect = Number(snap?.aspect) || 1.2; let best = 0.07 ** 2;
      for (const r of this._config.rooms) { const p = snap?.rooms?.[r.id]?.pin; if (!Array.isArray(p)) continue; const dx = (u - p[0] / 100) * aspect, dy = v - p[1] / 100; if (dx * dx + dy * dy < best) { best = dx * dx + dy * dy; room = r.id; } }
    }
    return room;
  }
  _tap(e) { const room = this._roomAt(e); if (room) this._select(room, true); }
  _hover(e) {
    if (e.pointerType && e.pointerType !== "mouse") return;
    const room = e.type === "pointerleave" ? undefined : this._roomAt(e, 0.012, false);
    if (room === this._hoverRoom) return;
    this._hoverRoom = room;
    this._mapEl.classList.toggle("hovering", !!room);
    this._mapEl.querySelectorAll(".pin").forEach((p) => p.classList.toggle("hover", p.dataset.room === room));
    this._paint();
  }
  _select(room, fromFloor = false) {
    this._room = room;
    this._flash = fromFloor && !this._labels ? { room, at: Date.now() } : null;
    this._scrollPanel = this.classList.contains("stacked");
    this._request();
  }

  // ---- actions --------------------------------------------------------------
  _allowed(id) { return this._entities.has(id); }
  async _call(id, domain, service, data = {}) {
    if (!this._allowed(id)) return;
    this._busy.add(id); this._request();
    try { await this._hass.callService(domain, service, { entity_id: id, ...data }); }
    catch (err) { this._showToast(`Couldn't change ${this._name({ entity: id })}.`); }
    finally { this._busy.delete(id); this._request(); }
  }
  _showToast(text) { this._toast = text; clearTimeout(this._toastTimer); this._toastTimer = setTimeout(() => { this._toast = ""; this._request(); }, 5000); this._request(); }
  _click(ev) {
    const b = ev.target.closest("button[data-action]"); if (!b || b.disabled) return;
    const { action, entity: id, room } = b.dataset, s = this._s(id), d = domainOf(id), g = this._guest();
    if (action === "room") { if (this._room_(room)) this._select(room); return; }
    if (action === "guest-toggle") {
      const gid = this._config.guest_mode_entity;
      if (!gid || !this._hass?.user?.is_admin) return;
      this._hass.callService(domainOf(gid) === "switch" ? "switch" : "input_boolean", "toggle", { entity_id: gid }).catch(() => this._showToast("Couldn't change guest mode."));
      return;
    }
    if (action === "more-info") { this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: b.dataset.entity }, bubbles: true, composed: true })); return; }
    if (action === "labels") { this._labels = !this._labels; try { localStorage.setItem("floor3d-snapshot-labels", this._labels ? "1" : "0"); } catch { /* private */ } this._request(); return; }
    if (action === "room-off") {
      for (const e of this._ents(this._room_())) if (["light", "switch", "input_boolean", "fan"].includes(domainOf(e.entity)) && !e.read_only && isOn(this._s(e.entity))) this._call(e.entity, domainOf(e.entity), "turn_off");
      return;
    }
    if (!s || !this._allowed(id)) return;
    if (action === "toggle") {
      if (d === "media_player") this._call(id, d, isOn(s) ? "turn_off" : "turn_on");
      else this._call(id, d, isOn(s) ? "turn_off" : "turn_on");
    } else if (action === "color") {
      if (d !== "light") return;
      this._call(id, "light", "turn_on", { hs_color: [Number(b.dataset.h), Number(b.dataset.s)] });
    } else if (action === "fan") {
      const v = Number(b.dataset.value);
      v ? this._call(id, "fan", "set_percentage", { percentage: v }) : this._call(id, "fan", "turn_off");
    } else if (action === "cover") {
      const svc = b.dataset.service;
      if (g && SENSITIVE_COVERS.has(s.attributes.device_class) && svc !== "close_cover") return;
      this._call(id, "cover", svc);
    } else if (action === "temp") {
      const t = Number(s.attributes.temperature) + Number(b.dataset.value), r = this._config.temperature_range;
      if (r && (t < r[0] || t > r[1])) return;
      this._call(id, "climate", "set_temperature", { temperature: Math.round(t * 10) / 10 });
    } else if (action === "lock" || action === "unlock" || action === "run") {
      if (action === "unlock" && g) return;
      // Two-tap confirmation, shown in the tile itself (no browser dialogs).
      if (this._confirm?.entity !== id) {
        this._confirm = { entity: id, text: action === "run" ? "Tap again to run" : `Tap again to ${action}` };
        clearTimeout(this._confirmTimer); this._confirmTimer = setTimeout(() => { this._confirm = null; this._request(); }, 3500);
        this._request(); return;
      }
      this._confirm = null;
      if (action === "run") this._call(id, d, ["button", "input_button"].includes(d) ? "press" : "turn_on");
      else this._call(id, "lock", action);
    }
  }
  _change(ev) {
    const i = ev.target; if (!i.matches("input[type=range]")) return;
    this._dragging = false;
    const id = i.dataset.entity; if (!this._allowed(id)) return;
    if (i.dataset.action === "brightness") this._call(id, "light", "turn_on", { brightness_pct: Number(i.value) });
    if (i.dataset.action === "kelvin") this._call(id, "light", "turn_on", { color_temp_kelvin: Number(i.value) });
    if (i.dataset.action === "volume") {
      const cap = Math.min(1, Number(this._config.max_volume ?? (this._guest() ? 0.6 : 1)));
      this._call(id, "media_player", "volume_set", { volume_level: Math.min(cap, Number(i.value)) });
    }
  }
}

if (!customElements.get("floor3d-snapshot-card")) customElements.define("floor3d-snapshot-card", Floor3dSnapshotCard);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "floor3d-snapshot-card")) {
  window.customCards.push({ type: "floor3d-snapshot-card", name: "Floor3D Snapshot", description: "A fast, tappable floor plan made from your floor3d model, with simple room controls.", preview: false, documentationURL: "https://github.com/FortranFour/floor3d-snapshot-card" });
}
console.info(`%c floor3d-snapshot-card %c ${VERSION} `, "background:#03a9f4;color:#fff;border-radius:4px 0 0 4px;padding:2px 4px", "background:#e0e0e0;color:#333;border-radius:0 4px 4px 0;padding:2px 4px");
