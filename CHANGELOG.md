# Changelog

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
