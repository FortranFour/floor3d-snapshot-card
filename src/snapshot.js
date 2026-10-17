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
import { nearestNormal } from "./sun.js";

export const VIEW_DEFAULTS = {
  azimuth: 45, elevation: 52, width: 1600, height: 1000, supersample: 2,
  hide: "^room_\\d+_2$|^Frame", auto_ceiling: true, ceiling_band: 0.7,
  fixture_band: 0.55, fixture_mesh_band: 0.62, fixture_names: "^fan_|^Fluorescent_strip",
  cut: 0, edges: true, edge_angle: 35, edge_color: "#4a4038", edge_opacity: 0.32,
  clay: "#EFE7DC", floor_color: "#E6E0D6", room_colors: false,
  exposure: 0.95, env_intensity: 0.35, contrast: 1.08, saturate: 1.18,
  crop_pad: 0.012, pin_room: 26, jpeg_quality: 0.86, matte: "#ECE8E2",
  sunlight: false,   // also bake the lighting layer; the picture is lit evenly so the card can relight it
  style: "standard", // standard | neon | blueprint | day (the floor3dx look themes)
  accent: "#37e0ff", // neon edge colour
  roll: 0,           // degrees, turns the picture about the view axis
  keep_signal: true, walls: "wall", floors: "room, floor",
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
  const draco = new DRACOLoader().setDecoderPath(new URL("./", decoderBase).href);
  const ktx2 = new KTX2Loader().setTranscoderPath(new URL("./", decoderBase).href).detectSupport(renderer);
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

  /** Style the scene for a snapshot or the live preview: hide ceilings and hanging fixtures,
   *  restyle materials (standard clay or a floor3dx look theme), add edge lines and lights.
   *  Undo with _unstage(). */
  async _stage(cfg, rooms, onProgress, renderer) {
    const { scene, roots } = this;
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
    const theme = THEME_INDEX[cfg.style] ?? -1;
    const look = theme >= 0 ? new LookThemer(theme, cfg) : null;
    if (look) {            // themes are flat colours: neutral lighting, no filmic curve (as in floor3dx)
      renderer.toneMapping = THREE.NoToneMapping;
      scene.environmentIntensity = 0.12;
    }
    const clay = new THREE.Color(cfg.clay);
    const floorOf = new Map();
    rooms.forEach((room, k) => (room.floors || []).forEach((f) => {
      const o = this.find(f.model, f.object);
      if (o) o.traverse((m) => { if (m.isMesh) floorOf.set(m, { k, color: cfg.room_colors ? (room.color || ROOM_PALETTE[k % ROOM_PALETTE.length]) : look ? null : cfg.floor_color }); });
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
        if (floor?.color) { c.color = new THREE.Color(floor.color); c.map = null; } else if (c.color && !look) c.color.multiply(clay);
        c.metalness = 0; c.roughness = Math.max(c.roughness ?? 1, 0.85);
        if (look) look.apply(c, look.surfaceOf(o));
        if (clip) { c.clippingPlanes = [clip[ri]]; c.side = THREE.DoubleSide; }
        return c;
      });
      o.material = next.length === 1 ? next[0] : next;
    }));
    renderer.localClippingEnabled = !!clip;

    if (cfg.edges) {
      onProgress("Tracing edges…"); await tick();
      const lineMat = look ? look.edgeMaterial() : new THREE.LineBasicMaterial({ color: cfg.edge_color, transparent: true, opacity: cfg.edge_opacity, depthWrite: false });
      const tiny = look ? Math.max(...roots.map((r) => { const z = new THREE.Box3().setFromObject(r).getSize(new THREE.Vector3()); return Math.max(z.x, z.z); })) * 0.004 : 0;
      let n = 0;
      for (const r of roots) {
        const meshes = []; r.traverse((o) => { if (o.isMesh && shown(o)) meshes.push(o); });
        for (const o of meshes) {
          if (look && look.skipEdges(o, tiny)) continue;
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
    // Sunlight mode: even, sun-at-noon lighting — the card adds direction and shadow later.
    // [hemisphere, directional] per style; sunlight mode lights evenly from overhead
    const LIGHTS = { standard: [0.9, 2.2], neon: [0.6, 0.9], blueprint: [0.75, 1.1], day: [1.25, 1.5] };
    const [hk, sk] = LIGHTS[look ? THEME_NAMES[look.index] : "standard"];
    const hemi = new THREE.HemisphereLight(0xffffff, look ? 0x8090a8 : 0xb7a58c, cfg.sunlight ? hk * (look ? 1.7 : 2.1) : hk);
    const sun = new THREE.DirectionalLight(0xfff3e0, cfg.sunlight ? sk * 0.45 : sk);
    sun.position.copy(center).addScaledVector(new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(cfg.sunlight ? 8 : 35), THREE.MathUtils.degToRad(160)), span * 2);
    sun.target.position.copy(center);
    scene.add(hemi, sun, sun.target); added.push(hemi, sun, sun.target);
    return { restore, added, pmrem, floorOf, clip, vis, center, span, look };
  }
  _unstage(st) {
    for (const o of st.added) o.parent?.remove(o);
    for (const [o, k, v] of st.restore.reverse()) o[k] = v;
    st.pmrem.dispose();
  }

  /**
   * Live preview on a canvas: the styled model under the snapshot's orthographic camera.
   * Returns { setView(view), restyle(view, rooms), draw(), close() }. Close it before render().
   */
  async openPreview(canvas, { view = {}, rooms = [] } = {}) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    let cfg = { ...VIEW_DEFAULTS, ...view, sunlight: false }, st = await this._stage(cfg, rooms, () => {}, r);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -st.span * 10, st.span * 10);
    let zoom = 1, frame = 0;
    const draw = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const w = canvas.clientWidth || 400, h = canvas.clientHeight || 300;
        r.setSize(w, h, false);
        orientCamera(cam, cfg, st.center, st.span);
        fitCamera(cam, st.vis, 1.06 / zoom, w / h);
        r.render(this.scene, cam);
      });
    };
    draw();
    return {
      get stage() { return st.look ? st.look.stage() : null; },
      setView: (v) => { cfg = { ...cfg, ...v }; draw(); },
      zoom: (k) => { zoom = Math.min(6, Math.max(0.5, zoom * k)); draw(); },
      restyle: async (v, rms = rooms) => { this._unstage(st); cfg = { ...VIEW_DEFAULTS, ...v, sunlight: false }; rooms = rms; st = await this._stage(cfg, rooms, () => {}, r); draw(); },
      draw,
      close: () => { cancelAnimationFrame(frame); this._unstage(st); r.dispose(); r.forceContextLoss?.(); },
    };
  }

  /** Render the snapshot. rooms: [{id, floors:[{model,object}], anchor?:{model,object}, pin_offset?:[dx,dy], color?}] */
  async render({ view: viewIn = {}, rooms = [], onProgress = () => {} }) {
    const cfg = { ...VIEW_DEFAULTS, ...viewIn };
    const { scene, renderer } = this;
    const st = await this._stage(cfg, rooms, onProgress, renderer);
    const { restore, added, pmrem, floorOf, clip, vis, center, span } = st;

    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -span * 10, span * 10);
    orientCamera(cam, cfg, center, span);
    const ext = fitCamera(cam, vis, 1.08);
    const H = cfg.height, W = Math.round(H * ext.w / ext.h);

    onProgress("Rendering…"); await tick();
    renderer.setSize(W * cfg.supersample, H * cfg.supersample, false);
    renderer.render(scene, cam);
    const full = document.createElement("canvas"); full.width = W; full.height = H;
    const fctx = full.getContext("2d", { willReadFrequently: true });
    fctx.imageSmoothingQuality = "high";
    fctx.filter = st.look ? "none" : `contrast(${cfg.contrast}) saturate(${cfg.saturate})`;
    fctx.drawImage(renderer.domElement, 0, 0, W, H);
    fctx.filter = "none";
    if (st.look && cfg.edges) {
      // Edge layer on its own (surfaces write depth only), laid over again sharp and, for neon and
      // blueprint, blurred as a glow: thin lines survive the downscale and read as lit.
      const hidden = [];
      scene.traverse((o) => { if (o.isMesh) for (const m of [o.material].flat()) if (m.colorWrite) { hidden.push(m); m.colorWrite = false; } });
      renderer.setClearColor(0x000000, 0); renderer.render(scene, cam);
      hidden.forEach((m) => { m.colorWrite = true; });
      const glow = st.look.index !== 2;
      fctx.globalCompositeOperation = glow ? "lighter" : "source-over";
      if (glow) { fctx.filter = `blur(${Math.max(1.5, H / 600).toFixed(1)}px)`; fctx.globalAlpha = 0.9; fctx.drawImage(renderer.domElement, 0, 0, W, H); fctx.filter = "none"; }
      fctx.globalAlpha = glow ? 0.7 : 0.55; fctx.drawImage(renderer.domElement, 0, 0, W, H);
      fctx.globalAlpha = 1; fctx.globalCompositeOperation = "source-over";
    }

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
    const light = cfg.sunlight ? (onProgress("Baking the lighting layer…"), await tick(), lightPass(scene, cam, W, H, vis)) : null;

    // Crop to the visible model plus pins.
    const img = fctx.getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (img[(y * W + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    for (const [px, py] of Object.values(pins)) { x0 = Math.min(x0, px - cfg.pin_room); x1 = Math.max(x1, px + cfg.pin_room); y0 = Math.min(y0, py - cfg.pin_room); y1 = Math.max(y1, py + cfg.pin_room); }
    const pad = Math.round(Math.max(W, H) * (st.look ? Math.max(cfg.crop_pad, 0.035) : cfg.crop_pad));
    x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad));
    x1 = Math.min(W, Math.ceil(x1 + pad)); y1 = Math.min(H, Math.ceil(y1 + pad));
    const cw = x1 - x0, ch = y1 - y0;

    // Picture: JPEG over a neutral matte (transparency comes from the mask).
    const pic = document.createElement("canvas"); pic.width = cw; pic.height = ch;
    const pctx = pic.getContext("2d");
    pctx.fillStyle = st.look ? st.look.stage().night : cfg.matte; pctx.fillRect(0, 0, cw, ch);
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
    // Lighting layer at half resolution (the card shades at half resolution):
    // R,G = 16-bit depth from the camera, B = surface direction index (255 = none).
    let lightCanvas = null;
    if (light) {
      const lw = Math.ceil(cw / 2), lh = Math.ceil(ch / 2);
      lightCanvas = document.createElement("canvas"); lightCanvas.width = lw; lightCanvas.height = lh;
      const lctx = lightCanvas.getContext("2d"), out = lctx.createImageData(lw, lh), o = out.data, cache = new Map();
      for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
        const i = (y * lw + x) * 4;
        o[i + 3] = 255; o[i + 2] = 255;
        for (const [ox, oy] of [[0, 0], [1, 1], [1, 0], [0, 1]]) {           // first covered pixel of the 2×2 block
          const fx = Math.min(cw - 1, x * 2 + ox), fy = Math.min(ch - 1, y * 2 + oy);
          const j = ((fy + y0) * W + fx + x0) * 4;
          if (light.normal[j + 3] < 250 || d[(fy * cw + fx) * 4 + 3] < 8) continue;
          o[i] = light.depth[j]; o[i + 1] = light.depth[j + 1];
          const key = (light.normal[j] << 16) | (light.normal[j + 1] << 8) | light.normal[j + 2];
          let k = cache.get(key);
          if (k === undefined) { k = nearestNormal(light.normal[j] / 127.5 - 1, light.normal[j + 1] / 127.5 - 1, light.normal[j + 2] / 127.5 - 1); cache.set(key, k); }
          o[i + 2] = k;
          break;
        }
      }
      lctx.putImageData(out, 0, 0);
    }

    // Restore the scene for further renders.
    this._unstage(st);

    const toBlob = (canvas, type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q));
    const result = {
      image: await toBlob(pic, "image/jpeg", cfg.jpeg_quality),
      index: await toBlob(mask, "image/png"),
      ...(lightCanvas ? { light: await toBlob(lightCanvas, "image/png"), lighting: lightMeta(cam, W, H, light) } : {}),
      width: cw, height: ch, aspect: +(cw / ch).toFixed(4),
      ...(st.look ? { style: cfg.style, stage: st.look.stage() } : {}),
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

// ---- camera ------------------------------------------------------------------------
/** Orthographic view: turn (Y, azimuth), tilt (X, elevation) and roll (Z), looking at `center`. */
export function orientCamera(cam, cfg, center, span) {
  const d = THREE.MathUtils.degToRad;
  cam.rotation.set(-d(Number(cfg.elevation) || 0), d(Number(cfg.azimuth) || 0), d(Number(cfg.roll) || 0), "YXZ");
  cam.position.copy(center).add(new THREE.Vector3(0, 0, 1).applyEuler(cam.rotation).multiplyScalar(span * 3));
  cam.updateMatrixWorld(true);
}
/** Fit the camera's frustum to a box (×pad); with `aspect`, widen to that aspect. Returns extents. */
export function fitCamera(cam, box, pad = 1.08, aspect = 0) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  let w = (maxX - minX) * pad, h = (maxY - minY) * pad;
  if (aspect) { if (w / h < aspect) w = h * aspect; else h = w / aspect; }
  cam.left = (minX + maxX) / 2 - w / 2; cam.right = (minX + maxX) / 2 + w / 2; cam.top = (minY + maxY) / 2 + h / 2; cam.bottom = (minY + maxY) / 2 - h / 2;
  cam.updateProjectionMatrix();
  return { w, h };
}

