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
let currentListSource = 'all';

let transposeStep = 0, fontSize = 17, chordsVisible = true;
const scale = ["C","C#","D","D#","E","F","F#","G","G#","A","B","H"];

let autoscrollInterval = null, currentLevel = 1;
let isAdmin = false;

let dnesSelectedIds = [];
// Default title shown when the list is empty / freshly cleared
const DNES_DEFAULT_TITLE = "PIESNE NA DNES";
let dnesTitle = DNES_DEFAULT_TITLE;

let selectedSongIds = [];
let playlistOrder = [];

// Persisted song font size (pinch zoom in song detail)
const LS_SONG_FONT_SIZE = 'song_font_size';

const LS_PLAYLIST_INDEX = "playlist_index";
const LS_PLAYLIST_ORDER = "playlist_order";

/* ===== TOAST ===== */
let toastTimer = null;
function showToast(message, ok=true){
  const t = document.getElementById("toast");
  if (!t) return;
  t.style.display = "block";
  t.innerText = message;
  t.style.borderColor = ok ? "#00c853" : "#ff4444";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.display = "none"; }, 1700);
}

/* ===== FAB (gear) ===== */
function closeFabMenu(){
  const m = document.getElementById("fab-menu");
  if (!m) return;
  m.style.display = "none";
  m.setAttribute("aria-hidden", "true");
}
function openFabMenu(){
  const m = document.getElementById("fab-menu");
  if (!m) return;
  m.style.display = "block";
  m.setAttribute("aria-hidden", "false");
}
function toggleFabMenu(ev){
  // stop click bubbling so outside-click handler doesn’t close immediately
  if (ev) ev.stopPropagation();

  if (!navigator.onLine){
    showToast("Si offline – aktualizácia nie je dostupná.", false);
    closeFabMenu();
    return;
  }

  const m = document.getElementById("fab-menu");
  if (!m) return;

  if (m.style.display === "block") closeFabMenu();
  else openFabMenu();
}

// click anywhere else closes
document.addEventListener('click', (e) => {
  const fab = document.getElementById("fab-update");
  if (!fab) return;
  if (!fab.contains(e.target)) closeFabMenu();
}, true);

/* offline: close menu automatically */
window.addEventListener('offline', () => closeFabMenu());

/* ===== SCROLL TO TOP BTN ===== */
window.addEventListener('scroll', () => {
  const btn = document.getElementById("scroll-to-top");
  if (!btn) return;
  btn.style.display = (window.scrollY > 300) ? "flex" : "none";
}, { passive: true });

/* ===== SECTIONS ===== */
function toggleSection(section, expand = null) {
  const content = document.getElementById(section + '-section-wrapper');
  const chevron = document.getElementById(section + '-chevron');
  if (!content || !chevron) return;

  const show = expand !== null ? expand : (content.style.display === 'none');
  content.style.display = show ? 'block' : 'none';
  chevron.className = show ? 'fas fa-chevron-up section-chevron' : 'fas fa-chevron-down section-chevron';
}

/* ===== HOME UI ===== */
function goHomeUI() {
  stopAutoscroll();
  closeSong();
  playlistViewName = null;
  renderPlaylistsUI(true);
  document.getElementById('search').value = "";
  filterSongs();

  toggleSection('dnes', false);
  toggleSection('playlists', false);
  toggleSection('all', false);

  window.scrollTo(0,0);
}

/* ===== LOGIN ===== */
function toggleAdminAuth() {
  if (!isAdmin) {
    const pwd = prompt("Heslo:");
    if (pwd !== ADMIN_PWD) return;

    isAdmin = true;
    document.getElementById('admin-toggle-text').innerText = "ODHLÁSIŤ";
    document.getElementById('dnes-editor-panel').style.display = 'block';
    document.getElementById('admin-panel').style.display = 'block';

    openDnesEditor(true);
    openPlaylistEditorNew(true);
    renderPlaylistsUI(true);
  } else {
    logoutAdmin();
  }
}
function logoutAdmin() {
  isAdmin = false;
  document.getElementById('admin-toggle-text').innerText = "PRIHLÁSIŤ";
  document.getElementById('dnes-editor-panel').style.display = 'none';
  document.getElementById('admin-panel').style.display = 'none';
  selectedSongIds = [];
  renderPlaylistsUI(true);
}

