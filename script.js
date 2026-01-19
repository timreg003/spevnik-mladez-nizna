const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyyrD8pCxgQYiERsOsDFJ_XoBEbg6KYe1oM8Wj9IAzkq4yqzMSkfApgcc3aFeD0-Pxgww/exec';
const ADMIN_PWD = "qwer";
const FORMSPREE_URL = "https://formspree.io/f/mvzzkwlw";

// ===== STATE =====
let songs = [], filteredSongs = [];
let currentSong = null;
let currentModeList = [];
let currentListSource = 'all';

let transposeStep = 0, fontSize = 17, chordsVisible = true;
const scale = ["C","C#","D","D#","E","F","F#","G","G#","A","B","H"];

let autoscrollInterval = null, currentLevel = 1;
let isAdmin = false;

// Dnes
let dnesSelectedIds = [];
let dnesTitle = "PIESNE NA DNES";

// Playlist editor
let selectedSongIds = [];
let editingPlaylistName = "";

// Playlists cached
let playlistOrder = []; // array of names
const LS_PLAYLIST_INDEX = "playlist_index";
const LS_PLAYLIST_ORDER = "playlist_order";

// ===== Toast =====
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

// ===== Scroll-to-top button =====
window.addEventListener('scroll', () => {
  const btn = document.getElementById("scroll-to-top");
  if (!btn) return;
  btn.style.display = (window.scrollY > 300) ? "flex" : "none";
}, { passive: true });

// ===== Sections =====
function toggleSection(section, expand = null) {
  const content = document.getElementById(section + '-section-wrapper');
  const chevron = document.getElementById(section + '-chevron');
  if (!content || !chevron) return;

  const show = expand !== null ? expand : (content.style.display === 'none');
  content.style.display = show ? 'block' : 'none';
  chevron.className = show ? 'fas fa-chevron-up section-chevron' : 'fas fa-chevron-down section-chevron';
}

// ===== Home button: ONLY UI reset, no memory clearing =====
function goHomeUI() {
  stopAutoscroll();
  closeSong();
  document.getElementById('search').value = "";
  filterSongs();

  toggleSection('dnes', false);
  toggleSection('playlists', false);
  toggleSection('all', false);
  toggleSection('update', false);

  window.scrollTo(0,0);
}

// ===== Login / Logout =====
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
    renderPlaylistsUI(); // show admin buttons
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
  editingPlaylistName = "";
  renderPlaylistsUI();
}

// ===== XML Load =====
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

  // sorting: numbers -> Marian -> text
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

  // cache-first load for dnes & playlists
  loadDnesCacheFirst();
  loadPlaylistsCacheFirst();
  // then refresh from drive in background
  loadDnesFromDrive();
  loadPlaylistsFromDrive();
}

// ===== Render helper: consistent row (fixes all “odskoky”) =====
function songRowHTML(displayId, title) {
  return `
    <div class="song-row">
      <div class="song-id">${escapeHtml(displayId)}.</div>
      <div class="song-title">${escapeHtml(title)}</div>
    </div>`;
}
function songRowHTMLClickable(displayId, title, onclickJs) {
  return `
    <div class="song-row" onclick="${onclickJs}">
      <div class="song-id">${escapeHtml(displayId)}.</div>
      <div class="song-title">${escapeHtml(title)}</div>
    </div>`;
}

// ===== All songs list =====
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

// ===== Song detail =====
function openSongById(id, source) {
  currentListSource = source;

  const s = songs.find(x => x.id === id);
  if (!s) return;

  if (source === 'dnes') {
    currentModeList = getDnesIds().map(i => songs.find(x => x.id === i)).filter(Boolean);
  } else if (source === 'playlist') {
    // currentModeList already set in openPlaylist()
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

  // Formspree subject = song name
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

function transposeSong(d) {
  transposeStep += d;
  document.getElementById('transpose-val').innerText = (transposeStep>0?"+":"")+transposeStep;
  renderSong();
}
function resetTranspose() { transposeStep = 0; document.getElementById('transpose-val').innerText = "0"; renderSong(); }
function toggleChords() { chordsVisible = !chordsVisible; renderSong(); }
function changeFontSize(d) { fontSize += d; renderSong(); }

// ===== Autoscroll =====
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

// ===== Swipe left/right in song detail (mobile/tablet) =====
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

    // horizontal swipe only
    if (Math.abs(dx) < 70) return;
    if (Math.abs(dy) > 80) return;

    if (dx < 0) navigateSong(1);   // left -> next
    else navigateSong(-1);         // right -> prev
  }, { passive:true });
})();

