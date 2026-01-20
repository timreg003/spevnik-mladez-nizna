/* ✅ ANTI PULL-TO-REFRESH (Android)
   Zablokuje refresh pri ťahu dole, keď je stránka úplne hore.
   Nezabíja scroll v listoch (editor-list, list-box, song-content).
*/
(function preventPullToRefresh(){
  let startY = 0;
  let maybePull = false;

  function isScrollableTarget(el){
    if (!el) return false;
    return !!(el.closest('.editor-list') || el.closest('.list-box') || el.closest('#song-content'));
  }

  window.addEventListener('touchstart', (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
    maybePull = (window.scrollY === 0);
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (!maybePull) return;
    if (isScrollableTarget(e.target)) return;

    const y = e.touches[0].clientY;
    const dy = y - startY;
    if (dy > 25 && e.cancelable) e.preventDefault();
  }, { passive: false });
})();

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyyrD8pCxgQYiERsOsDFJ_XoBEbg6KYe1oM8Wj9IAzkq4yqzMSkfApgcc3aFeD0-Pxgww/exec';
const ADMIN_PWD = "qwer";
const FORMSPREE_URL = "https://formspree.io/f/mvzzkwlw";

let songs = [], filteredSongs = [];
let currentSong = null;
let currentModeList = [];
let currentSongOrder = '';
let currentHistoryTs = null;
let forceOrderSongId = null;
let forceOrderValue = '';

let currentListSource = 'all';

let transposeStep = 0, fontSize = 17, chordsVisible = true;
const scale = ["C","C#","D","D#","E","F","F#","G","G#","A","B","H"];

let autoscrollInterval = null, currentLevel = 1;
let isAdmin = false;

let dnesSelectedIds = [];
let dnesItems = []; // [{id, order}]
let dnesOrderMap = {}; // id -> order string
let historyOrderMap = {}; // ts|id -> order
let dnesDirty = false;
let playlistDirty = false;
// Default title shown when the list is empty / freshly cleared
const DNES_DEFAULT_TITLE = "PIESNE NA DNES";
let dnesTitle = DNES_DEFAULT_TITLE;

let selectedSongIds = [];
let playlistOrder = [];

// Persisted song font size (pinch zoom in song detail)
const LS_SONG_FONT_SIZE = 'song_font_size';

const LS_PLAYLIST_INDEX = "playlist_index";
const LS_PLAYLIST_ORDER = "playlist_order";

const LS_HISTORY = "history_log";
const HISTORY_NAME = "HistoryLog";


function normText(s){
  return String(s || "")
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'');
}


function todayLabelSk(d){
  const dt = d ? new Date(d) : new Date();
  const days = ["Nedeľa","Pondelok","Utorok","Streda","Štvrtok","Piatok","Sobota"];
  const day = days[dt.getDay()];
  const dd = dt.getDate();
  const mm = dt.getMonth()+1;
  return `${day} ${dd}.${mm}.`;
}


async function postToScript(params){
  // Fire-and-forget POST (no-cors) to avoid CORS blocking on GitHub Pages.
  // We don't read the response; after this we re-sync via GET (load*FromDrive).
  const body = new URLSearchParams();
  Object.keys(params || {}).forEach(k => {
    if (params[k] !== undefined && params[k] !== null) body.append(k, String(params[k]));
  });

  try{
    await fetch(SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      body
    });
    return { ok:true };
  }catch(e){
    return { ok:false, error: String(e) };
  }
}


async function safeScriptSave(name, content){
  // Try POST (new script), fallback to legacy GET (no-cors)
  try {
    await postToScript({ action:'save', name:'PiesneNaDnes', pwd: ADMIN_PWD, content: payload });
    showToast("Uložené ✅", true);
  } catch(e) {
    showToast("Nepodarilo sa uložiť ❌", false);
  } finally {
    // always try to re-sync from Drive so other devices see the same data
    loadDnesFromDrive();
  }
}


/* ===== HISTÓRIA (public) ===== */
let historyFetchInFlight = false;

