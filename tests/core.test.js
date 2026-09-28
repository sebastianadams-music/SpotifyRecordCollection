import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Collection,
  createApi,
  normalizeAlbum,
  filterAlbums,
  importHistory,
  recentAlbums,
  saveCache,
} from "../core.js";
const storage = () => {
  const data = new Map();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
};
const raw = (id) => ({
  id,
  type: "album",
  name: `Album ${id}`,
  artists: [{ name: "Artist" }],
  images: [
    { width: 640, url: "large" },
    { width: 300, url: "medium" },
    { width: 64, url: "small" },
  ],
  release_date: "2001-01-01",
});
const entry = (id, track = id) => ({
  added_at: "2026-01-01",
  item: { uri: `spotify:track:${track}`, type: "track", album: raw(id) },
});
const playlist = {
  id: "p",
  name: "My Spotify Record Collection",
  owner: { id: "u" },
  snapshot_id: "s",
};
function cached(store) {
  saveCache(store, "rc:collection:u", {
    playlistId: "p",
    snapshot: "s",
    albums: [normalizeAlbum(raw("a"))],
    tracks: ["spotify:track:a"],
  });
}

test("renders the first page before the last page; deduplicates albums and skips missing/local/episode items", async () => {
  let finishLast;
  const last = new Promise((resolve) => (finishLast = resolve));
  const events = [];
  const c = new Collection(
    async (path) => {
      if (path === "me/playlists?limit=50") return { items: [playlist] };
      if (path.includes("/items"))
        return {
          items: [
            entry("a"),
            entry("a", "a2"),
            { item: null },
            { item: { type: "episode" } },
            { ...entry("local"), is_local: true },
          ],
          total: 6,
          next: "last",
        };
      if (path === "last") return last;
      return { snapshot_id: "s" };
    },
    storage(),
    "u",
  );
  const work = c.sync((albums, progress) => events.push({ albums, progress }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.length, 1);
  assert.equal(events[0].albums.length, 1);
  assert.equal(c.ready, false);
  finishLast({ items: [entry("b")], next: null });
  await work;
  assert.equal(c.albums.length, 2);
  assert.equal(c.tracks.size, 3);
  assert.equal(c.ready, true);
});

test("an unchanged cached collection requires one metadata call and no playlist scans or track downloads", async () => {
  const store = storage();
  cached(store);
  const calls = [];
  const c = new Collection(
    async (path) => {
      calls.push(path);
      return playlist;
    },
    store,
    "u",
  );
  assert.equal(c.albums.length, 1);
  await c.sync();
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^playlists\/p\?fields=/);
});

test("creates and awaits a private playlist before reading it", async () => {
  const calls = [];
  const c = new Collection(
    async (path, options) => {
      calls.push([path, options]);
      if (path === "me/playlists?limit=50") return { items: [], next: null };
      if (path === "me/playlists") {
        assert.equal(options.body.public, false);
        return playlist;
      }
      if (path.includes("/items")) return { items: [], next: null };
      return { snapshot_id: "s" };
    },
    storage(),
    "u",
  );
  await c.sync();
  assert.equal(calls[1][0], "me/playlists");
  assert.match(calls[2][0], /^playlists\/p\/items/);
});

test("recovers a missing remembered playlist but does not create a duplicate on permission failures", async () => {
  const store = storage();
  cached(store);
  const calls = [];
  const c = new Collection(
    async (path) => {
      calls.push(path);
      if (calls.length === 1)
        throw Object.assign(new Error("missing"), { status: 404 });
      return { items: [playlist] };
    },
    store,
    "u",
  );
  assert.equal((await c.findPlaylist()).id, "p");
  assert.equal(calls.length, 2);
  const denied = new Collection(
    async () => {
      throw Object.assign(new Error("denied"), { status: 403 });
    },
    store,
    "u",
  );
  await assert.rejects(() => denied.findPlaylist(), /denied/);
});

test("failed pagination does not overwrite the last complete cache or permit additions", async () => {
  const store = storage();
  cached(store);
  const previous = store.getItem("rc:collection:u");
  const c = new Collection(
    async (path) => {
      if (path.includes("/items")) throw new Error("offline");
      return { ...playlist, snapshot_id: "new" };
    },
    store,
    "u",
  );
  await assert.rejects(() => c.sync(), /offline/);
  assert.equal(store.getItem("rc:collection:u"), previous);
  assert.equal(c.ready, false);
});

test("cache is not marked current if the playlist changes during pagination", async () => {
  const store = storage();
  cached(store);
  const c = new Collection(
    async (path) =>
      path.includes("/items")
        ? { items: [entry("b")] }
        : path.includes("owner")
          ? { ...playlist, snapshot_id: "new" }
          : { snapshot_id: "newer" },
    store,
    "u",
  );
  await c.sync();
  assert.equal(JSON.parse(store.getItem("rc:collection:u")).snapshot, null);
});

