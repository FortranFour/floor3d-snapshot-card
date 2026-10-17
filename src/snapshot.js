// Snapshot engine — loaded only inside the card editor (never on guest devices).
// Loads floor3d-family models, finds rooms, assigns floor3d entities to rooms by
// position, and renders a static isometric snapshot plus a room-index/mask image.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export const VIEW_DEFAULTS = {
  azimuth: 45, elevation: 52, width: 1600, height: 1000, supersample: 2,
  hide: "^room_\\d+_2$|^Frame", auto_ceiling: true, ceiling_band: 0.7,
  fixture_band: 0.55, fixture_mesh_band: 0.62, fixture_names: "^fan_|^Fluorescent_strip",
  cut: 0, edges: true, edge_angle: 35, edge_color: "#4a4038", edge_opacity: 0.32,
  clay: "#EFE7DC", floor_color: "#E6E0D6", room_colors: false,
  exposure: 0.95, env_intensity: 0.35, contrast: 1.08, saturate: 1.18,
  crop_pad: 0.012, pin_room: 26, jpeg_quality: 0.86, matte: "#ECE8E2",
};

const ROOM_PALETTE = ["#F2C46D", "#9CC5A1", "#8FB8DE", "#E8A598", "#4FC99A", "#B9A6D9", "#8ED1CF", "#F0B8C8", "#C9D88A", "#B8C2CC", "#F4A97A", "#A9C7E8"];
const FLOOR_RE = /^room_(\d+)_1$/;
const CONTROL_DOMAINS = new Set(["light", "switch", "fan", "cover", "climate", "media_player", "lock", "input_boolean", "scene", "script", "remote", "vacuum", "water_heater", "humidifier", "valve"]);
const SENSOR_DOMAINS = new Set(["sensor", "binary_sensor"]);

const tick = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Load the models of a configuration into one scene. */
export async function createSession({ models, decoderBase, onProgress = () => {} }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  const draco = new DRACOLoader().setDecoderPath(new URL("draco/", decoderBase).href);
  const ktx2 = new KTX2Loader().setTranscoderPath(new URL("basis/", decoderBase).href).detectSupport(renderer);
  const gltfLoader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);

  const scene = new THREE.Scene();
  const roots = [];
  for (const [i, model] of models.entries()) {
    onProgress(`Loading model ${i + 1} of ${models.length}…`);
    const url = model.url;
    let object;
    if (/\.obj(\?|$)/i.test(url)) {
      const loader = new OBJLoader();
      if (model.mtl) {
        const materials = await new MTLLoader().loadAsync(model.mtl);
        materials.preload();
        loader.setMaterials(materials);
      }
      object = await loader.loadAsync(url);
    } else {
      object = (await gltfLoader.loadAsync(url)).scene;
    }
    const root = new THREE.Group();
    root.add(object);
    root.rotation.y = THREE.MathUtils.degToRad(Number(model.rotate) || 0);
    root.scale.setScalar(Number(model.scale) || 1);
    scene.add(root);
    root.updateMatrixWorld(true);
    roots.push(root);
  }
  // Separate exports share no origin: park later models beside the first one.
  const first = new THREE.Box3().setFromObject(roots[0]);
  models.forEach((model, i) => {
    if (!i) return;
    const place = model.place || "east";
    const r = roots[i];
    if (Array.isArray(model.offset)) r.position.add(new THREE.Vector3(...model.offset.map(Number)));
    if (place !== "as-is") {
      const b = new THREE.Box3().setFromObject(r);
      const gap = Math.max(first.max.x - first.min.x, first.max.z - first.min.z) * (model.gap ?? 0.12);
      const fc = first.getCenter(new THREE.Vector3()), bc = b.getCenter(new THREE.Vector3());
      const d = new THREE.Vector3();
      if (place === "east") d.set(first.max.x + gap - b.min.x, 0, fc.z - bc.z);
      if (place === "west") d.set(first.min.x - gap - b.max.x, 0, fc.z - bc.z);
      if (place === "south") d.set(fc.x - bc.x, 0, first.max.z + gap - b.min.z);
      if (place === "north") d.set(fc.x - bc.x, 0, first.min.z - gap - b.max.z);
      d.y = first.min.y - b.min.y;
      r.position.add(d);
    }
    r.updateMatrixWorld(true);
  });
  onProgress("Models loaded.");
  return new Session(scene, roots, models, renderer);
}

