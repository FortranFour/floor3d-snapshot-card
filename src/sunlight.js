// Sunlight layer for the card: relights the static picture in 2D from the baked
// lighting image (camera depth + surface direction). No 3D runs on the device.
import { NORMALS } from "./sun.js";

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const idle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Decode the lighting image (baked at half the snapshot's resolution). */
export function decodeLight(url, meta) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error("lighting image failed to load"));
    image.onload = () => {
      const w = image.naturalWidth, h = image.naturalHeight;
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(image, 0, 0);
      const px = cx.getImageData(0, 0, w, h).data;
      const depth = new Float32Array(w * h).fill(NaN), dir = new Uint8Array(w * h).fill(255);
      const [near, far] = meta.depth, scale = (far - near) / 65535;
      for (let i = 0, p = 0; i < w * h; i++, p += 4) if (px[p + 2] !== 255) { depth[i] = near + (px[p] * 256 + px[p + 1]) * scale; dir[i] = px[p + 2]; }
      resolve({ w, h, depth, dir, meta, px: meta.pixel[0], py: meta.pixel[1] });
    };
    image.src = url;
  });
}

/**
 * Direct sunlight per pixel (0–1): surface facing × visibility. Visibility is a
 * screen-space shadow march toward the sun over the depth image, done in slices so
 * a slow tablet stays responsive. Returns null if `isStale()` turns true midway.
 */
export async function shade(L, sun, { shadows = true, isStale = () => false } = {}) {
  const { w, h, depth, dir, meta, px, py } = L;
  const out = new Float32Array(w * h);
  const ax = dot(sun, meta.right) / px, ay = -dot(sun, meta.up) / py, ad = dot(sun, meta.forward);
  const len = Math.hypot(ax, ay);
  const march = shadows && len > 0.02 && sun[1] > 0;
  const ux = ax / len, uy = ay / len, dt = 1 / len;                 // model units per pixel along the ray
  const [near, far] = meta.depth;
  const bias = Math.max(px, py) * 2.5 + (far - near) / 65535 * 3;
  const thick = Math.max(px * 30, (far - near) * 0.05);
  const maxPix = Math.min(420, (Math.max(w * px, h * py) * 0.45) / dt);
  let t0 = performance.now();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, k = dir[i];
      if (k === 255) continue;
      const ndl = NORMALS[k * 3] * sun[0] + NORMALS[k * 3 + 1] * sun[1] + NORMALS[k * 3 + 2] * sun[2];
      if (ndl <= 0) continue;
      let lit = 1;
      if (march) {
        const d0 = depth[i];
        for (let p = 1; p <= maxPix; p += p < 8 ? 1 : p < 32 ? 2 : p < 96 ? 4 : 8) {
          const sx = Math.round(x + ux * p), sy = Math.round(y + uy * p);
          if (sx < 0 || sy < 0 || sx >= w || sy >= h) break;
          const sd = depth[sy * w + sx];
          if (sd !== sd) continue;                                     // empty pixel
          const behind = d0 + ad * p * dt - sd;
          if (behind > bias && behind < thick) { lit = 0; break; }
        }
      }
      out[i] = ndl * lit;
      if ((x & 31) === 31 && performance.now() - t0 > 12) { await idle(); if (isStale()) return null; t0 = performance.now(); }
    }
  }
  // Soften shadow edges a little (3×3 over surface pixels only).
  if (march) {
    const soft = new Float32Array(out.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x; if (dir[i] === 255) continue;
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
          const j = Y * w + X; if (dir[j] !== dir[i]) continue;
          s += out[j]; n++;
        }
        soft[i] = s / n;
      }
      if (performance.now() - t0 > 12) { await idle(); if (isStale()) return null; t0 = performance.now(); }
    }
    return soft;
  }
  return out;
}

// Daylight colors, multiplied over the picture (1 = as rendered).
// Shade is close to neutral by day; low sun is warm; night is a muted blue, never black.
const DAY = [0.74, 0.76, 0.82], TWILIGHT = [0.78, 0.7, 0.7], DUSK = [0.6, 0.58, 0.68], NIGHT = [0.46, 0.49, 0.6];
const SUN_LOW = [1, 0.86, 0.68], SUN_HIGH = [1, 0.99, 0.96], LAMP = [1, 0.9, 0.7];

/** Sky phase at a sun elevation: shade color, sun color, how much sun, how much lamp. */
export function phase(el) {
  const ambient = el >= 10 ? DAY : el >= 0 ? mix(TWILIGHT, DAY, smooth(0, 10, el)) : el >= -6 ? mix(DUSK, TWILIGHT, smooth(-6, 0, el)) : mix(NIGHT, DUSK, smooth(-12, -6, el));
  return { ambient, sun: mix(SUN_LOW, SUN_HIGH, smooth(1, 24, el)), day: smooth(-2, 3, el), lamp: 1 - smooth(-7, 3, el) };
}

/** Paint the multiply layer. lit: Uint8Array per half pixel (1 = a room with lights on). */
export function compose(ctx, L, direct, el, { strength = 0.6, lit = null } = {}) {
  const { w, h, dir } = L;
  const img = ctx.createImageData(w, h), d = img.data;
  const { ambient: A, sun: S, day, lamp } = phase(el);
  const s = Math.min(1, Math.max(0, strength));
  for (let i = 0; i < w * h; i++) {
    if (dir[i] === 255) continue;
    const t = direct ? direct[i] * day : 0;
    let r = A[0] + (S[0] - A[0]) * t, g = A[1] + (S[1] - A[1]) * t, b = A[2] + (S[2] - A[2]) * t;
    if (lit && lit[i] && lamp > 0) { const k = lamp * 0.9; r += (LAMP[0] - r) * k; g += (LAMP[1] - g) * k; b += (LAMP[2] - b) * k; }
    const o = i * 4;
    d[o] = 255 * (1 - s * (1 - r)); d[o + 1] = 255 * (1 - s * (1 - g)); d[o + 2] = 255 * (1 - s * (1 - b)); d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** Minutes until the next update: brisk around dawn and dusk, lazy at night. */
export const nextUpdateMinutes = (el) => (el > -10 && el < 12 ? 4 : el < -18 ? 30 : 10);
