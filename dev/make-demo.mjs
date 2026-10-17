// Generates dev/demo/demo-home.glb plus a matching floor3d-card dashboard and entity list.
import { chromium } from "playwright";
import fs from "node:fs";
import { start } from "./server.mjs";
const server = await start();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/dev/make-demo.html`);
await page.waitForFunction(() => window.__glb || window.__err, null, { timeout: 60000 });
const err = await page.evaluate(() => window.__err); if (err) throw new Error(err);
fs.writeFileSync("dev/demo/demo-home.glb", Buffer.from(await page.evaluate(() => window.__glb)));
await browser.close(); server.close();
const bind = [
  ["input_button.floor3d_kitchen", "room_0_1", "camera"], ["input_button.floor3d_living_room", "room_1_1", "camera"], ["input_button.floor3d_bedroom", "room_2_1", "camera"],
  ["input_button.floor3d_bathroom", "room_3_1", "camera"], ["input_button.floor3d_office", "room_4_1", "camera"], ["input_button.floor3d_garage", "room_5_1", "camera"],
  ["light.kitchen_ceiling", "lamp_kitchen", "light"], ["switch.coffee_maker", "coffee_maker", "color"], ["light.kitchen_island", "kitchen_island", "light"],
  ["media_player.living_room_tv", "tv", "color"], ["light.living_room_floor_lamp", "lamp_living", "light"], ["climate.thermostat", "thermostat", "text"],
  ["lock.front_door", "front_door", "door"], ["sensor.living_room_temperature", "thermostat", "text"],
  ["light.bedside_lamp", "lamp_bedside", "light"], ["fan.bedroom_ceiling_fan", "fan_bedroom", "rotate"],
  ["light.bathroom_vanity", "vanity", "light"], ["fan.bathroom_exhaust", "<bath>", "rotate"],
  ["light.office_desk_lamp", "lamp_desk", "light"], ["switch.office_heater", "desk", "color"],
  ["cover.garage_door", "garage_door", "cover"], ["light.garage_lights", "lamp_garage", "light"], ["switch.workbench_outlet", "workbench", "color"],
];
const card = { type: "custom:floor3d-card", path: "/dev/demo/", objfile: "demo-home.glb", entities: bind.map(([entity, object_id, type3d]) => ({ entity, object_id, type3d })), object_groups: [{ object_group: "bath", objects: [{ object_id: "bathtub" }] }] };
fs.writeFileSync("dev/demo/dashboard.json", JSON.stringify({ views: [{ title: "3D Home", cards: [card] }] }, null, 1));
fs.writeFileSync("dev/demo/entities.json", JSON.stringify([...new Set(bind.map((b) => b[0]))].sort(), null, 1));
console.log(`demo-home.glb ${(fs.statSync("dev/demo/demo-home.glb").size / 1024).toFixed(0)} KB, ${bind.length} floor3d bindings`);
