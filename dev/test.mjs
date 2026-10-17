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