// =======================================================
// DNES – cache-first + drive refresh
// =======================================================
function parseDnesPayload(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return { title: "PIESNE NA DNES", ids: [] };

  try {
    const obj = JSON.parse(trimmed);
    if (obj && Array.isArray(obj.ids)) {
      return { title: (obj.title || "PIESNE NA DNES"), ids: obj.ids.map(String) };
    }
  } catch(e) {}

  const ids = trimmed.split(',').map(x => x.trim()).filter(Boolean);
  return { title: "PIESNE NA DNES", ids };
}

function setDnesTitle(title) {
  dnesTitle = (title || "PIESNE NA DNES");
  document.getElementById('dnes-title').innerText = dnesTitle.toUpperCase();
}

function getDnesIds() {
  const raw = localStorage.getItem('piesne_dnes') || "";
  return parseDnesPayload(raw).ids;
}

function loadDnesCacheFirst() {
  const box = document.getElementById('dnes-section');
  const payload = parseDnesPayload(localStorage.getItem('piesne_dnes') || "");
  setDnesTitle(payload.title);

  if (!payload.ids.length) {
    box.innerHTML = '<div class="dnes-empty">Žiadne piesne.</div>';
    return;
  }

  box.innerHTML = payload.ids.map(id => {
    const s = songs.find(x => x.id === id);
    if (!s) return '';
    return songRowHTMLClickable(s.displayId, s.title, `openSongById('${s.id}','dnes')`);
  }).join('');
}

async function loadDnesFromDrive() {
  try {
    const r = await fetch(`${SCRIPT_URL}?action=get&name=PiesneNaDnes&t=${Date.now()}`);
    const t = await r.text();
    if (t != null) localStorage.setItem('piesne_dnes', t.trim());
  } catch(e) {}

  loadDnesCacheFirst();
  if (isAdmin) openDnesEditor(true);
}

function openDnesEditor(silent=false) {
  if (!isAdmin && !silent) return;

  const payload = parseDnesPayload(localStorage.getItem('piesne_dnes') || "");
  dnesSelectedIds = [...payload.ids];
  document.getElementById('dnes-name').value = payload.title || "PIESNE NA DNES";
  renderDnesSelected();
  renderDnesAvailable();
}

function filterDnesSearch() {
  renderDnesAvailable();
}

function renderDnesAvailable() {
  const t = document.getElementById('dnes-search').value.toLowerCase().trim();
  const list = t ? songs.filter(s => s.title.toLowerCase().includes(t) || s.displayId.toLowerCase().includes(t)) : songs;

  const target = document.getElementById('dnes-available-list');
  target.innerHTML = list.map(s => `
    <div class="draggable-item" onclick="addToDnesSelection('${s.id}')">
      <div style="display:flex; gap:10px; align-items:center; flex:1;">
        <div style="color:#00bfff; font-weight:900; min-width:110px; text-align:right; white-space:nowrap;">${escapeHtml(s.displayId)}.</div>
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
    box.innerHTML = '<div class="dnes-empty">Zatiaľ prázdne.</div>';
    return;
  }

  box.innerHTML = dnesSelectedIds.map((id, idx) => {
    const s = songs.find(x => x.id === id);
    const display = s ? `${s.displayId}. ${s.title}` : id;
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
          <div style="color:#00bfff; font-weight:900; min-width:110px; text-align:right; white-space:nowrap;">${escapeHtml(left)}</div>
          <div style="flex:1; overflow-wrap:anywhere;">${escapeHtml(right)}</div>
        </div>
        <span class="drag-handle"><i class="fas fa-grip-lines"></i></span>
        <button class="small-del" onclick="removeDnesAt(${idx})">X</button>
      </div>
    `;
  }).join('');
}

function removeDnesAt(idx) {
  dnesSelectedIds.splice(idx, 1);
  renderDnesSelected();
}

function clearDnesSelection() {
  dnesSelectedIds = [];
  renderDnesSelected();
}

async function saveDnesEditor() {
  const title = (document.getElementById('dnes-name').value || "PIESNE NA DNES").trim();
  const payload = JSON.stringify({ title, ids: dnesSelectedIds });

  localStorage.setItem('piesne_dnes', payload);
  setDnesTitle(title);
  loadDnesCacheFirst();

  try {
    await fetch(`${SCRIPT_URL}?action=save&name=PiesneNaDnes&pwd=${ADMIN_PWD}&content=${encodeURIComponent(payload)}`, { mode: 'no-cors' });
    showToast("Uložené ✅", true);
  } catch (e) {
    showToast("Nepodarilo sa uložiť ❌", false);
  }
}

