import {
  login,
  logout,
  finishLogin,
  hasSession,
  hasHistoryPermission,
  getToken,
} from "./auth.js";
import {
  Collection,
  createApi,
  normalizeAlbum,
  filterAlbums,
  recentAlbums,
  importHistory,
} from "./core.js";

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
const colors = new Map();

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
  link.href = album.link;
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
  const filtered = filterAlbums(albums, $("filter").value, $("sort").value);
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
      artist: "ARTISTS · A—Z",
      album: "ALBUMS · A—Z",
      year: "RELEASE YEAR · NEWEST FIRST",
      added: "RECENT ADDITIONS",
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
        ? "Making room on the shelf…"
        : "Your collection starts here.";
    $("empty").querySelector("p").textContent = albums.length
      ? "Try another album title or artist."
      : collection
        ? "Find an album you love and make it your first addition."
        : "Connect Spotify to open your album shelf. Your existing Record Collection playlist comes with you.";
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
        : "Find this album ↗",
  );
  add.disabled =
    collected ||
    (album.id && (!collection?.ready || collection.busy || adding));
  if (album.id) {
    add.onclick = () => addAlbum(album);
    card.append(openSpotify(album));
  } else
    add.onclick = () => {
      panel("discover");
      $("spotify-search").value = `album:${album.name} artist:${album.artist}`;
      search();
      $("spotify-search").focus();
    };
  card.append(add);
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
        ? `${album.name} is on your shelf.`
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
  const query = $("history-filter").value.toLocaleLowerCase();
  const visible = listening.filter(
    (a) =>
      (!$("uncollected").checked || !known(a)) &&
      `${a.name} ${a.artist}`.toLocaleLowerCase().includes(query),
  );
  $("history-results").replaceChildren(
    ...visible.slice(0, historyLimit).map((a) => discoveryCard(a, true)),
  );
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
$("logout").onclick = logout;
$("empty-action").onclick = () =>
  collection || demo ? panel("discover") : login().catch(fail);
$("refresh").onclick = () => sync(true);
$("filter").oninput = renderCollection;
$("sort").onchange = renderCollection;
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
    const { demoAlbums } = await import("./demo.js");
    albums = demoAlbums;
    renderCollection();
    $("sync-status").textContent =
      "Demo collection · these are fictional albums.";
    notice(
      "You’re browsing a demo. Connect Spotify to load your real collection.",
    );
    return;
  }
  try {
    await finishLogin();
    if (!hasSession()) return;
    $("sync-status").textContent = "Connecting to Spotify…";
    const user = await api("me");
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