/* ===== XML LOAD ===== */
async function parseXML() {
  try {
    const res = await fetch(SCRIPT_URL);
    const xmlText = await res.text();
    localStorage.setItem('offline_spevnik', xmlText);
    processXML(xmlText);
  } catch (e) {
    const saved = localStorage.getItem('offline_spevnik');
    if (saved) processXML(saved);
  }
}
function processXML(xmlText) {
  const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
  const nodes = xml.getElementsByTagName('song');

  songs = [...nodes].map(s => {
    const text = s.getElementsByTagName('songtext')[0]?.textContent.trim() || "";
    const rawId = s.getElementsByTagName('author')[0]?.textContent.trim() || "";
    let displayId = rawId;

    if (rawId.toUpperCase().startsWith('M')) displayId = "Mariánska " + rawId.substring(1).replace(/^0+/, '');
    else if (/^\d+$/.test(rawId)) displayId = rawId.replace(/^0+/, '');

    return {
      id: s.getElementsByTagName('ID')[0]?.textContent.trim(),
      title: s.getElementsByTagName('title')[0]?.textContent.trim(),
      originalId: rawId,
      displayId,
      origText: text
    };
  });

  songs.sort((a, b) => {
    const idA = a.originalId.toUpperCase(), idB = b.originalId.toUpperCase();
    const isNumA = /^\d+$/.test(idA), isNumB = /^\d+$/.test(idB);
    const isMarA = idA.startsWith('M'), isMarB = idB.startsWith('M');

    if (isNumA && !isNumB) return -1;
    if (!isNumA && isNumB) return 1;
    if (isNumA && isNumB) return parseInt(idA) - parseInt(idB);

    if (isMarA && !isMarB) return -1;
    if (!isMarA && isMarB) return 1;
    if (isMarA && isMarB) return (parseInt(idA.substring(1)) || 0) - (parseInt(idB.substring(1)) || 0);

    return a.title.localeCompare(b.title, 'sk');
  });

  filteredSongs = [...songs];
  renderAllSongs();

  // cache-first (no flicker)
  loadDnesCacheFirst(false);
  loadPlaylistsCacheFirst(false);

  // then refresh
  loadDnesFromDrive();
  loadPlaylistsFromDrive();
}

/* ===== SONG LIST ===== */
function songRowHTMLClickable(displayId, title, onclickJs) {
  return `
    <div class="song-row" onclick="${onclickJs}">
      <div class="song-id">${escapeHtml(displayId)}.</div>
      <div class="song-title">${escapeHtml(title)}</div>
    </div>`;
}
function renderAllSongs() {
  const box = document.getElementById('piesne-list');
  if (!box) return;

  box.innerHTML = filteredSongs.map(s =>
    songRowHTMLClickable(s.displayId, s.title, `openSongById('${s.id}','all')`)
  ).join('');
}
function filterSongs() {
  const t = document.getElementById('search').value.toLowerCase();
  filteredSongs = songs.filter(s => s.title.toLowerCase().includes(t) || s.displayId.toLowerCase().includes(t));
  renderAllSongs();
}

/* ===== SONG DETAIL ===== */
function openSongById(id, source) {
  currentListSource = source;
  const s = songs.find(x => x.id === id);
  if (!s) return;

  if (source === 'dnes') {
    currentModeList = getDnesIds().map(i => songs.find(x => x.id === i)).filter(Boolean);
  } else if (source === 'playlist') {
    // already set
  } else {
    currentModeList = [...songs];
  }

  currentSong = JSON.parse(JSON.stringify(s));
  transposeStep = 0;
  document.getElementById('transpose-val').innerText = "0";
  currentLevel = 1;
  updateSpeedUI();
  stopAutoscroll();

  document.getElementById('song-list').style.display = 'none';
  document.getElementById('song-detail').style.display = 'block';

  document.getElementById('render-title').innerText = `${s.displayId}. ${s.title}`;

  const firstChordMatch = s.origText.match(/\[(.*?)\]/);
  document.getElementById('original-key-label').innerText = "Tónina: " + (firstChordMatch ? firstChordMatch[1] : "-");

  const subj = document.getElementById('error-subject');
  const hidden = document.getElementById('error-song-hidden');
  if (subj) subj.value = `${s.displayId}. ${s.title}`;
  if (hidden) hidden.value = `${s.displayId}. ${s.title}`;

  renderSong();
  window.scrollTo(0,0);
}
function closeSong() {
  stopAutoscroll();
  document.getElementById('song-detail').style.display = 'none';
  document.getElementById('song-list').style.display = 'block';
}
function navigateSong(d) {
  if (!currentSong) return;
  const idx = currentModeList.findIndex(s => s.id === currentSong.id);
  const n = currentModeList[idx + d];
  if (n) openSongById(n.id, currentListSource);
}
function renderSong() {
  if (!currentSong) return;
  let text = currentSong.origText;

  if (transposeStep !== 0) {
    text = text.replace(/\[(.*?)\]/g, (m, c) => `[${transposeChord(c, transposeStep)}]`);
  }
  if (!chordsVisible) {
    text = text.replace(/\[.*?\]/g, '');
  }

  const el = document.getElementById('song-content');
  el.innerHTML = text.replace(/\[(.*?)\]/g, '<span class="chord">$1</span>');
  el.style.fontSize = fontSize + 'px';
  updateFontSizeLabel();
}