// =======================================================
// PLAYLISTS – cache-first + drive refresh (fix offline after killing app)
// =======================================================
function getCachedPlaylistNames() {
  try {
    const idx = JSON.parse(localStorage.getItem(LS_PLAYLIST_INDEX) || "[]");
    if (Array.isArray(idx)) return idx.map(String);
  } catch(e) {}
  return [];
}
function getCachedPlaylistOrder() {
  try {
    const ord = JSON.parse(localStorage.getItem(LS_PLAYLIST_ORDER) || "[]");
    if (Array.isArray(ord)) return ord.map(String);
  } catch(e) {}
  return [];
}

function applyOrder(names, order) {
  const ordered = [];
  order.forEach(n => { if (names.includes(n)) ordered.push(n); });
  names.forEach(n => { if (!ordered.includes(n)) ordered.push(n); });
  return ordered;
}

function loadPlaylistsCacheFirst() {
  const names = getCachedPlaylistNames();
  const order = getCachedPlaylistOrder();
  playlistOrder = applyOrder(names, order);
  renderPlaylistsUI();
}

async function loadPlaylistsFromDrive() {
  // always show something quickly
  const box = document.getElementById('playlists-section');
  if (box && (!playlistOrder || playlistOrder.length === 0)) {
    box.innerHTML = '<div class="dnes-empty">Načítavam...</div>';
  }

  // 1) list of files
  let list = [];
  try {
    const r = await fetch(`${SCRIPT_URL}?action=list&t=${Date.now()}`);
    list = await r.json();
  } catch(e) {
    // offline -> keep cache
    renderPlaylistsUI();
    return;
  }

  // remove special
  list = (list || []).filter(p => p.name !== "PiesneNaDnes" && p.name !== "PlaylistOrder");
  const names = list.map(p => p.name);

  // 2) order file (if exists)
  let order = [];
  try {
    const rr = await fetch(`${SCRIPT_URL}?action=get&name=PlaylistOrder&t=${Date.now()}`);
    const txt = (await rr.text()).trim();
    const arr = JSON.parse(txt || "[]");
    if (Array.isArray(arr)) order = arr.map(String);
  } catch(e) {}

  playlistOrder = applyOrder(names, order);

  // cache index + order
  localStorage.setItem(LS_PLAYLIST_INDEX, JSON.stringify(names));
  localStorage.setItem(LS_PLAYLIST_ORDER, JSON.stringify(playlistOrder));

  // 3) fetch contents (best effort)
  await Promise.all(playlistOrder.map(async (n) => {
    try {
      const r = await fetch(`${SCRIPT_URL}?action=get&name=${encodeURIComponent(n)}&t=${Date.now()}`);
      const t = (await r.text()).trim();
      localStorage.setItem('playlist_' + n, t);
    } catch(e) {}
  }));

  renderPlaylistsUI();
}

function renderPlaylistsUI() {
  const sect = document.getElementById('playlists-section');
  if (!sect) return;

  const names = playlistOrder || [];

  if (!names.length) {
    sect.innerHTML = '<div class="dnes-empty">Žiadne playlisty.</div>';
    return;
  }

  sect.innerHTML = names.map((name, idx) => {
    const safe = escapeHtml(name);
    if (!isAdmin) {
      return `
        <div class="draggable-item" onclick="openPlaylist('${encodeURIComponent(name)}')">
          <span style="flex:1;">
            <i class="fas fa-music" style="color:#00bfff;margin-right:10px;"></i>${safe}
          </span>
        </div>`;
    }

    return `
      <div class="draggable-item"
           draggable="true"
           data-idx="${idx}"
           ondragstart="onDragStart(event,'plist')"
           ondragover="onDragOver(event)"
           ondrop="onDrop(event,'plist')">
        <span style="flex:1; cursor:pointer;" onclick="openPlaylist('${encodeURIComponent(name)}')">
          <i class="fas fa-music" style="color:#00bfff;margin-right:10px;"></i>${safe}
        </span>
        <span class="drag-handle" title="Poradie"><i class="fas fa-grip-lines"></i></span>
        <button class="small-plus" title="Upraviť" onclick="event.stopPropagation(); editPlaylist('${encodeURIComponent(name)}')"><i class="fas fa-pen"></i></button>
        <button class="small-del" title="Vymazať" onclick="event.stopPropagation(); deletePlaylist('${encodeURIComponent(name)}')">X</button>
      </div>
    `;
  }).join('');
}

