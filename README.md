# Spotify Record Collection

A personal album shelf backed by the **My Spotify Record Collection** playlist. Browse covers, a CD shelf with cover-inspired spine colours, or a compact list. Hover or focus for album and artist details; click for a larger cover and **Listen here**.

Live site: https://sebastianadams-music.github.io/SpotifyRecordCollection/

## Run locally

Requires Node.js 20.11 or later. No dependencies or build step.

```sh
npm start
```

Open http://127.0.0.1:5500/ or http://127.0.0.1:5500/?demo=1 for a fictional collection that needs no Spotify login. For authenticated local testing, register **http://127.0.0.1:5500/** as an exact redirect URI in the existing Spotify developer app. Production keeps its existing GitHub Pages redirect URI. The app derives the callback from its current directory; use the directory URL, ending in `/`.

```sh
npm test
```

Deploy the static files directly to GitHub Pages. `index.html` imports the source modules, so there is no generated bundle to become out of sync. `server.js`, tests and demo data need no server infrastructure in production.

## Collection and loading

- Retains the original playlist and its tracks. No migration of Spotify data is needed.
- Shows the last complete local collection after identifying the signed-in account, then checks its playlist snapshot. An unchanged collection needs no track-page downloads.
- Reuses the remembered playlist ID. Discovery only runs when necessary, stops at the first owned matching playlist, and awaits private-playlist creation.
- First/changed loads request 50 playlist items per page and display albums progressively. The app uses the current `/playlists/{id}/items` and `/me/playlists` routes, and accepts both `item` and older `track` response shapes.
- Smaller covers, lazy loading and asynchronous image decoding keep artwork from blocking the interface. The shelf samples cover colours locally and uses a fallback tint if canvas access is unavailable; the cover thumbnail itself remains intact.
- Search within the collection; sort by artist, album, year or recently added; pick a random album from the current filter. The selected view is remembered.
- Album additions load every album-track page, skip track URIs already present and write in batches of at most 100. The local shelf updates without downloading the whole collection again. Existing albums have disabled add buttons.
- Writes are not retried after uncertain network failures. If a write fails, refresh the collection before retrying. If a partial album is already present, open its details after refreshing and use **Check for missing tracks** to finish it without duplicating tracks.
- Manual Refresh forces a full reconciliation. A cache is only marked current if the playlist snapshot is unchanged throughout pagination. Offline/failed refreshes preserve the last complete disk cache.
- Cache data is scoped to the Spotify account. Logout removes this app's tokens and caches, not unrelated local storage. Storage quota failure does not stop an otherwise successful load.

## Listening history

**Recent listening** requests the additional `user-read-recently-played` permission when first used. It groups up to 50 recent track plays into albums and can hide albums already on your shelf. This is not an all-time album history, nor evidence of listening to an entire album.

For older listening, request **Extended Streaming History** from https://www.spotify.com/account/privacy/. Unzip the download and select its audio JSON files together. The app aggregates album/artist, listening time and distinct tracks, deduplicates overlapping files, and ignores podcasts. Import is local to the page: no upload, persistence, analytics or automatic catalogue lookups. Clear imported history or reload to remove it. Choose **Find this album** to send that album/artist search to Spotify and select the correct edition yourself. The name-based already-collected filter may not match every remaster or compilation. Individual files are limited to 150 MB; very large exports may take time to parse.

Spotify explains the export contents at https://support.spotify.com/am/article/understanding-your-data/.

## Playback

**Listen here** opens Spotify's official album embed in a persistent player dock. Browse, search and change collection views while it stays open. Closing the player removes the iframe and stops that embedded player. Nothing autoplays on page load, and no playback permissions are requested.

Spotify determines the playback available through embeds, including sign-in, account and browser restrictions. This implementation does not promise full-album streaming for every listener. A fully custom Spotify Connect player would require the Web Playback SDK and Spotify Premium. See https://developer.spotify.com/documentation/embeds and https://developer.spotify.com/documentation/web-playback-sdk/.

## Authentication and verification

PKCE uses cryptographic randomness and validates OAuth state. Tokens are refreshed automatically and concurrently triggered refreshes share one request. Refresh tokens are retained when Spotify does not rotate them. Tokens are never rendered or logged. Profile, album and error text use DOM text nodes. Spotify rate-limit responses respect `Retry-After`; long cooldowns ask the user to return later. Requests time out after 30 seconds.

`npm test` covers progressive pagination, unchanged snapshots, first-playlist creation, missing/denied playlists, failed sync, snapshot changes, long-album batching, uncertain writes, image selection, history deduplication, rate limits and OAuth lifecycle. Browser checks use fictional albums and mocked Spotify responses; authenticated live Spotify playback and account-specific API access still require a real account check.
