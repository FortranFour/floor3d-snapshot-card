// Edge lines for the snapshot: creases and outlines of each mesh, without the joints an exported
// model has where it was built from pieces. Ported from floor3dx-card's look.ts (1.7.3).
//
// A Sweet Home 3D wall with a window is exported as overlapping closed pieces, often inside one
// mesh: full-height pieces either side, a piece under the sill, one over the lintel. The end face of
// a full-height piece is buried under the sill, exposed up the jamb and buried again above the
// lintel, on one and the same edge; two straight segments of one wall meet end face to end face;
// two rooms' floors meet along a border no wall stands on. None of those is an outline.
//
// buildEdges(meshes, options) returns, per mesh, the line geometry (in the mesh's frame) or null.
//   angle    degrees: a crease is drawn where two faces meet at more than this
//   joints   true: drop the joints described above (between the pieces of one mesh and between
//            meshes of the same class)
//   classOf  mesh -> 1 wall, 2 floor, 0 other; joints are looked for between walls and between floors
import * as THREE from "three";

export function buildEdges(meshes, { angle = 35, joints = true, classOf = () => 0 } = {}) {
  const thresholdDot = Math.cos(THREE.MathUtils.degToRad(angle));
  const items = [];
  const scene = new THREE.Box3();
  meshes.forEach((mesh) => {
    const geometry = mesh.geometry;
    if (!geometry?.attributes?.position) return;
    const edges = creaseEdges(geometry, angle);
    if (!edges) return;
    mesh.updateWorldMatrix(true, false);
    const box = geometry.boundingBox || (geometry.computeBoundingBox(), geometry.boundingBox);
    scene.union(box.clone().applyMatrix4(mesh.matrixWorld));
    items.push({ mesh, cls: classOf(mesh), edges });
  });
  const result = new Map();
  const candidate = (cls) => joints && (cls === 1 || cls === 2);
  const pairs = (a, b) => a === b && candidate(a);
  const extent = scene.getSize(new THREE.Vector3());
  const span = Math.max(extent.x, extent.y, extent.z) || 1;
  const along = span / 800; // loose along a surface: rooms drawn by hand overlap or stop short by millimetres
  const across = span / 8000; // tight across it: a parallel face a little behind is not a continuation
  const probe = span / 4000; // how far to either side of an edge the surface is sampled
  const cell = span / 40;
  const grid = new Map();
  const vertexGrid = new Map();
  const cellKey = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const bucketsIn = (map, bb, add) => {
    for (let x = Math.floor(bb.min.x / cell); x <= Math.floor(bb.max.x / cell); x++)
      for (let y = Math.floor(bb.min.y / cell); y <= Math.floor(bb.max.y / cell); y++)
        for (let z = Math.floor(bb.min.z / cell); z <= Math.floor(bb.max.z / cell); z++) {
          const k = `${x},${y},${z}`;
          let bucket = map.get(k);
          if (!bucket) map.set(k, (bucket = []));
          add(bucket);
        }
  };
  if (joints) {
    items.forEach((item, m) => {
      if (!candidate(item.cls)) return;
      const geometry = item.mesh.geometry;
      const pos = geometry.attributes.position;
      const index = geometry.index;
      const count = index ? index.count / 3 : pos.count / 3;
      const bb = new THREE.Box3();
      const seen = new Set();
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(item.mesh.matrixWorld);
        const k = `${Math.round(v.x / across)},${Math.round(v.y / across)},${Math.round(v.z / across)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        bb.min.copy(v).subScalar(along);
        bb.max.copy(v).addScalar(along);
        bucketsIn(vertexGrid, bb, (bucket) => bucket.push(v));
      }
      for (let t = 0; t < count; t++) {
        const i0 = index ? index.getX(t * 3) : t * 3, i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1, i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
        const tri = new THREE.Triangle(
          new THREE.Vector3().fromBufferAttribute(pos, i0).applyMatrix4(item.mesh.matrixWorld),
          new THREE.Vector3().fromBufferAttribute(pos, i1).applyMatrix4(item.mesh.matrixWorld),
          new THREE.Vector3().fromBufferAttribute(pos, i2).applyMatrix4(item.mesh.matrixWorld),
        );
        const n = tri.getNormal(new THREE.Vector3());
        if (n.lengthSq() < 0.5) continue;
        const entry = { tri, n, mesh: m };
        bb.setFromPoints([tri.a, tri.b, tri.c]).expandByScalar(along);
        bucketsIn(grid, bb, (bucket) => bucket.push(entry));
      }
    });
  }
  const wp = new THREE.Vector3(), closest = new THREE.Vector3(), nm = new THREE.Matrix3();
  const wa = new THREE.Vector3(), wb = new THREE.Vector3(), dir = new THREE.Vector3(), lateral = new THREE.Vector3();
  const side = [new THREE.Vector3(), new THREE.Vector3()];
  const foot = new THREE.Vector3(), delta = new THREE.Vector3();
  const near = (v, w) => v.distanceToSquared(w) <= across * across;
  // The coplanar surface at p (normal n) on the probe's side of the edge (`away` points from the edge
  // to the probe). own: a face of this edge (same mesh, holding both its ends). other: some other
  // coplanar surface within reach along the plane. buried: more coplanar faces cover the point than
  // one surface has, or a face of another mesh does: a face of another piece is pressed against ours.
  const surfaceAt = (p, n, away, item, m) => {
    const r = { own: false, other: false, buried: false };
    const bucket = grid.get(cellKey(p.x, p.y, p.z));
    if (!bucket) return r;
    let covering = 0;
    const expected = item.edges.doubleSided ? 2 : 1;
    for (const t of bucket) {
      if (t.mesh !== m && !pairs(item.cls, items[t.mesh].cls)) continue;
      if (Math.abs(t.n.dot(n)) < 0.999) continue;
      t.tri.closestPointToPoint(p, closest);
      delta.copy(closest).sub(p);
      const off = Math.abs(delta.dot(t.n));
      if (off > across) continue;
      const inPlane = delta.lengthSq() - off * off;
      if (inPlane > along * along) continue;
      if (delta.copy(closest).sub(wp).dot(away) <= across) continue;
      const covers = inPlane <= across * across;
      const holdsEdge = t.mesh === m && (near(t.tri.a, wa) || near(t.tri.b, wa) || near(t.tri.c, wa)) && (near(t.tri.a, wb) || near(t.tri.b, wb) || near(t.tri.c, wb));
      if (holdsEdge) {
        r.own = true;
        if (covers) covering++;
      } else {
        r.other = true;
        if (covers) r.buried = true;
      }
    }
    if (covering > expected) r.buried = true;
    return r;
  };
  items.forEach((item, m) => {
    const out = [];
    const merge = candidate(item.cls);
    if (merge) nm.getNormalMatrix(item.mesh.matrixWorld);
    item.edges.edges.forEach((edge) => {
      if (!merge) {
        out.push(edge.a.x, edge.a.y, edge.a.z, edge.b.x, edge.b.y, edge.b.z);
        return;
      }
      wa.copy(edge.a).applyMatrix4(item.mesh.matrixWorld);
      wb.copy(edge.b).applyMatrix4(item.mesh.matrixWorld);
      dir.copy(wb).sub(wa);
      const length = dir.length();
      if (length <= across) return;
      dir.divideScalar(length);
      const normals = edge.planes.map((pl) => pl.clone().applyMatrix3(nm).normalize());
      // cut where other vertices lie on the edge (T-junctions)
      const cuts = [0, length];
      const bb = new THREE.Box3().setFromPoints([wa, wb]);
      const seenCuts = new Set();
      for (let x = Math.floor(bb.min.x / cell); x <= Math.floor(bb.max.x / cell); x++)
        for (let y = Math.floor(bb.min.y / cell); y <= Math.floor(bb.max.y / cell); y++)
          for (let z = Math.floor(bb.min.z / cell); z <= Math.floor(bb.max.z / cell); z++) {
            const bucket = vertexGrid.get(`${x},${y},${z}`);
            if (!bucket) continue;
            bucket.forEach((v) => {
              delta.copy(v).sub(wa);
              const t = delta.dot(dir);
              if (t <= probe || t >= length - probe) return;
              foot.copy(wa).addScaledVector(dir, t);
              if (foot.distanceToSquared(v) > across * across) return;
              const key = Math.round(t / across);
              if (seenCuts.has(key)) return;
              seenCuts.add(key);
              cuts.push(t);
            });
          }
      cuts.sort((p, q) => p - q);
      for (let i = 1; i < cuts.length; i++) {
        const t0 = cuts[i - 1], t1 = cuts[i];
        if (t1 - t0 <= across) continue;
        wp.copy(wa).addScaledVector(dir, (t0 + t1) / 2);
        const reach = Math.min(probe, (t1 - t0) / 4);
        const exposed = [];
        let continues = false;
        normals.forEach((n) => {
          lateral.crossVectors(dir, n).normalize();
          side[0].copy(wp).addScaledVector(lateral, reach);
          side[1].copy(wp).addScaledVector(lateral, -reach);
          const s0 = surfaceAt(side[0], n, lateral, item, m);
          lateral.negate();
          const s1 = surfaceAt(side[1], n, lateral, item, m);
          const faceSide = s0.own ? s0 : s1.own ? s1 : null;
          const farSide = faceSide === s0 ? s1 : s0;
          if (!faceSide || faceSide.buried) return;
          exposed.push(n);
          if (farSide.own || farSide.other) continues = true;
        });
        let draw;
        if (exposed.length >= 2) draw = creaseBetween(exposed, thresholdDot);
        else if (exposed.length === 1) draw = !continues;
        else draw = false;
        if (!draw) continue;
        const a = edge.a.clone().lerp(edge.b, t0 / length), b = edge.a.clone().lerp(edge.b, t1 / length);
        out.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    });
    if (!out.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
    result.set(item.mesh, g);
  });
  return result;
}

// Edges of one mesh that may get a line, in the mesh's frame: an open edge (one plane) or a crease
// (two or more distinct planes meeting at more than the angle). Faces around an edge are compared
// with an unsigned dot product, so the flipped copies of a double-sided export count as coplanar and
// flat quads show no diagonal; the edge of a face and of its back copy is an open edge.
function creaseEdges(geometry, angle) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  if (triCount === 0 || triCount > 200000) return null;
  const thresholdDot = Math.cos(THREE.MathUtils.degToRad(angle));
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const q = Math.max(size.x, size.y, size.z) / 4000 || 1e-4;
  const keyOf = (i) => `${Math.round(pos.getX(i) / q)},${Math.round(pos.getY(i) / q)},${Math.round(pos.getZ(i) / q)}`;
  const vertexId = new Map();
  const ids = new Int32Array(pos.count);
  const first = [];
  for (let i = 0; i < pos.count; i++) {
    const k = keyOf(i);
    let id = vertexId.get(k);
    if (id === undefined) {
      id = first.length;
      vertexId.set(k, id);
      first.push(i);
    }
    ids[i] = id;
  }
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const normals = [], tris = [];
  const edges = new Map();
  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3, i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1, i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    const v = [ids[i0], ids[i1], ids[i2]];
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    n.copy(b).sub(a).cross(c.clone().sub(a));
    if (n.lengthSq() < 1e-12) continue;
    normals.push(n.clone().normalize());
    tris.push(v);
    const f = normals.length - 1;
    for (let e = 0; e < 3; e++) {
      const p = v[e], r = v[(e + 1) % 3];
      const key = p < r ? `${p}_${r}` : `${r}_${p}`;
      let entry = edges.get(key);
      if (!entry) edges.set(key, (entry = { a: p, b: r, faces: [] }));
      entry.faces.push(f);
    }
  }
  const out = [];
  let flipped = 0;
  edges.forEach((edge) => {
    const faces = edge.faces;
    const ia = first[edge.a], ib = first[edge.b];
    const planes = [];
    faces.forEach((f) => {
      const nf = normals[f];
      if (!planes.some((p) => Math.abs(p.dot(nf)) > 0.9999)) planes.push(nf);
    });
    const pair = faces.length === 2 && isFlippedPair(tris[faces[0]], tris[faces[1]]);
    if (pair) flipped += 2 / 3;
    const open = faces.length === 1 || pair;
    if (!open && planes.length < 2) return;
    if (!open && !creaseBetween(planes, thresholdDot)) return;
    out.push({ a: new THREE.Vector3().fromBufferAttribute(pos, ia), b: new THREE.Vector3().fromBufferAttribute(pos, ib), planes });
  });
  if (!out.length) return null;
  return { edges: out, doubleSided: flipped * 2 > tris.length };
}

function creaseBetween(normals, thresholdDot) {
  for (let i = 0; i < normals.length; i++)
    for (let j = i + 1; j < normals.length; j++) if (Math.abs(normals[i].dot(normals[j])) <= thresholdDot) return true;
  return false;
}

function isFlippedPair(a, b) {
  return a.includes(b[0]) && a.includes(b[1]) && a.includes(b[2]);
}