function parseHistory(raw){
  const t = (raw || "").trim();
  if (!t) return [];
  try {
    const arr = JSON.parse(t);
    return Array.isArray(arr) ? arr : [];
  } catch(e) {
    return [];
  }
}

function loadHistoryCacheFirst(showEmptyAllowed){
  const box = document.getElementById('history-section');
  if (!box) return;

  const items = parseHistory(localStorage.getItem(LS_HISTORY) || "");
  if (!items.length){
    if (!showEmptyAllowed && historyFetchInFlight){
      box.innerHTML = '<div class="loading">Načítavam...</div>';
      return;
    }
    box.innerHTML = '<div class="dnes-empty">Zatiaľ žiadna história.</div>';
    return;
  }

  // newest first
  const sorted = [...items].sort((a,b) => (b.date||"").localeCompare(a.date||"") || (b.ts||0)-(a.ts||0));

  box.innerHTML = sorted.map((h) => {
    const title = h.label || h.date || "Záznam";
    const meta = h.date ? h.date : "";
    const delBtn = isAdmin ? `<button class="history-del" onclick="event.stopPropagation(); deleteHistoryEntry(${h.ts||0})">X</button>` : '';
    const songRows = (h.items || []).map(it => {
      const s = songs.find(x => x.id === String(it.songId || it.id));
      if (!s) return '';
      const ord = (it.order || '').trim();
      const ordBadge = ord ? ` <span style="opacity:0.75; font-size:12px;">(${escapeHtml(ord)})</span>` : '';
      return `
        <div class="song-row" onclick="openSongFromHistory(${h.ts||0},'${s.id}')">
          <div class="song-id">${escapeHtml(s.displayId)}.</div>
          <div class="song-title">${escapeHtml(s.title)}${ordBadge}</div>
        </div>`;
    }).join('');

    return `
      <div class="history-card">
        <div class="history-head">
          <div style="min-width:0;">
            <div class="history-title">${escapeHtml(title)}</div>
            <div class="history-meta">${escapeHtml(meta)}</div>
          </div>
          ${delBtn}
        </div>
        ${songRows}
      </div>`;
  }).join('');
}

async function loadHistoryFromDrive(){
  historyFetchInFlight = true;
  loadHistoryCacheFirst(false);
  try {
    const r = await fetch(`${SCRIPT_URL}?action=get&name=${HISTORY_NAME}&t=${Date.now()}`);
    const t = await r.text();
    if (t != null) localStorage.setItem(LS_HISTORY, t.trim());
  } catch(e) {}
  historyFetchInFlight = false;
  loadHistoryCacheFirst(true);
}

function buildHistoryEntryFromCurrentDnes(){
  const payload = parseDnesPayload(localStorage.getItem('piesne_dnes') || "");
  // prefer editor state if admin is editing now
  const items = (Array.isArray(dnesSelectedIds) && dnesSelectedIds.length)
    ? dnesSelectedIds.map((id, idx) => ({ songId: String(id), order: (dnesItems[idx]?.order || '').trim() }))
    : (payload.items || []).map(it => ({ songId: String(it.id || it.songId), order: (it.order || '').trim() }));

  const now = Date.now();
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  const iso = `${yyyy}-${mm}-${dd}`;

  return {
    ts: now,
    date: iso,
    label: todayLabelSk(d),
    title: payload.title || DNES_DEFAULT_TITLE,
    items
  };
}

async function saveDnesToHistory(){
  if (!isAdmin) return;
  showToast('Ukladám do histórie…', true);

  const arr = parseHistory(localStorage.getItem(LS_HISTORY) || "");
  arr.push(buildHistoryEntryFromCurrentDnes());
  localStorage.setItem(LS_HISTORY, JSON.stringify(arr));
  loadHistoryCacheFirst(true);

  try {
    const r = await safeScriptSave(HISTORY_NAME, JSON.stringify(arr));
    if (!r.ok) throw new Error(r.error || 'save');
    showToast('Uložené do histórie ✅', true);
  } catch(e) {
    showToast('Nepodarilo sa uložiť do histórie ❌', false);
  } finally {
    loadHistoryFromDrive();
  }
}


