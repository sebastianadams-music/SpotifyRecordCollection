import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
test("published asset URLs match the contents of every app file", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const script = await readFile(new URL("index.js", root), "utf8");
  for (const file of [
    "index.js",
    "index.css",
    "auth.js",
    "core.js",
    "sorting.js",
    "demo.js",
  ]) {
    const hash = createHash("sha256")
      .update(await readFile(new URL(file, root)))
      .digest("hex")
      .slice(0, 16);
    assert.ok(
      (file.startsWith("index.") ? html : script).includes(`${file}?v=${hash}`),
      `Stale version for ${file}; run npm run version-assets before publishing.`,
    );
  }
});