// ---- look themes (from floor3dx-card's look.ts, itself adapted from NextFloor, MIT) ----
const THEME_INDEX = { neon: 0, blueprint: 1, day: 2 };
const THEME_NAMES = ["neon", "blueprint", "day"];
/** Stage (background) colours, night and day, per theme. */
export const STAGES = { neon: { night: "#0b1120", day: "#1a2c4e" }, blueprint: { night: "#1a4682", day: "#225696" }, day: { night: "#d6e0ee", day: "#f2f6fb" } };
const EDGE_COLORS = [0x37e0ff, 0xcce6ff, 0x142b61];
const LOOK_FUNCTION = `
uniform int uTheme;
uniform int uKeepSignal;
uniform int uSurface; // 0 generic, 1 wall, 2 floor
vec3 f3sThemed(vec3 c) {
  float strongest = max(c.r, max(c.g, c.b));
  float weakest = min(c.r, min(c.g, c.b));
  float saturation = strongest > 0.0 ? (strongest - weakest) / strongest : 0.0;
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  bool signal = uKeepSignal == 1 && strongest > 0.45 && saturation > 0.45;
  if (signal) return c;
  if (uTheme == 0) {
    vec3 base = uSurface == 1 ? vec3(0.075, 0.114, 0.19) : uSurface == 2 ? vec3(0.055, 0.086, 0.16) : vec3(0.09, 0.12, 0.2);
    vec3 lit = uSurface == 1 ? vec3(0.08, 0.19, 0.25) : vec3(0.16, 0.22, 0.36);
    vec3 m = mix(base, lit, clamp(luma * 1.4, 0.0, 1.0));
    return mix(m, m * (c / max(strongest, 0.001)) * 1.6, 0.18);
  }
  if (uTheme == 1) return mix(vec3(0.04, 0.13, 0.3), vec3(0.2, 0.42, 0.75), clamp(luma * 1.6, 0.0, 1.0));
  vec3 grey = vec3(clamp(0.62 + luma * 0.36, 0.0, 0.97));
  return mix(grey, grey * (c / max(strongest, 0.001)), 0.12);
}
`;
const prefixes = (v) => (Array.isArray(v) ? v : String(v || "").split(",")).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
class LookThemer {
  constructor(index, cfg) {
    this.index = index; this.cfg = cfg;
    this.walls = prefixes(cfg.walls); this.floors = prefixes(cfg.floors);
  }
  surfaceOf(o) {
    for (let p = o; p; p = p.parent) {
      const n = (p.name || "").toLowerCase(); if (!n) continue;
      if (this.walls.some((x) => n.startsWith(x))) return 1;
      if (this.floors.some((x) => n.startsWith(x))) return 2;
    }
    return 0;
  }
  apply(m, surface) {
    m.flatShading = true;
    if (m.shininess !== undefined) m.shininess = 0;
    if (m.specular) m.specular.setRGB(0, 0, 0);
    if (m.roughness !== undefined) m.roughness = 1;
    const uniforms = { uTheme: { value: this.index }, uKeepSignal: { value: this.cfg.keep_signal === false ? 0 : 1 }, uSurface: { value: surface } };
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\n" + LOOK_FUNCTION)
        .replace("#include <color_fragment>", "#include <color_fragment>\n  diffuseColor.rgb = f3sThemed(diffuseColor.rgb);");
    };
    m.customProgramCacheKey = () => `f3s-look-${this.index}-${surface}`;
    m.needsUpdate = true;
  }
  edgeMaterial() {
    const neon = this.index === 0, accent = /^#?[0-9a-f]{6}$/i.test(this.cfg.accent || "") ? this.cfg.accent : "#37e0ff";
    return new THREE.LineBasicMaterial({ color: neon ? new THREE.Color(accent.startsWith("#") ? accent : `#${accent}`) : EDGE_COLORS[this.index], transparent: true, opacity: 0.85, depthWrite: false, blending: this.index === 2 ? THREE.NormalBlending : THREE.AdditiveBlending });
  }
  skipEdges(o, tiny) {
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (m?.transparent && m.opacity < 0.99) return true;
    const b = o.geometry.boundingBox || (o.geometry.computeBoundingBox(), o.geometry.boundingBox);
    const z = b.getSize(new THREE.Vector3()).multiply(o.getWorldScale(new THREE.Vector3()));
    return Math.max(z.x, z.y, z.z) < tiny;
  }
  stage() { return STAGES[THEME_NAMES[this.index]]; }
}

