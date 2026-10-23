// End-to-end test in headless Chromium: editor finds floor3d cards, detects rooms,
// renders + uploads a snapshot, and the card's map and controls behave.
import { chromium } from "playwright";
import fs from "node:fs";
import { start } from "./server.mjs";

const fixture = process.argv.includes("--demo") ? "demo" : "auto";
const shots = "dev/out";
fs.mkdirSync(shots, { recursive: true });
const server = await start();
const base = `http://127.0.0.1:${server.address().port}/dev/index.html${fixture === "demo" ? "?fixture=demo" : ""}`;
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
let failures = 0;
const check = (ok, label, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };
const ed = (fn, arg) => page.evaluate(([f, a]) => new Function("root", "a", f)(window.harness.editor.shadowRoot, a), [fn.toString().replace(/^[^{]*{|}$/g, ""), arg]);
const clickEd = (sel) => page.evaluate((s) => window.harness.editor.shadowRoot.querySelector(s).click(), sel);
const waitEd = (fn, timeout = 600000) => page.waitForFunction(fn, null, { timeout, polling: 250 });

await page.goto(base);
await page.waitForFunction(() => window.harness);
console.log(await page.textContent("#status"));

// 1. find floor3d cards
await clickEd('[data-act="scan"]');
await waitEd(() => window.harness.editor._found);
const found = await page.evaluate(() => window.harness.editor._found.map((f) => ({ label: f.label, url: f.url, n: f.entities.length })));
check(found.length >= 1, "floor3d cards found in dashboards", JSON.stringify(found));
for (let i = 0; i < found.length; i++) await clickEd(`[data-act="use-found"][data-i="${i}"]`);
const models = await page.evaluate(() => window.harness.getConfig().models);
check(models.length === found.length, "models added", JSON.stringify(models));

// 2. detect rooms
let t0 = Date.now();
await clickEd('[data-act="detect"]');
await waitEd(() => !window.harness.editor._busy && window.harness.getConfig().rooms.length, 600000);
const rooms = await page.evaluate(() => window.harness.getConfig().rooms.map((r) => ({ id: r.id, name: r.name, floors: r.floors.map((f) => `${f.model}:${f.object}`).join(","), n: r.entities.length })));
console.log(`      detect took ${((Date.now() - t0) / 1000).toFixed(1)} s`);
check(rooms.length > 0, "rooms detected", JSON.stringify(rooms));
check(rooms.some((r) => r.n > 0), "floor3d entities assigned to rooms", rooms.map((r) => `${r.name}:${r.n}`).join(" "));
console.log("      message:", await ed(function () { return root.querySelector('[data-section="rooms"] .note:not(:first-of-type)')?.textContent; }));

// 3. render + upload
t0 = Date.now();
await clickEd('[data-act="render"]');
await waitEd(() => !window.harness.editor._busy && window.harness.getConfig().snapshot, 900000);
const snap = await page.evaluate(() => window.harness.getConfig().snapshot);
console.log(`      render took ${((Date.now() - t0) / 1000).toFixed(1)} s`);
check(/^\/api\/image\/serve\/\w+\/original$/.test(snap.image) && /original$/.test(snap.index), "snapshot uploaded to image store", `${snap.image} ${snap.width}x${snap.height}`);
check(Object.values(snap.rooms).filter((r) => r.pin).length === rooms.length, "every room has a pin", "");
const sizes = await page.evaluate(async (s) => ({ img: (await (await fetch(s.image)).blob()).size, idx: (await (await fetch(s.index)).blob()).size }), snap);
check(sizes.img < 250000 && sizes.idx < 200000, "guest download size", `${(sizes.img / 1024).toFixed(0)} KB jpeg + ${(sizes.idx / 1024).toFixed(0)} KB png`);
const status = await ed(function () { return root.querySelector('[data-section="snapshot"] .badge').textContent; });
check(status === "Up to date", "snapshot status badge", status);

// 4. card behaviour
await page.waitForFunction(() => window.harness.card.shadowRoot.querySelector(".map img")?.complete && window.harness.card._index, null, { timeout: 30000 });
const cardInfo = () => page.evaluate(() => { const c = window.harness.card, s = c.shadowRoot; return { room: c._room, heading: s.querySelector("#f3s-room")?.textContent, visiblePins: [...s.querySelectorAll(".pin")].filter((p) => getComputedStyle(p).opacity > 0.5).length, pins: s.querySelectorAll(".pin").length, tiles: s.querySelectorAll(".tile").length }; });
console.log("      card:", JSON.stringify(await cardInfo()));
await page.locator("#card").screenshot({ path: `${shots}/card.png` });
await page.locator("#editor").screenshot({ path: `${shots}/editor.png` });
// tap each room's pin position (floor) and expect that room
let hits = 0;
for (const r of rooms) {
  const p = snap.rooms[r.id].pin;
  const box = await page.evaluate(() => { const b = window.harness.card.shadowRoot.querySelector(".map").getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  await page.mouse.click(box.x + p[0] / 100 * box.w, box.y + p[1] / 100 * box.h + 3);
  await page.waitForTimeout(150);
  const got = await page.evaluate(() => window.harness.card._room);
  if (got === r.id) hits++; else console.log(`      tap ${r.id} → ${got}`);
}
check(hits >= rooms.length - 1, "tapping each room's floor selects it", `${hits}/${rooms.length}`);
// toggle first light in the selected room
const lightRoom = rooms.find((r) => r.n > 0);
await page.evaluate((id) => window.harness.card._select(id), lightRoom.id);
await page.waitForTimeout(200);
const before = await page.evaluate(() => window.harness.calls.length);
await page.evaluate(() => window.harness.card.shadowRoot.querySelector('.row[data-action="toggle"]')?.click());
await page.waitForTimeout(300);
const call = await page.evaluate(() => window.harness.calls.at(-1));
check((await page.evaluate(() => window.harness.calls.length)) === before + 1, "toggle sends one service call", JSON.stringify(call));
// stale detection
await page.evaluate(() => { const c = structuredClone(window.harness.getConfig()); c.view = { ...(c.view || {}), azimuth: 60 }; window.harness.setConfig(c); });
const stale = await ed(function () { return root.querySelector('[data-section="snapshot"] .badge').textContent; });
check(stale === "Out of date", "changing the view marks the snapshot out of date", stale);
// 5. sunlight: enable, re-render, the card relights the picture
await page.evaluate(() => { const c = structuredClone(window.harness.getConfig()); delete c.view.azimuth; c.sun = { enabled: true, north: 30 }; window.harness.setConfig(c); });
check((await ed(function () { return root.querySelector('[data-section="snapshot"] .badge').textContent; })) === "Out of date", "turning sunlight on asks for a new render");
await clickEd('[data-act="render"]');
await waitEd(() => !window.harness.editor._busy && window.harness.getConfig().snapshot?.light, 900000);
const lsnap = await page.evaluate(() => window.harness.getConfig().snapshot);
const lightKB = await page.evaluate(async (u) => Math.round((await (await fetch(u)).blob()).size / 1024), lsnap.light);
check(!!lsnap.lighting?.depth && lightKB < 250, "lighting layer baked and uploaded", `${lightKB} KB`);
await page.waitForFunction(() => window.harness.card._light && window.harness.card._index, null, { timeout: 30000 });
const sunAt = async (h) => {
  const t = await page.evaluate((h) => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() + h * 3600000; }, h);
  await page.evaluate((t) => window.dispatchEvent(new CustomEvent("floor3d-snapshot-sun-preview", { detail: { time: t } })), t);
  await page.waitForFunction(() => { const c = window.harness.card; return c._sunPos && c._shadeKey.startsWith(`${Math.round(c._sunPos.azimuth)}|`) && c._directKey === c._shadeKey && c._sunKey.startsWith(c._shadeKey); }, null, { timeout: 60000 });
  return page.evaluate(() => { const c = window.harness.card, cv = c.shadowRoot.querySelector("canvas.sun.show"), x = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data; let s = 0, n = 0; for (let i = 0; i < x.length; i += 4) if (x[i + 3]) { s += x[i] + x[i + 1] + x[i + 2]; n++; } return { el: Math.round(c._sunPos.elevation), mean: Math.round(s / n / 3), canvases: c.shadowRoot.querySelectorAll("canvas.sun").length, compass: !!c.shadowRoot.querySelector(".compass") }; });
};
const noon = await sunAt(12.5), night = await sunAt(0.5);
check(noon.canvases === 2 && noon.compass, "sun layers and north arrow present");
check(noon.el > night.el && noon.mean > night.mean + 25, "midday is brighter than midnight", `noon ${JSON.stringify(noon)} night ${JSON.stringify(night)}`);
await page.locator("#card").screenshot({ path: `${shots}/card-sun-night.png` });
await sunAt(16);
await page.locator("#card").screenshot({ path: `${shots}/card-sun.png` });
await page.evaluate(() => { const r = window.harness.editor.shadowRoot; for (const d of r.querySelectorAll("details[data-section]")) d.open = d.dataset.section === "sun"; r.querySelector('[data-section="sun"]').scrollIntoView(); });
await page.waitForTimeout(200);
await page.locator("#editor").screenshot({ path: `${shots}/editor-sun.png` });
await page.evaluate(() => window.dispatchEvent(new CustomEvent("floor3d-snapshot-sun-preview", { detail: { time: null } })));
await page.evaluate(() => { const c = structuredClone(window.harness.getConfig()); c.sun.enabled = false; window.harness.setConfig(c); });
await page.waitForTimeout(300);
check((await page.evaluate(() => window.harness.card.shadowRoot.querySelectorAll("canvas.sun").length)) === 0, "switching sunlight off removes the layer");
// 6. style + live 3D preview + X/Y/Z view
await page.evaluate(() => { const r = window.harness.editor.shadowRoot; r.querySelector('[data-section="snapshot"]').open = true; window.harness.editor._open.snapshot = true; });
await page.evaluate(() => { const sel = window.harness.editor.shadowRoot.querySelector('select[data-field="view.style"]'); sel.value = "neon"; sel.dispatchEvent(new Event("change", { bubbles: true })); });
check((await page.evaluate(() => window.harness.getConfig().view.style)) === "neon", "style picker writes view.style");
await clickEd('[data-act="preview"]');
await page.waitForFunction(() => window.harness.editor._pv, null, { timeout: 600000 });
await page.waitForTimeout(400);
const pvPixels = async () => page.evaluate(() => { const cv = window.harness.editor._pvCanvas, c = document.createElement("canvas"); c.width = cv.width; c.height = cv.height; const x = c.getContext("2d"); x.drawImage(cv, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0, h = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) { n++; h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0; } return { n, h, w: cv.width }; });
// the canvas must keep drawing: preserveDrawingBuffer is off, so redraw then read in the same frame
const before3d = await page.evaluate(() => new Promise((res) => { const pv = window.harness.editor._pv; pv.draw(); requestAnimationFrame(() => requestAnimationFrame(() => res(true))); }));
const box = await page.evaluate(() => { const b = window.harness.editor._pvCanvas.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width }; });
check(box.w > 200, "3D preview canvas is in the editor", `${Math.round(box.w)} px wide`);
await page.screenshot({ path: `${shots}/preview-before.png`, clip: { x: box.x - box.w / 2, y: box.y - box.w * 0.375, width: box.w, height: box.w * 0.75 } });
console.log("      view before drag", JSON.stringify(await page.evaluate(() => window.harness.getConfig().view)), JSON.stringify(await page.evaluate(() => window.harness.editor._config.view)));
const az0 = (await page.evaluate(() => window.harness.getConfig().view.azimuth)) ?? 45;
console.log("      hit", await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e?.tagName + " " + (e?.shadowRoot?.elementFromPoint(x, y)?.tagName || ""); }, [box.x, box.y]));
await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(box.x - 100, box.y + 30, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(300);
const v1 = await page.evaluate(() => window.harness.getConfig().view);
console.log("      view after drag", JSON.stringify(v1));
check(v1.azimuth === (az0 + 40) % 360 && v1.elevation === 61, "dragging the preview turns and tilts the view", JSON.stringify({ azimuth: v1.azimuth, elevation: v1.elevation }));
await page.screenshot({ path: `${shots}/preview-after.png`, clip: { x: box.x - box.w / 2, y: box.y - box.w * 0.375, width: box.w, height: box.w * 0.75 } });
await page.evaluate(() => { const i = window.harness.editor.shadowRoot.querySelector('input[data-view="roll"]'); i.value = "20"; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); });
check((await page.evaluate(() => window.harness.getConfig().view.roll)) === 20, "roll slider writes view.roll");
await page.locator("#editor").screenshot({ path: `${shots}/editor-preview.png` });
await clickEd('[data-act="render"]');
await waitEd(() => !window.harness.editor._busy && window.harness.getConfig().snapshot?.style === "neon", 120000).catch(async (e) => { console.log("RENDER WAIT", JSON.stringify(await page.evaluate(() => ({ busy: window.harness.editor._busy, msg: window.harness.editor._msg, prog: window.harness.editor._progress, snap: Object.keys(window.harness.getConfig().snapshot || {}) }))), JSON.stringify(errors)); throw e; });
await page.waitForFunction(() => window.harness.editor._pv, null, { timeout: 60000 }).catch(async (e) => { console.log("REOPEN", JSON.stringify(await page.evaluate(() => ({ open: window.harness.editor._previewOpen, text: window.harness.editor._pvWrap?.textContent, inDom: window.harness.editor._pvWrap?.isConnected }))), JSON.stringify(errors)); throw e; });
check(true, "preview reopens after rendering");
await page.waitForFunction(() => window.harness.card.shadowRoot.querySelector(".map img")?.complete && window.harness.card._index, null, { timeout: 30000 });
const staged = await page.evaluate(() => { const m = window.harness.card.shadowRoot.querySelector(".map"); return { staged: m.classList.contains("staged"), bg: getComputedStyle(m).backgroundColor }; });
check(staged.staged && staged.bg === "rgb(11, 17, 32)", "neon snapshot shows on its stage colour", JSON.stringify(staged));
await page.locator("#card").screenshot({ path: `${shots}/card-neon.png` });
let hits2 = 0; const nsnap = await page.evaluate(() => window.harness.getConfig().snapshot);
for (const r of rooms) {
  const p = nsnap.rooms[r.id].pin, b = await page.evaluate(() => { const b = window.harness.card.shadowRoot.querySelector(".map").getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  await page.mouse.click(b.x + p[0] / 100 * b.w, b.y + p[1] / 100 * b.h + 3); await page.waitForTimeout(120);
  if ((await page.evaluate(() => window.harness.card._room)) === r.id) hits2++;
}
check(hits2 >= rooms.length - 1, "rolled, neon map still selects rooms by tap", `${hits2}/${rooms.length}`);
await clickEd('[data-act="preview"]');
check((await page.evaluate(() => !window.harness.editor._pv && !window.harness.editor._previewOpen)), "preview closes");
// 7. a room with no floor and no anchor stays reachable; an anchor from the floor3d card gives it a pin
const bound = await page.evaluate(() => { const ed = window.harness.editor, url = window.harness.getConfig().models[0].url; return ed._floor3d[url].entities.find((e) => e.entity.startsWith("light.") && !/^</.test(e.object_id)); });
await page.evaluate((ent) => { const c = structuredClone(window.harness.getConfig()); c.rooms.push({ id: "outdoor", name: "Outdoor Lighting", icon: "mdi:outdoor-lamp", floors: [], entities: [{ entity: ent }] }); window.harness.setConfig(c); }, bound.entity);
await clickEd('[data-act="render"]');
await waitEd(() => !window.harness.editor._busy && window.harness.getConfig().snapshot?.rooms?.outdoor, 900000);
const unplacedMsg = await ed(function () { return root.querySelector('[data-section="snapshot"] .note.warn')?.textContent || ""; });
check(/No place on the map for: Outdoor Lighting/.test(unplacedMsg), "render warns about a room with no place on the map");
await page.waitForTimeout(300);
const chipsNow = await page.evaluate(() => [...window.harness.card.shadowRoot.querySelectorAll(".chip")].map((c) => c.dataset.room));
check(chipsNow.length === 1 && chipsNow[0] === "outdoor", "unplaced room shows as a button under the map", JSON.stringify(chipsNow));
await page.evaluate(() => { const r = window.harness.editor.shadowRoot; r.querySelector('[data-section="rooms"]').open = true; window.harness.editor._open.rooms = true; window.harness.editor._roomOpen.add("outdoor"); window.harness.editor._render(); });
const sugg = await page.evaluate(() => [...window.harness.editor.shadowRoot.querySelectorAll('[data-act="anchor-pick"]')].map((b) => b.dataset.obj));
check(sugg.includes(bound.object_id), "anchor suggestions come from the floor3d card's bindings", JSON.stringify(sugg));
await clickEd(`[data-act="anchor-pick"][data-obj="${bound.object_id}"]`);
await clickEd('[data-act="render"]');
await waitEd(() => !window.harness.editor._busy && Array.isArray(window.harness.getConfig().snapshot?.rooms?.outdoor?.pin), 900000);
await page.waitForTimeout(300);
const after = await page.evaluate(() => ({ chips: window.harness.card.shadowRoot.querySelectorAll(".chip").length, pin: !!window.harness.card.shadowRoot.querySelector('.pin[data-room="outdoor"]') }));
check(after.pin && after.chips === 0, "anchored room gets a pin on the map", JSON.stringify(after));
// 8. global wall transparency
await page.evaluate(() => { const i = window.harness.editor.shadowRoot.querySelector('input[data-field="view.wall_transparency"]'); i.value = "50"; i.dispatchEvent(new Event("change", { bubbles: true })); });
check((await page.evaluate(() => window.harness.getConfig().view.wall_transparency)) === 50, "wall transparency slider writes view.wall_transparency");
await clickEd('[data-act="render"]');
await waitEd(() => !window.harness.editor._busy && window.harness.getConfig().snapshot?.wall_alpha === 0.5, 900000);
await page.waitForFunction(() => window.harness.card._index?.halfBehind, null, { timeout: 30000 });
const behindPx = await page.evaluate(() => window.harness.card._index.halfBehind.reduce((a, b) => a + b, 0));
check(behindPx > 0, "floors seen through walls are marked in the room index", `${behindPx} px`);
let hits3 = 0; const wsnap = await page.evaluate(() => window.harness.getConfig().snapshot);
for (const r of rooms) {
  const p = wsnap.rooms[r.id].pin, b = await page.evaluate(() => { const b = window.harness.card.shadowRoot.querySelector(".map").getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  await page.mouse.click(b.x + p[0] / 100 * b.w, b.y + p[1] / 100 * b.h + 3); await page.waitForTimeout(120);
  if ((await page.evaluate(() => window.harness.card._room)) === r.id) hits3++;
}
check(hits3 >= rooms.length - 1, "with see-through walls, tapping each floor still selects it", `${hits3}/${rooms.length}`);
await page.locator("#card").screenshot({ path: `${shots}/card-walls.png` });
// 9. room buttons under the map never widen the card
await page.evaluate(() => { const c = structuredClone(window.harness.getConfig()); c.room_list = "always"; window.harness.setConfig(c); });
await page.waitForTimeout(400);
const fit = await page.evaluate(() => { const s = window.harness.card.shadowRoot, card = s.querySelector("ha-card").getBoundingClientRect().width, map = s.querySelector(".map").getBoundingClientRect().width; return { card: Math.round(card), map: Math.round(map), chips: s.querySelectorAll(".chip").length }; });
check(fit.chips === rooms.length + 1 && fit.map <= fit.card, "all room buttons fit under the map without widening the card", JSON.stringify(fit));
await page.evaluate(() => { const c = structuredClone(window.harness.getConfig()); delete c.room_list; window.harness.setConfig(c); });
// 10. the floor3d card's text and picture panels are picked up from its bindings
const panelInfo = await page.evaluate(() => { const c = window.harness.getConfig(), ed = window.harness.editor; return { models: c.models.map((m) => (m.panels || []).length), bound: c.models.map((m) => (ed._floor3d[m.url]?.entities || []).filter((e) => e.type3d === "text" || e.type3d === "image").length), label: ed.shadowRoot.querySelector('input[data-field="view.hide_panels"]')?.closest("label")?.textContent || "" }; });
check(panelInfo.models.every((n, i) => (n > 0) === (panelInfo.bound[i] > 0)), "text and picture panels recorded per model from the floor3d card", JSON.stringify(panelInfo));
// 11. a switch with a dimmer (the bulb behind it) gets a brightness slider that drives the bulb
const dimInfo = await page.evaluate(() => { const c = window.harness.getConfig(); return c.rooms.flatMap((r) => (r.entities || []).filter((e) => e.dimmer).map((e) => `${e.entity}→${e.dimmer}`)); });
console.log("      dimmers from floor3d color_entity:", dimInfo.join(", ") || "none");
const sw = await page.evaluate(() => { const c = structuredClone(window.harness.getConfig()); const room = c.rooms.find((r) => (r.entities || []).some((e) => /^switch\./.test(e.entity))) || c.rooms[0]; let e = room.entities.find((x) => /^switch\./.test(x.entity)); if (!e) { e = { entity: "switch.test_wall_switch" }; room.entities.push(e); } e.dimmer = e.dimmer || "light.test_bulb_behind_switch"; const h = window.harness.hass; h.states = { ...h.states, [e.entity]: { entity_id: e.entity, state: "on", attributes: { friendly_name: "Test Switch" } }, [e.dimmer]: { entity_id: e.dimmer, state: "on", attributes: { friendly_name: "Bulb", brightness: 204, supported_color_modes: ["brightness"] } } }; window.harness.setConfig(c); window.harness.push(); window.harness.card._select(room.id); return { room: room.id, entity: e.entity, dimmer: e.dimmer }; });
await page.waitForTimeout(300);
const slider = await page.evaluate((sw) => { const r = window.harness.card.shadowRoot.querySelector(`input[data-action="brightness"][data-entity="${sw.dimmer}"]`); return r ? { value: r.value, state: r.closest(".tile").querySelector(".tstate").textContent } : null; }, sw);
check(slider && slider.value === "80" && /80%/.test(slider.state), "a switch with a dimmer shows the bulb's brightness slider", JSON.stringify(slider));
const nCalls = await page.evaluate(() => window.harness.calls.length);
await page.evaluate((sw) => { const r = window.harness.card.shadowRoot.querySelector(`input[data-action="brightness"][data-entity="${sw.dimmer}"]`); r.value = "40"; r.dispatchEvent(new Event("change", { bubbles: true })); }, sw);
await page.waitForTimeout(200);
const dimCall = await page.evaluate(() => window.harness.calls.at(-1));
check(dimCall?.domain === "light" && dimCall.data.entity_id === sw.dimmer && dimCall.data.brightness_pct === 40 && (await page.evaluate(() => window.harness.calls.length)) === nCalls + 1, "the slider sets the bulb's brightness", JSON.stringify(dimCall));
// editor screenshot with the first room open (README)
await page.evaluate(() => { const r = window.harness.editor.shadowRoot; r.querySelector('[data-section="model"]').open = false; r.querySelector('[data-section="rooms"]').open = true; r.querySelector('details.room').open = true; });
await page.waitForTimeout(200);
await page.evaluate(() => window.harness.editor.shadowRoot.querySelector('details.room').scrollIntoView());
await page.locator("#editor").screenshot({ path: `${shots}/editor-room.png` });
await page.setViewportSize({ width: 420, height: 900 });
await page.waitForTimeout(400);
await page.locator("#card").screenshot({ path: `${shots}/card-phone.png` });
check(errors.length === 0, "no page errors", JSON.stringify(errors.slice(0, 5)));
await browser.close(); server.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
