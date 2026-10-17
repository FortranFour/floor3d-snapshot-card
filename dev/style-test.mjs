// Render the snapshot in each style (and an optional roll) and screenshot the card's map.
// node dev/style-test.mjs [--demo] [--styles standard,neon,blueprint,day] [--roll 0] [--dark]
import { chromium } from "playwright";
import fs from "node:fs";
import { start } from "./server.mjs";
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const styles = arg("styles", "standard,neon,blueprint,day").split(","), roll = Number(arg("roll", "0"));
fs.mkdirSync("dev/out", { recursive: true });
const server = await start();
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/dev/index.html${process.argv.includes("--demo") ? "?fixture=demo" : ""}`);
await page.waitForFunction(() => window.harness);
if (process.argv.includes("--dark")) await page.click("#theme");
const click = (s) => page.evaluate((s) => window.harness.editor.shadowRoot.querySelector(s).click(), s);
await click('[data-act="scan"]'); await page.waitForFunction(() => window.harness.editor._found);
const n = await page.evaluate(() => window.harness.editor._found.length);
for (let i = 0; i < n; i++) await click(`[data-act="use-found"][data-i="${i}"]`);
await click('[data-act="detect"]'); await page.waitForFunction(() => !window.harness.editor._busy && window.harness.getConfig().rooms.length, null, { timeout: 600000 });
for (const style of styles) {
  await page.evaluate(([style, roll]) => { const c = structuredClone(window.harness.getConfig()); c.view = { ...(c.view || {}), style, roll }; window.harness.setConfig(c); }, [style, roll]);
  const t0 = Date.now();
  await click('[data-act="render"]'); await page.waitForFunction(() => !window.harness.editor._busy && window.harness.getConfig().snapshot?.key, null, { timeout: 900000 });
  await page.waitForFunction(() => window.harness.card.shadowRoot.querySelector(".map img")?.complete && window.harness.card._index, null, { timeout: 30000 });
  await page.waitForTimeout(300);
  const map = await page.evaluateHandle(() => window.harness.card.shadowRoot.querySelector(".map"));
  await map.asElement().screenshot({ path: `dev/out/style-${style}.png` });
  console.log(style, `${((Date.now() - t0) / 1000).toFixed(1)} s`, JSON.stringify(await page.evaluate(() => { const s = window.harness.getConfig().snapshot; return { w: s.width, h: s.height, style: s.style, stage: s.stage }; })));
}
console.log(errors.length ? `ERRORS ${JSON.stringify(errors.slice(0, 5))}` : "no page errors");
await browser.close(); server.close();