class Session {
  constructor(scene, roots, models, renderer) {
    this.scene = scene; this.roots = roots; this.models = models; this.renderer = renderer;
  }
  dispose() { this.renderer.dispose(); this.scene.traverse((o) => { o.geometry?.dispose?.(); }); }

  /** Named objects (model index + name) for pickers. */
  objectNames() {
    return this.roots.map((root) => {
      const names = new Set();
      root.traverse((o) => { if (o.name && (o.isMesh || o.children.length)) names.add(o.name); });
      return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    });
  }

  find(model, name) { return this.roots[model]?.getObjectByName(name); }

  /** Resolve a floor3d object reference (object id or <group>) to objects. */
  _resolve(model, ref, groups) {
    const m = /^<(.+)>$/.exec(ref || "");
    const names = m ? (groups?.[m[1]] || []) : [ref];
    return names.map((name) => this.find(model, name)).filter(Boolean);
  }

  /** Floor objects in Sweet Home 3D / floor3d exports (room_N_1). */
  floorCandidates() {
    const out = [];
    this.roots.forEach((root, model) => root.traverse((o) => {
      if (o.name && FLOOR_RE.test(o.name) && !out.some((c) => c.model === model && c.object === o.name)) out.push({ model, object: o.name });
    }));
    return out;
  }

  /**
   * Propose rooms from floor objects, named from floor3d entities bound to the floor,
   * and fill each with the floor3d entities whose objects stand on that floor.
   * floor3d: per model {entities:[{entity, object_id}], groups:{name:[ids]}}
   */
  suggestRooms(floor3d = [], friendlyName = (id) => id, { sensors = false } = {}) {
    const floors = this.floorCandidates();
    const rooms = floors.map((f, i) => {
      // Prefer floor3d room buttons (type3d camera / input_button) for the name.
      const onFloor = (floor3d[f.model]?.entities || []).filter((e) => e.object_id === f.object);
      const bound = onFloor.find((e) => e.type3d === "camera" || /^input_button\./.test(e.entity)) || onFloor[0];
      let name = bound ? friendlyName(bound.entity) : "";
      name = cleanRoomName(name) || `Room ${i + 1}`;
      return { id: slug(name, i), name, icon: roomIcon(name), floors: [{ model: f.model, object: f.object }], entities: [] };
    });
    const tris = rooms.map((room) => room.floors.flatMap((f) => floorTriangles(this.find(f.model, f.object))));
    const span = new THREE.Box3().setFromObject(this.scene).getSize(new THREE.Vector3());
    const near = Math.max(span.x, span.z) * 0.025;
    floor3d.forEach((cfg, model) => {
      for (const ent of cfg?.entities || []) {
        const domain = String(ent.entity || "").split(".")[0];
        if (!CONTROL_DOMAINS.has(domain) && !(sensors && SENSOR_DOMAINS.has(domain))) continue;
        const objects = this._resolve(model, ent.object_id, cfg.groups);
        if (!objects.length) continue;
        const box = new THREE.Box3(); objects.forEach((o) => box.expandByObject(o));
        const c = box.getCenter(new THREE.Vector3());
        let best = -1, bestDist = near;
        tris.forEach((list, r) => {
          if (rooms[r].floors[0].model !== model) return;
          const d = distanceToFloor(list, c.x, c.z);
          if (d < bestDist) { bestDist = d; best = r; }
        });
        if (best >= 0 && !rooms[best].entities.some((e) => e.entity === ent.entity)) rooms[best].entities.push({ entity: ent.entity });
      }
    });
    rooms.forEach((room, i) => { room.color = ROOM_PALETTE[i % ROOM_PALETTE.length]; });
    return rooms;
  }