function openPlaylist(nameEnc) {
  const name = decodeURIComponent(nameEnc);
  editingPlaylistName = name;

  const raw = (localStorage.getItem('playlist_' + name) || "").trim();
  const ids = raw ? raw.split(',').map(x => x.trim()).filter(Boolean) : [];

  currentModeList = ids.map(id => songs.find(x => x.id === id)).filter(Boolean);
  currentListSource = 'playlist';

  toggleSection('all', true);

  const box = document.getElementById('piesne-list');
  if (!currentModeList.length) {
    box.innerHTML = `<div class="dnes-empty">Prázdny playlist.</div>`;
    return;
  }

  box.innerHTML = currentModeList.map(s =>
    songRowHTMLClickable(s.displayId, s.title, `openSongById('${s.id}','playlist')`)
  ).join('');

  window.scrollTo(0,0);
}

function openPlaylistEditorNew(silent=false) {
  if (!isAdmin && !silent) return;
  editingPlaylistName = "";
  document.getElementById('playlist-name').value = "";
  selectedSongIds = [];
  renderPlaylistSelected();
  renderPlaylistAvailable();
}

function editPlaylist(nameEnc) {
  if (!isAdmin) return;
  const name = decodeURIComponent(nameEnc);
  editingPlaylistName = name;

  document.getElementById('playlist-name').value = name;

  const raw = (localStorage.getItem('playlist_' + name) || "").trim();
  selectedSongIds = raw ? raw.split(',').map(x => x.trim()).filter(Boolean) : [];

  toggleSection('playlists', true);
  document.getElementById('admin-panel').style.display = 'block';

  renderPlaylistSelected();
  renderPlaylistAvailable();
}

function filterPlaylistSearch() {
  renderPlaylistAvailable();
}

function renderPlaylistAvailable() {
  const t = document.getElementById('playlist-search').value.toLowerCase().trim();
  const list = t ? songs.filter(s => s.title.toLowerCase().includes(t) || s.displayId.toLowerCase().includes(t)) : songs;

  const target = document.getElementById('playlist-available-list');
  target.innerHTML = list.map(s => `
    <div class="draggable-item" onclick="addToPlaylistSelection('${s.id}')">
      <div style="display:flex; gap:10px; align-items:center; flex:1;">
        <div style="color:#00bfff; font-weight:900; min-width:110px; text-align:right; white-space:nowrap;">${escapeHtml(s.displayId)}.</div>
        <div style="flex:1; overflow-wrap:anywhere;">${escapeHtml(s.title)}</div>
      </div>
      <button class="small-plus" onclick="event.stopPropagation(); addToPlaylistSelection('${s.id}')">+</button>
    </div>
  `).join('');
}

function addToPlaylistSelection(id) {
  if (!selectedSongIds.includes(id)) {
    selectedSongIds.push(id);
    renderPlaylistSelected();
  }
}

