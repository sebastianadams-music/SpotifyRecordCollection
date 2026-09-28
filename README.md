# Spotimy Record Collection

A personal album shelf with a dusty record-shop design, backed by the **My Spotify Record Collection** playlist. Browse covers in Record Shop view, a CD shelf with cover-inspired spine colours, or a compact list. Hover or focus for album and artist details; click for a larger cover and **Listen here**.

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
- Search within the collection; sort by artist, album, dominant colour, year, genre, recently added or random; pick a random album from the current filter. The selected view is remembered.
- Album additions load every album-track page, skip track URIs already present and write in batches of at most 100. The local shelf updates without downloading the whole collection again. Existing albums have disabled add buttons.
- Writes are not retried after uncertain network failures. If a write fails, refresh the collection before retrying. If a partial album is already present, open its details after refreshing and use **Check for missing tracks** to finish it without duplicating tracks.
- Manual Refresh forces a full reconciliation. A cache is only marked current if the playlist snapshot is unchanged throughout pagination. Offline/failed refreshes preserve the last complete disk cache.
- Cache data is scoped to the Spotify account. Logout removes this app's tokens and caches, not unrelated local storage. Storage quota failure does not stop an otherwise successful load.

## Listening history

**Recent listening** requests the additional `user-read-recently-played` permission when first used. It groups up to 50 recent track plays into albums and can hide albums already on your shelf. This is not an all-time album history, nor evidence of listening to an entire album.

For older listening, request **Extended Streaming History** from https://www.spotify.com/account/privacy/. Unzip the download and select its audio JSON files together. The app aggregates album/artist, listening time and distinct tracks, deduplicates overlapping files, and ignores podcasts. Import is local to the page: no upload, persistence, analytics or automatic catalogue lookups. Clear imported history or reload to remove it. Choose **Find album** to search Spotify inside the history card, inspect matching covers and editions, and add the correct album without leaving Listening history. You can edit the search or close the results. Only the selected album/artist query is sent to Spotify. The name-based already-collected filter may not match every remaster or compilation. Individual files are limited to 150 MB; very large exports may take time to parse.

Spotify explains the export contents at https://support.spotify.com/am/article/understanding-your-data/.

## Playback

**Listen here** opens Spotify's official album embed in a persistent player dock. Browse, search and change collection views while it stays open. Closing the player removes the iframe and stops that embedded player. Nothing autoplays on page load, and no playback permissions are requested.

Spotify determines the playback available through embeds, including sign-in, account and browser restrictions. This implementation does not promise full-album streaming for every listener. A fully custom Spotify Connect player would require the Web Playback SDK and Spotify Premium. See https://developer.spotify.com/documentation/embeds and https://developer.spotify.com/documentation/web-playback-sdk/.

## Authentication and verification

PKCE uses cryptographic randomness and validates OAuth state. Tokens are refreshed automatically and concurrently triggered refreshes share one request. Refresh tokens are retained when Spotify does not rotate them. Tokens are never rendered or logged. Profile, album and error text use DOM text nodes. Spotify rate-limit responses respect `Retry-After`; long cooldowns ask the user to return later. Requests time out after 30 seconds.

`npm test` covers progressive pagination, unchanged snapshots, first-playlist creation, missing/denied playlists, failed sync, snapshot changes, long-album batching, uncertain writes, image selection, history deduplication, rate limits and OAuth lifecycle. Browser checks use fictional albums and mocked Spotify responses; authenticated live Spotify playback and account-specific API access still require a real account check.

## Optional sorting data

Dominant-colour sorting samples a small version of each cover locally, groups similar pixel colours, and orders the largest colour group by hue. Greys follow the spectrum; unreadable or missing covers go last. This work happens only when that sort is selected, runs with at most three concurrent image loads, and is cached per account and image URL.

Genre sorting uses Spotify artist genres, which may be absent or deprecated for an account and may not describe each album accurately. It sorts by the first genre alphabetically, followed by artist and album. Artist lookups are shared across albums and cached for 30 days, with at most two enrichment jobs running together. Older collection caches retrieve artist IDs only when needed. Open album details to enter comma-separated genre labels; these local overrides take precedence. Blank overrides restore Spotify labels. Albums with no genre appear last. Neither enrichment path delays the normal initial collection load, and switching sort cancels unfinished enrichment.

UK Albums Chart peak sorting is deferred until an appropriate chart-data source is available; Spotify popularity is not substituted for chart position.

All sorts support reversal, with missing metadata kept last. Random uses a Fisher–Yates shuffle that stays fixed while filtering or switching views; **Shuffle again** generates a new order.

## Security

The page restricts scripts to this site's own files and API requests to Spotify's API and account endpoints through a Content Security Policy. API and token requests reject redirects. A no-referrer policy keeps callback URLs out of outgoing referrer headers. Album links are constructed from IDs rather than trusting cached URLs. Album names, artist names, imported history and errors are rendered as text; imported JSON is never executed or uploaded.

This is a browser-only app: access and refresh tokens are stored in localStorage to keep sign-in across visits. Any script running on the same origin could read them, including scripts in other projects hosted under the same GitHub Pages domain. PKCE and the Content Security Policy reduce risks but do not isolate localStorage between URL paths. A dedicated hosting origin would isolate this app from other projects; keeping refresh tokens inaccessible to JavaScript would require a backend with secure HttpOnly cookies. Log out on shared devices to remove tokens and cached collection data. The Spotify client ID is public configuration, not a client secret.

The local preview binds only to 127.0.0.1 and serves an explicit list of app files. There are no third-party JavaScript packages or runtime dependencies. This source review and regression testing are not a penetration test or a guarantee that no vulnerabilities exist.

## Publishing changes

Run `npm run version-assets` after editing app files and before committing to main. This updates the entry script, its module imports and stylesheet to content-based URLs so GitHub Pages/browser caches cannot mix an old authentication module with a new entry script. Commit these URL updates with the source changes. GitHub Pages publishes from main; previously cached HTML can take up to ten minutes to expire, or can be refreshed explicitly.