  /** Render the snapshot. rooms: [{id, floors:[{model,object}], anchor?:{model,object}, pin_offset?:[dx,dy], color?}] */
  async render({ view: viewIn = {}, rooms = [], onProgress = () => {} }) {
    const cfg = { ...VIEW_DEFAULTS, ...viewIn };
    const { scene, roots, renderer } = this;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = cfg.exposure;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = cfg.env_intensity;
    const restore = [];
    const setVisible = (o, v) => { restore.push([o, "visible", o.visible]); o.visible = v; };

    onProgress("Removing ceilings and hanging fixtures…"); await tick();
    const hideRe = cfg.hide ? new RegExp(cfg.hide) : null;
    for (const r of roots) {
      const rb = new THREE.Box3().setFromObject(r);
      const rh = rb.max.y - rb.min.y;
      r.traverse((o) => {
        if (!o.visible) return;
        if (hideRe && o.name && hideRe.test(o.name)) { setVisible(o, false); return; }
        if (!o.isMesh || !cfg.auto_ceiling) return;
        const b = new THREE.Box3().setFromObject(o);
        const h = b.max.y - b.min.y;
        const top = (b.min.y - rb.min.y) / rh;
        if (h < rh * 0.06 && top > cfg.ceiling_band && (b.max.x - b.min.x) * (b.max.z - b.min.z) > rh * rh * 0.01) setVisible(o, false);
      });
    }
    // Ceiling-hung fixtures float once ceilings are gone.
    if (cfg.fixture_band) {
      const nameRe = cfg.fixture_names ? new RegExp(cfg.fixture_names) : null;
      for (const r of roots) {
        const rb = new THREE.Box3().setFromObject(r);
        const rh = rb.max.y - rb.min.y;
        const groups = new Map();
        r.traverse((o) => {
          if (!o.isMesh || !o.visible) return;
          if (nameRe && nameRe.test(o.name)) { setVisible(o, false); return; }
          const g = (o.name || "").split("_")[0];
          if (!groups.has(g)) groups.set(g, []);
          groups.get(g).push(o);
        });
        for (const meshes of groups.values()) {
          const b = new THREE.Box3(); meshes.forEach((m) => b.expandByObject(m));
          const low = (b.min.y - rb.min.y) / rh, w = b.max.x - b.min.x, d = b.max.z - b.min.z;
          if (low > cfg.fixture_band && Math.min(w, d) > rh * 0.06 && Math.max(w, d) < rh * 0.8) meshes.forEach((m) => setVisible(m, false));
        }
        if (cfg.fixture_mesh_band) r.traverse((o) => {
          if (!o.isMesh || !o.visible) return;
          const b = new THREE.Box3().setFromObject(o);
          const low = (b.min.y - rb.min.y) / rh, w = b.max.x - b.min.x, d = b.max.z - b.min.z;
          if (low > cfg.fixture_mesh_band && Math.min(w, d) > rh * 0.05 && Math.max(w, d) < rh * 0.25) setVisible(o, false);
        });
      }
    }
    const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };

    onProgress("Styling…"); await tick();
    const clay = new THREE.Color(cfg.clay);
    const floorOf = new Map();
    rooms.forEach((room, k) => (room.floors || []).forEach((f) => {
      const o = this.find(f.model, f.object);
      if (o) o.traverse((m) => { if (m.isMesh) floorOf.set(m, { k, color: cfg.room_colors ? (room.color || ROOM_PALETTE[k % ROOM_PALETTE.length]) : cfg.floor_color }); });
    }));
    const clip = cfg.cut > 0 ? roots.map((r) => { const b = new THREE.Box3().setFromObject(r); return new THREE.Plane(new THREE.Vector3(0, -1, 0), b.min.y + (b.max.y - b.min.y) * cfg.cut); }) : null;
    const added = [];
    roots.forEach((r, ri) => r.traverse((o) => {
      if (!o.isMesh) return;
      restore.push([o, "material", o.material]);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const floor = floorOf.get(o);
      const next = mats.map((m) => {
        const c = m.clone();
        if (floor) { c.color = new THREE.Color(floor.color); c.map = null; } else if (c.color) c.color.multiply(clay);
        c.metalness = 0; c.roughness = Math.max(c.roughness ?? 1, 0.85);
        if (clip) { c.clippingPlanes = [clip[ri]]; c.side = THREE.DoubleSide; }
        return c;
      });
      o.material = next.length === 1 ? next[0] : next;
    }));
    renderer.localClippingEnabled = !!clip;

