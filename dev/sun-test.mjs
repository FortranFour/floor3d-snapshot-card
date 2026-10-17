// Sunlight check: render with sunlight on, then preview several times of day.
// node dev/sun-test.mjs [--demo] [--lat 47.6 --lon -122.3 --tz America/Los_Angeles] [--north 0]
import { chromium } from "playwright";
import fs from "node:fs";
import { start } from "./server.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const demo = process.argv.includes("--demo");
const lat = arg("lat", "51.48"), lon = arg("lon", "0"), tz = arg("tz", "Europe/London"), north = Number(arg("north", "0"));
const hours = (arg("hours", "6.5,8,10,13,16,18,19,22")).split(",").map(Number);
fs.mkdirSync("dev/out", { recursive: true });
const server = await start();
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, timezoneId: tz });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/dev/index.html?lat=${lat}&lon=${lon}${demo ? "&fixture=demo" : ""}`);
await page.waitForFunction(() => window.harness);
const click = (sel) => page.evaluate((s) => window.harness.editor.shadowRoot.querySelector(s).click(), sel);
await click('[data-act="scan"]'); await page.waitForFunction(() => window.harness.editor._found);
const n = await page.evaluate(() => window.harness.editor._found.length);
for (let i = 0; i < n; i++) await click(`[data-act="use-found"][data-i="${i}"]`);
await click('[data-act="detect"]'); await page.waitForFunction(() => !window.harness.editor._busy && window.harness.getConfig().rooms.length, null, { timeout: 600000 });
await page.evaluate((north) => { const c = structuredClone(window.harness.getConfig()); c.sun = { enabled: true, north }; window.harness.setConfig(c); }, north);
let t0 = Date.now();
await click('[data-act="render"]'); await page.waitForFunction(() => !window.harness.editor._busy && window.harness.getConfig().snapshot, null, { timeout: 900000 });
const snap = await page.evaluate(() => window.harness.getConfig().snapshot);
console.log(`render ${((Date.now() - t0) / 1000).toFixed(1)} s`, JSON.stringify(snap.lighting));
console.log(await page.evaluate(() => window.harness.editor.shadowRoot.querySelector('[data-section="snapshot"] .note:last-of-type')?.textContent), await page.evaluate(() => [...window.harness.editor.shadowRoot.querySelectorAll('[data-section="snapshot"] .note')].map((n) => n.textContent).join(" | ")));
const sizes = await page.evaluate(async (s) => ({ img: (await (await fetch(s.image)).blob()).size, idx: (await (await fetch(s.index)).blob()).size, light: (await (await fetch(s.light)).blob()).size }), snap);
console.log("sizes KB", Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, Math.round(v / 1024)])));
await page.waitForFunction(() => window.harness.card._light && window.harness.card._index, null, { timeout: 30000 });
for (const h of hours) {
  const t = await page.evaluate((h) => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() + h * 3600000; }, h);
  t0 = Date.now();
  await page.evaluate((t) => window.dispatchEvent(new CustomEvent("floor3d-snapshot-sun-preview", { detail: { time: t } })), t);
  await page.waitForFunction((t) => { const c = window.harness.card; return c._sunPos && c._shadeKey.startsWith(`${Math.round(c._sunPos.azimuth)}|`) && c._directKey === c._shadeKey && c._sunKey.startsWith(c._shadeKey); }, t, { timeout: 60000 });
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => { const c = window.harness.card; return { az: Math.round(c._sunPos.azimuth), el: Math.round(c._sunPos.elevation), compass: c.shadowRoot.querySelector(".compass")?.title }; });
  console.log(`${h}h`, JSON.stringify(info), `${Date.now() - t0} ms`);
  await page.locator("#card .map, #card").first().screenshot({ path: `dev/out/sun-${String(h).replace(".", "_")}.png` }).catch(async () => {});
  if (process.argv.includes("--debug")) {
    const url = await page.evaluate(() => { const c = window.harness.card, L = c._light, d = c._direct; const cv = document.createElement("canvas"); cv.width = L.w; cv.height = L.h; const x = cv.getContext("2d"), im = x.createImageData(L.w, L.h); for (let i = 0; i < L.w * L.h; i++) { const v = L.dir[i] === 255 ? 40 : d ? 60 + 195 * d[i] : 60; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; } x.putImageData(im, 0, 0); return cv.toDataURL(); });
    fs.writeFileSync(`dev/out/direct-${String(h).replace(".", "_")}.png`, Buffer.from(url.split(",")[1], "base64"));
  }
  const map = await page.evaluateHandle(() => window.harness.card.shadowRoot.querySelector(".map"));
  await map.asElement().screenshot({ path: `dev/out/sun-${String(h).replace(".", "_")}.png` });
}
// shade timing without preview stalls
const perf = await page.evaluate(async () => { const c = window.harness.card; c._shadeKey = "x"; const t = performance.now(); c._sunPreview = null; await c._updateSun(); return Math.round(performance.now() - t); });
console.log("live update ms", perf);
console.log(errors.length ? `ERRORS ${JSON.stringify(errors.slice(0, 5))}` : "no page errors");
await browser.close(); server.close();