function openSongFromHistory(ts, songId){
  const arr = parseHistory(localStorage.getItem(LS_HISTORY) || "");
  const h = arr.find(x => Number(x.ts) === Number(ts));
  if (!h) return;

  const ids = (h.items || []).map(it => String(it.songId || it.id));
  currentModeList = ids.map(i => songs.find(x => x.id === i)).filter(Boolean);
  currentListSource = 'dnes';

  const it = (h.items || []).find(x => String(x.songId || x.id) === String(songId));
  forceOrderSongId = String(songId);
  forceOrderValue = (it?.order || '').trim();

  openSongById(songId, 'dnes');
}

function deleteHistoryEntry(ts){
  if (!isAdmin) return;
  if (!confirm('Vymazať tento záznam z histórie?')) return;

  const arr = parseHistory(localStorage.getItem(LS_HISTORY) || "");
  const next = arr.filter(x => Number(x.ts) !== Number(ts));
  localStorage.setItem(LS_HISTORY, JSON.stringify(next));
  loadHistoryCacheFirst(true);

  (async () => {
    try {
      const r = await safeScriptSave(HISTORY_NAME, JSON.stringify(next));
      if (!r.ok) throw new Error(r.error || 'save');
      showToast('Vymazané ✅', true);
    } catch(e) {
      showToast('Nepodarilo sa vymazať ❌', false);
    } finally {
      loadHistoryFromDrive();
    }
  })();
}

/* ===== PLAYLISTY (no flicker) ===== */
let playlistsFetchInFlight = false;
let playlistViewName = null; // when set, playlists section shows songs inside that playlist
let editingPlaylistName = null;
  playlistDirty = false; // original name when editing (for rename)

function getCachedPlaylistNames() {
  try { const idx = JSON.parse(localStorage.getItem(LS_PLAYLIST_INDEX) || "[]"); if (Array.isArray(idx)) return idx.map(String); } catch(e) {}
  return [];
}
function getCachedPlaylistOrder() {
  try { const ord = JSON.parse(localStorage.getItem(LS_PLAYLIST_ORDER) || "[]"); if (Array.isArray(ord)) return ord.map(String); } catch(e) {}
  return [];
}
function applyOrder(names, order) {
  const ordered = [];
  order.forEach(n => { if (names.includes(n)) ordered.push(n); });
  names.forEach(n => { if (!ordered.includes(n)) ordered.push(n); });
  return ordered;
}
function loadPlaylistsCacheFirst(showEmptyAllowed) {
  const names = getCachedPlaylistNames();
  const order = getCachedPlaylistOrder();
  playlistOrder = applyOrder(names, order);
  renderPlaylistsUI(showEmptyAllowed);
}
async function loadPlaylistsFromDrive() {
  playlistsFetchInFlight = true;
  loadPlaylistsCacheFirst(false);
  loadHistoryCacheFirst(false);

  let list = [];
  try {
    const r = await fetch(`${SCRIPT_URL}?action=list&t=${Date.now()}`);
    list = await r.json();
  } catch(e) {
    playlistsFetchInFlight = false;
    loadPlaylistsCacheFirst(true);
    return;
  }

  list = (list || []).filter(p => p.name !== "PiesneNaDnes" && p.name !== "PlaylistOrder");
  const allNames = list.map(p => p.name);

  let order = [];
  try {
    const rr = await fetch(`${SCRIPT_URL}?action=get&name=PlaylistOrder&t=${Date.now()}`);
    const txt = (await rr.text()).trim();
    const arr = JSON.parse(txt || "[]");
    if (Array.isArray(arr)) order = arr.map(String);
  } catch(e) {}

  // Fetch contents first, then hide empty/deleted playlists
  const contents = {};
  await Promise.all(allNames.map(async (n) => {
    try {
      const r = await fetch(`${SCRIPT_URL}?action=get&name=${encodeURIComponent(n)}&t=${Date.now()}`);
      const t = (await r.text()).trim();
      contents[n] = t;
      localStorage.setItem('playlist_' + n, t);
    } catch(e) {
      contents[n] = (localStorage.getItem('playlist_' + n) || "").trim();
    }
  }));

  const names = allNames.filter(n => !isDeletedPlaylistContent(contents[n]));

  playlistOrder = applyOrder(names, order);
  localStorage.setItem(LS_PLAYLIST_INDEX, JSON.stringify(names));
  localStorage.setItem(LS_PLAYLIST_ORDER, JSON.stringify(playlistOrder));

  playlistsFetchInFlight = false;
  renderPlaylistsUI(true);
}


