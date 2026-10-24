import { chromium } from "playwright";
import { start } from "./server.mjs";
const server = await start(); const browser = await chromium.launch();
for (const width of [1500, 1200, 390, 340]) {
const page = await browser.newPage({ viewport: { width, height: 1000 } });
await page.goto(`http://127.0.0.1:${server.address().port}/dev/index.html?fixture=demo`);
await page.waitForFunction(() => window.harness);
const r = await page.evaluate(async () => {
  const H = window.harness;
  H.hass.states["climate.garage"] = { entity_id: "climate.garage", state: "off", attributes: { friendly_name: "Garage Thermostat", hvac_modes: ["auto","cool","dry","fan_only","heat","off"], current_temperature: 71, supported_features: 953 } };
  for (const n of ["Utility Room Lights", "Workbench Light", "Overhead Lights", "Refrigerator Compressor"]) { const id = "switch." + n.toLowerCase().replace(/ /g, "_"); H.hass.states[id] = { entity_id: id, state: "off", attributes: { friendly_name: n } }; }
  H.setConfig({ type: "custom:floor3d-snapshot-card", title: "Home", guest_mode: false, rooms: [{ id: "garage", name: "Garage", entities: ["switch.overhead_lights", "switch.utility_room_lights", "switch.workbench_light", "climate.garage", "switch.refrigerator_compressor"].map((entity) => ({ entity })) }] });
  H.push(); await new Promise((r) => setTimeout(r, 300));
  const split = [];
  for (const el of H.card.shadowRoot.querySelectorAll(".tname")) {
    const t = el.firstChild, words = t.textContent.split(" "); let o = 0;
    for (const w of words) { const rg = document.createRange(); rg.setStart(t, o); rg.setEnd(t, o + w.length); const tops = new Set([...rg.getClientRects()].map((x) => Math.round(x.top))); if (tops.size > 1) split.push(w); o += w.length + 1; }
    const tile = el.closest(".tile"); if (tile.scrollWidth > tile.clientWidth + 1) split.push("OVERFLOW:" + t.textContent);
  }
  return { split, w: H.card.shadowRoot.querySelector(".tile")?.clientWidth };
});
console.log(width, JSON.stringify(r));
await page.close();
}
await browser.close(); server.close();
