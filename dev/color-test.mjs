// Color swatches: whatever hue the bulb reports, at most one swatch is marked, and it is the nearest.
import { chromium } from "playwright";
import { start } from "./server.mjs";

const server = await start(); const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await page.goto(`http://127.0.0.1:${server.address().port}/dev/index.html?fixture=demo`);
await page.waitForFunction(() => window.harness);
const r = await page.evaluate(async () => {
  const H = window.harness, out = { multi: [], wrong: [], none: [] };
  const wheel = [["Red", 0], ["Orange", 30], ["Yellow", 52], ["Green", 130], ["Cyan", 185], ["Blue", 220], ["Purple", 270], ["Pink", 325]];
  const gap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  H.setConfig({ type: "custom:floor3d-snapshot-card", title: "Home", guest_mode: false, rooms: [{ id: "k", name: "Kitchen", entities: [{ entity: "light.bulb" }] }] });
  const show = async (hs, mode = "hs") => {
    H.hass.states = { ...H.hass.states, "light.bulb": { entity_id: "light.bulb", state: "on", attributes: { friendly_name: "Bulb", brightness: 200, supported_color_modes: ["color_temp", "hs"], color_mode: mode, hs_color: hs } } };
    H.push(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return [...H.card.shadowRoot.querySelectorAll('.swatch-b[aria-pressed="true"]')].map((b) => b.getAttribute("aria-label"));
  };
  for (let h = 0; h < 360; h++) {
    const sel = await show([h, 55]);
    const best = wheel.reduce((a, b) => (gap(b[1], h) < gap(a[1], h) ? b : a));
    if (sel.length > 1) out.multi.push(`${h}:${sel.join("+")}`);
    else if (sel.length === 1 && sel[0] !== best[0]) out.wrong.push(`${h}:${sel[0]}`);
    else if (!sel.length && gap(best[1], h) < 22) out.none.push(h);
  }
  out.swatches = H.card.shadowRoot.querySelectorAll(".swatch-b").length;
  out.reported = await show([45.2, 54.9]);   // a bulb sent Yellow (52, 55) answering a few degrees off
  out.exact = { orange: await show([30, 55]), yellow: await show([52, 55]) };
  out.white = await show([40, 5]); out.pale = await show([40, 18]); out.warm = await show([30, 55], "color_temp");
  return out;
});
let failures = 0;
const check = (ok, label, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };
check(r.swatches === 9, "nine swatches drawn", String(r.swatches));
check(!r.multi.length, "never two swatches marked, at any hue 0–359", r.multi.join(" "));
check(!r.wrong.length && !r.none.length, "the marked swatch is the nearest hue, whenever one is within reach", `${r.wrong.join(" ")} ${r.none.join(" ")}`);
check(r.reported.join() === "Yellow", "yellow reported back as hue 45 marks Yellow only", r.reported.join("+"));
check(r.exact.orange.join() === "Orange" && r.exact.yellow.join() === "Yellow", "exact orange and yellow", JSON.stringify(r.exact));
check(r.white.join() === "White" && !r.pale.length && !r.warm.length, "white, a pale tint (none) and white-temperature mode (none)", JSON.stringify([r.white, r.pale, r.warm]));
await browser.close(); server.close();
console.log(failures ? `${failures} FAILED` : "all passed");
process.exit(failures ? 1 : 0);