test("all album pages are added in batches of 100, existing tracks are skipped, and collection is not refetched", async () => {
  const writes = [],
    paths = [];
  const c = new Collection(
    async (path, options) => {
      paths.push(path);
      if (path === "albums/b")
        return {
          ...raw("b"),
          tracks: {
            items: Array.from({ length: 50 }, (_, i) => ({
              uri: `spotify:track:${i}`,
            })),
            next: "next",
          },
        };
      if (path === "next")
        return {
          items: Array.from({ length: 56 }, (_, i) => ({
            uri: `spotify:track:${i + 50}`,
          })),
        };
      if (options?.method === "POST") {
        writes.push(options.body.uris);
        return { snapshot_id: "x" };
      }
      throw new Error(`Unexpected call ${path}`);
    },
    storage(),
    "u",
  );
  c.playlist = playlist;
  c.ready = true;
  c.tracks.add("spotify:track:0");
  assert.equal(await c.add(normalizeAlbum(raw("b"))), 105);
  assert.deepEqual(
    writes.map((a) => a.length),
    [100, 5],
  );
  assert.equal(c.albums.length, 1);
  assert.equal(paths.filter((p) => p.includes("/items?")).length, 0);
  assert.equal(await c.add(normalizeAlbum(raw("b"))), 0);
  assert.equal(writes.length, 2);
});

test("an uncertain write disables retry until sync and invalidates stored cache", async () => {
  const store = storage();
  cached(store);
  const c = new Collection(
    async (path, options) => {
      if (options) throw new Error("connection lost");
      return { ...raw("b"), tracks: { items: [{ uri: "spotify:track:b" }] } };
    },
    store,
    "u",
  );
  c.playlist = playlist;
  c.ready = true;
  await assert.rejects(
    () => c.add(normalizeAlbum(raw("b"))),
    /Refresh the collection/,
  );
  assert.equal(c.ready, false);
  assert.equal(store.getItem("rc:collection:u"), null);
});

test("normalization uses a thumbnail, handles absent artwork, and filtering covers artists", () => {
  assert.equal(normalizeAlbum(raw("a")).image, "medium");
  assert.equal(normalizeAlbum({ id: "b" }).image, "");
  assert.equal(normalizeAlbum(null), null);
  assert.equal(filterAlbums([normalizeAlbum(raw("a"))], "ARTIST").length, 1);
});

test("history groups album plays, deduplicates overlapping files, ignores podcasts, and preserves listening duration", () => {
  const rows = [
    {
      ts: "2026-01-01",
      spotify_track_uri: "spotify:track:a",
      master_metadata_album_album_name: "An album",
      master_metadata_album_artist_name: "Someone",
      ms_played: 60000,
    },
    { ts: "2026-01-01", episode_name: "Podcast", ms_played: 10000 },
  ];
  const map = new Map(),
    seen = new Set();
  importHistory(rows, map, seen);
  importHistory(rows, map, seen);
  assert.equal(map.size, 1);
  assert.equal([...map.values()][0].milliseconds, 60000);
  assert.equal([...map.values()][0].plays, 1);
  assert.equal(
    recentAlbums([
      { track: { album: raw("a") } },
      { track: { album: raw("a") } },
      { track: null },
    ])[0].plays,
    2,
  );
  assert.throws(() => importHistory({}), /Extended Streaming History/);
});

test("API refreshes expired access, obeys Retry-After, restricts origins, and does not retry uncertain writes", async () => {
  const forced = [];
  let calls = 0;
  const api = createApi(
    async (force) => {
      forced.push(force);
      return "token";
    },
    async () =>
      ++calls === 1
        ? new Response("{}", { status: 401 })
        : new Response('{"ok":true}', { status: 200 }),
  );
  assert.deepEqual(await api("me"), { ok: true });
  assert.deepEqual(forced, [false, true]);
  await assert.rejects(() => api("https://example.com/steal"), /Invalid/);
  let writes = 0;
  const writeApi = createApi(
    async () => "",
    async () => {
      writes++;
      throw new Error("offline");
    },
  );
  await assert.rejects(
    () => writeApi("me/playlists", { method: "POST", body: {} }),
    /offline/,
  );
  assert.equal(writes, 1);
  const waits = [];
  let retries = 0;
  const limited = createApi(
    async () => "",
    async () =>
      ++retries === 1
        ? new Response("{}", { status: 429, headers: { "Retry-After": "1" } })
        : new Response("{}"),
    async (ms) => waits.push(ms),
  );
  await limited("me");
  assert.equal(waits.length, 1);
  assert.ok(waits[0] > 0 && waits[0] <= 1000);
});
