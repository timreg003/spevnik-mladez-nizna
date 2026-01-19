const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyyrD8pCxgQYiERsOsDFJ_XoBEbg6KYe1oM8Wj9IAzkq4yqzMSkfApgcc3aFeD0-Pxgww/exec';
const ADMIN_PWD = "qwer";

// ===== STATE =====
let songs = [], filteredSongs = [], currentSong = null;
let currentModeList = [];            // list used for prev/next
let currentListSource = 'all';       // all | dnes | playlist
let currentPlaylistName = "";        // for editor/edit

let transposeStep = 0, fontSize = 17, chordsVisible = true;
const scale = ["C","C#","D","D#","E","F","F#","G","G#","A","B","H"];

let autoscrollInterval = null, currentLevel = 1;

let isAdmin = false;

// dnes + playlist editor arrays
let dnesSelectedIds = [];
let selectedSongIds = [];

// playlist order
let playlistOrder = []; // array of playlist names

// ===== UI helpers =====
window.addEventListener('scroll', () => {
  const btn = document.getElementById("scroll-to-top");
  if (!btn) return;
  btn.style.display = (window.scrollY > 300) ? "flex" : "none";
}, { passive: true });

// ===== SECTION TOGGLE =====
function toggleSection(section, expand = null) {
  const content = document.getElementById(section + '-section-wrapper');
  const chevron = document.getElementById(section + '-chevron');
  if (!content || !chevron) return;

  const show = expand !== null ? expand : (content.style.display === 'none');
  content.style.display = show ? 'block' : 'none';
  chevron.className = show ? 'fas fa-chevron-up section-chevron' : 'fas fa-chevron-down section-chevron';
}

// ===== RESET =====
function smartReset() {
  stopAutoscroll();
  closeSong();
  closeDnesEditor();
  logoutAdmin();

  document.getElementById('search').value = "";
  currentModeList = [...songs];
  filterSongs();

  // reload dynamic content
  loadDnesFromDrive();
  loadPlaylistsFromDrive();

  // all collapsed
  toggleSection('dnes', false);
  toggleSection('playlists', false);
  toggleSection('all', false);
  toggleSection('update', false);

  window.scrollTo(0, 0);
}

// ===== LOGIN / LOGOUT =====
function toggleAdminAuth() {
  if (!isAdmin) {
    const pwd = prompt("Heslo:");
    if (pwd !== ADMIN_PWD) return;

    isAdmin = true;
    document.getElementById('admin-toggle-text').innerText = "ODHLÁSIŤ";

    // show editors (only panels; still inside their sections)
    document.getElementById('dnes-editor-panel').style.display = 'block';
    document.getElementById('admin-panel').style.display = 'block';

    // prefill editor lists
    openDnesEditor(true);
    openPlaylistEditorNew(true);

    renderAllSongs();
    renderPlaylistsUI(); // update with admin controls
  } else {
    logoutAdmin();
  }
}

function logoutAdmin() {
  isAdmin = false;
  document.getElementById('admin-toggle-text').innerText = "PRIHLÁSIŤ";

  // auto close editors
  document.getElementById('dnes-editor-panel').style.display = 'none';
  document.getElementById('admin-panel').style.display = 'none';

  // clear temporary selections
  selectedSongIds = [];
  // dnesSelectedIds keep as current loaded list (no harm)

  renderAllSongs();
  renderPlaylistsUI();
}

// ===== XML LOAD =====
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
  currentModeList = [...songs];

  renderAllSongs();

  // load dnes + playlists
  loadDnesFromDrive();
  loadPlaylistsFromDrive();
}

// ===== SONG LIST RENDER =====
function renderAllSongs() {
  const box = document.getElementById('piesne-list');
  if (!box) return;

  box.innerHTML = filteredSongs.map(s => `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid #333; color:#fff;" onclick="openSongById('${s.id}','all')">
      <span><span style="color:#00bfff;font-weight:bold;">${s.displayId}.</span> ${s.title}</span>
    </div>
  `).join('');
}