function renderPlaylistSelected() {
  const box = document.getElementById('selected-list-editor');
  if (!selectedSongIds.length) {
    box.innerHTML = '<div class="dnes-empty">Zatiaľ prázdne.</div>';
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
           ondragstart="onDragStart(event,'psongs')"
           ondragover="onDragOver(event)"
           ondrop="onDrop(event,'psongs')">
        <div style="display:flex; gap:10px; align-items:center; flex:1;">
          <div style="color:#00bfff; font-weight:900; min-width:110px; text-align:right; white-space:nowrap;">${escapeHtml(left)}</div>
          <div style="flex:1; overflow-wrap:anywhere;">${escapeHtml(right)}</div>
        </div>
        <span class="drag-handle"><i class="fas fa-grip-lines"></i></span>
        <button class="small-del" onclick="removePlaylistAt(${idx})">X</button>
      </div>
    `;
  }).join('');
}

function removePlaylistAt(idx) {
  selectedSongIds.splice(idx, 1);
  renderPlaylistSelected();
}

function clearSelection() {
  selectedSongIds = [];
  renderPlaylistSelected();
}

async function savePlaylist() {
  if (!isAdmin) return;

  const name = (document.getElementById('playlist-name').value || "").trim();
  if (!name) return alert("Zadaj názov playlistu.");

  const content = selectedSongIds.join(',');
  localStorage.setItem('playlist_' + name, content);

  try {
    await fetch(`${SCRIPT_URL}?action=save&name=${encodeURIComponent(name)}&pwd=${ADMIN_PWD}&content=${encodeURIComponent(content)}`, { mode:'no-cors' });

    // ensure in order
    if (!playlistOrder.includes(name)) playlistOrder.push(name);
    localStorage.setItem(LS_PLAYLIST_ORDER, JSON.stringify(playlistOrder));
    localStorage.setItem(LS_PLAYLIST_INDEX, JSON.stringify(playlistOrder));

    // persist playlist order file
    await savePlaylistOrder();

    renderPlaylistsUI();
    showToast("Uložené ✅", true);
  } catch (e) {
    showToast("Nepodarilo sa uložiť ❌", false);
  }
}

async function deletePlaylist(nameEnc) {
  if (!isAdmin) return;
  const name = decodeURIComponent(nameEnc);

  if (!confirm(`Vymazať playlist "${name}"?`)) return;

  try {
    await fetch(`${SCRIPT_URL}?action=delete&name=${encodeURIComponent(name)}&pwd=${ADMIN_PWD}`, { mode:'no-cors' });
    localStorage.removeItem('playlist_' + name);

    playlistOrder = playlistOrder.filter(n => n !== name);
    localStorage.setItem(LS_PLAYLIST_ORDER, JSON.stringify(playlistOrder));
    localStorage.setItem(LS_PLAYLIST_INDEX, JSON.stringify(playlistOrder));
    await savePlaylistOrder();

    renderPlaylistsUI();
    showToast("Vymazané ✅", true);
  } catch(e) {
    showToast("Nepodarilo sa vymazať ❌", false);
  }
}

async function savePlaylistOrder() {
  try {
    const payload = JSON.stringify(playlistOrder || []);
    await fetch(`${SCRIPT_URL}?action=save&name=PlaylistOrder&pwd=${ADMIN_PWD}&content=${encodeURIComponent(payload)}`, { mode:'no-cors' });
  } catch(e) {}
}

// ===== Drag & Drop =====
function onDragStart(ev, ctx) {
  ev.dataTransfer.effectAllowed = "move";
  ev.dataTransfer.setData("text/plain", ev.currentTarget.getAttribute("data-idx"));
  ev.dataTransfer.setData("ctx", ctx);
}
function onDragOver(ev) {
  ev.preventDefault();
  ev.dataTransfer.dropEffect = "move";
}
function onDrop(ev, ctx) {
  ev.preventDefault();
  const from = parseInt(ev.dataTransfer.getData("text/plain"), 10);
  const to = parseInt(ev.currentTarget.getAttribute("data-idx"), 10);
  if (isNaN(from) || isNaN(to) || from === to) return;

  if (ctx === 'dnes') {
    moveInArray(dnesSelectedIds, from, to);
    renderDnesSelected();
  } else if (ctx === 'psongs') {
    moveInArray(selectedSongIds, from, to);
    renderPlaylistSelected();
  } else if (ctx === 'plist') {
    moveInArray(playlistOrder, from, to);
    localStorage.setItem(LS_PLAYLIST_ORDER, JSON.stringify(playlistOrder));
    localStorage.setItem(LS_PLAYLIST_INDEX, JSON.stringify(playlistOrder));
    renderPlaylistsUI();
    savePlaylistOrder();
  }
}
function moveInArray(arr, from, to) {
  const item = arr.splice(from, 1)[0];
  arr.splice(to, 0, item);
}

// ===== Update App =====
async function hardResetApp() {
  if (!confirm("Vymazať pamäť?")) return;

  localStorage.clear();
  try {
    const keys = await caches.keys();
    for (const k of keys) await caches.delete(k);
  } catch (e) {}

  location.reload(true);
}

// ===== Error report -> Formspree =====
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

    // Ensure subject is always set to current song
    if (currentSong) {
      formData.set("_subject", `${currentSong.displayId}. ${currentSong.title}`);
      formData.set("piesen", `${currentSong.displayId}. ${currentSong.title}`);
    }

    const res = await fetch(FORMSPREE_URL, {
      method: "POST",
      headers: { "Accept": "application/json" },
      body: formData
    });

    if (res.ok) {
      status.style.color = "#00ff00";
      status.innerText = "Chyba bola odoslaná!";
      form.reset();
      showToast("Odoslané ✅", true);
    } else {
      status.style.color = "#ff4444";
      status.innerText = "Nepodarilo sa odoslať. Skús ešte raz.";
      showToast("Neodoslané ❌", false);
    }
  } catch (e) {
    status.style.color = "#ff4444";
    status.innerText = "Nepodarilo sa odoslať. Skontroluj internet.";
    showToast("Neodoslané ❌", false);
  } finally {
    btn.disabled = false;
  }
}

// ===== Utils =====
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  }[m]));
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  // collapsed by default
  toggleSection('dnes', false);
  toggleSection('playlists', false);
  toggleSection('all', false);
  toggleSection('update', false);

  // immediate cache render (even before songs load)
  loadPlaylistsCacheFirst();

  parseXML();
});