function transposeChord(c, step) {
  return c.replace(/[A-H][#b]?/g, (n) => {
    const idx = scale.indexOf(n);
    if (idx === -1) return n;
    let newIdx = (idx + step) % 12;
    while (newIdx < 0) newIdx += 12;
    return scale[newIdx];
  });
}
function transposeSong(d) { transposeStep += d; document.getElementById('transpose-val').innerText = (transposeStep>0?"+":"")+transposeStep; renderSong(); }
function resetTranspose() { transposeStep = 0; document.getElementById('transpose-val').innerText = "0"; renderSong(); }
function toggleChords() { chordsVisible = !chordsVisible; renderSong(); }
function changeFontSize(d) { applySongFontSize(fontSize + d); }

/* ===== AUTOSCROLL ===== */
function toggleAutoscroll() {
  if (autoscrollInterval) stopAutoscroll();
  else {
    document.getElementById('scroll-btn').classList.add('active');
    document.getElementById('scroll-btn').innerHTML = '<i class="fas fa-pause"></i>';
    startScrolling();
  }
}
function startScrolling() {
  if (autoscrollInterval) clearInterval(autoscrollInterval);
  const delay = 260 - (currentLevel * 12);
  autoscrollInterval = setInterval(() => {
    window.scrollBy(0, 1);
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight) stopAutoscroll();
  }, delay);
}
function stopAutoscroll() {
  clearInterval(autoscrollInterval);
  autoscrollInterval = null;
  const btn = document.getElementById('scroll-btn');
  if (btn) {
    btn.classList.remove('active');
    btn.innerHTML = '<i class="fas fa-play"></i>';
  }
}
function changeScrollSpeed(d) {
  currentLevel += d;
  if (currentLevel < 1) currentLevel = 1;
  if (currentLevel > 20) currentLevel = 20;
  updateSpeedUI();
  if (autoscrollInterval) startScrolling();
}
function updateSpeedUI() {
  const s = document.getElementById('speed-label');
  if (s) s.innerText = "Rýchlosť: " + currentLevel;
}

