// Thermostat, TV and shade tiles in headless Chromium against simulated entities.
import { chromium } from "playwright";
import fs from "node:fs";
import { start } from "./server.mjs";

fs.mkdirSync("dev/out", { recursive: true });
const server = await start();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1300 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
let failures = 0;
const check = (ok, label, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };
await page.goto(`http://127.0.0.1:${server.address().port}/dev/index.html?fixture=demo`);
await page.waitForFunction(() => window.harness);

await page.evaluate(() => {
  const H = window.harness, st = (id, state, attributes) => ({ entity_id: id, state, attributes: { friendly_name: id.split(".")[1].replace(/_/g, " "), ...attributes } });
  Object.assign(H.hass.states, {
    "climate.ecobee": st("climate.ecobee", "heat_cool", { hvac_modes: ["heat_cool", "heat", "cool", "off"], min_temp: 45, max_temp: 92, target_temp_step: 0.5, target_temp_low: 68, target_temp_high: 74, current_temperature: 71, hvac_action: "idle", supported_features: 411 }),
    "climate.gree": st("climate.gree", "off", { hvac_modes: ["auto", "cool", "dry", "fan_only", "heat", "off"], min_temp: 46, max_temp: 86, target_temp_step: 1, temperature: null, current_temperature: 80, supported_features: 953 }),
    "climate.old": st("climate.old", "off", { hvac_modes: ["heat", "cool", "off"], min_temp: 50, max_temp: 90, temperature: null, current_temperature: 60, supported_features: 1 }),
    "media_player.samsung": st("media_player.samsung", "on", { supported_features: 24381, volume_level: 0.5, is_volume_muted: false, source_list: ["TV", "HDMI"], source: "TV" }),
    "media_player.android": st("media_player.android", "on", { supported_features: 153529, volume_level: 0.3, is_volume_muted: false, app_name: "YouTube", media_title: "A long programme title" }),
    "remote.android": st("remote.android", "on", {}),
    "cover.shade_bottom": st("cover.shade_bottom", "closed", { current_position: 0, supported_features: 15, device_class: "shade" }),
    "cover.shade_top": st("cover.shade_top", "open", { current_position: 30, supported_features: 15, device_class: "shade" }),
    "cover.blind": st("cover.blind", "open", { current_position: 40, supported_features: 15, device_class: "blind" }),
  });
  H.hass.entities = { "media_player.samsung": { platform: "samsungtv" }, "remote.android": { platform: "androidtv_remote" }, "media_player.android": { platform: "androidtv_remote" } };
  // a fuller service stand-in for these domains; covers move after a moment, like a real shade
  H.hass.callService = async (domain, service, data) => {
    H.calls.push({ domain, service, data });
    const id = data.entity_id, s = { ...H.hass.states[id], attributes: { ...H.hass.states[id].attributes } }, a = s.attributes;
    const put = (x) => { H.hass.states = { ...H.hass.states, [id]: x }; H.push(); };
    if (domain === "climate") {
      if (service === "turn_on") s.state = window.__lastMode?.[id] || "cool";
      if (service === "turn_off" || (service === "set_hvac_mode" && data.hvac_mode === "off")) { (window.__lastMode ||= {})[id] = s.state; s.state = "off"; }
      if (service === "set_hvac_mode" && data.hvac_mode !== "off") s.state = data.hvac_mode;
      if (service === "set_temperature") Object.assign(a, data, { entity_id: undefined });
      if (s.state === "heat_cool") { a.temperature = null; a.target_temp_low ??= 68; a.target_temp_high ??= 74; }
      else if (s.state !== "off") { a.temperature ??= 72; a.target_temp_low = a.target_temp_high = null; }
      put(s);
    } else if (domain === "media_player") {
      if (service === "turn_off") s.state = "off"; if (service === "turn_on") s.state = "on";
      if (service === "volume_set") a.volume_level = data.volume_level;
      if (service === "volume_up") a.volume_level = Math.round((a.volume_level + 0.1) * 100) / 100;
      if (service === "volume_down") a.volume_level = Math.round((a.volume_level - 0.1) * 100) / 100;
      if (service === "volume_mute") a.is_volume_muted = data.is_volume_muted;
      if (service === "select_source") a.source = data.source;
      put(s);
    } else if (domain === "cover") {
      const p = service === "close_cover" ? 0 : service === "open_cover" ? 100 : data.position;
      if (H.blockCovers) throw new Error("hub busy");
      setTimeout(() => { const t = { ...H.hass.states[id], attributes: { ...H.hass.states[id].attributes, current_position: p } }; t.state = p > 0 ? "open" : "closed"; H.hass.states = { ...H.hass.states, [id]: t }; H.push(); }, 400);
    }
  };
  H.setConfig({ type: "custom:floor3d-snapshot-card", title: "Home", guest_mode: false, temperature_range: [64, 76], rooms: [
    { id: "climate", name: "Climate", entities: [{ entity: "climate.ecobee" }, { entity: "climate.gree" }, { entity: "climate.old" }] },
    { id: "tv", name: "TV", entities: [{ entity: "media_player.samsung" }, { entity: "media_player.android", remote: "remote.android" }] },
    { id: "shades", name: "Shades", entities: [{ entity: "cover.shade_bottom", top_entity: "cover.shade_top", name: "Left shade" }, { entity: "cover.blind" }] },
  ] });
  H.push();
});
await page.waitForFunction(() => window.harness.card.shadowRoot.querySelector("[data-action=room]"), null, { timeout: 10000 });
const q = (sel) => page.evaluate((s) => !!window.harness.card.shadowRoot.querySelector(s), sel);
const click = async (sel) => { await page.evaluate((s) => { const el = window.harness.card.shadowRoot.querySelector(s); if (!el) throw new Error("missing " + s); el.click(); }, sel); await page.waitForTimeout(120); };
const lastCall = () => page.evaluate(() => window.harness.calls.at(-1));
const state = (id) => page.evaluate((i) => window.harness.hass.states[i], id);
const room = async (id) => { await click(`[data-action=room][data-room="${id}"]`); await page.waitForTimeout(100); };
const setGuest = (on) => page.evaluate((g) => { const H = window.harness; H.setConfig({ ...H.getConfig(), guest_mode: g }); H.push(); }, on);
const text = (sel) => page.evaluate((s) => window.harness.card.shadowRoot.querySelector(s)?.textContent, sel);

