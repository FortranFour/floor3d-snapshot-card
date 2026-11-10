// The `height` option: the card itself fills a given height (a full-screen panel view, say), from
// its first frame and with no styling add-on. Headless Chromium, no model or snapshot render needed.
import { chromium } from "playwright";
import { start } from "./server.mjs";

const server = await start(); const browser = await chromium.launch();
let failures = 0;
const check = (ok, label, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };

for (const [width, height] of [[1280, 800], [1024, 600], [390, 800]]) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/dev/index.html?fixture=demo`);
  await page.waitForFunction(() => window.harness);
  const r = await page.evaluate(async () => {
    const H = window.harness, frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const cv = document.createElement("canvas"); cv.width = 218; cv.height = 200; cv.getContext("2d").fillRect(0, 0, 218, 200);
    const png = cv.toDataURL("image/png");
    const ents = (n) => Array.from({ length: n }, (_, i) => { const id = `switch.h${i}`; H.hass.states[id] = { entity_id: id, state: "off", attributes: { friendly_name: `Lamp ${i}` } }; return { entity: id }; });
    const base = { type: "custom:floor3d-snapshot-card", title: "Home", clock: true, guest_mode: false,
      rooms: [{ id: "a", name: "Big room", entities: ents(40) }, { id: "b", name: "Small room", entities: ents(2) }],
      snapshot: { image: png, index: png, aspect: 1.09, width: 218, height: 200, rooms: { a: { pin: [30, 40], code: 1 }, b: { pin: [70, 60], code: 2 } } } };
    // A bare page like a panel view, the card inside a wrapper card's shadow root.
    document.body.replaceChildren(); document.body.style.margin = "0";
    const mount = async (config) => {
      document.body.replaceChildren();
      const wrap = document.createElement("div"); wrap.attachShadow({ mode: "open" }).innerHTML = "<style>:host{display:block;min-width:0;width:100%}</style>";
      const card = document.createElement("floor3d-snapshot-card");
      const st = document.createElement("style"); st.textContent = "ha-card{display:block;border:1px solid #ccc}"; card.shadowRoot.appendChild(st);   // as Home Assistant's ha-card
      card.setConfig(config); card.hass = H.hass; wrap.shadowRoot.appendChild(card); document.body.appendChild(wrap);
      const first = card.getBoundingClientRect().height;   // before any frame: nothing loads later to size it
      await frame(); await new Promise((r) => setTimeout(r, 150)); await frame();
      const q = (s) => card.shadowRoot.querySelector(s), box = (s) => q(s)?.getBoundingClientRect();
      const c = card.getBoundingClientRect(), hc = box("ha-card"), map = box(".map"), panel = q(".panel"), pb = box(".panel"), layout = q(".layout");
      return { first, host: c.height, card: hc.height, vh: innerHeight, pageScroll: document.documentElement.scrollHeight - innerHeight, stacked: card.classList.contains("stacked"), fill: card.classList.contains("fill"),
        map: map && { w: map.width, h: map.height, inside: map.top >= hc.top - 0.5 && map.bottom <= hc.bottom + 0.5 && map.left >= hc.left - 0.5 && map.right <= hc.right + 0.5 },
        panel: { inside: pb.bottom <= hc.bottom + 0.5, scrolls: panel.scrollHeight > panel.clientHeight + 1, overflow: getComputedStyle(panel).overflowY },
        layout: { scrolls: layout.scrollHeight > layout.clientHeight + 1, overflow: getComputedStyle(layout).overflowY }, tiles: card.shadowRoot.querySelectorAll(".tile").length };
    };
    return { small: await mount({ ...base, height: "100dvh", default_room: "b" }), px: await mount({ ...base, height: 500 }), str: await mount({ ...base, height: "480" }),
      calc: await mount({ ...base, height: "calc(100vh - 56px)" }), bad: await mount({ ...base, height: "tall" }), none: await mount(base), full: await mount({ ...base, height: "100dvh" }) };
  });
  const tag = `${width}×${height}`, f = r.full, near = (a, b) => Math.abs(a - b) <= 1;
  check(near(f.first, f.vh) && near(f.host, f.vh) && near(f.card, f.vh), `${tag} height: 100dvh fills the viewport, already before the first frame`, `first ${f.first} host ${f.host} ha-card ${f.card} viewport ${f.vh}`);
  check(f.pageScroll <= 1, `${tag} the page itself doesn't scroll`, `${f.pageScroll}px`);
  check(f.tiles === 40, `${tag} all 40 tiles drawn`, String(f.tiles));
  if (f.stacked) check(f.layout.scrolls && f.layout.overflow === "auto", `${tag} stacked: map and controls scroll inside the card`, JSON.stringify(f.layout));
  else {
    check(f.map.inside && f.map.h > 100 && Math.abs(f.map.w / f.map.h - 1.09) < 0.02, `${tag} side by side: the whole map fits, in proportion`, JSON.stringify(f.map));
    check(f.panel.inside && f.panel.scrolls && f.panel.overflow === "auto", `${tag} side by side: a long room scrolls inside its panel`, JSON.stringify(f.panel));
    check(r.small.panel.inside && !r.small.panel.scrolls, `${tag} side by side: a short room's panel keeps its own height`, JSON.stringify(r.small.panel));
  }
  check(near(r.px.host, 500) && near(r.str.host, 480), `${tag} a number is pixels`, `${r.px.host} ${r.str.host}`);
  check(near(r.calc.host, r.calc.vh - 56), `${tag} calc() lengths`, String(r.calc.host));
  check(!r.bad.fill && !r.none.fill && near(r.bad.host, r.none.host), `${tag} no height, or an invalid one: sized by content as before`, `${r.bad.host} ${r.none.host}`);
  check(!errors.length, `${tag} no page errors`, errors.join(" | "));
  await page.screenshot({ path: `dev/out/height-${width}.png` }).catch(() => {});
  await page.close();
}
await browser.close(); server.close();
console.log(failures ? `${failures} FAILED` : "all passed");
process.exit(failures ? 1 : 0);
