# Changelog

## 0.8.0 — 2026-10-23

- **White warmth and color.** A light that is on (or the dimmer behind a switch) can show a warmth slider (`color_temp_kelvin`, within the bulb's range) and a color wheel of pastel swatches, white in the middle and eight hues around it (`hs_color` at a soft saturation, the current color ringed), each only when the bulb supports it. With more than one control, each gets a small label.
- **Choose what shows.** *Display → Light controls* has card-wide switches: `brightness_slider`, `white_slider` (both on by default) and `color_swatches` (off by default in guest mode). Per tile, `controls: [brightness, white, color]`, set from *Light controls on this tile*, overrides them; `[]` leaves on/off only.

## 0.7.0 — 2026-10-23

- **Dimmers for switched bulbs.** A room entity can name a `dimmer`, the light behind a wall switch. The tile switches the switch, and while it's on, it shows the bulb's brightness (`On · 80%`) and a slider that sets it. The editor has a *Dimmer* field under each switch. Detecting rooms and *Find floor3d cards* fill it from the floor3d card's `color_entity`, and existing rooms pick it up too.

## 0.6.0 — 2026-10-22

- **three.js 0.186** (from 0.170), the version floor3dx-card 2.x renders with. The models' object names are made unique the way three.js r130 did (`1_1`, `1_1_1`, `1_1_1_1` for duplicates), so the `panels`, rooms and anchors copied from a floor3d or floor3dx configuration keep matching; current loaders number duplicates differently and the names a configuration refers to could be missing from the model.
- **Four more styles**, the look themes floor3dx-card added since: **Paper**, **Ember**, **Pastel** and **Custom colors**. Custom shows four color pickers under the style (dark, light, edges, stage) and keeps the rest — walls, floors, daytime stage, how much hue shows through — behind *More custom colors*; the stage behind the map and the edge glow follow the chosen stage color. *Find floor3d cards* copies any of the seven themes and the custom colors from the floor3dx card. `node dev/style-test.mjs` renders all eight styles.

## 0.5.1 — 2026-10-20

- **No lines on wall seams and room borders** (on by default). The outline pass no longer draws the joint between two segments of one straight wall, the vertical lines under a window sill and over a lintel where Sweet Home 3D built the wall from overlapping pieces, or the border between two rooms' floors. Edges are cut where other vertices lie on them and each part is judged on its own: a face pressed against a face of another piece is not a visible face there, and a surface continuing on the far side means no outline. Jambs, sills, lintels, reveals, corners and object contours keep their lines. Ported from floor3dx-card 1.7.3 (`look.edge_skip: seams, floors`); `src/edges.js`, unit test `node dev/edges-test.mjs`. Switch in the Snapshot section; `view.edge_joints: false` restores the previous lines.

## 0.5.0 — 2026-10-20

- **Text and picture panels hidden per model.** *Find floor3d cards* records the objects each floor3d card binds as `type3d: text` or `image`. The render hides them (first object of each name, as floor3d resolves it) and unused spares beside them, meaning flat objects of the same size and name family. A model whose panels aren't named `Frame…` no longer keeps blank frames in the snapshot, and objects that share a name elsewhere in the model are left alone. Running *Find floor3d cards* again refreshes the lists for models already added. Switch: *Hide the floor3d card's text and picture panels* (on by default).

## 0.4.2 — 2026-10-19

- Fix: with *Room buttons under the map* set to all rooms, the row of buttons widened the map column beyond the card, cutting off the map in narrow places such as the card editor's preview. The row now scrolls sideways within the card.
- Editor: the *Room buttons under the map* choices read "Rooms the map can't show" (default), "All rooms" and "Never".

## 0.4.0 — 2026-10-18

- **Wall transparency**: one global slider (0–90 %) makes every wall object see-through. From 30 % up, floors behind walls can be tapped, and their tints are drawn as faintly as the wall lets them through (marked in the room index). Works with every style, the 3D preview and sunlight.
- *Advanced → Wall objects*: the name prefix(es) that identify walls (default `wall`), shared with the look themes.

## 0.3.1 — 2026-10-17

- A room with no floor object and no pin anchor (an "Outdoor Lighting" group, say) no longer disappears: the card lists it as a button under the map, and the editor warns about it, both in the room and after rendering.
- Pin anchor: quick picks from the floor3d objects bound to the room's entities, a model selector with two or more models, and a lookup in every model if the object isn't in the one named.

## 0.3.0 — 2026-10-17

- **Styles**: Neon, Blueprint and Day, the look themes of floor3dx-card (muted per-pixel surface colors, edge lines that glow in Neon and Blueprint, saturated colors kept), alongside the standard look. Themed maps sit on the theme's stage color, which follows the sun when sunlight is on.
- **View**: turn (Y), tilt (X) and the new roll (Z), down to a straight plan view. The snapshot stays an orthographic projection.
- **3D preview** in the editor: drag to turn and tilt, scroll to zoom, styled as it will render; *Reset view* and *Straight down*.
- Picking a floor3dx card copies its `look.theme` and `north` when they aren't already set here.

## 0.2.0 — 2026-10-17

- **Sunlight**: an optional layer that relights the snapshot for the real sun through the day, with surface shading, wall shadows, warm dawn and dusk, muted night, and rooms with lights on glowing after dark. It is computed on the viewer's device in 2D from a baked lighting image, so no 3D runs there.
- Editor: new *Sunlight* section with an on/off switch, north direction, strength, shadows, night glow, north arrow and a time-of-day preview.
- Snapshots rendered with sunlight on use even, overhead lighting so the card can supply direction. Turning sunlight on or off marks the snapshot *Out of date*.

## 0.1.1 — 2026-10-17

- Fix HACS install: the release now ships the card's files as individual assets and `hacs.json` names `floor3d-snapshot-card.js`. 0.1.0 named its zip, so HACS registered the zip as the dashboard resource and the card never loaded.
- Draco/Basis decoders now sit beside the card files (HACS downloads release assets into a single folder).

## 0.1.0 — 2026-10-17

First release.

- Card: static isometric floor plan with floor-tap room selection, theme-colored selection wash, amber "on" wash, hover names, fading tap labels, Labels toggle, and a room control panel (lights with brightness, switches, fans with speeds, media power and volume, covers, thermostats, locks, scenes/scripts, read-only sensors).
- Guest mode: lock-only locks, close-only garage/gate/door covers, read-only alarms, capped volume, optional thermostat range.
- Visual editor: finds floor3d / floor3dpro / floor3dx cards in your dashboards; detects `room_N_1` floors; names rooms from floor3d bindings; assigns floor3d entities to rooms by position; room and entity editing; in-browser snapshot rendering with upload to Home Assistant's image store or embedding; out-of-date detection.
- Touch-safe rendering for iOS (no DOM replacement between touch and click).