function isDeletedPlaylistContent(t){
  const s = (t || "").trim();
  return s === "" || s === "__DELETED__";
}
function renderPlaylistsUI(showEmptyAllowed=true) {
  const sect = document.getElementById('playlists-section');
  if (!sect) return;

  // If user opened a playlist, show its songs INSIDE the playlists folder
  if (playlistViewName) {
    renderPlaylistSongsView(playlistViewName);
    return;
  }

  const names = playlistOrder || [];
  if (!names.length) {
    if (!showEmptyAllowed && playlistsFetchInFlight) {
      sect.innerHTML = '<div class="loading">Načítavam...</div>';
      return;
    }
    sect.innerHTML = '<div class="dnes-empty">Žiadne playlisty. <span class="sad-ico"><i class="fa-solid fa-face-sad-tear"></i></span></div>';
    return;
  }

  sect.innerHTML = names.map((name, idx) => {
    const safe = escapeHtml(name);

    if (!isAdmin) {
      return `
        <div class="pl-row" onclick="openPlaylist('${encodeURIComponent(name)}')">
          <div class="pl-icon"><i class="fas fa-music"></i></div>
          <div class="song-title">${safe}</div>
        </div>`;
    }

    return `
      <div class="draggable-item"
           draggable="true"
           data-idx="${idx}"
           ondragstart="onDragStart(event,'plist')"
           ondragover="onDragOver(event)"
           ondrop="onDrop(event,'plist')">
        <div style="display:flex; gap:10px; align-items:center; flex:1; cursor:pointer;" onclick="openPlaylist('${encodeURIComponent(name)}')">
          <div style="min-width:78px; text-align:right; color:#00bfff;"><i class="fas fa-music"></i></div>
          <div style="flex:1; overflow-wrap:anywhere;">${safe}</div>
        </div>

        <span class="drag-handle" title="Poradie"><i class="fas fa-grip-lines"></i></span>
        <button class="small-plus" title="Upraviť" onclick="event.stopPropagation(); editPlaylist('${encodeURIComponent(name)}')"><i class="fas fa-pen"></i></button>
        <button class="small-del" title="Vymazať" onclick="event.stopPropagation(); deletePlaylist('${encodeURIComponent(name)}')">X</button>
      </div>`;
  }).join('');
}

function openPlaylist(nameEnc) {
  const name = decodeURIComponent(nameEnc);
  playlistViewName = name;
  toggleSection('playlists', true);
  renderPlaylistsUI(true);
  window.scrollTo(0,0);
}

function closePlaylistView(){
  playlistViewName = null;
  renderPlaylistsUI(true);
}

