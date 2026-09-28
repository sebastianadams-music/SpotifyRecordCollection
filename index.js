import { SortMetadata } from "./sorting.js?v=296a610999c0f274";
import {
  login,
  logout,
  finishLogin,
  hasSession,
  hasHistoryPermission,
  getToken,
} from "./auth.js?v=a1b5b32582c5fd1e";
import {
  Collection,
  HistoryAlbumLookup,
  createApi,
  normalizeAlbum,
  filterAlbums,
  shuffleAlbums,
  recentAlbums,
  importHistory,
} from "./core.js?v=f7c1fb9b31d33d0a";

const $ = (id) => document.getElementById(id);
const demo = new URLSearchParams(location.search).has("demo");
const api = createApi(getToken);
let collection,
  albums = [],
  searchResults = [],
  listening = [],
  imported = false,
  historyLimit = 40;
let view = localStorage.getItem("rc:view") || "grid";
if (!["grid", "shelf", "list"].includes(view)) view = "grid";
let searchTimer,
  searchController,
  searchVersion = 0,
  adding = false;
const historyLookup = new HistoryAlbumLookup((path, options) => {
  if (!collection || demo)
    throw new Error("Connect Spotify to find and add this album.");
  return api(path, options);
}, renderHistory);
const colors = new Map();
let sortMetadata = new SortMetadata(localStorage, "demo", api);
let sortController;
let reversed = false;
let randomRanks = new Map();
function reshuffle() {
  randomRanks = new Map(
    shuffleAlbums(albums).map((album, index) => [album.id, index]),
  );
}
let sortWork = Promise.resolve();
function sortedAlbums() {
  for (const album of albums)
    if (!randomRanks.has(album.id)) randomRanks.set(album.id, randomRanks.size);
  return filterAlbums(
    albums.map((a) => ({
      ...sortMetadata.decorate(a),
      randomOrder: randomRanks.get(a.id),
    })),
    $("filter").value,
    $("sort").value,
    reversed,
  );
}
async function applySort() {
  sortController?.abort();
  const controller = new AbortController();
  sortController = controller;
  const sort = $("sort").value;
  $("shuffle").hidden = sort !== "random";
  renderCollection();
  $("sort-status").hidden = !["color", "genre"].includes(sort);
  if (!["color", "genre"].includes(sort)) return;
  // Finish cancellation before starting another job sharing the artist cache.
  await sortWork.catch(() => {});
  if (controller.signal.aborted) return;
  $("sort-status").textContent =
    sort === "color"
      ? "Reading cover colours…"
      : "Loading artist genres from Spotify…";
  if (demo && sort === "genre") {
    $("sort-status").textContent =
      "Demo genres. Real albums use Spotify’s artist genres where available.";
    return;
  }
  sortWork = sortMetadata.load(
    [...albums],
    sort,
    controller.signal,
    (count, total) => {
      if (!controller.signal.aborted)
        $("sort-status").textContent =
          `${sort === "color" ? "Reading cover colours" : "Loading genres"}… ${count}/${total}`;
    },
  );
  try {
    const missing = await sortWork;
    if (controller.signal.aborted) return;
    $("sort-status").textContent =
      sort === "color"
        ? missing
          ? `${missing} covers could not be read and appear last.`
          : ""
        : `Uses the first genre alphabetically from Spotify’s artist labels; these may not describe every album.${missing ? ` ${missing} albums have no genre and appear last.` : ""} Edit genres in album details.`;
    $("sort-status").hidden = !$("sort-status").textContent;
    renderCollection();
  } catch (error) {
    if (!controller.signal.aborted) {
      controller.abort();
      $("sort-status").textContent =
        `Could not finish this sort: ${error.message} Available results are shown; select this sort again to retry.`;
      renderCollection();
    }
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function notice(message, error = false) {
  $("notice").textContent = message;
  $("notice").classList.toggle("error", error);
  $("notice").hidden = !message;
}
function fail(error) {
  notice(error.message || "Something went wrong. Please try again.", true);
}
function panel(name) {
  for (const tab of document.querySelectorAll("[data-panel]")) {
    if (tab.dataset.panel === name) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
    $(`${tab.dataset.panel}-panel`).hidden = tab.dataset.panel !== name;
  }
}
function image(album, className = "cover") {
  if (!album.image) {
    const placeholder = el("span", `${className} cover-placeholder`, "◎");
    placeholder.setAttribute("aria-label", "No cover available");
    return placeholder;
  }
  const img = el("img", className);
  img.alt = `${album.name} cover`;
  img.loading = "lazy";
  img.decoding = "async";
  img.width = 300;
  img.height = 300;
  // A single small canvas samples an already-needed cover, only in shelf view.
  if (view === "shelf" && !demo) img.crossOrigin = "anonymous";
  img.src = album.image;
  img.addEventListener("error", () => {
    // Artwork still works if a provider stops allowing canvas access.
    if (img.crossOrigin) {
      img.removeAttribute("crossorigin");
      img.src = album.image;
    } else img.replaceWith(el("span", `${className} cover-placeholder`, "◎"));
  });
  return img;
}
function fallbackColor(album) {
  let hash = 0;
  for (const char of album.id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 22% 32%)`;
}
function tintSpine(img, card, album) {
  card.style.setProperty(
    "--spine",
    colors.get(album.image) || fallbackColor(album),
  );
  if (!(img instanceof HTMLImageElement) || colors.has(album.image)) return;
  const sample = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 8;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(img, 0, 0, 8, 8);
      const pixels = context.getImageData(0, 0, 8, 8).data;
      let r = 0,
        g = 0,
        b = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        r += pixels[i];
        g += pixels[i + 1];
        b += pixels[i + 2];
      }
      // Keep the decorative spine dark enough for its white title.
      const scale = Math.min(1, 90 / Math.max(r / 64, g / 64, b / 64, 1));
      const color = `rgb(${Math.round((r / 64) * scale)} ${Math.round((g / 64) * scale)} ${Math.round((b / 64) * scale)})`;
      colors.set(album.image, color);
      card.style.setProperty("--spine", color);
    } catch {
      /* The intact thumbnail and deterministic tint remain available. */
    }
  };
  if (img.complete && img.naturalWidth) sample();
  else img.addEventListener("load", sample, { once: true });
}
function openSpotify(album, text = "Open in Spotify ↗") {
  const link = el("a", "open-link", text);
  link.href = `https://open.spotify.com/album/${encodeURIComponent(album.id)}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}
function showAlbum(album) {
  const content = $("album-details");
  content.replaceChildren(
    image(album, "dialog-cover"),
    el("h2", "", album.name),
    el("p", "", `${album.artist}${album.year ? ` · ${album.year}` : ""}`),
  );
  if (!demo) {
    const listen = el("button", "dark listen-button", "▶ Listen here");
    listen.onclick = () => {
      playAlbum(album);
      $("album-dialog").close();
    };
    content.append(listen, openSpotify(album));
    if (known(album) && collection?.ready && !collection.busy) {
      const repair = el("button", "repair-button", "Check for missing tracks");
      repair.onclick = () => {
        $("album-dialog").close();
        addAlbum(album, true);
      };
      content.append(repair);
    }
  } else
    content.append(
      el(
        "p",
        "",
        "Demo album · connect Spotify to browse and play your own collection.",
      ),
    );
  const genreForm = el("form", "album-metadata");
  const genreLabel = el("label", "", "Genres (comma-separated)");
  const genreInput = el("input");
  genreInput.type = "text";
  genreInput.value = sortMetadata.decorate(album).genres.join(", ");
  genreLabel.append(genreInput);
  const save = el("button", "", "Save genres");
  save.type = "submit";
  const help = el(
    "p",
    "",
    "Saved on this device. Leave blank to use Spotify’s artist genres.",
  );
  genreForm.append(genreLabel, save, help);
  genreForm.onsubmit = (event) => {
    event.preventDefault();
    const saved = sortMetadata.setGenres(album.id, genreInput.value);
    help.textContent = saved
      ? "Genres saved on this device."
      : "Genres updated for this visit; browser storage is unavailable.";
    renderCollection();
  };
  content.append(genreForm);
  $("album-dialog").showModal();
}
function playAlbum(album) {
  const player = $("player");
  $("player-title").textContent = `${album.name} — ${album.artist}`;
  const frame = document.createElement("iframe");
  frame.title = `Spotify player: ${album.name} by ${album.artist}`;
  frame.src = `https://open.spotify.com/embed/album/${encodeURIComponent(album.id)}?utm_source=generator&theme=0`;
  frame.allow =
    "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
  frame.setAttribute("allowfullscreen", "");
  frame.height = "152";
  frame.width = "100%";
  $("player-frame").replaceChildren(frame);
  player.hidden = false;
  document.body.classList.add("with-player");
}
function albumCard(album) {
  const card = el("article", "album");
  const button = el("button", "album-open");
  button.setAttribute(
    "aria-label",
    `${album.name} by ${album.artist}. Album details and playback.`,
  );
  button.onclick = () => showAlbum(album);
  const wrap = el("span", "cover-wrap");
  const img = image(album);
  wrap.append(img);
  const info = el("span", "album-info");
  info.append(
    el("span", "album-title", album.name),
    el("span", "album-artist", album.artist),
  );
  const hover = el("span", "album-hover");
  hover.setAttribute("aria-hidden", "true");
  hover.append(el("strong", "", album.name), el("span", "", album.artist));
  if (view === "shelf") hover.prepend(image(album, "hover-cover"));
  const positionHover = () => {
    const rect = button.getBoundingClientRect();
    hover.style.left = `${Math.min(0, innerWidth - rect.left - Math.min(260, innerWidth - 32) - 16)}px`;
  };
  button.addEventListener("pointerenter", positionHover);
  button.addEventListener("focus", positionHover);
  button.append(wrap, info, hover);
  card.append(button);
  if (!demo) card.append(openSpotify(album));
  if (view === "shelf") tintSpine(img, card, album);
  return card;
}
function renderCollection() {
  const optionLabels = {
    artist: reversed ? "Artist Z–A" : "Artist A–Z",
    album: reversed ? "Album Z–A" : "Album A–Z",
    genre: reversed ? "Genre Z–A" : "Genre A–Z",
    year: reversed ? "Year · oldest first" : "Year · newest first",
    added: reversed ? "Earliest added" : "Recently added",
  };
  for (const [value, label] of Object.entries(optionLabels))
    $("sort").querySelector(`option[value="${value}"]`).textContent = label;
  const filtered = sortedAlbums();
  $("album-count").textContent = albums.length.toLocaleString();
  $("result-count").textContent = albums.length
    ? `${filtered.length} of ${albums.length} albums`
    : "";
  $("random").disabled = !filtered.length;
  $("collection").className = `collection ${view}`;
  document
    .querySelectorAll("[data-view]")
    .forEach((button) =>
      button.setAttribute("aria-pressed", String(button.dataset.view === view)),
    );
  const fragment = document.createDocumentFragment();
  if (view === "shelf") {
    const group = el("section", "shelf-group");
    const row = el("div", "shelf-row");
    const labels = {
      artist: reversed ? "ARTISTS · Z—A" : "ARTISTS · A—Z",
      album: reversed ? "ALBUMS · Z—A" : "ALBUMS · A—Z",
      year: reversed
        ? "RELEASE YEAR · OLDEST FIRST"
        : "RELEASE YEAR · NEWEST FIRST",
      color: "DOMINANT COLOUR",
      genre: reversed ? "GENRE · Z—A" : "GENRE · A—Z",
      added: reversed ? "EARLIEST ADDITIONS" : "RECENT ADDITIONS",
      random: "RANDOM ORDER",
    };
    group.append(el("h3", "", labels[$("sort").value]), row);
    filtered.forEach((album) => row.append(albumCard(album)));
    fragment.append(group);
  } else filtered.forEach((album) => fragment.append(albumCard(album)));
  $("collection").replaceChildren(fragment);
  $("empty").hidden = filtered.length > 0;
  if (!filtered.length) {
    $("empty").querySelector("h2").textContent = albums.length
      ? "No albums found."
      : collection?.busy
        ? "Loading albums…"
        : "No albums loaded.";
    $("empty").querySelector("p").textContent = albums.length
      ? "Try another album title or artist."
      : collection
        ? "Use Find albums to add an album to your collection."
        : "Connect Spotify to load your existing Record Collection playlist.";
    $("empty-action").textContent =
      collection || demo ? "Find albums" : "Connect Spotify";
    $("empty").querySelector(".demo-link").hidden = Boolean(collection || demo);
  }
}
async function sync(force = false) {
  if (!collection || collection.busy) return;
  $("refresh").disabled = true;
  $("sync-status").textContent = albums.length
    ? "Showing your saved collection · checking Spotify…"
    : "Finding your Record Collection playlist…";
  try {
    const work = collection.sync((loaded, progress) => {
      albums = loaded;
      renderCollection();
      $("sync-status").textContent = progress.done
        ? progress.saved === false
          ? "Collection loaded · this browser could not save a local copy."
          : progress.changedDuringSync
            ? "Collection loaded · playlist changed while loading; refresh to check updates."
            : "Your collection is up to date."
        : `${loaded.length} albums found · ${progress.count} of ${progress.total ?? "…"} tracks checked`;
    }, force);
    renderSearch();
    renderHistory();
    await work;
    notice("");
    if (["color", "genre"].includes($("sort").value)) applySort();
  } catch (error) {
    $("sync-status").textContent = albums.length
      ? "Showing available albums · refresh to finish syncing."
      : "Could not load your collection. Use Refresh to try again.";
    fail(error);
  } finally {
    $("refresh").disabled = false;
    renderSearch();
    renderHistory();
  }
}
function known(album) {
  return albums.some((a) =>
    album.id
      ? a.id === album.id
      : a.name.toLocaleLowerCase() === album.name.toLocaleLowerCase() &&
        a.artist.toLocaleLowerCase() === album.artist.toLocaleLowerCase(),
  );
}
function discoveryCard(album, history = false) {
  const card = el("article", "discovery-card");
  if (album.id) {
    const artButton = el("button", "art-button");
    artButton.setAttribute(
      "aria-label",
      `Details and playback for ${album.name}`,
    );
    artButton.append(image(album));
    artButton.onclick = () => showAlbum(album);
    card.append(artButton);
  }
  card.append(
    el("span", "album-title", album.name),
    el("span", "album-artist", album.artist),
  );
  if (history)
    card.append(
      el(
        "p",
        "history-meta",
        imported
          ? `${album.tracks.size} different tracks · ${Math.round(album.milliseconds / 60000).toLocaleString()} min listened`
          : `${album.plays} recent track ${album.plays === 1 ? "play" : "plays"}`,
      ),
    );
  const collected = known(album);
  const add = el(
    "button",
    "",
    collected
      ? "✓ In your collection"
      : album.id
        ? "+ Add album"
        : "Find album",
  );
  add.disabled =
    collected ||
    (album.id && (!collection?.ready || collection.busy || adding));
  if (album.id) {
    add.onclick = () => addAlbum(album);
    card.append(openSpotify(album));
  } else {
    add.onclick = () => {
      historyLookup.find(album);
      $("history-results").querySelector(".history-lookup-form input")?.focus();
    };
  }
  card.append(add);
  if (
    history &&
    historyLookup.state?.key === JSON.stringify([album.name, album.artist])
  ) {
    card.classList.add("history-card-expanded");
    const state = historyLookup.state;
    const lookup = el("section", "history-lookup");
    lookup.setAttribute("aria-label", `Find ${album.name} on Spotify`);
    const form = el("form", "history-lookup-form");
    const input = el("input");
    input.type = "search";
    input.value = state.query;
    input.setAttribute("aria-label", "Search Spotify for this history album");
    const submit = el("button", "", "Search");
    submit.type = "submit";
    const close = el("button", "", "Close results");
    close.type = "button";
    close.onclick = () => historyLookup.clear();
    form.append(input, submit, close);
    form.onsubmit = (event) => {
      event.preventDefault();
      historyLookup.find(album, input.value);
    };
    const status = el("p", "history-lookup-status", state.message);
    status.setAttribute("role", "status");
    const matches = el("div", "discovery-grid");
    matches.append(
      ...state.results.map((match) => {
        const result = discoveryCard(match);
        if (match.year)
          result.append(el("span", "history-meta", `Released ${match.year}`));
        return result;
      }),
    );
    lookup.append(status, form, matches);
    card.append(lookup);
    add.textContent = state.loading ? "Searching…" : "Find album";
    add.disabled = state.loading || collected;
  }
  return card;
}
function renderSearch() {
  $("search-results").replaceChildren(
    ...searchResults.map((a) => discoveryCard(a)),
  );
}
async function addAlbum(album, repair = false) {
  if (adding || (known(album) && !repair)) return;
  adding = true;
  renderSearch();
  renderHistory();
  $("refresh").disabled = true;
  notice(`Adding ${album.name}…`);
  try {
    const count = await collection.add(album);
    albums = collection.albums;
    renderCollection();
    notice(
      count
        ? `${album.name} added to your collection.`
        : "Those tracks are already in your collection.",
    );
  } catch (error) {
    fail(error);
  } finally {
    adding = false;
    $("refresh").disabled = false;
    renderSearch();
    renderHistory();
  }
}
async function search() {
  clearTimeout(searchTimer);
  searchController?.abort();
  const version = ++searchVersion;
  const query = $("spotify-search").value.trim();
  searchResults = [];
  renderSearch();
  if (!query) {
    $("search-status").textContent = "Search by album title or artist.";
    return;
  }
  if (!collection || demo) {
    $("search-status").textContent = "Connect Spotify to search the catalogue.";
    return;
  }
  searchController = new AbortController();
  $("search-status").textContent = "Searching Spotify…";
  try {
    const data = await api(
      `search?${new URLSearchParams({ q: query, type: "album", limit: "10" })}`,
      { signal: searchController.signal },
    );
    if (version !== searchVersion) return;
    searchResults = (data.albums?.items || [])
      .map((a) => normalizeAlbum(a))
      .filter(Boolean);
    renderSearch();
    $("search-status").textContent = searchResults.length
      ? `${searchResults.length} albums found · select a cover to listen`
      : "No albums found. Try another title or artist.";
  } catch (error) {
    if (error.name !== "AbortError" && version === searchVersion)
      $("search-status").textContent = error.message;
  }
}
function renderHistory() {
  const activeInput = document.activeElement;
  const focusedLookup =
    activeInput?.matches(".history-lookup-form input") && historyLookup.state
      ? {
          key: historyLookup.state.key,
          value: activeInput.value,
          start: activeInput.selectionStart,
          end: activeInput.selectionEnd,
        }
      : null;
  const query = $("history-filter").value.toLocaleLowerCase();
  const visible = listening.filter(
    (a) =>
      (!$("uncollected").checked || !known(a)) &&
      `${a.name} ${a.artist}`.toLocaleLowerCase().includes(query),
  );
  $("history-results").replaceChildren(
    ...visible.slice(0, historyLimit).map((a) => discoveryCard(a, true)),
  );
  if (focusedLookup && historyLookup.state?.key === focusedLookup.key) {
    const input = $("history-results").querySelector(
      ".history-lookup-form input",
    );
    if (input) {
      input.value = focusedLookup.value;
      input.focus({ preventScroll: true });
      input.setSelectionRange(focusedLookup.start, focusedLookup.end);
    }
  }
  $("more-history").hidden = visible.length <= historyLimit;
  $("history-filter-label").hidden = !listening.length;
  $("clear-history").hidden = !imported;
  if (listening.length)
    $("history-status").textContent =
      `${visible.length.toLocaleString()} ${visible.length === 1 ? "album" : "albums"}${$("uncollected").checked ? " not yet in your collection" : ""} · ${imported ? "from your imported track plays, most listened first" : "from recent track plays"}`;
}
async function loadRecent() {
  if (demo) {
    notice("Connect Spotify to see your own listening history.");
    return;
  }
  if (!hasSession() || !hasHistoryPermission()) {
    await login(true);
    return;
  }
  $("load-recent").disabled = true;
  $("history-status").textContent = "Reading recent track plays…";
  try {
    const data = await api("me/player/recently-played?limit=50");
    listening = recentAlbums(data.items || []);
    imported = false;
    historyLimit = 40;
    renderHistory();
    if (!listening.length)
      $("history-status").textContent =
        "Spotify returned no recent track plays.";
  } catch (error) {
    $("history-status").textContent =
      error.status === 403
        ? "Spotify denied recent listening access. Use Reconnect to review access, then try again."
        : error.message;
  } finally {
    $("load-recent").disabled = false;
  }
}
async function importFiles(event) {
  const files = [...event.target.files];
  if (!files.length) return;
  const map = new Map(),
    seen = new Set();
  $("history-status").textContent = "Reading history on this device…";
  try {
    for (const file of files) {
      if (file.size > 150 * 1024 * 1024)
        throw new Error(
          "This file is too large. Select individual Spotify audio JSON files under 150 MB.",
        );
      importHistory(JSON.parse(await file.text()), map, seen);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (!map.size)
      throw new Error(
        "No album history found. Choose the audio JSON files from Extended Streaming History, rather than the standard account-data export.",
      );
    listening = [...map.values()].sort(
      (a, b) => b.milliseconds - a.milliseconds,
    );
    imported = true;
    historyLookup.clear();
    historyLimit = 40;
    renderHistory();
  } catch (error) {
    $("history-status").textContent =
      error instanceof SyntaxError
        ? "One file is not valid JSON. Unzip your Spotify export and select its audio JSON files."
        : error.message;
  } finally {
    event.target.value = "";
  }
}

$("connect").onclick = () => login().catch(fail);
$("close-welcome").onclick = () => $("welcome-dialog").close();
$("welcome-connect").onclick = () => {
  $("welcome-dialog").close();
  login().catch(fail);
};
if (demo) {
  $("welcome-demo").textContent = "Browse demo collection";
  $("welcome-demo").onclick = (event) => {
    event.preventDefault();
    $("welcome-dialog").close();
  };
}
$("logout").onclick = logout;
$("empty-action").onclick = () =>
  collection || demo ? panel("discover") : login().catch(fail);
$("refresh").onclick = () => sync(true);
$("filter").oninput = renderCollection;
$("sort").onchange = () => {
  if ($("sort").value === "random") reshuffle();
  applySort();
};
$("reverse-sort").onclick = () => {
  reversed = !reversed;
  $("reverse-sort").setAttribute("aria-pressed", String(reversed));
  $("reverse-sort").title = reversed
    ? "Restore sort order"
    : "Reverse sort order";
  $("reverse-sort").setAttribute("aria-label", $("reverse-sort").title);
  renderCollection();
};
$("shuffle").onclick = () => {
  reshuffle();
  renderCollection();
};
document
  .querySelectorAll("[data-panel]")
  .forEach((button) => (button.onclick = () => panel(button.dataset.panel)));
document.querySelectorAll("[data-view]").forEach(
  (button) =>
    (button.onclick = () => {
      view = button.dataset.view;
      try {
        localStorage.setItem("rc:view", view);
      } catch {}
      renderCollection();
    }),
);
$("random").onclick = () => {
  const choices = filterAlbums(albums, $("filter").value);
  if (choices.length)
    showAlbum(choices[Math.floor(Math.random() * choices.length)]);
};
$("close-dialog").onclick = () => $("album-dialog").close();
$("album-dialog").addEventListener("click", (event) => {
  if (event.target === $("album-dialog")) {
    const r = event.target.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      event.target.close();
  }
});
$("spotify-search").oninput = () => {
  clearTimeout(searchTimer);
  searchController?.abort();
  searchVersion++;
  searchTimer = setTimeout(search, 300);
};
$("load-recent").onclick = () => loadRecent().catch(fail);
$("history-files").onchange = importFiles;
$("uncollected").onchange = renderHistory;
$("history-filter").oninput = () => {
  historyLimit = 40;
  renderHistory();
};
$("more-history").onclick = () => {
  historyLimit += 40;
  renderHistory();
};
$("clear-history").onclick = () => {
  listening = [];
  imported = false;
  historyLookup.clear();
  renderHistory();
  $("history-status").textContent = "Imported history cleared from this page.";
};
$("close-player").onclick = () => {
  $("player-frame").replaceChildren();
  $("player").hidden = true;
  document.body.classList.remove("with-player");
};

async function start() {
  if (demo) {
    const { demoAlbums } = await import("./demo.js?v=932b349c929708fe");
    albums = demoAlbums;
    renderCollection();
    $("sync-status").textContent =
      "Demo collection · these are fictional albums.";
    notice("Demo collection. Connect Spotify to load your albums.");
    if (!hasSession()) $("welcome-dialog").showModal();
    return;
  }
  try {
    await finishLogin();
    if (!hasSession()) {
      $("welcome-dialog").showModal();
      return;
    }
    $("sync-status").textContent = "Connecting to Spotify…";
    const user = await api("me");
    sortMetadata = new SortMetadata(localStorage, user.id, api);
    collection = new Collection(api, localStorage, user.id);
    albums = collection.albums;
    $("account-name").textContent = user.display_name || "Your Spotify";
    $("connect").textContent = "Reconnect";
    $("logout").hidden = false;
    $("search-status").textContent = "Search by album title or artist.";
    renderCollection();
    await sync();
  } catch (error) {
    $("sync-status").textContent = "Reconnect Spotify to load your collection.";
    fail(error);
  }
}
start();
