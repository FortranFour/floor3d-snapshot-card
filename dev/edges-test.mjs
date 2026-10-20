// Unit test of src/edges.js on a hand-built scene (no browser): open quads standing in for wall faces
// and room floors, closed boxes for wall segments, and a windowed wall built from overlapping pieces
// in one mesh, as Sweet Home 3D exports it. Run: node dev/edges-test.mjs
import * as THREE from "three";
import { buildEdges } from "../src/edges.js";

const quad = (name, pts, doubleSided) => {
  const p = []; const tri = (a, b, c) => p.push(...pts[a], ...pts[b], ...pts[c]);
  tri(0, 1, 2); tri(0, 2, 3); if (doubleSided) { tri(0, 2, 1); tri(0, 3, 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial()); m.name = name; return m;
};
const box = (name, x, y, z, w, h, d) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial()); m.name = name; m.position.set(x, y, z); return m; };
const pieces = (name, list) => {
  const ps = []; list.forEach(([x, y, z, w, h, d]) => { const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(); g.translate(x, y, z); ps.push(...g.attributes.position.array); });
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(ps, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial()); m.name = name; return m;
};
const build = (joints) => {
  const scene = new THREE.Scene();
  const meshes = [
    quad("wall_a", [[0, 0, 0], [200, 0, 0], [200, 250, 0], [0, 250, 0]]),
    quad("wall_b", [[200, 0, 0], [400, 0, 0], [400, 250, 0], [200, 250, 0]]),      // continues wall_a: seam at x=200
    quad("wall_c", [[400, 0, 0], [400, 0, 300], [400, 250, 300], [400, 250, 0]]),  // perpendicular: a corner
    quad("wall_d", [[0, 0, 500], [200, 0, 500], [200, 250, 500], [0, 250, 500]], true), // double-sided
    quad("room_1", [[0, 0, 0], [200, 0, 0], [200, 0, 300], [0, 0, 300]]),
    quad("room_2", [[200, 0, 0], [400, 0, 0], [400, 0, 300], [200, 0, 300]]),
    quad("room_3a", [[0, 0, 300], [100, 0, 300], [100, 0, 500], [0, 0, 500]]),     // border with room_1 split in two
    quad("room_3b", [[100, 0, 300], [200, 0, 300], [200, 0, 500], [100, 0, 500]]),
    quad("room_4", [[600, 0, 0], [800, 0, 0], [800, 0, 300.4], [600, 0, 300.4]]),  // room_5 overlaps room_4 by 4 mm
    quad("room_5", [[600, 0, 300], [800, 0, 300], [800, 0, 600], [600, 0, 600]]),  // room_6 stops 6 mm short of room_5
    quad("room_6", [[800.6, 0, 300], [1000, 0, 300], [1000, 0, 600], [800.6, 0, 600]]),
    quad("screen_1", [[50, 100, 1], [150, 100, 1], [150, 160, 1], [50, 160, 1]]),
    box("wall_e", 700, 125, 1000, 200, 250, 10), box("wall_f", 900, 125, 1000, 200, 250, 10), // end caps pressed together at x=800
    box("wall_g", 1005, 125, 1105, 10, 250, 200),                                           // perpendicular on wall_f's end
    pieces("wall_w", [[50, 125, 2000, 100, 250, 10], [150, 40, 2000, 100, 80, 10], [150, 225, 2000, 100, 50, 10], [250, 125, 2000, 100, 250, 10]]), // window x 100..200, y 80..200
  ];
  meshes.forEach((m) => scene.add(m)); scene.updateMatrixWorld(true);
  const classOf = (o) => (o.name.startsWith("wall") ? 1 : o.name.startsWith("room") ? 2 : 0);
  const out = buildEdges(meshes, { angle: 35, joints, classOf });
  const counts = {}; meshes.forEach((m) => (counts[m.name] = out.has(m) ? out.get(m).attributes.position.count / 2 : 0));
  const w = out.get(meshes.find((m) => m.name === "wall_w"));
  const segs = []; if (w) { const p = w.attributes.position; for (let i = 0; i < p.count; i += 2) segs.push([[p.getX(i), p.getY(i), p.getZ(i)], [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)]].map((q) => q.map((v) => Math.round(v * 10) / 10))); }
  return { counts, segs };
};
const plain = build(false), joints = build(true);
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };
const c = joints.counts, p = plain.counts;
check(["wall_a", "wall_b", "wall_c", "wall_d", "room_1", "room_2", "room_3a", "room_3b", "screen_1"].every((k) => p[k] === 4) && p.wall_e === 12 && p.wall_f === 12 && p.wall_g === 12, "joints off: every quad 4 edges, every box 12");
check(c.wall_a === 3 && c.wall_b === 3 && c.wall_c === 4 && c.wall_d === 5, "wall seam between open faces gone, corner kept (the room corner on wall_d cuts one edge in two)");
check(c.room_1 === 2 && c.room_2 === 3 && c.room_3a === 2 && c.room_3b === 2, "room borders gone, including a border split differently on each side");
check(c.room_4 === 3 && c.room_5 === 2 && c.room_6 === 3, "borders that overlap by 4 mm or stop 6 mm short gone too");
check(c.wall_e === 8 && c.wall_f === 8 && c.wall_g === 12, "closed segments: the 4 edges around the pressed-together end caps gone, the corner kept");
check(c.screen_1 === 4, "an object of neither class is left alone");
const vertical = (segs, x, lo, hi) => segs.some(([a, b]) => a[0] === x && b[0] === x && a[2] === b[2] && Math.min(a[1], b[1]) <= lo + 0.1 && Math.max(a[1], b[1]) >= hi - 0.1);
const seamPart = (segs, x, lo, hi) => segs.some(([a, b]) => a[0] === x && b[0] === x && a[2] === b[2] && Math.min(a[1], b[1]) >= lo - 0.1 && Math.max(a[1], b[1]) <= hi + 0.1 && Math.abs(a[1] - b[1]) > 0.5);
check(seamPart(plain.segs, 100, 0, 80) && seamPart(plain.segs, 100, 200, 250), "windowed wall, joints off: seams below the sill and above the lintel show");
check(!seamPart(joints.segs, 100, 0, 80) && !seamPart(joints.segs, 100, 200, 250) && !seamPart(joints.segs, 200, 0, 80) && !seamPart(joints.segs, 200, 200, 250), "windowed wall, joints on: those seams are gone");
check(vertical(joints.segs, 100, 80, 200) && vertical(joints.segs, 200, 80, 200), "windowed wall: jambs kept");
check(vertical(joints.segs, 0, 0, 250) && vertical(joints.segs, 300, 0, 250), "windowed wall: outer corners kept");
check(joints.segs.some(([a, b]) => a[1] === 80 && b[1] === 80 && a[2] === b[2] && Math.abs(a[0] - b[0]) > 50) && joints.segs.some(([a, b]) => a[1] === 200 && b[1] === 200 && a[2] === b[2] && Math.abs(a[0] - b[0]) > 50), "windowed wall: sill and lintel kept");
check(joints.segs.some(([a, b]) => a[0] === 100 && b[0] === 100 && a[1] === 80 && b[1] === 80 && a[2] !== b[2]), "windowed wall: reveal edges kept");
process.exit(failures ? 1 : 0);
