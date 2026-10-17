# Floor3D Snapshot Card

Turn the 3D model behind a [floor3d-card](https://github.com/adizanni/floor3d-card), [floor3dpro-card](https://github.com/levonisyas/floor3dpro-card) or [floor3dx-card](https://github.com/FortranFour/floor3dx-card) into a **fast, tappable floor plan** with simple room controls — for wall tablets, phones, guests and anyone who doesn't need the full 3D experience.

![Card](docs/card.png)

- **Static and light.** The card shows a pre-rendered isometric picture of your model. Tablets and phones download one ~26 KB module and two images (typically 100–200 KB); no 3D runs on them.
- **Tap a floor, get its controls.** Each room's floor is the button. The selected room is washed in your theme color, rooms with something on glow amber, and a mouse hover names the room. Pins stay hidden so the picture stays clean (a **Labels** toggle shows them).
- **Built from your floor3d card.** The visual editor finds floor3d cards in your dashboards, loads the model, detects rooms, names them, and places the card's lights, switches, fans, covers, media players, thermostats and locks into the room each one stands in. You review and edit.
- **Guest mode** (on by default): locks can only be locked, garage doors and gates only closed, alarms are read-only, TV volume is capped, thermostats can be limited to a range.

| Editor | Phone |
|---|---|
| ![Editor](docs/editor.png) | ![Phone](docs/phone.png) |

## Install

**HACS:** HACS → ⋮ → *Custom repositories* → add `https://github.com/FortranFour/floor3d-snapshot-card` as type **Dashboard**, then install *Floor3D Snapshot Card*. HACS adds the resource `/hacsfiles/floor3d-snapshot-card/floor3d-snapshot-card.js`.

**Manual:** download `floor3d-snapshot-card.zip` from the [latest release](https://github.com/FortranFour/floor3d-snapshot-card/releases), unzip it into `/config/www/floor3d-snapshot-card/`, and add `/local/floor3d-snapshot-card/floor3d-snapshot-card.js` as a JavaScript module resource. Keep the other files from the zip beside it — the editor loads them on demand.

## Set up (visual editor)

Add a card → **Floor3D Snapshot**, then work down the editor:

1. **Model** — *Find floor3d cards in my dashboards* lists every floor3d-family card you can read; pick one (or two, e.g. house and detached garage — the second is placed beside the first). Or paste a model URL (`.glb`, `.gltf` or `.obj` + `.mtl`).
2. **Rooms** — *Detect rooms from the model* finds the floor objects (`room_N_1`, as Sweet Home 3D exports them), names each room from the floor3d entity bound to that floor (e.g. `input_button.floor3d_kitchen` → *Kitchen*), and assigns the floor3d card's entities to the room they stand in. Tick *Also add sensors* first if you want temperatures, doors and windows too. Then rename rooms, change icons, add or remove entities, set labels, reorder. Rooms without a floor object (a porch, say) show as a pin on an anchor object.
3. **Snapshot** — choose the view angle and tilt, then *Render snapshot*. Rendering runs in your browser (a few seconds to ~20 s for a large house) and the two images are saved in Home Assistant's image store. If you later change rooms, models or the view, the editor marks the snapshot *Out of date*.
4. **Display** — title, starting room, layout, guest-mode limits.

> Rendering needs WebGL in the browser you edit from (any desktop browser). Guests never need it.

## Configuration

The editor writes everything. For reference:

```yaml
type: custom:floor3d-snapshot-card
title: Our Home
subtitle: Tap a room on the map to see its controls.
models:
  - url: /local/floor3d/house.glb
  - url: /local/floor3d/garage.glb
    place: east            # east | west | north | south | as-is
    rotate: 0
view:
  azimuth: 45              # camera direction, degrees
  elevation: 52            # tilt, degrees
  room_colors: false       # pastel floors instead of neutral
  edges: true
  hide: "^room_\\d+_2$|^Frame"            # ceilings and text frames
  fixture_names: "^fan_|^Fluorescent_strip" # hanging fixtures to hide
rooms:
  - id: kitchen
    name: Kitchen
    icon: mdi:countertop-outline
    floors: [{ model: 0, object: room_0_1 }]
    entities:
      - entity: light.kitchen_island
        name: Island           # optional label
      - entity: sensor.kitchen_temperature
        read_only: true        # show state only
  - id: porch
    name: Porch
    anchor: { model: 0, object: porch_light }   # pin-only room
    pin_offset: [2, -3]                          # nudge pin, % of image
    entities: [{ entity: light.porch }]
default_room: kitchen
layout: auto               # auto | side | stacked
room_list: ""              # "" (only without snapshot) | always | never
guest_mode: true
max_volume: 0.6
temperature_range: [64, 78]
snapshot:                  # written by the editor's Render button
  image: /api/image/serve/<id>/original
  index: /api/image/serve/<id>/original
  aspect: 1.096
  rooms: { kitchen: { pin: [52.1, 47.3], code: 1 } }
```

### What each entity becomes

| Domain | Control |
|---|---|
| `light` | toggle, brightness slider when on |
| `switch`, `input_boolean`, `remote`, `humidifier` | toggle |
| `fan` | toggle; Off/Low/Med/High when speeds are supported |
| `media_player` | power toggle; volume slider (capped in guest mode) |
| `cover` | Open / Stop / Close — *Close* only for garage, gate and door covers in guest mode |
| `climate` | current mode and temperature, − / + setpoint (within `temperature_range`) |
| `lock` | Lock (tap twice to confirm); Unlock only with guest mode off |
| `scene`, `script`, `button`, `input_button` | Run (tap twice) |
| `sensor`, `binary_sensor`, `alarm_control_panel`, others | state only |

## How it works

The editor loads three.js (only for you, while editing) and renders the model with ceilings, hanging fixtures and text frames removed, crease-only edge lines, and an isometric camera cropped to the building. It also renders a **room index**: each room's visible floor in a flat code color with walls and furniture occluding it. That PNG doubles as the picture's transparency mask, so the JPEG blends into any theme, light or dark. The card decodes the index once to know exactly which room a tap lands on and to paint the selected/active floor washes. Pins sit on each room's visible floor.

Images go to Home Assistant's built-in image store (`/api/image/upload`, served from `/api/image/serve/…`), the same place the picture-card editor uploads to; re-rendering deletes the previous pair. Choose *Embed in this dashboard* under *Snapshot → Advanced* to store them in the card configuration instead.

## Security

A dashboard is not a security boundary. Give guests a non-administrator Home Assistant user and use Home Assistant's own permissions for anything that must be enforced. The card only ever calls services on the entities you put in its rooms.

## Development

```bash
npm install
npm run build            # dist/ + floor3d-snapshot-card.zip
node dev/make-demo.mjs   # regenerate the demo home model
node dev/test.mjs --demo # headless end-to-end test (editor → render → card)
node dev/server.mjs      # then open http://127.0.0.1:8123/?fixture=demo
```

`dev/` contains a harness with a simulated Home Assistant (dashboards, states, image store). Put your own model and dashboard JSON in `dev/private/` (git-ignored) to test against your home.

## Credits

Built on [three.js](https://threejs.org). Thanks to [adizanni/floor3d-card](https://github.com/adizanni/floor3d-card) and [levonisyas/floor3dpro-card](https://github.com/levonisyas/floor3dpro-card), whose model conventions this card reads. MIT licensed.