// ---- thermostats -------------------------------------------------------------
await room("climate");
await page.waitForTimeout(150);
check(await q('[data-action=temp][data-which=low][data-entity="climate.ecobee"]') && await q('[data-action=temp][data-which=high][data-entity="climate.ecobee"]'), "ecobee in heat_cool shows heat-to and cool-to steppers");
await click('[data-action=temp][data-which=high][data-entity="climate.ecobee"][aria-label^=Raise]');
let c = await lastCall();
check(c.service === "set_temperature" && c.data.target_temp_high === 74.5 && c.data.target_temp_low === 68 && c.data.temperature === undefined, "ecobee setpoint uses target_temp_low/high", JSON.stringify(c.data));
for (let i = 0; i < 10; i++) await click('[data-action=temp][data-which=low][data-entity="climate.ecobee"][aria-label^=Raise]');
let s = await state("climate.ecobee");
check(s.attributes.target_temp_high - s.attributes.target_temp_low >= 2 - 1e-9, "heat and cool setpoints keep a gap", `${s.attributes.target_temp_low}–${s.attributes.target_temp_high}`);
check(await q('[data-action=climate-power][data-entity="climate.gree"]'), "gree has a power switch");
await click('[data-action=climate-power][data-entity="climate.gree"]');
c = await lastCall();
check(c.service === "turn_on" && (await state("climate.gree")).state !== "off", "gree turns on", c.service);
check(await q('[data-action=temp][data-entity="climate.gree"]'), "gree shows its setpoint once on");
check(await page.evaluate(() => window.harness.card.shadowRoot.querySelectorAll('[data-action=hvac][data-entity="climate.gree"]').length) === 5, "host sees five mode buttons for gree");
await click('[data-action=hvac][data-entity="climate.gree"][data-mode=heat]');
check((await state("climate.gree")).state === "heat", "host changes mode");
await click('[data-action=climate-power][data-entity="climate.old"]');
c = await lastCall();
check(c.service === "set_hvac_mode" && c.data.hvac_mode === "heat", "without turn_on, power uses set_hvac_mode", JSON.stringify(c.data));
await page.evaluate(() => window.harness.card.shadowRoot.querySelector(".panel").scrollIntoView());
await page.screenshot({ path: "dev/out/devices-climate-host.png", fullPage: true });

