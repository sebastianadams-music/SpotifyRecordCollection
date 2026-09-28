const CLIENT_ID = "751a32e96e9446828c23c0e1c0e4a660";
const REDIRECT_URI = new URL("./", location.href).href;
const BASE_SCOPES =
  "playlist-modify-public playlist-modify-private playlist-read-private playlist-read-collaborative";
const KEYS = [
  "access_token",
  "refresh_token",
  "expires_at",
  "scope",
  "loggedInSpotifyId",
  "collectionId",
];
let refreshPromise;

function randomString() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export async function login(withHistory = false) {
  const verifier = randomString();
  const state = randomString();
  sessionStorage.setItem("rc:verifier", verifier);
  sessionStorage.setItem("rc:state", state);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const scope =
    BASE_SCOPES +
    (withHistory || hasHistoryPermission() ? " user-read-recently-played" : "");
  location.assign(
    "https://accounts.spotify.com/authorize?" +
      new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope,
        state,
        code_challenge_method: "S256",
        code_challenge: challenge,
      }),
  );
}

async function tokenRequest(params) {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...params }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok) {
    if (data.error === "invalid_grant")
      KEYS.slice(0, 4).forEach((key) => localStorage.removeItem(key));
    throw new Error(data.error_description || "Please reconnect to Spotify.");
  }
  localStorage.setItem("access_token", data.access_token);
  // Spotify does not always rotate the refresh token.
  if (data.refresh_token)
    localStorage.setItem("refresh_token", data.refresh_token);
  if (data.scope !== undefined) localStorage.setItem("scope", data.scope);
  localStorage.setItem("expires_at", Date.now() + data.expires_in * 1000);
  return data.access_token;
}

export async function finishLogin() {
  const args = new URLSearchParams(location.search);
  if (!args.has("code") && !args.has("error")) return;
  history.replaceState({}, "", location.pathname);
  const state = sessionStorage.getItem("rc:state");
  const verifier = sessionStorage.getItem("rc:verifier");
  sessionStorage.removeItem("rc:state");
  sessionStorage.removeItem("rc:verifier");
  if (!state || args.get("state") !== state || !verifier)
    throw new Error("Sign-in expired. Please connect again.");
  if (args.has("error")) throw new Error("Spotify connection was cancelled.");
  await tokenRequest({
    grant_type: "authorization_code",
    code: args.get("code"),
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
}

export function hasSession() {
  return Boolean(localStorage.getItem("refresh_token"));
}
export function hasHistoryPermission() {
  return (localStorage.getItem("scope") || "")
    .split(" ")
    .includes("user-read-recently-played");
}
export async function getToken(force = false) {
  if (
    !force &&
    localStorage.getItem("access_token") &&
    Number(localStorage.getItem("expires_at")) > Date.now() + 60000
  )
    return localStorage.getItem("access_token");
  if (!hasSession()) throw new Error("Please connect to Spotify.");
  if (!refreshPromise)
    refreshPromise = tokenRequest({
      grant_type: "refresh_token",
      refresh_token: localStorage.getItem("refresh_token"),
    }).finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}
export function logout() {
  KEYS.forEach((key) => localStorage.removeItem(key));
  Object.keys(localStorage)
    .filter((key) => key.startsWith("rc:"))
    .forEach((key) => localStorage.removeItem(key));
  sessionStorage.removeItem("rc:state");
  sessionStorage.removeItem("rc:verifier");
  location.assign(location.pathname);
}
