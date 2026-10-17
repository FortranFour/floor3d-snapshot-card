// Dev server: static files from the repo root plus a minimal stand-in for Home
// Assistant's image store (POST /api/image/upload, GET /api/image/serve/:id/original).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const images = new Map();
const MIME = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".glb": "model/gltf-binary", ".png": "image/png", ".jpg": "image/jpeg", ".css": "text/css" };
export function start(port = 0) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    if (req.method === "POST" && url === "/api/image/upload") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks), boundary = "--" + /boundary=(.+)$/.exec(req.headers["content-type"])[1];
        const start = body.indexOf("\r\n\r\n") + 4, end = body.lastIndexOf(Buffer.from("\r\n" + boundary));
        const head = body.slice(0, start).toString(), type = /Content-Type: (\S+)/i.exec(head)?.[1];
        if (!["image/png", "image/jpeg", "image/gif"].includes(type)) { res.writeHead(400); return res.end("Only jpeg, png, and gif images are allowed"); }
        const id = Math.random().toString(16).slice(2, 18);
        images.set(id, { type, data: body.slice(start, end) });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id, content_type: type, filesize: end - start }));
      });
      return;
    }
    const m = /^\/api\/image\/serve\/([^/]+)\/original$/.exec(url);
    if (m) { const img = images.get(m[1]); if (!img) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": img.type }); return res.end(img.data); }
    const file = path.join(root, url === "/" ? "dev/index.html" : url);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  server.images = images;
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) start(Number(process.argv[2] || 8123)).then((s) => console.log(`http://127.0.0.1:${s.address().port}/`));