await setGuest(true); await page.waitForTimeout(150);
check(!(await q('[data-action=hvac]')), "guest: no mode buttons");
check(await q('[data-action=climate-power][data-entity="climate.gree"]'), "guest: power by default");
// guest range 64–76: gree at 72 heat → raise to 76 then the + is disabled
for (let i = 0; i < 8; i++) { if (await q('[data-action=temp][data-entity="climate.gree"][aria-label^=Raise]:not([disabled])')) await click('[data-action=temp][data-entity="climate.gree"][aria-label^=Raise]'); }
s = await state("climate.gree");
check(s.attributes.temperature === 76, "guest: setpoint stops at temperature_range max", String(s.attributes.temperature));
await page.screenshot({ path: "dev/out/devices-climate-guest.png", fullPage: true });
await page.evaluate(() => { const H = window.harness; H.setConfig({ ...H.getConfig(), guest_thermostat: "setpoint" }); H.push(); });
await page.waitForTimeout(100);
check(!(await q('[data-action=climate-power]')) && await q('[data-action=temp]'), "guest_thermostat: setpoint hides power, keeps temperature");
await page.evaluate(() => { const H = window.harness; H.setConfig({ ...H.getConfig(), guest_thermostat: "view" }); H.push(); });
await page.waitForTimeout(100);
check(!(await q('[data-action=climate-power]')) && !(await q('[data-action=temp]')), "guest_thermostat: view is look-only");
await page.evaluate(() => { const H = window.harness; const c = { ...H.getConfig() }; delete c.guest_thermostat; H.setConfig(c); H.push(); });

// ---- TVs ------------------------------------------------------------------------
await room("tv");
await page.waitForTimeout(150);
const slider = await page.evaluate(() => window.harness.card.shadowRoot.querySelector('input[data-action=volume][data-entity="media_player.samsung"]')?.max);
check(slider === "0.6", "guest: Samsung volume slider capped", slider);
check((await text('[data-cmd=next][data-entity="media_player.samsung"]'))?.includes("Ch +"), "Samsung: channel buttons via next/previous track");
await click('[data-cmd=next][data-entity="media_player.samsung"]');
check((await lastCall()).service === "media_next_track", "Samsung channel up");
await page.evaluate(() => { const sel = window.harness.card.shadowRoot.querySelector('select[data-action=source][data-entity="media_player.samsung"]'); sel.value = "HDMI"; sel.dispatchEvent(new Event("change", { bubbles: true })); });
await page.waitForTimeout(120);
check((await state("media_player.samsung")).attributes.source === "HDMI", "source select");
await click('[data-cmd=ch-up][data-entity="media_player.android"]');
c = await lastCall();
check(c.domain === "remote" && c.data.entity_id === "remote.android" && c.data.command === "CHANNEL_UP", "Android TV channel via its remote", JSON.stringify(c));
await click('[data-cmd=info][data-entity="media_player.android"]');
check((await lastCall()).data.command === "INFO", "Info key via remote");
for (let i = 0; i < 6; i++) if (await q('[data-cmd=vol-up][data-entity="media_player.android"]:not([disabled])')) await click('[data-cmd=vol-up][data-entity="media_player.android"]');
s = await state("media_player.android");
check(s.attributes.volume_level <= 0.6 + 1e-9 && s.attributes.volume_level >= 0.5, "guest: volume steps stop at the cap", String(s.attributes.volume_level));
await click('[data-cmd=mute][data-entity="media_player.android"]');
check((await state("media_player.android")).attributes.is_volume_muted === true, "mute");
check((await text('.tile:has([data-entity="media_player.android"]) .minfo'))?.includes("programme"), "now-playing line");
await page.evaluate(() => window.harness.card.shadowRoot.querySelector(".panel").scrollIntoView());
await page.screenshot({ path: "dev/out/devices-tv.png", fullPage: true });

