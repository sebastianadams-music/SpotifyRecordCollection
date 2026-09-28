import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const digest = async (file) =>
  createHash("sha256")
    .update(await readFile(new URL(file, root)))
    .digest("hex")
    .slice(0, 16);

// Version dependencies first, then the entry module containing those URLs.
let script = await readFile(new URL("index.js", root), "utf8");
for (const file of ["auth.js", "core.js", "sorting.js", "demo.js"]) {
  const hash = await digest(file);
  const escaped = file.replaceAll(".", "\\.");
  script = script.replace(
    new RegExp(`(["'])\\./${escaped}(?:\\?v=[a-f0-9]+)?\\1`, "g"),
    `"./${file}?v=${hash}"`,
  );
}
await writeFile(new URL("index.js", root), script);

let html = await readFile(new URL("index.html", root), "utf8");
for (const file of ["index.js", "index.css"]) {
  const hash = await digest(file);
  const escaped = file.replaceAll(".", "\\.");
  html = html.replace(
    new RegExp(`((?:src|href)=")${escaped}(?:\\?v=[a-f0-9]+)?"`, "g"),
    `$1${file}?v=${hash}"`,
  );
}
await writeFile(new URL("index.html", root), html);
console.log("Updated asset versions.");