/* Swipe left/right */
(function initSwipe(){
  const detail = document.getElementById('song-detail');
  if (!detail) return;

  let sx = 0, sy = 0, active = false;

  detail.addEventListener('touchstart', (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    active = true;
  }, { passive:true });

  detail.addEventListener('touchend', (e) => {
    if (!active || !e.changedTouches || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    active = false;

    if (Math.abs(dx) < 70) return;
    if (Math.abs(dy) > 80) return;

    if (dx < 0) navigateSong(1);
    else navigateSong(-1);
  }, { passive:true });
})();

/* ===== DNES (no flicker) ===== */
let dnesFetchInFlight = false;

function parseDnesPayload(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return { title: DNES_DEFAULT_TITLE, ids: [] };

  try {
    const obj = JSON.parse(trimmed);
    if (obj && Array.isArray(obj.ids)) {
      if (obj.ids.length === 0) return { title: DNES_DEFAULT_TITLE, ids: [] };
      return { title: obj.title || DNES_DEFAULT_TITLE, ids: obj.ids.map(String) };
    }
  } catch(e) {}

  const ids = trimmed.split(',').map(x => x.trim()).filter(Boolean);
  return { title: DNES_DEFAULT_TITLE, ids };
}
function setDnesTitle(title) {
  dnesTitle = (title || DNES_DEFAULT_TITLE);
  document.getElementById('dnes-title').innerText = dnesTitle.toUpperCase();
}
function getDnesIds() {
  const raw = localStorage.getItem('piesne_dnes') || "";
  return parseDnesPayload(raw).ids;
}
function loadDnesCacheFirst(showEmptyAllowed) {
  const box = document.getElementById('dnes-section');
  const payload = parseDnesPayload(localStorage.getItem('piesne_dnes') || "");
  setDnesTitle(payload.title);

  if (!payload.ids.length) {
    if (!showEmptyAllowed && dnesFetchInFlight) {
      box.innerHTML = '<div class="loading">Načítavam...</div>';
      return;
    }
    box.innerHTML = '<div class="dnes-empty">Zoznam piesní na dnešný deň je prázdny <span class="sad-ico"><i class="fa-solid fa-face-sad-tear"></i></span></div>';
    return;
  }

  box.innerHTML = payload.ids.map(id => {
    const s = songs.find(x => x.id === id);
    if (!s) return '';
    return songRowHTMLClickable(s.displayId, s.title, `openSongById('${s.id}','dnes')`);
  }).join('');
}
async function loadDnesFromDrive() {
  dnesFetchInFlight = true;
  loadDnesCacheFirst(false);
  try {
    const r = await fetch(`${SCRIPT_URL}?action=get&name=PiesneNaDnes&t=${Date.now()}`);
    const t = await r.text();
    if (t != null) localStorage.setItem('piesne_dnes', t.trim());
  } catch(e) {}
  dnesFetchInFlight = false;
  loadDnesCacheFirst(true);
  if (isAdmin) openDnesEditor(true);
}

/* dnes editor (zachované) */
function openDnesEditor(silent=false) {
  if (!isAdmin && !silent) return;
  const payload = parseDnesPayload(localStorage.getItem('piesne_dnes') || "");
  dnesSelectedIds = [...payload.ids];
  document.getElementById('dnes-name').value = payload.title || DNES_DEFAULT_TITLE;
  renderDnesSelected();
  renderDnesAvailable();
}
function filterDnesSearch(){ renderDnesAvailable(); }
function renderDnesAvailable() {
  const t = document.getElementById('dnes-search').value.toLowerCase().trim();
  const list = t ? songs.filter(s => s.title.toLowerCase().includes(t) || s.displayId.toLowerCase().includes(t)) : songs;

  const target = document.getElementById('dnes-available-list');
  target.innerHTML = list.map(s => `
    <div class="draggable-item" onclick="addToDnesSelection('${s.id}')">
      <div style="display:flex; gap:10px; align-items:center; flex:1;">
        <div style="color:#00bfff; font-weight:900; min-width:78px; text-align:right; white-space:nowrap;">${escapeHtml(s.displayId)}.</div>
        <div style="flex:1; overflow-wrap:anywhere;">${escapeHtml(s.title)}</div>
      </div>
      <button class="small-plus" onclick="event.stopPropagation(); addToDnesSelection('${s.id}')">+</button>
    </div>
  `).join('');
}
function addToDnesSelection(id) {
  if (!dnesSelectedIds.includes(id)) {
    dnesSelectedIds.push(id);
    renderDnesSelected();
  }
}
function renderDnesSelected() {
  const box = document.getElementById('dnes-selected-editor');
  if (!dnesSelectedIds.length) {
    box.innerHTML = '<div class="dnes-empty">Zoznam piesní na dnešný deň je prázdny <span class="sad-ico"><i class="fa-solid fa-face-sad-tear"></i></span></div>';
    return;
  }
  box.innerHTML = dnesSelectedIds.map((id, idx) => {
    const s = songs.find(x => x.id === id);
    const left = s ? `${s.displayId}.` : id;
    const right = s ? s.title : '';
    return `
      <div class="draggable-item"
           draggable="true"
           data-idx="${idx}"
           ondragstart="onDragStart(event,'dnes')"
           ondragover="onDragOver(event)"
           ondrop="onDrop(event,'dnes')">
        <div style="display:flex; gap:10px; align-items:center; flex:1;">
          <div style="color:#00bfff; font-weight:900; min-width:78px; text-align:right; white-space:nowrap;">${escapeHtml(left)}</div>
          <div style="flex:1; overflow-wrap:anywhere;">${escapeHtml(right)}</div>
        </div>
        <span class="drag-handle"><i class="fas fa-grip-lines"></i></span>
        <button class="small-del" onclick="removeDnesAt(${idx})">X</button>
      </div>`;
  }).join('');
}
function removeDnesAt(idx){ dnesSelectedIds.splice(idx,1); renderDnesSelected(); }
function clearDnesSelection(){
  dnesSelectedIds=[];
  const inp = document.getElementById('dnes-name');
  if (inp) inp.value = DNES_DEFAULT_TITLE;
  setDnesTitle(DNES_DEFAULT_TITLE);
  renderDnesSelected();
}
async function saveDnesEditor() {
  const title = (document.getElementById('dnes-name').value || DNES_DEFAULT_TITLE).trim();
  const payload = JSON.stringify({ title, ids: dnesSelectedIds });

  localStorage.setItem('piesne_dnes', payload);
  setDnesTitle(title);
  loadDnesCacheFirst(true);

  try {
    await fetch(`${SCRIPT_URL}?action=save&name=PiesneNaDnes&pwd=${ADMIN_PWD}&content=${encodeURIComponent(payload)}`, { mode:'no-cors' });
    showToast("Uložené ✅", true);
  } catch(e) {
    showToast("Nepodarilo sa uložiť ❌", false);
  }
}

/* ===== PLAYLISTY (no flicker) ===== */
let playlistsFetchInFlight = false;
let playlistViewName = null; // when set, playlists section shows songs inside that playlist
let editingPlaylistName = null; // original name when editing (for rename)

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
    sect.innerHTML = '<div class="dnes-empty">Žiadne playlisty.</div>';
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
function openPlaylistEditorNew(silent=false){
  if (!isAdmin && !silent) return;
  editingPlaylistName = null;
  selectedSongIds = [];
  const nameEl = document.getElementById('playlist-name');
  if (nameEl) nameEl.value = '';
  const searchEl = document.getElementById('playlist-search');
  if (searchEl) searchEl.value = '';
  renderPlaylistAvailable();
  renderPlaylistSelection();
}

function filterPlaylistSearch(){
  renderPlaylistAvailable();
}

function renderPlaylistAvailable(){
  const t = (document.getElementById('playlist-search')?.value || '').toLowerCase().trim();
  const list = t ? songs.filter(s => s.title.toLowerCase().includes(t) || s.displayId.toLowerCase().includes(t)) : songs;
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
    renderPlaylistSelection();
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
  renderPlaylistSelection();
}

function clearSelection(){
  selectedSongIds = [];
  const nameEl = document.getElementById('playlist-name');
  if (nameEl) nameEl.value = '';
  editingPlaylistName = null;
  renderPlaylistSelection();
}

async function savePlaylist(){
  if (!isAdmin) return;
  const nameEl = document.getElementById('playlist-name');
  const rawName = (nameEl?.value || '').trim();
  if (!rawName) {
    showToast('Zadaj názov playlistu.', false);
    return;
  }

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

  editingPlaylistName = newName;

  // update UI immediately
  playlistViewName = null;
  renderPlaylistsUI(true);

  // persist to Drive
  try {
    await fetch(`${SCRIPT_URL}?action=save&name=${encodeURIComponent(newName)}&pwd=${ADMIN_PWD}&content=${encodeURIComponent(payload)}`, { mode:'no-cors' });
    await fetch(`${SCRIPT_URL}?action=save&name=PlaylistOrder&pwd=${ADMIN_PWD}&content=${encodeURIComponent(JSON.stringify(playlistOrder))}`, { mode:'no-cors' });
    // best-effort delete old name on backend if renamed
    if (oldName && newName !== oldName) {
      try { await fetch(`${SCRIPT_URL}?action=delete&name=${encodeURIComponent(oldName)}&pwd=${ADMIN_PWD}`, { mode:'no-cors' }); } catch(e) {}
      try { await fetch(`${SCRIPT_URL}?action=save&name=${encodeURIComponent(oldName)}&pwd=${ADMIN_PWD}&content=`, { mode:'no-cors' }); } catch(e) {}
    }
    showToast('Uložené ✅', true);
  } catch(e) {
    showToast('Nepodarilo sa uložiť ❌', false);
  }
}

function editPlaylist(nameEnc){
  if (!isAdmin) return;
  const name = decodeURIComponent(nameEnc);
  editingPlaylistName = name;
  const nameEl = document.getElementById('playlist-name');
  if (nameEl) nameEl.value = name;

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

  try {
    try { await fetch(`${SCRIPT_URL}?action=delete&name=${encodeURIComponent(name)}&pwd=${ADMIN_PWD}`, { mode:'no-cors' }); } catch(e) {}
    await fetch(`${SCRIPT_URL}?action=save&name=${encodeURIComponent(name)}&pwd=${ADMIN_PWD}&content=__DELETED__`, { mode:'no-cors' });
    await fetch(`${SCRIPT_URL}?action=save&name=PlaylistOrder&pwd=${ADMIN_PWD}&content=${encodeURIComponent(JSON.stringify(playlistOrder))}`, { mode:'no-cors' });
    showToast('Vymazané ✅', true);
  } catch(e) {
    showToast('Nepodarilo sa vymazať ❌', false);
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
    renderDnesSelected();
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

  parseXML();
});