// ---- shades -----------------------------------------------------------------------
await room("shades");
await page.waitForTimeout(150);
check((await text('.tile:has([data-rail]) .tstate'))?.startsWith("Open from the top"), "TDBU state", await text('.tile:has([data-rail]) .tstate'));
await click('[data-action=shade][data-rail=bottom]');
await page.waitForFunction(() => window.harness.calls.some((c) => c.data.entity_id === "cover.shade_bottom"), null, { timeout: 5000 });
const seq = await page.evaluate(() => window.harness.calls.filter((c) => c.domain === "cover").map((c) => `${c.data.entity_id}:${c.data.position}`));
check(seq[0] === "cover.shade_top:0" && seq[1] === "cover.shade_bottom:100", "opening the bottom closes the top first", seq.join(" → "));
await page.waitForTimeout(600);
let top = await state("cover.shade_top"), bottom = await state("cover.shade_bottom");
check(top.attributes.current_position === 0 && bottom.attributes.current_position === 100, "never both open", `${top.attributes.current_position}/${bottom.attributes.current_position}`);
await page.evaluate(() => { const i = window.harness.card.shadowRoot.querySelector("input[data-action=shade-pos]"); i.value = "35"; i.dispatchEvent(new Event("change", { bubbles: true })); });
await page.waitForTimeout(600);
check((await state("cover.shade_bottom")).attributes.current_position === 35, "slider moves the open end", "");
await click('[data-action=shade][data-rail=none]');
await page.waitForTimeout(600);
check((await state("cover.shade_bottom")).attributes.current_position === 0, "Close closes the shade");
await page.evaluate(() => { const H = window.harness; H.hass.states = { ...H.hass.states, "cover.shade_top": { ...H.hass.states["cover.shade_top"], state: "open", attributes: { ...H.hass.states["cover.shade_top"].attributes, current_position: 20 } }, "cover.shade_bottom": { ...H.hass.states["cover.shade_bottom"], state: "open", attributes: { ...H.hass.states["cover.shade_bottom"].attributes, current_position: 20 } } }; H.push(); });
await page.waitForTimeout(150);
check(await q(".tstate.warn"), "both-ends-open is flagged");
check(await q('input[data-action=position][data-entity="cover.blind"]'), "plain shade gets a position slider");
await page.evaluate(() => window.harness.card.shadowRoot.querySelector(".panel").scrollIntoView());
await page.screenshot({ path: "dev/out/devices-shades.png", fullPage: true });
// phone width
await page.setViewportSize({ width: 390, height: 1400 });
let overflow = false; for (const r of ["climate", "tv", "shades"]) { await room(r); await page.waitForTimeout(150); overflow ||= await page.evaluate(() => [...window.harness.card.shadowRoot.querySelectorAll(".tile .seg")].some((t) => t.scrollWidth > t.clientWidth + 1 || [...t.children].some((b) => b.scrollWidth > b.clientWidth + 1))); }
check(!overflow, "phone: tiles don't overflow");
await page.screenshot({ path: "dev/out/devices-phone.png", fullPage: true });

check(!errors.length, "no page errors", errors.join(" | "));
await browser.close(); server.close();
console.log(failures ? `${failures} failure(s)` : "all passed");
process.exit(failures ? 1 : 0);
