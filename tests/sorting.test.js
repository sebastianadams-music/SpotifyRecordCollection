import { test } from "node:test";
import assert from "node:assert/strict";
import { dominantColor, SortMetadata } from "../sorting.js";
import { filterAlbums } from "../core.js";
const store = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k), setItem: (k, v) => data.set(k, v) };
};
const signal = () => new AbortController().signal;
const album = (id, extra = {}) => ({
  id,
  name: id,
  artist: "Artist",
  image: id,
  ...extra,
});

test("dominant colour selects the largest colour group rather than averaging the whole cover", () => {
  const color = dominantColor(
    new Uint8Array([255, 0, 0, 255, 250, 3, 0, 255, 0, 0, 255, 255]),
  );
  assert.ok(color.rgb[0] > 250);
  assert.ok(color.rgb[2] < 5);
  assert.equal(dominantColor(new Uint8Array([0, 0, 0, 0])), null);
});
test("colour sorting orders hues, then greys, and puts unknowns last", () => {
  const entries = [
    album("unknown"),
    album("blue", { colorKey: 240 }),
    album("red", { colorKey: 0 }),
    album("grey", { colorKey: 1050 }),
  ];
  assert.deepEqual(
    filterAlbums(entries, "", "color").map((a) => a.id),
    ["red", "blue", "grey", "unknown"],
  );
});
test("genre sorting is alphabetical with unknown genres last and manual overrides retained", () => {
  const entries = [
    album("unknown"),
    album("rock", { genres: ["rock"] }),
    album("jazz", { genres: ["jazz"] }),
  ];
  assert.deepEqual(
    filterAlbums(entries, "", "genre").map((a) => a.id),
    ["jazz", "rock", "unknown"],
  );
  const storage = store(),
    meta = new SortMetadata(storage, "user", () => {});
  meta.setGenres("a", "Jazz, jazz, Ambient");
  assert.deepEqual(
    new SortMetadata(storage, "user", () => {}).decorate(album("a")).genres,
    ["ambient", "jazz"],
  );
  meta.setGenres("a", "");
  assert.deepEqual(meta.decorate(album("a")).genres, []);
});
test("optional colour sampling is lazy, cached, and invalidated when artwork changes", async () => {
  let reads = 0;
  const storage = store();
  const meta = new SortMetadata(
    storage,
    "u",
    () => {
      throw Error("No API expected");
    },
    async () => {
      reads++;
      return { rgb: [255, 0, 0], key: 0 };
    },
  );
  assert.equal(reads, 0);
  await meta.load([album("a")], "color", signal());
  await meta.load([album("a")], "color", signal());
  assert.equal(reads, 1);
  const restored = new SortMetadata(
    storage,
    "u",
    () => {},
    async () => {
      reads++;
      return { key: 1 };
    },
  );
  await restored.load([album("a")], "color", signal());
  assert.equal(reads, 1);
  await restored.load([album("a", { image: "new" })], "color", signal());
  assert.equal(reads, 2);
});
test("artist requests are shared, genre metadata is cached, and old albums recover artist IDs", async () => {
  const calls = [];
  const meta = new SortMetadata(store(), "u", async (path) => {
    calls.push(path);
    return path.startsWith("albums/")
      ? { artists: [{ id: "artist" }] }
      : { genres: ["jazz"] };
  });
  await meta.load(
    [album("a"), album("b", { artistIds: ["artist"] })],
    "genre",
    signal(),
  );
  assert.equal(calls.filter((p) => p === "artists/artist").length, 1);
  assert.deepEqual(meta.decorate(album("a")).genres, ["jazz"]);
  await meta.load([album("a")], "genre", signal());
  assert.equal(calls.length, 2);
});
test("cancelled enrichment makes no requests and failed genre lookup does not cache an empty success", async () => {
  let calls = 0;
  const meta = new SortMetadata(store(), "u", async () => {
    calls++;
    throw Error("rate limited");
  });
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(() => meta.load([album("a")], "genre", aborted.signal), {
    name: "AbortError",
  });
  assert.equal(calls, 0);
  await assert.rejects(
    () => meta.load([album("a", { artistIds: ["artist"] })], "genre", signal()),
    /rate limited/,
  );
  assert.equal(meta.entries.a.genresAt, undefined);
});

test("reversing sorts reverses known values but leaves missing metadata last", () => {
  const entries = [
    album("unknown"),
    album("older", { year: "1990", colorKey: 10, genres: ["jazz"] }),
    album("newer", { year: "2000", colorKey: 20, genres: ["rock"] }),
  ];
  assert.deepEqual(
    filterAlbums(entries, "", "year", true).map((a) => a.id),
    ["older", "newer", "unknown"],
  );
  assert.deepEqual(
    filterAlbums(entries, "", "color", true).map((a) => a.id),
    ["newer", "older", "unknown"],
  );
  assert.deepEqual(
    filterAlbums(entries, "", "genre", true).map((a) => a.id),
    ["newer", "older", "unknown"],
  );
  assert.deepEqual(
    filterAlbums([album("A"), album("Z")], "", "album", true).map((a) => a.id),
    ["Z", "A"],
  );
});
test("random order is stable through filtering and is reversible", async () => {
  const { shuffleAlbums } = await import("../core.js");
  const original = [album("A"), album("B"), album("C")];
  const shuffled = shuffleAlbums(original, () => 0);
  assert.deepEqual(
    original.map((a) => a.id),
    ["A", "B", "C"],
  );
  assert.deepEqual(
    shuffled.map((a) => a.id),
    ["B", "C", "A"],
  );
  const ranked = shuffled.map((a, i) => ({ ...a, randomOrder: i }));
  assert.deepEqual(
    filterAlbums(ranked, "", "random").map((a) => a.id),
    ["B", "C", "A"],
  );
  assert.deepEqual(
    filterAlbums(ranked, "", "random", true).map((a) => a.id),
    ["A", "C", "B"],
  );
  assert.deepEqual(
    filterAlbums(ranked, "B", "random").map((a) => a.id),
    ["B"],
  );
});
