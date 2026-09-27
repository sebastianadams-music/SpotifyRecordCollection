// Optional enrichment is requested only when its sort is selected.
export function dominantColor(pixels) {
  const bins = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
    const key = rgb.map((n) => n >> 5).join(",");
    const bin = bins.get(key) || { count: 0, sums: [0, 0, 0] };
    bin.count++;
    rgb.forEach((n, j) => (bin.sums[j] += n));
    bins.set(key, bin);
  }
  const bin = [...bins.values()].sort((a, b) => b.count - a.count)[0];
  if (!bin) return null;
  const rgb = bin.sums.map((n) => Math.round(n / bin.count));
  const [r, g, b] = rgb.map((n) => n / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min;
  const light = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1));
  let hue =
    delta === 0
      ? 0
      : max === r
        ? ((g - b) / delta) % 6
        : max === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  return {
    rgb,
    key: saturation < 0.12 ? 1000 + light * 100 : hue + light / 1000,
  };
}

export function sampleCover(url, signal) {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const finish = (value, error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      img.onload = img.onerror = null;
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => {
      img.src = "";
      finish(null, new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      img.src = "";
      finish(null);
    }, 12000);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 32;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, 32, 32);
        finish(dominantColor(ctx.getImageData(0, 0, 32, 32).data));
      } catch {
        finish(null);
      }
    };
    img.onerror = () => finish(null);
    img.src = url;
  });
}

export class SortMetadata {
  constructor(storage, userId, api, sample = sampleCover) {
    this.storage = storage;
    this.key = `rc:sorting:${userId}`;
    this.api = api;
    this.sample = sample;
    this.entries = {};
    this.artists = {};
    this.artistRequests = new Map();
    try {
      const cache = JSON.parse(storage.getItem(this.key));
      if (cache?.version === 1) {
        this.entries = cache.entries || {};
        this.artists = cache.artists || {};
      }
    } catch {}
  }
  save() {
    try {
      this.storage.setItem(
        this.key,
        JSON.stringify({
          version: 1,
          entries: this.entries,
          artists: this.artists,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
  decorate(album) {
    const meta = this.entries[album.id] || {};
    return {
      ...album,
      colorKey: meta.image === album.image ? meta.color?.key : undefined,
      genres: meta.manualGenres ?? meta.genres ?? album.genres ?? [],
    };
  }
  setGenres(id, text) {
    const entry = (this.entries[id] ||= {});
    if (text.trim())
      entry.manualGenres = [
        ...new Set(
          text
            .split(",")
            .map((s) => s.trim().toLocaleLowerCase())
            .filter(Boolean),
        ),
      ].sort();
    else delete entry.manualGenres;
    return this.save();
  }
  async artistGenres(id, signal) {
    const cached = this.artists[id];
    if (cached && Date.now() - cached.at < 30 * 86400000) return cached.genres;
    if (!this.artistRequests.has(id)) {
      const work = this.api(`artists/${encodeURIComponent(id)}`, { signal })
        .then((data) => {
          const genres = (data.genres || [])
            .filter((g) => typeof g === "string")
            .map((g) => g.toLocaleLowerCase());
          this.artists[id] = { genres, at: Date.now() };
          return genres;
        })
        .finally(() => this.artistRequests.delete(id));
      this.artistRequests.set(id, work);
    }
    return this.artistRequests.get(id);
  }
  async load(albums, sort, signal, progress = () => {}) {
    let cursor = 0,
      finished = 0,
      missing = 0,
      stopped = false;
    const worker = async () => {
      while (!stopped && cursor < albums.length) {
        signal.throwIfAborted();
        const album = albums[cursor++];
        const entry = (this.entries[album.id] ||= {});
        if (sort === "color") {
          if (entry.image !== album.image || !entry.color) {
            entry.color = await this.sample(album.image, signal);
            entry.image = album.image;
          }
          if (!entry.color) missing++;
        } else if (sort === "genre") {
          if (
            !entry.manualGenres &&
            (!entry.genresAt || Date.now() - entry.genresAt > 30 * 86400000)
          ) {
            let ids = album.artistIds || entry.artistIds;
            if (!ids) {
              const detail = await this.api(
                `albums/${encodeURIComponent(album.id)}`,
                { signal },
              );
              ids = (detail.artists || []).map((a) => a.id).filter(Boolean);
              entry.artistIds = ids;
            }
            const genres = [];
            for (const id of ids)
              genres.push(...(await this.artistGenres(id, signal)));
            entry.genres = [...new Set(genres)].sort();
            entry.genresAt = Date.now();
          }
          if (!this.decorate(album).genres.length) missing++;
        }
        signal.throwIfAborted();
        progress(++finished, albums.length);
      }
    };
    try {
      const results = await Promise.allSettled(
        Array.from({ length: sort === "color" ? 3 : 2 }, () =>
          worker().catch((error) => {
            stopped = true;
            throw error;
          }),
        ),
      );
      const failure = results.find((result) => result.status === "rejected");
      if (failure) throw failure.reason;
    } finally {
      this.save();
    }
    return missing;
  }
}
