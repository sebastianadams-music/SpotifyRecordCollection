import { test } from "node:test";
import assert from "node:assert/strict";
import { HistoryAlbumLookup } from "../core.js";
const source = { name: "A Good Distance", artist: "North Parade" };
const result = {
  id: "matched",
  name: source.name,
  artists: [{ name: source.artist }],
  release_date: "2018",
};

test("history lookup sends only the selected album query and returns normalized editions", async () => {
  let updates = 0;
  const lookup = new HistoryAlbumLookup(
    async (path) => {
      const url = new URL(path, "https://api.spotify.com/v1/");
      assert.equal(
        url.searchParams.get("q"),
        'album:"A Good Distance" artist:"North Parade"',
      );
      assert.equal(url.searchParams.get("type"), "album");
      return { albums: { items: [result, null] } };
    },
    () => updates++,
  );
  await lookup.find(source);
  assert.equal(lookup.state.results.length, 1);
  assert.equal(lookup.state.results[0].artist, source.artist);
  assert.equal(lookup.state.results[0].year, "2018");
  assert.equal(lookup.state.loading, false);
  assert.equal(updates, 2);
});

test("a late result cannot replace a newer history search or reopen closed results", async () => {
  const pending = [];
  const lookup = new HistoryAlbumLookup(
    (_, { signal }) =>
      new Promise((resolve) => pending.push({ resolve, signal })),
  );
  const first = lookup.find(source);
  const second = lookup.find(source, "different edition");
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve({ albums: { items: [{ ...result, id: "new" }] } });
  await second;
  pending[0].resolve({ albums: { items: [{ ...result, id: "old" }] } });
  await first;
  assert.equal(lookup.state.results[0].id, "new");
  const third = lookup.find(source);
  lookup.clear();
  pending[2].resolve({ albums: { items: [result] } });
  await third;
  assert.equal(lookup.state, null);
});

test("history lookup allows retry after empty results or a failed request", async () => {
  let calls = 0;
  const lookup = new HistoryAlbumLookup(async () => {
    calls++;
    if (calls === 1) throw new Error("Spotify unavailable");
    return { albums: { items: [] } };
  });
  await lookup.find(source);
  assert.equal(lookup.state.message, "Spotify unavailable");
  assert.equal(lookup.state.loading, false);
  await lookup.find(source, "retry");
  assert.equal(lookup.state.results.length, 0);
  assert.match(lookup.state.message, /No albums found/);
  await lookup.find(source, "  ");
  assert.equal(calls, 2);
});
