import { test } from "node:test";
import assert from "node:assert/strict";
const storage = () => {
  const data = new Map();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
};
function setup(t) {
  const original = {
    fetch: globalThis.fetch,
    location: globalThis.location,
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
    history: globalThis.history,
  };
  globalThis.location = {
    href: "https://example.com/SpotifyRecordCollection/",
    search: "",
    pathname: "/SpotifyRecordCollection/",
  };
  globalThis.localStorage = storage();
  globalThis.sessionStorage = storage();
  globalThis.history = { replaceState: () => {} };
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
}
test("concurrent expired-token requests share a refresh and preserve an unrotated refresh token", async (t) => {
  setup(t);
  localStorage.setItem("refresh_token", "old-refresh");
  localStorage.setItem("expires_at", "1");
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(
      JSON.stringify({ access_token: "new", expires_in: 3600 }),
    );
  };
  const { getToken } = await import("../auth.js?refresh");
  assert.deepEqual(await Promise.all([getToken(), getToken()]), ["new", "new"]);
  assert.equal(calls, 1);
  assert.equal(localStorage.getItem("refresh_token"), "old-refresh");
  assert.equal(await getToken(), "new");
  assert.equal(calls, 1);
});
test("OAuth rejects mismatched state without exchanging a code", async (t) => {
  setup(t);
  location.search = "?code=untrusted&state=wrong";
  sessionStorage.setItem("rc:state", "expected");
  sessionStorage.setItem("rc:verifier", "verifier");
  globalThis.fetch = () => {
    throw new Error("Should not fetch");
  };
  const { finishLogin } = await import("../auth.js?state");
  await assert.rejects(() => finishLogin(), /Sign-in expired/);
});
test("successful OAuth preserves the GitHub Pages path and stores granted scopes", async (t) => {
  setup(t);
  location.search = "?code=valid&state=expected";
  sessionStorage.setItem("rc:state", "expected");
  sessionStorage.setItem("rc:verifier", "verifier");
  let replaced;
  history.replaceState = (_, __, url) => (replaced = url);
  globalThis.fetch = async (_, options) => {
    assert.equal(options.redirect, "error");
    assert.equal(
      options.body.get("redirect_uri"),
      "https://example.com/SpotifyRecordCollection/",
    );
    return new Response(
      JSON.stringify({
        access_token: "access",
        refresh_token: "refresh",
        scope: "user-read-recently-played",
        expires_in: 3600,
      }),
    );
  };
  const { finishLogin, hasHistoryPermission } = await import(
    "../auth.js?callback"
  );
  await finishLogin();
  assert.equal(replaced, "/SpotifyRecordCollection/");
  assert.equal(hasHistoryPermission(), true);
});