    if (cfg.edges) {
      onProgress("Tracing edges…"); await tick();
      const lineMat = new THREE.LineBasicMaterial({ color: cfg.edge_color, transparent: true, opacity: cfg.edge_opacity, depthWrite: false });
      let n = 0;
      for (const r of roots) {
        const meshes = []; r.traverse((o) => { if (o.isMesh && shown(o)) meshes.push(o); });
        for (const o of meshes) {
          const lm = lineMat.clone(); lm.clippingPlanes = (Array.isArray(o.material) ? o.material[0] : o.material).clippingPlanes || null;
          const lines = new THREE.LineSegments(creaseEdges(o.geometry, cfg.edge_angle), lm);
          o.add(lines); added.push(lines);
          if (++n % 300 === 0) await tick();
        }
      }
    }

    // Lights and camera
    const vis = new THREE.Box3();
    scene.traverse((o) => { if (o.isMesh && shown(o)) vis.expandByObject(o); });
    const center = vis.getCenter(new THREE.Vector3()), size = vis.getSize(new THREE.Vector3()), span = Math.max(size.x, size.z);
    const hemi = new THREE.HemisphereLight(0xffffff, 0xb7a58c, 0.9);
    const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
    sun.position.copy(center).addScaledVector(new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(35), THREE.MathUtils.degToRad(160)), span * 2);
    sun.target.position.copy(center);
    scene.add(hemi, sun, sun.target); added.push(hemi, sun, sun.target);

    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -span * 10, span * 10);
    cam.position.copy(center).addScaledVector(new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - cfg.elevation), THREE.MathUtils.degToRad(cfg.azimuth)), span * 3);
    cam.lookAt(center); cam.updateMatrixWorld(true);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [vis.min.x, vis.max.x]) for (const y of [vis.min.y, vis.max.y]) for (const z of [vis.min.z, vis.max.z]) {
      const p = new THREE.Vector3(x, y, z).applyMatrix4(cam.matrixWorldInverse);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const w = (maxX - minX) * 1.08, h = (maxY - minY) * 1.08;
    const H = cfg.height, W = Math.round(H * w / h);
    cam.left = (minX + maxX) / 2 - w / 2; cam.right = (minX + maxX) / 2 + w / 2; cam.top = (minY + maxY) / 2 + h / 2; cam.bottom = (minY + maxY) / 2 - h / 2;
    cam.updateProjectionMatrix();

    onProgress("Rendering…"); await tick();
    renderer.setSize(W * cfg.supersample, H * cfg.supersample, false);
    renderer.render(scene, cam);
    const full = document.createElement("canvas"); full.width = W; full.height = H;
    const fctx = full.getContext("2d", { willReadFrequently: true });
    fctx.imageSmoothingQuality = "high";
    fctx.filter = `contrast(${cfg.contrast}) saturate(${cfg.saturate})`;
    fctx.drawImage(renderer.domElement, 0, 0, W, H);
    fctx.filter = "none";

    // Pins: floor bbox top-centre, or an anchor object's base for pin-only rooms.
    const pins = {};
    const project = (v) => { const p = v.clone().project(cam); return [(p.x + 1) / 2 * W, (1 - p.y) / 2 * H]; };
    for (const room of rooms) {
      const objs = (room.floors?.length ? room.floors : room.anchor ? [room.anchor] : []).map((f) => this.find(f.model, f.object)).filter(Boolean);
      if (!objs.length) continue;
      const b = new THREE.Box3(); objs.forEach((o) => b.expandByObject(o));
      const c = b.getCenter(new THREE.Vector3());
      c.y = room.floors?.length ? b.max.y : b.min.y;
      const [x, y] = project(c);
      const [dx, dy] = Array.isArray(room.pin_offset) ? room.pin_offset.map(Number) : [0, 0];
      pins[room.id] = [x + dx / 100 * W, y + dy / 100 * H];
    }

    // Room index: flat codes on visible floors, everything else occludes (no AA).
    onProgress("Building room index…"); await tick();
    const swap = [];
    const black = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
    scene.traverse((o) => {
      if (o.isLineSegments) { swap.push([o, "visible", o.visible]); o.visible = false; return; }
      if (!o.isMesh) return;
      swap.push([o, "material", o.material]);
      const floor = floorOf.get(o);
      if (floor) { const m = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }); m.color.setRGB((floor.k + 1) / 255, 0, 0, THREE.LinearSRGBColorSpace); o.material = m; }
      else o.material = black;
      if (clip) [o.material].flat().forEach((m) => { m.clippingPlanes = (Array.isArray(swap.at(-1)[2]) ? swap.at(-1)[2][0] : swap.at(-1)[2]).clippingPlanes; });
    });
    const env = scene.environment; scene.environment = null;
    const indexRenderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
    indexRenderer.setPixelRatio(1); indexRenderer.setSize(W, H, false);
    indexRenderer.outputColorSpace = THREE.LinearSRGBColorSpace; indexRenderer.toneMapping = THREE.NoToneMapping;
    indexRenderer.localClippingEnabled = !!clip; indexRenderer.setClearColor(0x000000, 0);
    indexRenderer.render(scene, cam);
    const ic = document.createElement("canvas"); ic.width = W; ic.height = H;
    const ictx = ic.getContext("2d", { willReadFrequently: true });
    ictx.drawImage(indexRenderer.domElement, 0, 0);
    indexRenderer.dispose();
    for (const [o, k, v] of swap) o[k] = v;
    scene.environment = env;

    // Crop to the visible model plus pins.
    const img = fctx.getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (img[(y * W + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    for (const [px, py] of Object.values(pins)) { x0 = Math.min(x0, px - cfg.pin_room); x1 = Math.max(x1, px + cfg.pin_room); y0 = Math.min(y0, py - cfg.pin_room); y1 = Math.max(y1, py + cfg.pin_room); }
    const pad = Math.round(Math.max(W, H) * cfg.crop_pad);
    x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad));
    x1 = Math.min(W, Math.ceil(x1 + pad)); y1 = Math.min(H, Math.ceil(y1 + pad));
    const cw = x1 - x0, ch = y1 - y0;

    // Picture: JPEG over a neutral matte (transparency comes from the mask).
    const pic = document.createElement("canvas"); pic.width = cw; pic.height = ch;
    const pctx = pic.getContext("2d");
    pctx.fillStyle = cfg.matte; pctx.fillRect(0, 0, cw, ch);
    pctx.drawImage(full, x0, y0, cw, ch, 0, 0, cw, ch);
    // Mask + index: alpha = model coverage (anti-aliased), red = room code on visible floors.
    const idx = ictx.getImageData(x0, y0, cw, ch);
    const alpha = fctx.getImageData(x0, y0, cw, ch).data;
    const d = idx.data;
    const codes = new Uint8Array(cw * ch);
    for (let i = 0; i < cw * ch; i++) codes[i] = d[i * 4 + 3] > 200 && d[i * 4 + 1] < 4 && d[i * 4 + 2] < 4 ? d[i * 4] : 0;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {     // despeckle slivers
      const i = y * cw + x, v = codes[i]; if (!v) continue;
      let same = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && x + dx >= 0 && y + dy >= 0 && x + dx < cw && y + dy < ch && codes[(y + dy) * cw + x + dx] === v) same++;
      if (same < 3) codes[i] = 0;
    }
    for (let i = 0; i < cw * ch; i++) { const a = alpha[i * 4 + 3]; d[i * 4] = codes[i] && a > 200 ? codes[i] : 0; d[i * 4 + 1] = 0; d[i * 4 + 2] = 0; d[i * 4 + 3] = a; }
    // Floor-room pins go on the room's visible floor: the coded pixel nearest the
    // centroid of its visible area (thin or L-shaped rooms keep their pin inside).
    const sum = new Map();
    for (let i = 0; i < cw * ch; i++) { const v = d[i * 4]; if (!v) continue; const e = sum.get(v) || [0, 0, 0]; e[0] += i % cw; e[1] += (i / cw) | 0; e[2]++; sum.set(v, e); }
    const floorPin = new Map();
    for (const [v, [sx, sy, n]] of sum) {
      const mx = sx / n, my = sy / n; let best = Infinity, bx = mx, by = my;
      if (d[(Math.round(my) * cw + Math.round(mx)) * 4] !== v) for (let i = 0; i < cw * ch; i++) if (d[i * 4] === v) { const x = i % cw, y = (i / cw) | 0, q = (x - mx) ** 2 + (y - my) ** 2; if (q < best) { best = q; bx = x; by = y; } }
      floorPin.set(v, [bx, by]);
    }
    const mask = document.createElement("canvas"); mask.width = cw; mask.height = ch;
    mask.getContext("2d").putImageData(idx, 0, 0);

    // Restore the scene for further renders.
    for (const o of added) o.parent?.remove(o);
    for (const [o, k, v] of restore.reverse()) o[k] = v;
    pmrem.dispose();

    const toBlob = (canvas, type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q));
    const result = {
      image: await toBlob(pic, "image/jpeg", cfg.jpeg_quality),
      index: await toBlob(mask, "image/png"),
      width: cw, height: ch, aspect: +(cw / ch).toFixed(4),
      rooms: {},
    };
    rooms.forEach((room, k) => {
      let p = pins[room.id];
      const fp = room.floors?.length ? floorPin.get(k + 1) : null;
      if (fp) { const [dx, dy] = Array.isArray(room.pin_offset) ? room.pin_offset.map(Number) : [0, 0]; p = [fp[0] + x0 + dx / 100 * cw, fp[1] + y0 + dy / 100 * ch]; }
      result.rooms[room.id] = {
        ...(p ? { pin: [+((p[0] - x0) / cw * 100).toFixed(1), +((p[1] - y0) / ch * 100).toFixed(1)] } : {}),
        ...(room.floors?.length ? { code: k + 1 } : {}),
      };
    });
    onProgress("Done.");
    return result;
  }
}