// ---- lighting layer ------------------------------------------------------------
const LIGHT_VERT = `
#include <clipping_planes_pars_vertex>
varying vec3 vN; varying float vDepth;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 mvPosition = viewMatrix * world;
  vDepth = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`;
const LIGHT_FRAG = `
#include <clipping_planes_pars_fragment>
uniform vec3 viewDir; uniform float near; uniform float far; uniform float mode;
varying vec3 vN; varying float vDepth;
void main() {
  #include <clipping_planes_fragment>
  if (mode < 0.5) {
    vec3 n = normalize(vN);
    if (dot(n, viewDir) > 0.0) n = -n;          // face the camera whatever the winding
    gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
  } else {
    float v = floor(clamp((vDepth - near) / (far - near), 0.0, 1.0) * 65535.0 + 0.5);
    float hi = floor(v / 256.0);
    gl_FragColor = vec4(hi / 255.0, (v - hi * 256.0) / 255.0, 0.0, 1.0);
  }
}`;

/** Render world-space surface directions and camera depth (no anti-aliasing). */
function lightPass(scene, cam, W, H, vis) {
  let near = Infinity, far = -Infinity;
  for (const x of [vis.min.x, vis.max.x]) for (const y of [vis.min.y, vis.max.y]) for (const z of [vis.min.z, vis.max.z]) {
    const dz = -new THREE.Vector3(x, y, z).applyMatrix4(cam.matrixWorldInverse).z; near = Math.min(near, dz); far = Math.max(far, dz);
  }
  const viewDir = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld);
  const uniforms = { viewDir: { value: viewDir }, near: { value: near }, far: { value: far }, mode: { value: 0 } };
  const swap = [], mats = new Map();
  const matFor = (planes) => {
    const key = planes?.[0] || null;
    if (!mats.has(key)) mats.set(key, new THREE.ShaderMaterial({ uniforms, vertexShader: LIGHT_VERT, fragmentShader: LIGHT_FRAG, side: THREE.DoubleSide, clipping: !!key, clippingPlanes: key ? [key] : null }));
    return mats.get(key);
  };
  scene.traverse((o) => {
    if (o.isLineSegments) { swap.push([o, "visible", o.visible]); o.visible = false; return; }
    if (!o.isMesh) return;
    if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
    swap.push([o, "material", o.material]);
    o.material = matFor((Array.isArray(o.material) ? o.material[0] : o.material).clippingPlanes || null);
  });
  const env = scene.environment; scene.environment = null;
  const r = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1); r.setSize(W, H, false); r.outputColorSpace = THREE.LinearSRGBColorSpace; r.toneMapping = THREE.NoToneMapping;
  r.localClippingEnabled = true; r.setClearColor(0x000000, 0);
  const grab = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(r.domElement, 0, 0); return x.getImageData(0, 0, W, H).data; };
  r.render(scene, cam); const normal = grab();
  uniforms.mode.value = 1; r.render(scene, cam); const depth = grab();
  r.dispose(); mats.forEach((m) => m.dispose());
  for (const [o, k, v] of swap) o[k] = v;
  scene.environment = env;
  return { normal, depth, near, far };
}
function lightMeta(cam, W, H, light) {
  const v = (x, y, z) => new THREE.Vector3(x, y, z).transformDirection(cam.matrixWorld).toArray().map((n) => +n.toFixed(5));
  return {
    right: v(1, 0, 0), up: v(0, 1, 0), forward: v(0, 0, -1),
    pixel: [+((cam.right - cam.left) / W * 2).toPrecision(6), +((cam.top - cam.bottom) / H * 2).toPrecision(6)],   // model units per lighting-image pixel
    depth: [+light.near.toPrecision(7), +light.far.toPrecision(7)],
  };
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