function renderPlaylistSongsView(name){
  const sect = document.getElementById('playlists-section');
  if (!sect) return;

  const raw = (localStorage.getItem('playlist_' + name) || "").trim();
  const ids = raw ? raw.split(',').map(x => x.trim()).filter(Boolean) : [];
  currentModeList = ids.map(id => songs.find(x => x.id === id)).filter(Boolean);
  currentListSource = 'playlist';

  const headerBtns = `
    <div style="display:flex; gap:10px; align-items:center; justify-content:space-between; padding:10px 12px; border-bottom:1px solid #333; background:#121212;">
      <button class="pl-back" onclick="closePlaylistView()"><i class=\"fas fa-arrow-left\"></i> Späť</button>
      <div style="font-weight:800; color:#fff; text-align:center; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:0 8px;">${escapeHtml(name)}</div>
      ${isAdmin ? `<button class=\"pl-edit\" onclick=\"editPlaylist('${encodeURIComponent(name)}')\"><i class=\"fas fa-pen\"></i></button>` : `<span style=\"width:44px;\"></span>`}
    </div>`;

  if (!currentModeList.length) {
    sect.innerHTML = headerBtns + `<div class="dnes-empty">Prázdny playlist.</div>`;
    return;
  }

  sect.innerHTML = headerBtns + currentModeList.map(s =>
    songRowHTMLClickable(s.displayId, s.title, `openSongById('${s.id}','playlist')`)
  ).join('');
}

/* ===== PLAYLIST EDITOR ===== */

function newPlaylist(){
  // reset editor so user can create another playlist without overwriting
  openPlaylistEditorNew(true);
  const nameEl = document.getElementById('playlist-name');
  if (nameEl) nameEl.value = '';
  selectedSongIds = [];
  editingPlaylistName = null;
  playlistDirty = false;
  renderPlaylistAvailable();
  renderPlaylistSelection();
  updatePlaylistSaveEnabled();
}
function openPlaylistEditorNew(silent=false){
  if (!isAdmin && !silent) return;
  editingPlaylistName = null;
  playlistDirty = false;
  selectedSongIds = [];
  const nameEl = document.getElementById('playlist-name');
  if (nameEl) nameEl.value = '';
  const searchEl = document.getElementById('playlist-search');
  if (searchEl) searchEl.value = '';
  renderPlaylistAvailable();
  renderPlaylistSelection();
  updatePlaylistSaveEnabled();
}

function filterPlaylistSearch(){
  renderPlaylistAvailable();
}

function renderPlaylistAvailable(){
  const tRaw = (document.getElementById('playlist-search')?.value || '');
  const t = normText(tRaw).trim();
  const list = t ? songs.filter(s => normText(s.title).includes(t) || normText(s.displayId).includes(t)) : songs;
  const target = document.getElementById('playlist-available-list');
  if (!target) return;

  target.innerHTML = list.map(s => `
    <div class="draggable-item" onclick="addToPlaylistSelection('${s.id}')">
      <div style="display:flex; gap:10px; align-items:center; flex:1;">
        <div style="color:#00bfff; font-weight:900; min-width:78px; text-align:right; white-space:nowrap;">${escapeHtml(s.displayId)}.</div>
        <div style="flex:1; overflow-wrap:anywhere;">${escapeHtml(s.title)}</div>
      </div>
      <button class="small-plus" onclick="event.stopPropagation(); addToPlaylistSelection('${s.id}')">+</button>
    </div>
  `).join('');
}

function addToPlaylistSelection(id){
  if (!selectedSongIds.includes(id)) {
    selectedSongIds.push(id);
    playlistDirty = true;
    renderPlaylistSelection();
    const __ps = document.getElementById('playlist-search');
    if (__ps && __ps.value) { __ps.value = ''; renderPlaylistAvailable(); }

  }
}

function renderPlaylistSelection(){
  const box = document.getElementById('selected-list-editor');
  if (!box) return;
  if (!selectedSongIds.length) {
    box.innerHTML = '<div class="dnes-empty">Zoznam piesní na dnešný deň je prázdny <span class="sad-ico"><i class="fa-solid fa-face-sad-tear"></i></span></div>';
    return;
  }

  box.innerHTML = selectedSongIds.map((id, idx) => {
    const s = songs.find(x => x.id === id);
    const left = s ? `${s.displayId}.` : id;
    const right = s ? s.title : '';
    return `
      <div class="draggable-item"
           draggable="true"
           data-idx="${idx}"
           ondragstart="onDragStart(event,'plsel')"
           ondragover="onDragOver(event)"
           ondrop="onDrop(event,'plsel')">
        <div style="display:flex; gap:10px; align-items:center; flex:1;">
          <div style="color:#00bfff; font-weight:900; min-width:78px; text-align:right; white-space:nowrap;">${escapeHtml(left)}</div>
          <div style="flex:1; overflow-wrap:anywhere;">${escapeHtml(right)}</div>
        </div>
        <span class="drag-handle"><i class="fas fa-grip-lines"></i></span>
        <button class="small-del" onclick="removeFromPlaylistSelection(${idx})">X</button>
      </div>`;
  }).join('');
}

function removeFromPlaylistSelection(idx){
  selectedSongIds.splice(idx,1);
  playlistDirty = true;
  renderPlaylistSelection();
}

function clearSelection(){
  selectedSongIds = [];
  const nameEl = document.getElementById('playlist-name');
  if (nameEl) nameEl.value = '';
  editingPlaylistName = null;
  playlistDirty = false;
  renderPlaylistSelection();
}

async function savePlaylist(){
  if (!isAdmin) return;

  const nameEl = document.getElementById('playlist-name');
  const rawName = (nameEl?.value || '').trim();

  // Don't allow save without a name (button should be disabled, but keep this guard)
  if (!rawName) {
    showToast('Zadaj názov playlistu.', false);
    updatePlaylistSaveEnabled();
    return;
  }

  // immediate feedback
  setButtonStateById('playlist-save-btn', true, '<i class="fas fa-check"></i>');
  showToast('Ukladám…', true);
const newName = rawName;
  const oldName = editingPlaylistName;

  // handle rename / overwrite
  if (oldName && newName !== oldName) {
    if (playlistOrder.includes(newName) && !confirm('Playlist s týmto názvom už existuje. Prepísať?')) return;
  } else if (!oldName && playlistOrder.includes(newName)) {
    if (!confirm('Playlist s týmto názvom už existuje. Prepísať?')) return;
  }

  // update local storage index/order
  let names = getCachedPlaylistNames();
  playlistOrder = getCachedPlaylistOrder();
  playlistOrder = applyOrder(names, playlistOrder);

  if (oldName && newName !== oldName) {
    // rename in index
    names = names.filter(n => n !== oldName);
    if (!names.includes(newName)) names.push(newName);
    // rename in order
    playlistOrder = playlistOrder.map(n => (n === oldName ? newName : n));
    // move cached content key
    const oldKey = 'playlist_' + oldName;
    const newKey = 'playlist_' + newName;
    const oldContent = localStorage.getItem(oldKey);
    if (oldContent != null) localStorage.setItem(newKey, oldContent);
    localStorage.removeItem(oldKey);
  } else {
    if (!names.includes(newName)) names.push(newName);
    if (!playlistOrder.includes(newName)) playlistOrder.push(newName);
  }

  const payload = selectedSongIds.join(',');
  localStorage.setItem('playlist_' + newName, payload);
  localStorage.setItem(LS_PLAYLIST_INDEX, JSON.stringify(names));
  localStorage.setItem(LS_PLAYLIST_ORDER, JSON.stringify(playlistOrder));

  // reset editor to allow creating a new playlist immediately
  editingPlaylistName = null;
  playlistDirty = false;

  // update UI immediately
  playlistViewName = null;
  renderPlaylistsUI(true);

    // clear editor fields after save so it doesn't overwrite the same playlist
  newPlaylist();

  // persist to Drive (POST)
  try {
    const r1 = await safeScriptSave(newName, payload);
    if (!r1.ok) throw new Error(r1.error || 'save');

    const r2 = await safeScriptSave('PlaylistOrder', JSON.stringify(playlistOrder));
    if (!r2.ok) throw new Error(r2.error || 'save');

    if (oldName && newName !== oldName) {
      try { await safeScriptDelete(oldName); } catch(e) {}
    }

    showToast('Uložené ✅', true);
  } catch(e) {
    showToast('Nepodarilo sa uložiť ❌', false);
  } finally {
    loadPlaylistsFromDrive();
  }
}

function editPlaylist(nameEnc){
  if (!isAdmin) return;
  const name = decodeURIComponent(nameEnc);
  editingPlaylistName = name;
  const nameEl = document.getElementById('playlist-name');
  if (nameEl) nameEl.value = name;
  updatePlaylistSaveEnabled();

  const raw = (localStorage.getItem('playlist_' + name) || '').trim();
  selectedSongIds = raw ? raw.split(',').map(x => x.trim()).filter(Boolean) : [];

  // show editor (already visible for admin), and reset search
  const searchEl = document.getElementById('playlist-search');
  if (searchEl) searchEl.value = '';
  renderPlaylistAvailable();
  renderPlaylistSelection();

  // if we were inside playlist view, jump out so user sees editor
  playlistViewName = null;
  renderPlaylistsUI(true);
  toggleSection('playlists', true);
}

async function deletePlaylist(nameEnc){
  if (!isAdmin) return;
  const name = decodeURIComponent(nameEnc);
  if (!confirm(`Vymazať playlist "${name}"?`)) return;

  localStorage.removeItem('playlist_' + name);

  let names = getCachedPlaylistNames().filter(n => n !== name);
  playlistOrder = applyOrder(names, getCachedPlaylistOrder().filter(n => n !== name));
  localStorage.setItem(LS_PLAYLIST_INDEX, JSON.stringify(names));
  localStorage.setItem(LS_PLAYLIST_ORDER, JSON.stringify(playlistOrder));

  if (editingPlaylistName === name) openPlaylistEditorNew(true);
  if (playlistViewName === name) playlistViewName = null;

  renderPlaylistsUI(true);
  showToast('Vymazávam…', true);

  try {
    const r1 = await safeScriptDelete(name);
    if (!r1.ok) throw new Error(r1.error || 'delete');

    const r2 = await safeScriptSave('PlaylistOrder', JSON.stringify(playlistOrder));
    if (!r2.ok) throw new Error(r2.error || 'save');

    showToast('Vymazané ✅', true);
  } catch(e) {
    showToast('Nepodarilo sa vymazať ❌', false);
  } finally {
    loadPlaylistsFromDrive();
  }
}

/* Drag & Drop basics */
function onDragStart(ev, ctx) {
  ev.dataTransfer.effectAllowed = "move";
  ev.dataTransfer.setData("text/plain", ev.currentTarget.getAttribute("data-idx"));
  ev.dataTransfer.setData("ctx", ctx);
}
function onDragOver(ev){ ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; }
function onDrop(ev, ctx) {
  ev.preventDefault();
  const from = parseInt(ev.dataTransfer.getData("text/plain"), 10);
  const to = parseInt(ev.currentTarget.getAttribute("data-idx"), 10);
  if (isNaN(from) || isNaN(to) || from === to) return;

  if (ctx === 'dnes') {
    moveInArray(dnesSelectedIds, from, to);
    moveInArray(dnesItems, from, to);
    renderDnesSelected();
    const __s = document.getElementById('dnes-search');
    if (__s && __s.value) { __s.value = ''; renderDnesAvailable(); }

  }
  else if (ctx === 'plist') {
    moveInArray(playlistOrder, from, to);
    localStorage.setItem(LS_PLAYLIST_ORDER, JSON.stringify(playlistOrder));
    renderPlaylistsUI(true);
    // best-effort persist order
    if (isAdmin) {
      try { fetch(`${SCRIPT_URL}?action=save&name=PlaylistOrder&pwd=${ADMIN_PWD}&content=${encodeURIComponent(JSON.stringify(playlistOrder))}`, { mode:'no-cors' }); } catch(e) {}
    }
  }
  else if (ctx === 'plsel') {
    moveInArray(selectedSongIds, from, to);
    renderPlaylistSelection();
    const __ps = document.getElementById('playlist-search');
    if (__ps && __ps.value) { __ps.value = ''; renderPlaylistAvailable(); }

  }
}
function moveInArray(arr, from, to){ const item = arr.splice(from,1)[0]; arr.splice(to,0,item); }

/* Update app (offline blocked) */
async function hardResetApp() {
  if (!navigator.onLine){
    showToast("Si offline – aktualizácia nie je dostupná.", false);
    return;
  }
  closeFabMenu();
  if (!confirm("Vymazať pamäť?")) return;

  localStorage.clear();
  try {
    const keys = await caches.keys();
    for (const k of keys) await caches.delete(k);
  } catch (e) {}
  location.reload(true);
}

/* Formspree */
async function submitErrorForm(event) {
  event.preventDefault();
  const form = document.getElementById("error-form");
  const status = document.getElementById("form-status");
  const btn = document.getElementById("submit-btn");

  status.style.display = "block";
  status.style.color = "#00ff00";
  status.innerText = "Odosielam...";
  btn.disabled = true;

  try {
    const formData = new FormData(form);
    const res = await fetch(FORMSPREE_URL, { method:"POST", headers:{ "Accept":"application/json" }, body: formData });
    if (res.ok) {
      status.style.color = "#00ff00";
      status.innerText = "Chyba bola odoslaná!";
      form.reset();
      showToast("Odoslané ✅", true);
    } else {
      status.style.color = "#ff4444";
      status.innerText = "Nepodarilo sa odoslať.";
      showToast("Neodoslané ❌", false);
    }
  } catch(e) {
    status.style.color = "#ff4444";
    status.innerText = "Nepodarilo sa odoslať.";
    showToast("Neodoslané ❌", false);
  } finally {
    btn.disabled = false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  }[m]));
}


/* ===== FONT SIZE UI (DETAIL) ===== */
function updateFontSizeLabel(){
  const el = document.getElementById('font-size-label');
  if (el) el.innerText = String(fontSize);
}

/* ===== PINCH TO CHANGE SONG TEXT SIZE (DETAIL) ===== */
function applySongFontSize(px){
  const v = Math.max(12, Math.min(34, Math.round(px)));
  fontSize = v;
  updateFontSizeLabel();
  try { localStorage.setItem(LS_SONG_FONT_SIZE, String(v)); } catch(e) {}
  renderSong();
}

function initSongPinchToZoom(){
  // Custom pinch so it works even with viewport user-scalable=no
  const area = document.getElementById('song-detail');
  if (!area) return;

  let active = false;
  let startDist = 0;
  let startSize = fontSize;

  function dist(t1, t2){
    const dx = t2.clientX - t1.clientX;
    const dy = t2.clientY - t1.clientY;
    return Math.sqrt(dx*dx + dy*dy);
  }

  area.addEventListener('touchstart', (e) => {
    // only when song detail is visible
    if (area.style.display === 'none') return;
    if (!e.touches || e.touches.length !== 2) return;
    active = true;
    startDist = dist(e.touches[0], e.touches[1]);
    startSize = fontSize;
  }, { passive: true });

  area.addEventListener('touchmove', (e) => {
    if (!active || !e.touches || e.touches.length !== 2) return;
    const d = dist(e.touches[0], e.touches[1]);
    if (!startDist) return;
    const scale = d / startDist;
    const next = startSize * scale;
    applySongFontSize(next);
    // prevent accidental browser zoom
    e.preventDefault();
  }, { passive: false });

  area.addEventListener('touchend', () => { active = false; startDist = 0; }, { passive: true });
  area.addEventListener('touchcancel', () => { active = false; startDist = 0; }, { passive: true });
}

document.addEventListener('DOMContentLoaded', () => {
  // restore song font size (detail)
  const savedSong = parseInt(localStorage.getItem(LS_SONG_FONT_SIZE) || String(fontSize), 10);
  if (!isNaN(savedSong)) fontSize = Math.max(12, Math.min(34, savedSong));
  updateFontSizeLabel();
  initSongPinchToZoom();

  toggleSection('dnes', false);
  toggleSection('playlists', false);
    toggleSection('all', false);

  const __pn = document.getElementById('playlist-name');
  if (__pn) __pn.addEventListener('input', () => { updatePlaylistSaveEnabled(); playlistDirty = true; });
  updatePlaylistSaveEnabled();

  parseXML();
});