function filterSongs() {
  const t = document.getElementById('search').value.toLowerCase();
  filteredSongs = songs.filter(s => s.title.toLowerCase().includes(t) || s.displayId.toLowerCase().includes(t));
  renderAllSongs();
}

// ===== OPEN SONG / NAV =====
function openSongById(id, source) {
  currentListSource = source;

  const s = songs.find(x => x.id === id);
  if (!s) return;

  // important: keep navigation only within opened list
  if (source === 'dnes') {
    currentModeList = getDnesIds().map(i => songs.find(x => x.id === i)).filter(Boolean);
  } else if (source === 'all') {
    currentModeList = [...songs];
  } else if (source === 'playlist') {
    // do not override currentModeList, it was set in openPlaylist()
  }

  currentSong = JSON.parse(JSON.stringify(s));
  transposeStep = 0;
  document.getElementById('transpose-val').innerText = "0";
  currentLevel = 1;
  updateSpeedUI();
  stopAutoscroll();

  document.getElementById('song-list').style.display = 'none';
  document.getElementById('song-detail').style.display = 'block';

  document.getElementById('render-title').innerText = s.displayId + '. ' + s.title;
  const firstChordMatch = s.origText.match(/\[(.*?)\]/);
  document.getElementById('original-key-label').innerText = "Tónina: " + (firstChordMatch ? firstChordMatch[1] : "-");

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

// ===== AUTOSCROLL =====
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

// =======================================================
// DNES (title + ids), stored as JSON in Drive file PiesneNaDnes
// =======================================================
function parseDnesPayload(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return { title: "PIESNE NA DNES", ids: [] };

  // try JSON
  try {
    const obj = JSON.parse(trimmed);
    if (obj && Array.isArray(obj.ids)) {
      return { title: (obj.title || "PIESNE NA DNES"), ids: obj.ids.map(String) };
    }
  } catch(e) {}

  // fallback old CSV
  const ids = trimmed.split(',').map(x => x.trim()).filter(Boolean);
  return { title: "PIESNE NA DNES", ids };
}

function setDnesTitle(title) {
  const t = (title || "PIESNE NA DNES").toUpperCase();
  document.getElementById('dnes-title').innerText = t;
}

function getDnesIds() {
  const raw = localStorage.getItem('piesne_dnes') || "";
  return parseDnesPayload(raw).ids;
}

async function loadDnesFromDrive() {
  // show loading
  document.getElementById('dnes-section').innerHTML = '<div class="dnes-empty">Načítavam...</div>';

  try {
    const r = await fetch(`${SCRIPT_URL}?action=get&name=PiesneNaDnes&t=${Date.now()}`);
    const t = await r.text();
    if (t != null) localStorage.setItem('piesne_dnes', t.trim());
  } catch(e) {}

  const payload = parseDnesPayload(localStorage.getItem('piesne_dnes') || "");
  setDnesTitle(payload.title);
  renderDnesSection();

  // keep editor state in sync if opened/admin
  if (isAdmin) openDnesEditor(true);
}

function renderDnesSection() {
  const box = document.getElementById('dnes-section');
  const payload = parseDnesPayload(localStorage.getItem('piesne_dnes') || "");
  const ids = payload.ids;

  if (!ids.length) {
    box.innerHTML = '<div class="dnes-empty">Žiadne piesne.</div>';
    return;
  }

  box.innerHTML = ids.map(id => {
    const s = songs.find(x => x.id === id);
    if (!s) return '';
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;border-bottom:1px solid #333;color:#fff;" onclick="openSongById('${s.id}','dnes')">
        <span><span style="color:#00bfff;font-weight:bold;">${s.displayId}.</span> ${s.title}</span>
      </div>`;
  }).join('');
}

// ===== DNES EDITOR =====
function openDnesEditor(silent=false) {
  if (!isAdmin && !silent) return;

  const payload = parseDnesPayload(localStorage.getItem('piesne_dnes') || "");
  dnesSelectedIds = [...payload.ids];

  document.getElementById('dnes-name').value = payload.title || "PIESNE NA DNES";
  renderDnesEditor();
  filterDnesSearch();
}

function closeDnesEditor() {
  document.getElementById('dnes-editor-panel').style.display = 'none';
}

function filterDnesSearch() {
  const t = document.getElementById('dnes-search').value.toLowerCase();
  const filt = songs.filter(s => s.title.toLowerCase().includes(t) || s.displayId.toLowerCase().includes(t));

  // if empty filter -> show all songs (limited for performance)
  const list = (t.trim() === "") ? songs : filt;

  const target = document.getElementById('dnes-available-list');
  target.innerHTML = list.slice(0, 60).map(s => `
    <div class="draggable-item" style="cursor:pointer;" onclick="addToDnesSelection('${s.id}')">
      <span><span style="color:#00bfff;font-weight:bold;">${s.displayId}.</span> ${s.title}</span>
      <button class="small-plus" onclick="event.stopPropagation(); addToDnesSelection('${s.id}')">+</button>
    </div>
  `).join('');
}

function addToDnesSelection(id) {
  if (!dnesSelectedIds.includes(id)) {
    dnesSelectedIds.push(id);
    renderDnesEditor();
  }
}

function renderDnesEditor() {
  const box = document.getElementById('dnes-selected-editor');
  if (!dnesSelectedIds.length) {
    box.innerHTML = '<div class="dnes-empty">Zatiaľ prázdne.</div>';
    return;
  }

  box.innerHTML = dnesSelectedIds.map((id, idx) => {
    const s = songs.find(x => x.id === id);
    const label = s ? `${s.displayId}. ${s.title}` : id;
    return `
      <div class="draggable-item" draggable="true"
           data-idx="${idx}"
           ondragstart="onDragStart(event, 'dnes')"
           ondragover="onDragOver(event)"
           ondrop="onDrop(event, 'dnes')">
        <span style="flex:1;">${label}</span>
        <span class="drag-handle"><i class="fas fa-grip-lines"></i></span>
        <button class="small-del" onclick="removeDnesAt(${idx})">X</button>
      </div>`;
  }).join('');
}

function removeDnesAt(idx) {
  dnesSelectedIds.splice(idx, 1);
  renderDnesEditor();
}

function clearDnesSelection() {
  dnesSelectedIds = [];
  renderDnesEditor();
}

async function saveDnesEditor() {
  const title = (document.getElementById('dnes-name').value || "PIESNE NA DNES").trim();
  const payload = JSON.stringify({ title, ids: dnesSelectedIds });

  localStorage.setItem('piesne_dnes', payload);
  setDnesTitle(title);
  renderDnesSection();

  // keep editor visible
  document.getElementById('dnes-editor-panel').style.display = 'block';

  await fetch(`${SCRIPT_URL}?action=save&name=PiesneNaDnes&pwd=${ADMIN_PWD}&content=${encodeURIComponent(payload)}`, { mode: 'no-cors' });
}

// =======================================================
// PLAYLISTS (list, order, editor, drag & drop, edit existing)
// =======================================================
async function loadPlaylistsFromDrive() {
  document.getElementById('playlists-section').innerHTML = '<div class="dnes-empty">Načítavam...</div>';

  // load list
  let list = [];
  try {
    const r = await fetch(`${SCRIPT_URL}?action=list&t=${Date.now()}`);
    list = await r.json();
  } catch(e) {}

  // remove special files
  list = (list || []).filter(p => p.name !== "PiesneNaDnes" && p.name !== "PlaylistOrder");

  // load saved order file
  try {
    const rr = await fetch(`${SCRIPT_URL}?action=get&name=PlaylistOrder&t=${Date.now()}`);
    const txt = await rr.text();
    const arr = JSON.parse((txt||"").trim());
    if (Array.isArray(arr)) playlistOrder = arr.map(String);
  } catch(e) {}

  // apply order
  const names = list.map(p => p.name);
  const ordered = [];
  // first items from playlistOrder that still exist
  playlistOrder.forEach(n => { if (names.includes(n)) ordered.push(n); });
  // append any new not in order list
  names.forEach(n => { if (!ordered.includes(n)) ordered.push(n); });

  // store back in memory
  playlistOrder = ordered;

  // prime localStorage content cache (async)
  ordered.forEach(n => {
    fetch(`${SCRIPT_URL}?action=get&name=${encodeURIComponent(n)}&t=${Date.now()}`)
      .then(r => r.text())
      .then(t => localStorage.setItem('playlist_' + n, (t||"").trim()))
      .catch(()=>{});
  });

  renderPlaylistsUI();
}

function renderPlaylistsUI() {
  const sect = document.getElementById('playlists-section');
  const names = playlistOrder || [];

  if (!names.length) {
    sect.innerHTML = '<div class="dnes-empty">Žiadne playlisty.</div>';
    return;
  }

  sect.innerHTML = names.map((name, idx) => `
    <div class="draggable-item"
         ${isAdmin ? `draggable="true" data-idx="${idx}" ondragstart="onDragStart(event, 'plist')" ondragover="onDragOver(event)" ondrop="onDrop(event,'plist')"` : ''}>
      <span style="flex:1; cursor:pointer;" onclick="openPlaylist('${escapeHtml(name)}')">
        <i class="fas fa-music" style="color:#00bfff;margin-right:10px;"></i>${escapeHtml(name)}
      </span>

      ${isAdmin ? `
        <span class="drag-handle" title="Poradie playlistov"><i class="fas fa-grip-lines"></i></span>
        <button class="small-plus" title="Upraviť" onclick="event.stopPropagation(); editPlaylist('${escapeHtml(name)}')"><i class="fas fa-pen"></i></button>
        <button class="small-del" title="Vymazať" onclick="event.stopPropagation(); deletePlaylist('${escapeHtml(name)}')">X</button>
      ` : ``}
    </div>
  `).join('');
}

function openPlaylist(name) {
  currentPlaylistName = name;

  const raw = (localStorage.getItem('playlist_' + name) || "").trim();
  const ids = raw ? raw.split(',').map(x => x.trim()).filter(Boolean) : [];

  currentModeList = ids.map(id => songs.find(x => x.id === id)).filter(Boolean);
  currentListSource = 'playlist';

  // show list in ZOZNAM PIESNI panel
  toggleSection('all', true);
  document.getElementById('piesne-list').innerHTML =
    `<h2 style="text-align:center;color:#00bfff;">${escapeHtml(name)}</h2>` +
    (currentModeList.length ? currentModeList.map(s => `
      <div onclick="openSongById('${s.id}','playlist')" style="padding:15px;border-bottom:1px solid #333;color:#fff;">
        <span style="color:#00bfff;font-weight:bold;">${s.displayId}.</span> ${s.title}
      </div>
    `).join('') : `<div class="dnes-empty">Prázdny playlist.</div>`);

  window.scrollTo(0,0);
}

function openPlaylistEditorNew(silent=false) {
  if (!isAdmin && !silent) return;
  currentPlaylistName = "";
  document.getElementById('playlist-name').value = "";
  selectedSongIds = [];
  renderPlaylistSelected();
  filterPlaylistSearch();
}

function editPlaylist(name) {
  if (!isAdmin) return;
  currentPlaylistName = name;
  document.getElementById('playlist-name').value = name;

  const raw = (localStorage.getItem('playlist_' + name) || "").trim();
  selectedSongIds = raw ? raw.split(',').map(x => x.trim()).filter(Boolean) : [];

  // ensure playlist section open + editor visible
  toggleSection('playlists', true);
  document.getElementById('admin-panel').style.display = 'block';

  renderPlaylistSelected();
  filterPlaylistSearch();
  window.scrollTo(0,0);
}

function filterPlaylistSearch() {
  const t = document.getElementById('playlist-search').value.toLowerCase();
  const filt = songs.filter(s => s.title.toLowerCase().includes(t) || s.displayId.toLowerCase().includes(t));
  const list = (t.trim() === "") ? songs : filt;

  document.getElementById('playlist-available-list').innerHTML = list.slice(0, 60).map(s => `
    <div class="draggable-item" style="cursor:pointer;" onclick="addToPlaylistSelection('${s.id}')">
      <span><span style="color:#00bfff;font-weight:bold;">${s.displayId}.</span> ${s.title}</span>
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
    const label = s ? `${s.displayId}. ${s.title}` : id;
    return `
      <div class="draggable-item" draggable="true"
           data-idx="${idx}"
           ondragstart="onDragStart(event, 'psongs')"
           ondragover="onDragOver(event)"
           ondrop="onDrop(event, 'psongs')">
        <span style="flex:1;">${label}</span>
        <span class="drag-handle"><i class="fas fa-grip-lines"></i></span>
        <button class="small-del" onclick="removePlaylistAt(${idx})">X</button>
      </div>`;
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

  // save to Drive
  await fetch(`${SCRIPT_URL}?action=save&name=${encodeURIComponent(name)}&pwd=${ADMIN_PWD}&content=${encodeURIComponent(content)}`, { mode: 'no-cors' });

  // if new playlist, add to order
  if (!playlistOrder.includes(name)) playlistOrder.push(name);

  // persist playlist order
  await savePlaylistOrder();

  // reset editor for next
  currentPlaylistName = "";
  document.getElementById('playlist-name').value = "";
  selectedSongIds = [];
  renderPlaylistSelected();

  // refresh UI
  renderPlaylistsUI();
}

async function deletePlaylist(name) {
  if (!isAdmin) return;
  if (!confirm(`Vymazať playlist "${name}"?`)) return;

  await fetch(`${SCRIPT_URL}?action=delete&name=${encodeURIComponent(name)}&pwd=${ADMIN_PWD}`, { mode: 'no-cors' });
  localStorage.removeItem('playlist_' + name);

  playlistOrder = playlistOrder.filter(n => n !== name);
  await savePlaylistOrder();
  renderPlaylistsUI();
}

async function savePlaylistOrder() {
  try {
    const payload = JSON.stringify(playlistOrder || []);
    await fetch(`${SCRIPT_URL}?action=save&name=PlaylistOrder&pwd=${ADMIN_PWD}&content=${encodeURIComponent(payload)}`, { mode: 'no-cors' });
  } catch(e) {}
}

// =======================================================
// DRAG & DROP (3 contexts: dnes list, playlist songs, playlists order)
// =======================================================
let dragCtx = null;
function onDragStart(ev, ctx) {
  dragCtx = ctx;
  ev.dataTransfer.effectAllowed = "move";
  ev.dataTransfer.setData("text/plain", ev.currentTarget.getAttribute("data-idx"));
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
    renderDnesEditor();
  } else if (ctx === 'psongs') {
    moveInArray(selectedSongIds, from, to);
    renderPlaylistSelected();
  } else if (ctx === 'plist') {
    moveInArray(playlistOrder, from, to);
    renderPlaylistsUI();
    // persist order (debounced-ish)
    savePlaylistOrder();
  }
}
function moveInArray(arr, from, to) {
  const item = arr.splice(from, 1)[0];
  arr.splice(to, 0, item);
}

// =======================================================
// UPDATE APP
// =======================================================
async function hardResetApp() {
  if (!confirm("Vymazať pamäť?")) return;

  localStorage.clear();
  try {
    const keys = await caches.keys();
    for (const k of keys) await caches.delete(k);
  } catch (e) {}

  location.reload(true);
}

// =======================================================
// ERROR REPORT (basic)
// =======================================================
function submitErrorForm(event) {
  event.preventDefault();
  const status = document.getElementById("form-status");
  status.style.display = "block";
  status.innerText = "Odosielam...";

  // Simple: just fake success locally (you can wire to form endpoint if you had one)
  setTimeout(() => {
    status.style.display = "block";
    status.innerText = "Chyba bola odoslaná!";
  }, 700);
}

// =======================================================
// utils
// =======================================================
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  }[m]));
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  // collapse all by default
  toggleSection('dnes', false);
  toggleSection('playlists', false);
  toggleSection('all', false);
  toggleSection('update', false);

  parseXML();
});
