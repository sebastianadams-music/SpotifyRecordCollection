export const COLLECTION_NAME = "My Spotify Record Collection";
const API_ROOT = "https://api.spotify.com/v1/";

export class SpotifyError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createApi(
  getToken,
  fetcher = fetch,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  let blockedUntil = 0;
  return async function request(path, { method = "GET", body, signal } = {}) {
    const url = new URL(path, API_ROOT);
    if (
      url.origin !== "https://api.spotify.com" ||
      !url.pathname.startsWith("/v1/")
    )
      throw new Error("Invalid Spotify API URL.");
    let refreshed = false,
      forceNext = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      signal?.throwIfAborted();
      const pause = blockedUntil - Date.now();
      if (pause > 30000)
        throw new SpotifyError(
          "Spotify is busy. Please try again in a little while.",
          429,
        );
      if (pause > 0) await wait(pause);
      const token = await getToken(forceNext);
      forceNext = false;
      const response = await fetcher(url.href, {
        method,
        redirect: "error",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000),
      });
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        forceNext = true;
        continue;
      }
      if (response.status === 429) {
        const seconds = Math.max(
          1,
          Number(response.headers.get("Retry-After")) || 3,
        );
        blockedUntil = Date.now() + seconds * 1000;
        if (attempt < 3) continue;
      }
      const data =
        response.status === 204
          ? null
          : await response.json().catch(() => null);
      if (!response.ok)
        throw new SpotifyError(
          data?.error?.message ||
            `Spotify request failed (${response.status}). Please try again.`,
          response.status,
        );
      return data;
    }
    throw new SpotifyError("Please reconnect to Spotify.", 401);
  };
}

export function normalizeAlbum(album, addedAt = "") {
  if (!album?.id || (album.type && album.type !== "album")) return null;
  const images = (album.images || [])
    .filter((image) => image.url)
    .sort((a, b) => (a.width || 0) - (b.width || 0));
  const cover = images.find((image) => image.width >= 240) || images.at(-1);
  return {
    id: album.id,
    name: album.name || "Untitled album",
    artist:
      (album.artists || [])
        .map((artist) => artist.name)
        .filter(Boolean)
        .join(", ") || "Unknown artist",
    artistIds: (album.artists || []).map((artist) => artist.id).filter(Boolean),
    image: cover?.url || "",
    year: (album.release_date || "").slice(0, 4),
    link: `https://open.spotify.com/album/${encodeURIComponent(album.id)}`,
    addedAt,
  };
}

export function readCache(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key));
    return value?.version === 1 &&
      Array.isArray(value.albums) &&
      Array.isArray(value.tracks)
      ? value
      : null;
  } catch {
    return null;
  }
}
export function saveCache(storage, key, value) {
  try {
    storage.setItem(
      key,
      JSON.stringify({ ...value, version: 1, savedAt: Date.now() }),
    );
    return true;
  } catch {
    return false;
  }
}

export class Collection {
  constructor(api, storage, userId) {
    this.api = api;
    this.storage = storage;
    this.userId = userId;
    this.key = `rc:collection:${userId}`;
    this.cache = readCache(storage, this.key);
    this.albums = this.cache?.albums || [];
    this.tracks = new Set(this.cache?.tracks || []);
    this.playlist = null;
    this.ready = false;
    this.busy = false;
  }
  async findPlaylist() {
    const remembered =
      this.cache?.playlistId ||
      (this.storage.getItem("loggedInSpotifyId") === this.userId
        ? this.storage.getItem("collectionId")
        : null);
    if (remembered) {
      try {
        const playlist = await this.api(
          `playlists/${encodeURIComponent(remembered)}?fields=id,owner(id),snapshot_id`,
        );
        if (playlist.owner?.id === this.userId) return playlist;
      } catch (error) {
        if (error.status !== 404) throw error;
      }
    }
    let url = "me/playlists?limit=50";
    while (url) {
      const page = await this.api(url);
      const match = page.items.find(
        (p) => p && p.name === COLLECTION_NAME && p.owner?.id === this.userId,
      );
      if (match) return match;
      url = page.next;
    }
    return this.api("me/playlists", {
      method: "POST",
      body: {
        name: COLLECTION_NAME,
        public: false,
        description:
          "Your album collection, managed by Spotify Record Collection.",
      },
    });
  }
  persist(snapshot = null) {
    this.cache = {
      playlistId: this.playlist.id,
      snapshot,
      albums: this.albums,
      tracks: [...this.tracks],
    };
    return saveCache(this.storage, this.key, this.cache);
  }
  async sync(onProgress = () => {}, force = false) {
    if (this.busy) return;
    this.busy = true;
    this.ready = false;
    try {
      this.playlist = await this.findPlaylist();
      if (
        !force &&
        this.cache?.playlistId === this.playlist.id &&
        this.cache.snapshot &&
        this.cache.snapshot === this.playlist.snapshot_id
      ) {
        this.ready = true;
        onProgress(this.albums, { done: true, cached: true });
        return;
      }
      const albums = new Map();
      const tracks = new Set();
      let count = 0;
      const fields =
        "items(added_at,is_local,item(type,is_local,uri,album(id,name,artists(id,name),images,release_date))),next,total";
      let url = `playlists/${encodeURIComponent(this.playlist.id)}/items?${new URLSearchParams({ limit: "50", fields })}`;
      while (url) {
        const page = await this.api(url);
        for (const entry of page.items || []) {
          const track = entry?.item ?? entry?.track;
          if (
            !track ||
            entry.is_local ||
            track.is_local ||
            track.type === "episode"
          )
            continue;
          const album = normalizeAlbum(track.album, entry.added_at);
          if (!album) continue;
          if (!albums.has(album.id)) albums.set(album.id, album);
          if (track.uri) tracks.add(track.uri);
        }
        count += page.items?.length || 0;
        onProgress([...albums.values()], {
          count,
          total: page.total,
          done: false,
        });
        url = page.next;
      }
      // Only mark a cache current if the playlist did not change during pagination.
      const latest = await this.api(
        `playlists/${encodeURIComponent(this.playlist.id)}?fields=snapshot_id`,
      );
      this.albums = [...albums.values()];
      this.tracks = tracks;
      const stable =
        latest.snapshot_id && latest.snapshot_id === this.playlist.snapshot_id;
      const saved = this.persist(stable ? latest.snapshot_id : null);
      this.ready = Boolean(stable);
      onProgress(this.albums, {
        done: true,
        saved,
        changedDuringSync: !stable,
      });
    } finally {
      this.busy = false;
    }
  }
  async add(album) {
    if (this.busy || !this.ready)
      throw new Error(
        "Wait for the collection to finish syncing before adding an album.",
      );
    this.busy = true;
    let wrote = false;
    try {
      const detail = await this.api(`albums/${encodeURIComponent(album.id)}`);
      let page = detail.tracks;
      const uris = [];
      while (page) {
        for (const track of page.items || [])
          if (track?.uri && track.type !== "episode") uris.push(track.uri);
        page = page.next ? await this.api(page.next) : null;
      }
      if (!uris.length)
        throw new Error("Spotify returned no tracks for this album.");
      const missing = [...new Set(uris)].filter((uri) => !this.tracks.has(uri));
      for (let i = 0; i < missing.length; i += 100) {
        const batch = missing.slice(i, i + 100);
        // No automatic network/5xx retries for writes: an uncertain response may already have saved tracks.
        await this.api(
          `playlists/${encodeURIComponent(this.playlist.id)}/items`,
          { method: "POST", body: { uris: batch } },
        );
        wrote = true;
        batch.forEach((uri) => this.tracks.add(uri));
      }
      if (!this.albums.some((a) => a.id === album.id))
        this.albums.push(normalizeAlbum(detail, new Date().toISOString()));
      this.persist(); // Revalidate on next visit; another client may have edited the playlist.
      return missing.length;
    } catch (error) {
      // A failed write may have reached Spotify. Require a fresh sync before any retry.
      this.ready = false;
      if (wrote) this.persist();
      if (this.cache) this.cache.snapshot = null;
      this.storage.removeItem(this.key);
      throw new Error(
        `${error.message} Refresh the collection before trying again.`,
      );
    } finally {
      this.busy = false;
    }
  }
}

