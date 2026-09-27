import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
const root = import.meta.dirname;
const allowed = new Set([
  "index.html",
  "index.css",
  "index.js",
  "auth.js",
  "core.js",
  "demo.js",
]);
const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
};
createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://127.0.0.1").pathname;
  const file = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!allowed.has(file)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  try {
    const body = await readFile(resolve(root, file));
    res.writeHead(200, {
      "Content-Type": types[extname(file)],
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(5500, "127.0.0.1", () =>
  console.log("Record Collection: http://127.0.0.1:5500"),
);