// ---- helpers ------------------------------------------------------------------
const ROOM_ICONS = [[/kitchen/i, "mdi:countertop-outline"], [/dining/i, "mdi:silverware-fork-knife"], [/family|den/i, "mdi:sofa-single-outline"], [/living|lounge/i, "mdi:sofa-outline"], [/master.*bed|primary.*bed/i, "mdi:bed-king-outline"], [/bed|guest/i, "mdi:bed-queen-outline"], [/bath|shower|wc|toilet/i, "mdi:shower"], [/laundry|utility/i, "mdi:washing-machine"], [/garage/i, "mdi:garage-variant"], [/office|study|desk/i, "mdi:desk"], [/hall|entry|foyer|corridor/i, "mdi:door-open"], [/porch|patio|deck|garden|yard/i, "mdi:outdoor-lamp"], [/kid|nursery|play/i, "mdi:teddy-bear"], [/gym/i, "mdi:dumbbell"], [/closet|storage/i, "mdi:hanger"]];
export function roomIcon(name) { return (ROOM_ICONS.find(([re]) => re.test(name)) || [, "mdi:door-open"])[1]; }
export function cleanRoomName(name) {
  return String(name || "").replace(/\bfloor\s*3d\b|\bfloor3d\b|\b3d\b/gi, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim()
    .replace(/(^|\s)([a-z])/g, (m, p, c) => p + c.toUpperCase());
}
export function slug(name, i = 0) { return (String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `room-${i + 1}`); }

/** World-space XZ triangles of a floor object. */
function floorTriangles(obj) {
  const tris = [];
  obj?.traverse((m) => {
    if (!m.isMesh) return;
    const pos = m.geometry.attributes.position, index = m.geometry.index;
    const v = (i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
    const n = index ? index.count : pos.count;
    for (let t = 0; t < n; t += 3) {
      const a = v(index ? index.getX(t) : t), b = v(index ? index.getX(t + 1) : t + 1), c = v(index ? index.getX(t + 2) : t + 2);
      tris.push([a.x, a.z, b.x, b.z, c.x, c.z]);
    }
  });
  return tris;
}
/** 0 inside a floor triangle, else distance to the nearest triangle vertex/edge (approx.). */
function distanceToFloor(tris, x, z) {
  let best = Infinity;
  for (const [ax, az, bx, bz, cx, cz] of tris) {
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-9) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
    if (l1 >= 0 && l2 >= 0 && l3 >= 0) return 0;
    for (const [px, pz, qx, qz] of [[ax, az, bx, bz], [bx, bz, cx, cz], [cx, cz, ax, az]]) {
      const vx = qx - px, vz = qz - pz, t = Math.max(0, Math.min(1, ((x - px) * vx + (z - pz) * vz) / (vx * vx + vz * vz || 1)));
      best = Math.min(best, Math.hypot(x - (px + t * vx), z - (pz + t * vz)));
    }
  }
  return best;
}

/** Crease/outline edges that ignore triangle winding (no diagonals on flat faces). */
function creaseEdges(geom, angleDeg) {
  const pos = geom.attributes.position, idx = geom.index ? geom.index.array : null;
  const triCount = (idx ? idx.length : pos.count) / 3;
  const thr = Math.cos(THREE.MathUtils.degToRad(angleDeg));
  if (!geom.boundingBox) geom.computeBoundingBox();
  const q = Math.max(geom.boundingBox.getSize(new THREE.Vector3()).length() * 1e-5, 1e-6);
  const ids = new Map(), pts = [];
  const vid = (i) => {
    const k = `${Math.round(pos.getX(i) / q)},${Math.round(pos.getY(i) / q)},${Math.round(pos.getZ(i) / q)}`;
    let v = ids.get(k);
    if (v === undefined) { v = pts.length; ids.set(k, v); pts.push(new THREE.Vector3().fromBufferAttribute(pos, i)); }
    return v;
  };
  const edges = new Map();
  const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    const v = [vid(idx ? idx[3 * t] : 3 * t), vid(idx ? idx[3 * t + 1] : 3 * t + 1), vid(idx ? idx[3 * t + 2] : 3 * t + 2)];
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;
    n.crossVectors(e1.subVectors(pts[v[2]], pts[v[1]]), e2.subVectors(pts[v[0]], pts[v[1]]));
    if (!n.lengthSq()) continue;
    n.normalize();
    for (const [x, y] of [[v[0], v[1]], [v[1], v[2]], [v[2], v[0]]]) {
      const k = x < y ? x * 4294967296 + y : y * 4294967296 + x;
      const e = edges.get(k);
      if (!e) edges.set(k, { x, y, normals: [n.clone()] }); else e.normals.push(n.clone());
    }
  }
  const out = [];
  for (const e of edges.values()) {
    let draw = e.normals.length === 1;
    for (let i = 0; !draw && i < e.normals.length; i++) for (let j = i + 1; j < e.normals.length; j++) if (Math.abs(e.normals[i].dot(e.normals[j])) < thr) { draw = true; break; }
    if (draw) out.push(pts[e.x].x, pts[e.x].y, pts[e.x].z, pts[e.y].x, pts[e.y].y, pts[e.y].z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  return g;
}
