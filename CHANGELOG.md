# Changelog

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

- **Styles**: Neon, Blueprint and Day, the look themes of floor3dx-card (muted per-pixel surface colours, edge lines that glow in Neon and Blueprint, saturated colours kept), alongside the standard look. Themed maps sit on the theme's stage colour, which follows the sun when sunlight is on.
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
