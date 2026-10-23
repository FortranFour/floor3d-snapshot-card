// Visual editor for floor3d-snapshot-card. Loaded only when the card editor opens.
import { solarPosition, compassName } from "./sun.js";
const SUN_PREVIEW_EVENT = "floor3d-snapshot-sun-preview";
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clone = (v) => JSON.parse(JSON.stringify(v ?? null));
const slug = (name, taken = new Set()) => {
  let base = String(name || "room").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "room", id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
};
const hash = (v) => { const s = JSON.stringify(v); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const ENTITY_DOMAINS = /^(light|switch|fan|cover|climate|media_player|lock|input_boolean|scene|script|sensor|binary_sensor|remote|button|input_button|vacuum|humidifier|valve|water_heater|alarm_control_panel)\./;
const STYLES = [["standard", "Standard"], ["neon", "Neon"], ["blueprint", "Blueprint"], ["day", "Day"], ["paper", "Paper"], ["ember", "Ember"], ["pastel", "Pastel"], ["custom", "Custom colours"]];
const STAGE_BG = { neon: "#0b1120", blueprint: "#1a4682", day: "#d6e0ee", paper: "#c4b8a0", ember: "#141012", pastel: "#c4c8dc" };
const THEME_NAMES = STYLES.map(([k]) => k).filter((k) => k !== "standard");
const CUSTOM_DEFAULTS = { dark: "#1c2230", light: "#6c7a96", edges: "#e8f0ff", stage: "#10141c", hue: 0.15 };
const THEME_NOTES = {
  neon: "Dark navy surfaces with glowing edge lines in the edge colour.", blueprint: "Shades of blue with pale lines.", day: "Light grey surfaces with dark navy lines.",
  paper: "An architect's drawing: cream card, ink lines.", ember: "Charcoal with a warm cast and amber lines.", pastel: "The model's own colours, lightened and softened.",
  custom: "Your colours: dark where the model is dark, light where it is bright; walls and floors can have their own light tone.",
};
const VIEW_RESET = { azimuth: 45, elevation: 52, roll: 0 };
const PLACES = [["east", "East of first model"], ["west", "West"], ["north", "North"], ["south", "South"], ["as-is", "Keep model coordinates"]];

/** The part of the configuration a snapshot depends on. */
export const snapshotKey = (config) => hash({
  models: (config.models || []).map(({ url, mtl, place, offset, rotate, scale, panels }) => ({ url, mtl, place, offset, rotate, scale, panels })),
  view: config.view || {},
  ...(config.sun?.enabled ? { sun: true } : {}),
  rooms: (config.rooms || []).map(({ id, floors, anchor, pin_offset, color }) => ({ id, floors, anchor, pin_offset, color })),
});

const STYLE = `
:host{display:block;color:var(--primary-text-color);font-size:14px}
details{border:1px solid var(--divider-color,rgba(127,127,127,.25));border-radius:12px;margin:0 0 12px;background:var(--card-background-color)}
summary{cursor:pointer;padding:12px 14px;font-weight:500;list-style:none;display:flex;align-items:center;gap:8px}summary::-webkit-details-marker{display:none}summary:before{content:"▸";color:var(--secondary-text-color);transition:transform .15s}details[open]>summary:before{transform:rotate(90deg)}
summary .badge{margin-left:auto;font-weight:400;font-size:12px;color:var(--secondary-text-color)}summary .badge.warn{color:var(--warning-color,#e69500)}summary .badge.ok{color:var(--success-color,#2e7d32)}
.body{padding:0 14px 14px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}.row>label{flex:1;min-width:140px}
label{display:block;font-size:12px;color:var(--secondary-text-color)}label>input,label>select{margin-top:4px}
input[type=text],input[type=number],select{width:100%;box-sizing:border-box;min-height:38px;padding:6px 10px;border:1px solid var(--divider-color,rgba(127,127,127,.35));border-radius:8px;background:var(--secondary-background-color,transparent);color:var(--primary-text-color);font:inherit}
input[type=range]{width:100%;accent-color:var(--primary-color)}
.check{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--primary-text-color);min-height:32px}
button{font:inherit;cursor:pointer;min-height:36px;padding:6px 12px;border-radius:8px;border:1px solid var(--divider-color,rgba(127,127,127,.35));background:transparent;color:var(--primary-color)}button.primary{background:var(--primary-color);border-color:var(--primary-color);color:var(--text-primary-color,#fff)}button.icon{min-height:30px;padding:2px 8px;color:var(--secondary-text-color)}button:disabled{opacity:.5;cursor:default}
.note{font-size:12px;color:var(--secondary-text-color);line-height:1.5;margin:6px 0}.note.warn{color:var(--warning-color,#e69500)}.note.err{color:var(--error-color,#db4437)}
.item{border:1px solid var(--divider-color,rgba(127,127,127,.2));border-radius:10px;padding:8px 10px;margin:8px 0}.item .title{display:flex;align-items:center;gap:8px}.item .title b{flex:1;font-weight:500;overflow-wrap:anywhere}
.room>summary{padding:10px 12px}.room{margin:8px 0}.room .body{padding:0 12px 12px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.chip{display:inline-flex;align-items:center;gap:4px;padding:2px 4px 2px 10px;border-radius:14px;background:var(--secondary-background-color,rgba(127,127,127,.12));font-size:12px}.chip button{min-height:24px;padding:0 6px;border:0}
.ent{display:grid;grid-template-columns:1fr 1fr auto;gap:6px;align-items:end;margin:6px 0}.ent.dim{grid-template-columns:1fr;margin:-2px 0 10px 14px}.ent .tools{display:flex;gap:2px}
.preview{position:relative;margin:10px 0;border-radius:10px;overflow:hidden;background:var(--secondary-background-color,rgba(127,127,127,.08))}.preview img{display:block;width:100%;-webkit-mask-size:100% 100%;mask-size:100% 100%}
ha-icon{--mdc-icon-size:20px;width:20px;height:20px;color:var(--secondary-text-color)}
.found{max-height:220px;overflow:auto}
.pv{position:relative;margin:10px 0;border-radius:12px;overflow:hidden;background:var(--secondary-background-color,rgba(127,127,127,.08))}.pv canvas{display:block;width:100%;aspect-ratio:4/3;touch-action:none;cursor:grab}.pv canvas:active{cursor:grabbing}.pv .pvhint{position:absolute;left:8px;bottom:6px;font-size:11px;color:#fff;background:rgba(0,0,0,.45);padding:2px 8px;border-radius:8px;pointer-events:none}.pv .pvbusy{position:absolute;inset:0;display:grid;place-items:center;font-size:12px;color:var(--secondary-text-color);pointer-events:none}.pv [hidden]{display:none}
input[type=color]{width:52px;height:38px;padding:2px;border-radius:8px;border:1px solid var(--divider-color,rgba(127,127,127,.35));background:transparent}
`;

class Floor3dSnapshotCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._open = { model: true, rooms: true, snapshot: false, sun: false, display: false };
    this._roomOpen = new Set();
    this._floor3d = {};      // url -> {entities, groups} from scanned floor3d cards
    this._shadowRootEvents();
  }
  disconnectedCallback() { this._closePreview(); this._previewOpen = false; if (this._previewTime != null) { this._previewTime = null; window.dispatchEvent(new CustomEvent(SUN_PREVIEW_EVENT, { detail: { time: null } })); } }
  setConfig(config) { this._config = clone(config) || {}; this._config.rooms ||= []; this._config.models ||= []; this._render(); }
  set hass(hass) { const first = !this._hass; this._hass = hass; if (first) this._render(); }

  _emit() {
    const config = clone(this._config);
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
    this._render();
  }

  // ---- rendering ------------------------------------------------------------
  _render() {
    if (!this._config) return;
    const root = this.shadowRoot, focus = root.activeElement?.dataset?.key;
    const c = this._config, snap = c.snapshot, key = snapshotKey(c);
    const status = !c.models.length ? ["", ""] : !snap ? ["warn", "Not rendered"] : snap.key !== key ? ["warn", "Out of date"] : ["ok", "Up to date"];
    const entities = this._hass ? Object.keys(this._hass.states).filter((id) => ENTITY_DOMAINS.test(id)).sort() : [];
    root.innerHTML = `<style>${STYLE}</style>
<datalist id="f3s-entities">${entities.map((id) => `<option value="${esc(id)}">${esc(this._hass.states[id].attributes.friendly_name || "")}</option>`).join("")}</datalist>
<datalist id="f3s-objects">${(this._objectNames || []).flatMap((names, m) => names.map((n) => `<option value="${esc(n)}">${c.models.length > 1 ? `model ${m + 1}` : ""}</option>`)).join("")}</datalist>
${this._section("model", "1 · Model", c.models.length ? `${c.models.length} model${c.models.length > 1 ? "s" : ""}` : "None", "", this._modelSection())}
${this._section("rooms", "2 · Rooms", `${c.rooms.length} room${c.rooms.length === 1 ? "" : "s"}`, "", this._roomsSection())}
${this._section("snapshot", "3 · Snapshot", status[1], status[0], this._snapshotSection(status))}
${this._section("sun", "4 · Sunlight", c.sun?.enabled ? (snap?.light ? "On" : "Needs a render") : "Off", c.sun?.enabled && !snap?.light ? "warn" : "", this._sunSection())}
${this._section("display", "5 · Display", "", "", this._displaySection())}`;
    if (focus) root.querySelector(`[data-key="${CSS.escape(focus)}"]`)?.focus();
    this._mountPreview();
  }
  _section(id, title, badge, badgeClass, body) {
    return `<details data-section="${id}" ${this._open[id] ? "open" : ""}><summary>${title}<span class="badge ${badgeClass}">${esc(badge)}</span></summary><div class="body">${body}</div></details>`;
  }

  _modelSection() {
    const c = this._config;
    const found = this._found;
    return `<p class="note">Pick the floor3d card whose model you want to snapshot. floor3d-card, floor3dpro-card and floor3dx-card (GLB, glTF or OBJ) are supported. Add a second card (e.g. a detached garage) to show both.</p>
<div class="row"><button data-act="scan" ${this._scanning ? "disabled" : ""}>${this._scanning ? "Searching dashboards…" : "Find floor3d cards in my dashboards"}</button></div>
${found ? (found.length ? `<div class="found">${found.map((f, i) => `<div class="item"><div class="title"><b>${esc(f.label)}</b><button data-act="use-found" data-i="${i}" ${c.models.some((m) => m.url === f.url) ? "disabled" : ""}>${c.models.some((m) => m.url === f.url) ? "Added" : "Use"}</button></div><div class="note">${esc(f.url)} · ${f.entities.length} entities${f.look ? ` · ${f.look} look` : ""}${f.north !== undefined ? ` · north ${f.north}°` : ""}</div></div>`).join("")}</div>` : `<p class="note warn">No floor3d cards found in dashboards you can read. Add the model URL below.</p>`) : ""}
${c.models.map((m, i) => `<div class="item"><div class="title"><b>${i + 1}. ${esc(m.url)}</b><button class="icon" data-act="model-remove" data-i="${i}" title="Remove">✕</button></div>${i ? `<div class="row"><label>Placement<select data-field="models.${i}.place" data-key="mp${i}">${PLACES.map(([v, t]) => `<option value="${v}" ${(m.place || "east") === v ? "selected" : ""}>${t}</option>`).join("")}</select></label><label>Rotate (°)<input type="number" step="90" data-field="models.${i}.rotate" data-num value="${esc(m.rotate ?? 0)}" data-key="mr${i}"></label></div>` : ""}${/\.obj(\?|$)/i.test(m.url) ? `<label>MTL file<input type="text" data-field="models.${i}.mtl" value="${esc(m.mtl || "")}" data-key="mm${i}"></label>` : ""}</div>`).join("")}
<div class="row"><label>Or add a model URL<input type="text" placeholder="/local/floor3d/home.glb" data-key="new-model" id="new-model"></label><button data-act="model-add">Add</button></div>`;
  }

  _roomsSection() {
    const c = this._config;
    return `<div class="row"><button class="primary" data-act="detect" ${!c.models.length || this._busy ? "disabled" : ""}>${this._busy === "detect" ? "Analyzing model…" : c.rooms.length ? "Detect rooms again" : "Detect rooms from the model"}</button><button data-act="room-add">Add room</button></div>
<label class="check"><input type="checkbox" id="detect-sensors" ${this._detectSensors ? "checked" : ""}>Also add sensors (temperatures, doors, windows…) when detecting</label>
<p class="note">Detection finds floor objects named <code>room_N_1</code> (Sweet Home 3D exports), names rooms from floor3d entities bound to each floor, and assigns the floor3d card's entities to the room they stand in. Review and edit below.</p>
${this._msg?.rooms ? `<p class="note ${this._msg.rooms[0]}">${esc(this._msg.rooms[1])}</p>` : ""}
${c.rooms.map((r, i) => this._roomEditor(r, i)).join("")}`;
  }
  _roomEditor(r, i) {
    const n = this._config.rooms.length;
    const ents = r.entities || [];
    const multi = this._config.models.length > 1;
    const objRef = (f) => `${multi ? `${f.model + 1}:` : ""}${f.object}`;
    return `<details class="room item" data-room="${i}" ${this._roomOpen.has(r.id) ? "open" : ""}><summary><ha-icon icon="${esc(r.icon || "mdi:door-open")}"></ha-icon>${esc(r.name || r.id)}<span class="badge">${ents.length} entit${ents.length === 1 ? "y" : "ies"}</span></summary><div class="body">
<div class="row"><label>Name<input type="text" data-field="rooms.${i}.name" value="${esc(r.name || "")}" data-key="rn${i}"></label><label>Icon<input type="text" data-field="rooms.${i}.icon" value="${esc(r.icon || "")}" placeholder="mdi:sofa-outline" data-key="ri${i}"></label></div>
<label>Floor objects (tap target and tint)</label><div class="chips">${(r.floors || []).map((f, j) => `<span class="chip">${esc(objRef(f))}<button data-act="floor-remove" data-i="${i}" data-j="${j}" title="Remove">✕</button></span>`).join("") || '<span class="note">None — the room shows as a pin only.</span>'}</div>
<div class="row"><label>Add floor object<input type="text" list="f3s-objects" placeholder="room_3_1" data-key="rf${i}" id="floor-${i}"></label>${multi ? `<label style="max-width:110px">Model<select id="floor-model-${i}">${this._config.models.map((_, m) => `<option value="${m}">${m + 1}</option>`).join("")}</select></label>` : ""}<button data-act="floor-add" data-i="${i}">Add</button></div>
${(r.floors || []).length ? "" : this._anchorEditor(r, i, multi)}
<label>Entities</label>
${ents.map((e, j) => `<div class="ent"><label>Entity<input type="text" list="f3s-entities" data-field="rooms.${i}.entities.${j}.entity" value="${esc(e.entity)}" data-key="re${i}-${j}"></label><label>Label<input type="text" data-field="rooms.${i}.entities.${j}.name" value="${esc(e.name || "")}" placeholder="${esc(this._hass?.states[e.entity]?.attributes?.friendly_name || "")}" data-key="rl${i}-${j}"></label><div class="tools"><button class="icon" data-act="ent-up" data-i="${i}" data-j="${j}" ${j ? "" : "disabled"} title="Move up">↑</button><button class="icon" data-act="ent-remove" data-i="${i}" data-j="${j}" title="Remove">✕</button></div></div>${e.dimmer || /^(switch|input_boolean)\./.test(e.entity || "") ? `<div class="ent dim"><label>Dimmer — the light behind this switch, for brightness<input type="text" list="f3s-entities" data-field="rooms.${i}.entities.${j}.dimmer" value="${esc(e.dimmer || "")}" placeholder="light.… (optional)" data-key="rd${i}-${j}"></label></div>` : ""}${this._hass && e.entity && !this._hass.states[e.entity] ? `<p class="note warn">${esc(e.entity)} doesn't exist.</p>` : ""}${this._hass && e.dimmer && !this._hass.states[e.dimmer] ? `<p class="note warn">${esc(e.dimmer)} doesn't exist.</p>` : ""}`).join("")}
<div class="row"><label>Add entity<input type="text" list="f3s-entities" placeholder="light.kitchen" data-key="ra-${i}" id="ent-${i}"></label><button data-act="ent-add" data-i="${i}">Add</button></div>
<div class="row"><button class="icon" data-act="room-up" data-i="${i}" ${i ? "" : "disabled"}>↑ Move up</button><button class="icon" data-act="room-down" data-i="${i}" ${i < n - 1 ? "" : "disabled"}>↓ Move down</button><button class="icon" data-act="room-remove" data-i="${i}">Delete room</button></div>
</div></details>`;
  }

  /** Pin anchor for a room without a floor: an object to stand the pin on, with suggestions
   *  from the floor3d objects bound to the room's entities. */
  _anchorEditor(r, i, multi) {
    const sugg = [];
    this._config.models.forEach((m, model) => {
      const f = this._floor3d[m.url]; if (!f) return;
      for (const e of r.entities || []) for (const b of f.entities.filter((x) => x.entity === e.entity)) {
        const g = /^<(.+)>$/.exec(b.object_id || ""), object = g ? f.groups?.[g[1]]?.[0] : b.object_id;
        if (object && !sugg.some((s) => s.model === model && s.object === object)) sugg.push({ model, object });
      }
    });
    const a = r.anchor;
    return `<div class="row"><label>Pin anchor object<input type="text" list="f3s-objects" data-field="rooms.${i}.anchor.object" value="${esc(a?.object || "")}" placeholder="an object the pin stands on" data-key="ra${i}"></label>${multi ? `<label style="max-width:110px">Model<select data-field="rooms.${i}.anchor.model" data-num data-key="ram${i}">${this._config.models.map((_, m) => `<option value="${m}" ${(a?.model ?? 0) === m ? "selected" : ""}>${m + 1}</option>`).join("")}</select></label>` : ""}</div>
${a?.object ? "" : `<p class="note warn">No floor object and no anchor: this room has no place on the map. The card shows it as a button under the map; pick an anchor to give it a pin.</p>`}
${sugg.length ? `<div class="chips"><span class="note" style="margin:0 4px 0 0">From the floor3d card:</span>${sugg.slice(0, 8).map((s) => `<button class="icon" data-act="anchor-pick" data-i="${i}" data-model="${s.model}" data-obj="${esc(s.object)}">${esc(multi ? `${s.model + 1}:${s.object}` : s.object)}</button>`).join("")}</div>` : ""}`;
  }

  // The custom theme's colours: the four that matter in a row, the rest behind "More".
  _customColours(cu) {
    const pick = (key, label, dflt) => `<label style="flex:0 0 auto;min-width:0">${label}<input type="color" data-field="view.custom.${key}" value="${esc(cu[key] || dflt)}" data-key="cc${key}"></label>`;
    const hue = cu.hue ?? CUSTOM_DEFAULTS.hue;
    return `<div class="row">${pick("dark", "Dark", CUSTOM_DEFAULTS.dark)}${pick("light", "Light", CUSTOM_DEFAULTS.light)}${pick("edges", "Edges", CUSTOM_DEFAULTS.edges)}${pick("stage", "Stage", CUSTOM_DEFAULTS.stage)}</div>
<details><summary>More custom colours</summary><div class="row">${pick("walls", "Walls", cu.light || CUSTOM_DEFAULTS.light)}${pick("floors", "Floors", cu.light || CUSTOM_DEFAULTS.light)}${pick("stage_day", "Stage by day", cu.stage || CUSTOM_DEFAULTS.stage)}<label>Hue kept: <span>${Math.round(hue * 100)}%</span><input type="range" min="0" max="1" step="0.05" data-field="view.custom.hue" data-num value="${hue}" data-key="cchue"></label></div>
<p class="note">Walls and floors default to the light colour, the day stage to the stage colour. Hue kept: how much of the model's own colour shows through.</p></details>`;
  }

  _snapshotSection(status) {
    const c = this._config, v = c.view || {}, snap = c.snapshot;
    const store = c.storage || "upload";
    return `<p class="note">Renders a static picture of the model in this browser and stores it with Home Assistant, so guests' devices never run 3D.</p>
<div class="row"><label>Style<select data-field="view.style" data-key="vst">${STYLES.map(([k, t]) => `<option value="${k}" ${(v.style || "standard") === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>${v.style === "neon" ? `<label style="flex:0 0 auto;min-width:0">Edge colour<input type="color" data-field="view.accent" value="${esc(v.accent || "#37e0ff")}" data-key="vac"></label>` : ""}</div>
${v.style && v.style !== "standard" ? `<p class="note">${THEME_NOTES[v.style] || ""} The floor3dx-card look themes recolour surfaces per pixel and draw edge lines; the map sits on the theme's stage colour. Bright, saturated colours keep their colour.</p>` : ""}
${v.style === "custom" ? this._customColours(v.custom || {}) : ""}
<label>View — the picture stays an orthographic (true-scale) projection</label>
<div class="row"><label>Turn (Y): <span data-unit="°">${esc(v.azimuth ?? 45)}°</span><input type="range" min="0" max="359" step="1" data-field="view.azimuth" data-num data-view="azimuth" value="${esc(v.azimuth ?? 45)}" data-key="va"></label><label>Tilt (X): <span data-unit="°">${esc(v.elevation ?? 52)}°</span><input type="range" min="5" max="90" step="1" data-field="view.elevation" data-num data-view="elevation" value="${esc(v.elevation ?? 52)}" data-key="ve"></label><label>Roll (Z): <span data-unit="°">${esc(v.roll ?? 0)}°</span><input type="range" min="-180" max="180" step="1" data-field="view.roll" data-num data-view="roll" value="${esc(v.roll ?? 0)}" data-key="vr"></label></div>
<div class="row"><button data-act="preview" ${!c.models.length ? "disabled" : ""}>${this._previewOpen ? "Hide 3D preview" : "Show 3D preview"}</button>${this._previewOpen ? '<button data-act="view-reset">Reset view</button><button data-act="view-top">Straight down</button>' : ""}</div>
${this._previewOpen ? '<div class="pv-slot"></div><p class="note">Drag to turn and tilt, scroll to zoom the preview. Nothing is saved until you render the snapshot.</p>' : ""}
<div class="row"><label>Wall transparency: <span data-unit="%">${esc(v.wall_transparency ?? 0)}%</span><input type="range" min="0" max="90" step="5" data-field="view.wall_transparency" data-num value="${esc(v.wall_transparency ?? 0)}" data-key="vwt"></label></div>
${Number(v.wall_transparency) > 0 ? `<p class="note">Every wall object (name starting with <code>${esc(v.walls ?? "wall")}</code>) is drawn see-through${Number(v.wall_transparency) >= 30 ? "; floors behind walls can be tapped" : ""}.</p>` : ""}
${(() => { const n = c.models.reduce((k, m) => k + (m.panels?.length || 0), 0); return `<label class="check"><input type="checkbox" data-field="view.hide_panels" data-bool data-default-true ${v.hide_panels !== false ? "checked" : ""} ${n ? "" : "disabled"}>Hide the floor3d card's text and picture panels${n ? ` (${n} object${n === 1 ? "" : "s"})` : " — run “Find floor3d cards” in section 1 to pick them up"}</label>`; })()}
<div class="row"><label class="check"><input type="checkbox" data-field="view.room_colors" data-bool ${v.room_colors ? "checked" : ""}>Pastel room floors</label><label class="check"><input type="checkbox" data-field="view.edges" data-bool data-default-true ${v.edges !== false ? "checked" : ""}>Outline edges</label>${v.edges !== false ? `<label class="check"><input type="checkbox" data-field="view.edge_joints" data-bool data-default-true ${v.edge_joints !== false ? "checked" : ""}>No lines on wall seams and room borders</label>` : ""}</div>
<details><summary>Advanced</summary><div class="body">
<label>Hide objects matching (regex)<input type="text" data-field="view.hide" value="${esc(v.hide ?? "^room_\\d+_2$|^Frame")}" data-key="vh"></label>
<label>Wall objects (name prefixes, comma-separated)<input type="text" data-field="view.walls" value="${esc(v.walls ?? "wall")}" data-key="vw"></label>
<label>Hanging fixtures to hide (regex)<input type="text" data-field="view.fixture_names" value="${esc(v.fixture_names ?? "^fan_|^Fluorescent_strip")}" data-key="vf"></label>
<div class="row"><label>Image height (px)<input type="number" min="500" max="2400" step="100" data-field="view.height" data-num value="${esc(v.height ?? 1000)}" data-key="vhh"></label><label>Storage<select data-field="storage" data-key="vs"><option value="upload" ${store === "upload" ? "selected" : ""}>Home Assistant image store</option><option value="embed" ${store === "embed" ? "selected" : ""}>Embed in this dashboard</option></select></label></div>
</div></details>
<div class="row"><button class="primary" data-act="render" ${!c.models.length || !c.rooms.length || this._busy ? "disabled" : ""}>${this._busy === "render" ? "Rendering…" : snap ? "Render again" : "Render snapshot"}</button></div>
${this._progress ? `<p class="note">${esc(this._progress)}</p>` : ""}${this._msg?.snapshot ? `<p class="note ${this._msg.snapshot[0]}">${esc(this._msg.snapshot[1])}</p>` : ""}
${status[0] === "warn" && snap ? '<p class="note warn">Rooms, models or view changed since the last render. Render again to update the map.</p>' : ""}
${snap ? `<div class="preview"><img src="${esc(snap.image)}" style="-webkit-mask-image:url(&quot;${esc(snap.index)}&quot;);mask-image:url(&quot;${esc(snap.index)}&quot;);aspect-ratio:${Number(snap.aspect) || 1.2}"></div><p class="note">${snap.width}×${snap.height}px</p>` : ""}`;
  }

  _sunSection() {
    const c = this._config, s = c.sun || {}, snap = c.snapshot;
    const lat = s.latitude ?? this._hass?.config?.latitude, lon = s.longitude ?? this._hass?.config?.longitude;
    const hasLoc = Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) && (Number(lat) || Number(lon));
    const north = Number(s.north) || 0, strength = Number(s.strength ?? 0.6);
    const t = this._previewTime ?? Date.now(), d = new Date(t);
    const hours = d.getHours() + d.getMinutes() / 60;
    const pos = hasLoc ? solarPosition(d, Number(lat), Number(lon)) : null;
    const sunText = !pos ? "" : pos.elevation > 0 ? `sun ${Math.round(pos.elevation)}° up in the ${compassName(pos.azimuth)}` : pos.elevation > -6 ? "twilight" : "night";
    const when = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return `<label class="check"><input type="checkbox" data-field="sun.enabled" data-bool ${s.enabled ? "checked" : ""}>Simulate sunlight — shading and shadows follow the sun through the day, warm at dawn and dusk, dim at night</label>
${s.enabled ? `${!hasLoc ? '<p class="note err">Home Assistant has no home location (Settings → System → General). Sunlight needs it.</p>' : `<p class="note">Sun position from your home location (${Number(lat).toFixed(2)}°, ${Number(lon).toFixed(2)}°) and the viewer's clock, updated every few minutes (more often around sunrise and sunset).</p>`}
${!snap?.light ? '<p class="note warn">Render the snapshot again (section 3) to add the lighting layer.</p>' : ""}
<div class="row"><label>North: <span data-unit="°">${north}°</span><input type="range" min="0" max="359" step="1" data-field="sun.north" data-num value="${north}" data-key="sn"></label><label style="max-width:110px">Degrees<input type="number" min="0" max="359" data-field="sun.north" data-num value="${north}" data-key="sn2"></label></div>
<p class="note">Clockwise from the top of the floor plan — the same as the compass “North direction” in Sweet Home 3D. Check it with the north arrow on the map.</p>
<div class="row"><label>Strength: <span data-unit="%">${Math.round(strength * 100)}%</span><input type="range" min="0.2" max="1" step="0.05" data-field="sun.strength" data-num data-pct value="${strength}" data-key="ss"></label></div>
<div class="row"><label class="check"><input type="checkbox" data-field="sun.shadows" data-bool data-default-true ${s.shadows !== false ? "checked" : ""}>Shadows</label><label class="check"><input type="checkbox" data-field="sun.night_glow" data-bool data-default-true ${s.night_glow !== false ? "checked" : ""}>Rooms with lights on glow after dark</label><label class="check"><input type="checkbox" data-field="sun.compass" data-bool data-default-true ${s.compass !== false ? "checked" : ""}>North arrow</label></div>
${hasLoc ? `<div class="row"><label>Preview today at <b id="sun-when">${esc(when)}</b> · <span id="sun-text">${esc(sunText)}</span><input type="range" id="sun-preview" min="0" max="23.75" step="0.25" value="${hours.toFixed(2)}" data-key="sp"></label><button data-act="sun-live" ${this._previewTime == null ? "disabled" : ""}>Now</button></div><p class="note">The preview only changes this editor's view; the card always follows the real time.</p>` : ""}` : ""}`;
  }

  _displaySection() {
    const c = this._config;
    return `<div class="row"><label>Title<input type="text" data-field="title" value="${esc(c.title || "")}" data-key="dt"></label><label>Subtitle<input type="text" data-field="subtitle" value="${esc(c.subtitle ?? "")}" placeholder="Tap a room on the map to see its controls." data-key="ds"></label></div>
<div class="row"><label>Start with room<select data-field="default_room" data-key="dr"><option value="">First room</option>${c.rooms.map((r) => `<option value="${esc(r.id)}" ${c.default_room === r.id ? "selected" : ""}>${esc(r.name || r.id)}</option>`).join("")}</select></label><label>Layout<select data-field="layout" data-key="dl">${[["", "Automatic"], ["side", "Map beside controls"], ["stacked", "Map above controls"]].map(([v, t]) => `<option value="${v}" ${(c.layout || "") === v ? "selected" : ""}>${t}</option>`).join("")}</select></label></div>
<div class="row"><label>Room buttons under the map<select data-field="room_list" data-key="dl2">${[["", "Rooms the map can't show"], ["always", "All rooms"], ["never", "Never"]].map(([v, t]) => `<option value="${v}" ${(c.room_list || "") === v ? "selected" : ""}>${t}</option>`).join("")}</select></label></div>
<label class="check"><input type="checkbox" data-field="guest_mode" data-bool data-default-true ${c.guest_mode !== false ? "checked" : ""}>Guest mode — locks can only be locked, garage doors and gates only closed, alarms are read-only, TV volume is capped</label>
<div class="row"><label>Max volume (0–1)<input type="number" min="0" max="1" step="0.05" data-field="max_volume" data-num value="${esc(c.max_volume ?? "")}" placeholder="${c.guest_mode !== false ? "0.6" : "1"}" data-key="dv"></label><label>Thermostat min<input type="number" data-field="temperature_range.0" data-num value="${esc(c.temperature_range?.[0] ?? "")}" data-key="dmin"></label><label>Thermostat max<input type="number" data-field="temperature_range.1" data-num value="${esc(c.temperature_range?.[1] ?? "")}" data-key="dmax"></label></div>
<p class="note">A dashboard is not a security boundary: give guests a non-admin Home Assistant user, and use Home Assistant permissions for anything that must be enforced.</p>`;
  }

  // ---- events ---------------------------------------------------------------
  _shadowRootEvents() {
    const root = this.shadowRoot;
    root.addEventListener("toggle", (e) => {
      const d = e.target;
      if (d.dataset?.section) this._open[d.dataset.section] = d.open;
      if (d.dataset?.room !== undefined) { const id = this._config.rooms[d.dataset.room]?.id; if (id) d.open ? this._roomOpen.add(id) : this._roomOpen.delete(id); }
    }, true);
    root.addEventListener("change", (e) => { if (e.target.id === "detect-sensors") { this._detectSensors = e.target.checked; return; } this._field(e.target); });
    root.addEventListener("input", (e) => {
      const el = e.target; if (el.type !== "range") return;
      if (el.id === "sun-preview") return this._preview(Number(el.value));
      if (el.dataset.view && this._pv) this._pv.setView({ [el.dataset.view]: Number(el.value) });
      const l = el.closest("label"), unit = l?.querySelector("[data-unit]");
      if (unit) unit.textContent = el.dataset.pct !== undefined ? `${Math.round(el.value * 100)}%` : `${el.value}${unit.dataset.unit}`;
      else if (l) l.firstChild.textContent = l.firstChild.textContent.replace(/[\d.]+°/, `${el.value}°`);
    });
    root.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id?.match(/^(new-model|ent-|floor-)/)) { e.preventDefault(); e.target.closest(".row")?.querySelector("button")?.click(); } });
    root.addEventListener("click", (e) => { const b = e.target.closest("button[data-act]"); if (b && !b.disabled) this._act(b.dataset.act, b.dataset, b); });
  }
  _field(el) {
    const path = el.dataset?.field; if (!path) return;
    let value = el.dataset.bool !== undefined ? el.checked : el.value;
    if (el.dataset.num !== undefined) value = value === "" ? undefined : Number(value);
    if (typeof value === "string") value = value.trim();
    if (path === "view.style" && value === "standard") value = "";
    if (path === "view.wall_transparency" && value === 0) value = undefined;
    const keys = path.split("."), last = keys.pop();
    let o = this._config;
    keys.forEach((k, n) => { const next = keys[n + 1] ?? last; o[k] ??= /^\d+$/.test(next) ? [] : {}; o = o[k]; });
    if (value === "" || value === undefined || (el.dataset.defaultTrue !== undefined && value === true)) delete o[last]; else o[last] = value;
    if (path === "guest_mode" && value === false) this._config.guest_mode = false;
    if (Array.isArray(this._config.temperature_range) && this._config.temperature_range.filter((x) => x !== null && x !== undefined).length < 2) delete this._config.temperature_range;
    if (/^rooms\.\d+\.name$/.test(path)) {
      const r = this._config.rooms[Number(keys[1])];
      if (r && (!r.id || /^room(-\d+)?$/.test(r.id))) { const taken = new Set(this._config.rooms.filter((x) => x !== r).map((x) => x.id)); this._roomOpen.delete(r.id); r.id = slug(value, taken); this._roomOpen.add(r.id); }
    }
    if (/\.anchor\.object$/.test(path) && o.object) o.model ??= 0;
    if (/\.anchor\.object$/.test(path) && !o.object) delete this._config.rooms[Number(keys[1])].anchor;
    this._emit();
  }
  async _act(act, d) {
    const c = this._config, i = Number(d.i), j = Number(d.j);
    const rooms = c.rooms;
    if (act === "scan") return this._scan();
    if (act === "use-found") {
      const f = this._found[i]; this._floor3d[f.url] = { entities: f.entities, groups: f.groups };
      // the first card also lends its look theme and north direction, unless already set here
      if (!c.models.length && f.look && !c.view?.style) c.view = { ...(c.view || {}), style: f.look, ...(f.look === "neon" && f.accent ? { accent: f.accent } : {}), ...(f.look === "custom" && f.custom ? { custom: f.custom } : {}) };
      if (!c.models.length && f.north !== undefined && c.sun?.north === undefined) c.sun = { ...(c.sun || {}), north: f.north };
      const panels = panelsOf(f);
      c.models.push({ url: f.url, ...(f.mtl ? { mtl: f.mtl } : {}), ...(c.models.length ? { place: "east" } : {}), ...(panels.length ? { panels } : {}) });
      this._session = null; return this._emit();
    }
    if (act === "model-add") {
      const url = this.shadowRoot.getElementById("new-model").value.trim(); if (!url) return;
      c.models.push({ url, ...(c.models.length ? { place: "east" } : {}) }); this._session = null; return this._emit();
    }
    if (act === "model-remove") { c.models.splice(i, 1); this._session = null; return this._emit(); }
    if (act === "room-add") { const id = slug("room", new Set(rooms.map((r) => r.id))); rooms.push({ id, name: "New room", floors: [], entities: [] }); this._roomOpen.add(id); return this._emit(); }
    if (act === "room-remove") { rooms.splice(i, 1); return this._emit(); }
    if (act === "room-up" && i) { [rooms[i - 1], rooms[i]] = [rooms[i], rooms[i - 1]]; return this._emit(); }
    if (act === "room-down" && i < rooms.length - 1) { [rooms[i + 1], rooms[i]] = [rooms[i], rooms[i + 1]]; return this._emit(); }
    if (act === "floor-add") {
      const input = this.shadowRoot.getElementById(`floor-${i}`), obj = input.value.trim(); if (!obj) return;
      const model = Number(this.shadowRoot.getElementById(`floor-model-${i}`)?.value || 0);
      (rooms[i].floors ||= []).push({ model, object: obj }); delete rooms[i].anchor; return this._emit();
    }
    if (act === "floor-remove") { rooms[i].floors.splice(j, 1); return this._emit(); }
    if (act === "ent-add") {
      const id = this.shadowRoot.getElementById(`ent-${i}`).value.trim(); if (!id) return;
      (rooms[i].entities ||= []).push({ entity: id }); return this._emit();
    }
    if (act === "ent-remove") { rooms[i].entities.splice(j, 1); return this._emit(); }
    if (act === "ent-up" && j) { const e = rooms[i].entities; [e[j - 1], e[j]] = [e[j], e[j - 1]]; return this._emit(); }
    if (act === "anchor-pick") { rooms[i].anchor = { model: Number(d.model) || 0, object: d.obj }; return this._emit(); }
    if (act === "preview") return this._previewOpen ? this._closePreview(true) : this._openPreview();
    if (act === "view-reset" || act === "view-top") {
      c.view = { ...(c.view || {}), ...(act === "view-top" ? { azimuth: 0, elevation: 90, roll: 0 } : VIEW_RESET) };
      for (const k of ["azimuth", "elevation", "roll"]) if (c.view[k] === VIEW_RESET[k]) delete c.view[k];
      return this._emit();
    }
    if (act === "sun-live") { this._previewTime = null; window.dispatchEvent(new CustomEvent(SUN_PREVIEW_EVENT, { detail: { time: null } })); return this._render(); }
    if (act === "detect") return this._detect();
    if (act === "render") return this._renderSnapshot();
  }

  // ---- 3D preview -------------------------------------------------------------
  _previewView() { const v = this._config.view || {}; return { ...v, azimuth: v.azimuth ?? 45, elevation: v.elevation ?? 52, roll: v.roll ?? 0 }; }
  _styleKey() { const { azimuth, elevation, roll, height, ...rest } = this._config.view || {}; return JSON.stringify([rest, (this._config.rooms || []).map((r) => [r.floors, r.color])]); }
  async _openPreview() {
    this._previewOpen = true; this._render();
    if (!this._pvCanvas) {
      const wrap = document.createElement("div"); wrap.className = "pv";
      wrap.innerHTML = '<canvas></canvas><div class="pvbusy">Loading the model…</div><span class="pvhint" hidden>Drag to rotate</span>';
      this._pvWrap = wrap; this._pvCanvas = wrap.querySelector("canvas");
      this._wirePreview(this._pvCanvas);
    }
    this._mountPreview();
    try {
      const session = await this._engine();
      if (!this._previewOpen || this._pv) return;
      this._pvWrap.querySelector(".pvbusy").textContent = "Styling…";
      this._pv = await session.openPreview(this._pvCanvas, { view: this._previewView(), rooms: this._config.rooms });
      this._pvStyle = this._styleKey();
      this._pvWrap.querySelector(".pvbusy").hidden = true; this._pvWrap.querySelector(".pvhint").hidden = false;
      this._paintPreviewStage();
    } catch (err) { this._pvWrap.querySelector(".pvbusy").textContent = `Couldn't load the model: ${err.message || err}`; }
  }
  _closePreview(hide = false) {
    if (this._pv) {
      this._pv.close(); this._pv = null;
      // a released WebGL context can't be reacquired: the next preview gets a fresh canvas
      const fresh = document.createElement("canvas"); this._pvCanvas.replaceWith(fresh); this._pvCanvas = fresh; this._wirePreview(fresh);
    }
    if (this._pvWrap) { this._pvWrap.querySelector(".pvbusy").hidden = false; this._pvWrap.querySelector(".pvbusy").textContent = "Loading the model…"; this._pvWrap.querySelector(".pvhint").hidden = true; }
    if (hide) { this._previewOpen = false; this._render(); }
  }
  _mountPreview() {
    const slot = this.shadowRoot.querySelector(".pv-slot");
    if (!slot || !this._pvWrap) return;
    slot.replaceWith(this._pvWrap);
    if (this._pv) {
      if (this._styleKey() !== this._pvStyle) { this._pvStyle = this._styleKey(); this._pv.restyle(this._previewView(), this._config.rooms).then(() => this._paintPreviewStage()); }
      else this._pv.setView(this._previewView());
    }
  }
  _paintPreviewStage() { const v = this._config.view || {}; this._pvCanvas.style.background = v.style === "custom" ? (v.custom?.stage || CUSTOM_DEFAULTS.stage) : STAGE_BG[v.style] || ""; }
  _wirePreview(cv) {
    let drag = null;
    cv.addEventListener("pointerdown", (e) => { if (!this._pv) return; drag = { x: e.clientX, y: e.clientY, v: this._previewView() }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const az = ((Math.round(drag.v.azimuth - (e.clientX - drag.x) * 0.4) % 360) + 360) % 360;
      const el = Math.min(90, Math.max(5, Math.round(drag.v.elevation + (e.clientY - drag.y) * 0.3)));
      drag.now = { azimuth: az, elevation: el };
      this._pv.setView(drag.now);
      for (const [k, val] of Object.entries(drag.now)) { const i = this.shadowRoot.querySelector(`input[data-view="${k}"]`); if (i) { i.value = val; const u = i.closest("label")?.querySelector("[data-unit]"); if (u) u.textContent = `${val}°`; } }
    });
    const end = () => {
      if (!drag) return; const now = drag.now; drag = null;
      if (!now) return;
      this._config.view = { ...(this._config.view || {}), ...now };
      this._emit();
    };
    cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
    cv.addEventListener("wheel", (e) => { if (!this._pv) return; e.preventDefault(); this._pv.zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
  }

  _preview(hours) {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    this._previewTime = d.getTime() + hours * 3600000;
    window.dispatchEvent(new CustomEvent(SUN_PREVIEW_EVENT, { detail: { time: this._previewTime } }));
    // update the label in place (no re-render while dragging)
    const c = this._config.sun || {}, lat = c.latitude ?? this._hass?.config?.latitude, lon = c.longitude ?? this._hass?.config?.longitude;
    const pos = solarPosition(new Date(this._previewTime), Number(lat), Number(lon));
    const r = this.shadowRoot;
    r.getElementById("sun-when").textContent = new Date(this._previewTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    r.getElementById("sun-text").textContent = pos.elevation > 0 ? `sun ${Math.round(pos.elevation)}° up in the ${compassName(pos.azimuth)}` : pos.elevation > -6 ? "twilight" : "night";
    const live = r.querySelector('[data-act="sun-live"]'); if (live) live.disabled = false;
  }

  // ---- floor3d discovery ----------------------------------------------------
  async _scan() {
    this._scanning = true; this._render();
    const found = [];
    try {
      const boards = await this._hass.callWS({ type: "lovelace/dashboards/list" }).catch(() => []);
      const targets = [{ url_path: null, title: "Overview" }, ...boards.filter((b) => b.mode !== "yaml" || true)];
      for (const b of targets) {
        let cfg;
        try { cfg = await this._hass.callWS({ type: "lovelace/config", url_path: b.url_path, force: false }); } catch { continue; }
        const walk = (node, view) => {
          if (!node || typeof node !== "object") return;
          if (Array.isArray(node)) return node.forEach((n) => walk(n, view));
          if (typeof node.type === "string" && /floor3d/i.test(node.type) && typeof node.objfile === "string") {
            const url = `${node.path || ""}${node.objfile}`;
            if (!found.some((f) => f.url === url)) {
              const groups = {};
              for (const g of node.object_groups || []) groups[g.object_group] = (g.objects || []).map((o) => o.object_id);
              found.push({ url, mtl: node.mtlfile ? `${node.path || ""}${node.mtlfile}` : undefined, look: THEME_NAMES.includes(String(node.look?.theme || "").toLowerCase()) ? String(node.look.theme).toLowerCase() : undefined, accent: node.look?.accent, custom: node.look?.custom && typeof node.look.custom === "object" ? node.look.custom : undefined, north: northDegrees(node.north), label: `${b.title || b.url_path || "Dashboard"} › ${view || "view"} · ${node.type.replace("custom:", "")}`, entities: (node.entities || []).filter((e) => typeof e.entity === "string" && typeof e.object_id === "string").map(({ entity, object_id, type3d, color_entity }) => ({ entity, object_id, ...(type3d ? { type3d } : {}), ...(typeof color_entity === "string" ? { color_entity } : {}) })), groups });
            } else {
              // A second card on the same model adds its entities too.
              const f = found.find((x) => x.url === url);
              for (const e of node.entities || []) if (e.entity && e.object_id && !f.entities.some((x) => x.entity === e.entity && x.object_id === e.object_id)) f.entities.push({ entity: e.entity, object_id: e.object_id, ...(e.type3d ? { type3d: e.type3d } : {}), ...(typeof e.color_entity === "string" ? { color_entity: e.color_entity } : {}) });
            }
          }
          for (const [k, v] of Object.entries(node)) walk(v, k === "views" ? view : (node.title && node.cards ? node.title : view));
        };
        (cfg.views || []).forEach((v) => walk(v, v.title || v.path));
      }
    } finally { this._scanning = false; }
    this._found = found;
    for (const f of found) this._floor3d[f.url] = { entities: f.entities, groups: f.groups };
    // models already here pick up (or refresh) their card's text and picture panels
    let changed = false;
    for (const m of this._config.models) {
      const f = found.find((x) => x.url === m.url); if (!f) continue;
      const panels = panelsOf(f);
      if (JSON.stringify(panels) !== JSON.stringify(m.panels || [])) { if (panels.length) m.panels = panels; else delete m.panels; changed = true; }
    }
    if (changed) this._session = null;
    // a switch whose floor3d binding names a color_entity (the bulb behind it) gets that as its dimmer
    const dimmers = dimmersOf(found);
    let added = 0;
    for (const r of this._config.rooms) for (const e of r.entities || []) if (!e.dimmer && dimmers.has(e.entity)) { e.dimmer = dimmers.get(e.entity); added++; }
    if (added) this._msg = { rooms: ["", `Linked ${added} switch${added === 1 ? "" : "es"} to the bulb${added === 1 ? "" : "s"} behind ${added === 1 ? "it" : "them"} (floor3d color_entity) for brightness.`] };
    if (changed || added) return this._emit();
    this._render();
  }

  // ---- 3D engine (lazy) -----------------------------------------------------
  async _engine() {
    const models = this._config.models, key = JSON.stringify(models);
    if (this._session && this._sessionKey === key) return this._session;
    if (this._pv) this._closePreview();
    this._session?.dispose?.();
    const mod = await import("./snapshot.js");
    this._session = await mod.createSession({ models, decoderBase: new URL("./", import.meta.url), onProgress: (p) => { this._progress = p; this._render(); } });
    this._sessionKey = key;
    this._objectNames = this._session.objectNames();
    return this._session;
  }
  async _detect() {
    this._busy = "detect"; this._msg = {}; this._render();
    try {
      const session = await this._engine();
      const floor3d = this._config.models.map((m) => this._floor3d[m.url] || { entities: [], groups: {} });
      const name = (id) => this._hass?.states?.[id]?.attributes?.friendly_name || String(id).split(".")[1]?.replace(/_/g, " ") || id;
      const proposed = session.suggestRooms(floor3d, name, { sensors: !!this._detectSensors });
      const dim = dimmersOf(Object.values(this._floor3d));
      for (const r of proposed) for (const e of r.entities) if (dim.has(e.entity)) e.dimmer = dim.get(e.entity);
      if (!proposed.length) { this._msg = { rooms: ["warn", "No room_N_1 floor objects found. Add rooms by hand and pick their floor objects."] }; return; }
      const existing = new Map(this._config.rooms.map((r) => [JSON.stringify(r.floors), r]));
      const taken = new Set();
      this._config.rooms = proposed.map((p) => {
        const keep = existing.get(JSON.stringify(p.floors));     // keep the host's edits for known floors
        const room = keep ? { ...keep, entities: keep.entities?.length ? keep.entities : p.entities } : p;
        room.id = slug(room.id || room.name, taken); taken.add(room.id);
        return room;
      }).concat(this._config.rooms.filter((r) => !r.floors?.length));   // pin-only rooms stay
      const ents = this._config.rooms.reduce((n, r) => n + (r.entities?.length || 0), 0);
      const hadFloor3d = floor3d.some((f) => f.entities.length);
      this._msg = { rooms: ["", `Found ${proposed.length} rooms${hadFloor3d ? ` and placed ${ents} floor3d entities in them` : ". Use “Find floor3d cards” first to fill rooms with the card's entities automatically"}.`] };
      this._open.rooms = true;
    } catch (err) {
      this._msg = { rooms: ["err", `Couldn't load the model: ${err.message || err}`] };
    } finally { this._busy = null; this._progress = ""; this._emit(); }
  }
  async _renderSnapshot() {
    this._busy = "render"; this._msg = {}; this._render();
    const reopen = !!this._pv; if (reopen) this._closePreview();
    try {
      const session = await this._engine();
      const c = this._config;
      const result = await session.render({ view: { ...(c.view || {}), sunlight: !!c.sun?.enabled }, rooms: c.rooms, onProgress: (p) => { this._progress = p; this._render(); } });
      this._progress = c.storage === "embed" ? "Embedding…" : "Uploading to Home Assistant…"; this._render();
      const old = c.snapshot;
      let image, index, light, ids = {};
      if (c.storage === "embed") { image = await dataUrl(result.image); index = await dataUrl(result.index); if (result.light) light = await dataUrl(result.light); }
      else {
        const a = await this._upload(result.image, "floor3d-snapshot.jpg"), b = await this._upload(result.index, "floor3d-snapshot-index.png");
        image = a.url; index = b.url; ids = { image_id: a.id, index_id: b.id };
        if (result.light) { const l = await this._upload(result.light, "floor3d-snapshot-light.png"); light = l.url; ids.light_id = l.id; }
      }
      c.snapshot = { image, index, ...(light ? { light, lighting: result.lighting } : {}), ...(result.stage ? { style: result.style, stage: result.stage } : {}), ...(result.wall_alpha ? { wall_alpha: result.wall_alpha } : {}), ...ids, aspect: result.aspect, width: result.width, height: result.height, rooms: result.rooms, key: snapshotKey(c) };
      for (const id of [old?.image_id, old?.index_id, old?.light_id]) if (id) this._hass.callWS({ type: "image/delete", image_id: id }).catch(() => {});
      const kb = Math.round((result.image.size + result.index.size) / 1024), lkb = result.light ? Math.round(result.light.size / 1024) : 0;
      const unplaced = c.rooms.filter((r) => !result.rooms[r.id]?.pin).map((r) => r.name || r.id);
      this._msg = { snapshot: [unplaced.length ? "warn" : "", `Snapshot saved (${kb} KB for guests to download${lkb ? `, plus ${lkb} KB for sunlight` : ""}).${unplaced.length ? ` No place on the map for: ${unplaced.join(", ")} — they show as buttons under the map. Give them a floor object or a pin anchor (section 2) and render again.` : ""}`] };
    } catch (err) {
      this._msg = { snapshot: ["err", `Rendering failed: ${err.message || err}`] };
    } finally { this._busy = null; this._progress = ""; this._emit(); if (reopen && this._previewOpen) this._openPreview(); }
  }
  async _upload(blob, name) {
    const form = new FormData(); form.append("file", blob, name);
    const resp = await this._hass.fetchWithAuth("/api/image/upload", { method: "POST", body: form });
    if (!resp.ok) throw new Error(`Home Assistant refused the upload (${resp.status}). Choose “Embed in this dashboard” under Advanced.`);
    const json = await resp.json();
    return { id: json.id, url: `/api/image/serve/${json.id}/original` };
  }
}
/** switch → light: floor3d `color_entity` on a non-light entry names the dimmable bulb behind it. */
function dimmersOf(found) {
  const map = new Map();
  for (const f of found || []) for (const e of f.entities || []) if (e.color_entity && !/^light\./.test(e.entity) && /^light\./.test(e.color_entity) && !map.has(e.entity)) map.set(e.entity, e.color_entity);
  return map;
}
/** Objects a floor3d card uses as text or picture panels (type3d text / image), groups resolved. */
function panelsOf(f) {
  const out = new Set();
  for (const e of f?.entities || []) {
    if (e.type3d !== "text" && e.type3d !== "image") continue;
    const g = /^<(.+)>$/.exec(e.object_id || "");
    for (const o of g ? f.groups?.[g[1]] || [] : [e.object_id]) if (o) out.add(o);
  }
  return [...out].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
/** floor3dx `north: {x, z}` (scene direction of north) → degrees clockwise from the plan's top. */
function northDegrees(n) {
  if (!n || typeof n !== "object" || !Number.isFinite(Number(n.x)) || !Number.isFinite(Number(n.z)) || (!Number(n.x) && !Number(n.z))) return undefined;
  return (Math.round(Math.atan2(Number(n.x), -Number(n.z)) * 180 / Math.PI) + 360) % 360;
}
const dataUrl = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });

if (!customElements.get("floor3d-snapshot-card-editor")) customElements.define("floor3d-snapshot-card-editor", Floor3dSnapshotCardEditor);