export function shuffleAlbums(albums, random = Math.random) {
  const result = [...albums];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function filterAlbums(albums, query, sort = "artist", reversed = false) {
  const needle = query.trim().toLocaleLowerCase();
  const direction = reversed ? -1 : 1;
  return albums
    .filter((a) => `${a.name} ${a.artist}`.toLocaleLowerCase().includes(needle))
    .sort((a, b) => {
      let comparison = 0;
      if (sort === "color") {
        const ak = Number.isFinite(a.colorKey),
          bk = Number.isFinite(b.colorKey);
        if (!ak || !bk) return ak ? -1 : bk ? 1 : a.name.localeCompare(b.name);
        comparison = a.colorKey - b.colorKey;
      } else if (sort === "genre") {
        const ag = a.genres?.[0],
          bg = b.genres?.[0];
        if (!ag || !bg) return ag ? -1 : bg ? 1 : a.name.localeCompare(b.name);
        comparison = ag.localeCompare(bg) || a.artist.localeCompare(b.artist);
      } else if (sort === "random") comparison = a.randomOrder - b.randomOrder;
      else if (sort === "year" || sort === "added") {
        const key = sort === "year" ? "year" : "addedAt";
        if (!a[key] || !b[key])
          return a[key] ? -1 : b[key] ? 1 : a.name.localeCompare(b.name);
        comparison = b[key].localeCompare(a[key]);
      } else
        comparison =
          sort === "album"
            ? a.name.localeCompare(b.name)
            : a.artist.localeCompare(b.artist);
      return direction * (comparison || a.name.localeCompare(b.name));
    });
}

export function recentAlbums(items) {
  const albums = new Map();
  for (const entry of items) {
    const album = normalizeAlbum(entry.track?.album);
    if (!album) continue;
    const existing = albums.get(album.id);
    if (existing) existing.plays++;
    else
      albums.set(album.id, { ...album, plays: 1, lastPlayed: entry.played_at });
  }
  return [...albums.values()];
}

export function importHistory(rows, albums = new Map(), seen = new Set()) {
  if (!Array.isArray(rows))
    throw new Error("Choose Spotify’s Extended Streaming History JSON files.");
  for (const row of rows) {
    const name = row.master_metadata_album_album_name;
    const artist = row.master_metadata_album_artist_name;
    if (!name || !artist || !row.spotify_track_uri || !(row.ms_played > 0))
      continue;
    const eventKey = `${row.ts}|${row.spotify_track_uri}|${row.ms_played}`;
    if (seen.has(eventKey)) continue;
    seen.add(eventKey);
    const key = JSON.stringify([name, artist]);
    const album = albums.get(key) || {
      name,
      artist,
      plays: 0,
      milliseconds: 0,
      lastPlayed: "",
      tracks: new Set(),
    };
    album.plays++;
    album.milliseconds += row.ms_played;
    album.tracks.add(row.spotify_track_uri);
    if ((row.ts || "") > album.lastPlayed) album.lastPlayed = row.ts;
    albums.set(key, album);
  }
  return albums;
}
