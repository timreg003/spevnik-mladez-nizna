const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyyrD8pCxgQYiERsOsDFJ_XoBEbg6KYe1oM8Wj9IAzkq4yqzMSkfApgcc3aFeD0-Pxgww/exec';
const ADMIN_PWD = "qwer";
const FORMSPREE_URL = "https://formspree.io/f/mvzzkwlw";

// ===== STATE =====
let songs = [], filteredSongs = [], currentSong = null;
let currentModeList = [];
let currentListSource = 'all';
let currentPlaylistName = "";

let transposeStep = 0, fontSize = 17, chordsVisible = true;
const scale = ["C","C#","D","D#","E","F","F#","G","G#","A","B","H"];

let autoscrollInterval = null, currentLevel = 1;

let isAdmin = false;

// editors
let dnesSelectedIds = [];
let selectedSongIds = [];

// playlists order
let playlistOrder = [];

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
  logoutAdmin();

  document.getElementById('search').value = "";
  currentModeList = [...songs];
  filterSongs();

  loadDnesFromDrive();
  loadPlaylistsFromDrive();

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

    document.getElementById('dnes-editor-panel').style.display = 'block';
    document.getElementById('admin-panel').style.display = 'block';

    openDnesEditor(true);
    openPlaylistEditorNew(true);

    renderAllSongs();
    renderPlaylistsUI();
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

  if (source === 'dnes') {
    currentModeList = getDnesIds().map(i => songs.find(x => x.id === i)).filter(Boolean);
  } else if (source === 'all') {
    currentModeList = [...songs];
  } else if (source === 'playlist') {
    // currentModeList already set in openPlaylist()
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

  // pre error form
  const hidden = document.getElementById('error-song-hidden');
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
// DNES (title + ids)
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
  const t = (title || "PIESNE NA DNES").toUpperCase();
  document.getElementById('dnes-title').innerText = t;
}

function getDnesIds() {
  const raw = localStorage.getItem('piesne_dnes') || "";
  return parseDnesPayload(raw).ids;
}

async function loadDnesFromDrive() {
  document.getElementById('dnes-section').innerHTML = '<div class="dnes-empty">Načítavam...</div>';

  try {
    const r = await fetch(`${SCRIPT_URL}?action=get&name=PiesneNaDnes&t=${Date.now()}`);
    const t = await r.text();
    if (t != null) localStorage.setItem('piesne_dnes', t.trim());
  } catch(e) {}

  const payload = parseDnesPayload(localStorage.getItem('piesne_dnes') || "");
  setDnesTitle(payload.title);
  renderDnesSection();

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

function filterDnesSearch() {
  const t = document.getElementById('dnes-search').value.toLowerCase();
  const list = (t.trim() === "")
    ? songs
    : songs.filter(s => s.title.toLowerCase().includes(t) || s.displayId.toLowerCase().includes(t));

  const target = document.getElementById('dnes-available-list');
  target.innerHTML = list.map(s => `
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

  await fetch(`${SCRIPT_URL}?action=save&name=PiesneNaDnes&pwd=${ADMIN_PWD}&content=${encodeURIComponent(payload)}`, { mode: 'no-cors' });
}

// =======================================================
// PLAYLISTS (list, order, editor)
// =======================================================
async function loadPlaylistsFromDrive() {
  document.getElementById('playlists-section').innerHTML = '<div class="dnes-empty">Načítavam...</div>';

  let list = [];
  try {
    const r = await fetch(`${SCRIPT_URL}?action=list&t=${Date.now()}`);
    list = await r.json();
  } catch(e) {}

  list = (list || []).filter(p => p.name !== "PiesneNaDnes" && p.name !== "PlaylistOrder");

  try {
    const rr = await fetch(`${SCRIPT_URL}?action=get&name=PlaylistOrder&t=${Date.now()}`);
    const txt = await rr.text();
    const arr = JSON.parse((txt||"").trim());
    if (Array.isArray(arr)) playlistOrder = arr.map(String);
  } catch(e) {}

  const names = list.map(p => p.name);
  const ordered = [];

  playlistOrder.forEach(n => { if (names.includes(n)) ordered.push(n); });
  names.forEach(n => { if (!ordered.includes(n)) ordered.push(n); });

  playlistOrder = ordered;

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
      <span style="flex:1; cursor:pointer;" onclick="openPlaylist('${encodeURIComponent(name)}')">
        <i class="fas fa-music" style="color:#00bfff;margin-right:10px;"></i>${escapeHtml(name)}
      </span>

      ${isAdmin ? `
        <span class="drag-handle" title="Poradie playlistov"><i class="fas fa-grip-lines"></i></span>
        <button class="small-plus" title="Upraviť" onclick="event.stopPropagation(); editPlaylist('${encodeURIComponent(name)}')"><i class="fas fa-pen"></i></button>
        <button class="small-del" title="Vymazať" onclick="event.stopPropagation(); deletePlaylist('${encodeURIComponent(name)}')">X</button>
      ` : ``}
    </div>
  `).join('');
}

function openPlaylist(nameEnc) {
  const name = decodeURIComponent(nameEnc);
  currentPlaylistName = name;

  const raw = (localStorage.getItem('playlist_' + name) || "").trim();
  const ids = raw ? raw.split(',').map(x => x.trim()).filter(Boolean) : [];

  currentModeList = ids.map(id => songs.find(x => x.id === id)).filter(Boolean);
  currentListSource = 'playlist';

  toggleSection('all', true);
  document.getElementById('piesne-list').innerHTML =
    `<h2 style="text-align:center;color:#00bfff;">${escapeHtml(name)}</h2>` +
    (currentModeList.length ? currentModeList.map(s => `
      <div onclick="openSongById('${s.id}','playlist')" style="padding:15px;border-bottom:1px solid #333;color:#fff;">
        <span style="color:#00bfff;font-weight:bold;">${s.displayId}.</span> ${s.title}
      </div>
    `).join('') : `<div class="dnes-empty">Prázdny playlist.</div>`);
}

function openPlaylistEditorNew(silent=false) {
  if (!isAdmin && !silent) return;
  currentPlaylistName = "";
  document.getElementById('playlist-name').value = "";
  selectedSongIds = [];
  renderPlaylistSelected();
  filterPlaylistSearch();
}

function editPlaylist(nameEnc) {
  if (!isAdmin) return;
  const name = decodeURIComponent(nameEnc);

  currentPlaylistName = name;
  document.getElementById('playlist-name').value = name;

  const raw = (localStorage.getItem('playlist_' + name) || "").trim();
  selectedSongIds = raw ? raw.split(',').map(x => x.trim()).filter(Boolean) : [];

  toggleSection('playlists', true);
  document.getElementById('admin-panel').style.display = 'block';

  renderPlaylistSelected();
  filterPlaylistSearch();
}

function filterPlaylistSearch() {
  const t = document.getElementById('playlist-search').value.toLowerCase();
  const list = (t.trim() === "")
    ? songs
    : songs.filter(s => s.title.toLowerCase().includes(t) || s.displayId.toLowerCase().includes(t));

  document.getElementById('playlist-available-list').innerHTML = list.map(s => `
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

  await fetch(`${SCRIPT_URL}?action=save&name=${encodeURIComponent(name)}&pwd=${ADMIN_PWD}&content=${encodeURIComponent(content)}`, { mode: 'no-cors' });

  if (!playlistOrder.includes(name)) playlistOrder.push(name);
  await savePlaylistOrder();

  currentPlaylistName = "";
  document.getElementById('playlist-name').value = "";
  selectedSongIds = [];
  renderPlaylistSelected();

  renderPlaylistsUI();
}

async function deletePlaylist(nameEnc) {
  if (!isAdmin) return;
  const name = decodeURIComponent(nameEnc);

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
// DRAG & DROP
// =======================================================
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
    renderDnesEditor();
  } else if (ctx === 'psongs') {
    moveInArray(selectedSongIds, from, to);
    renderPlaylistSelected();
  } else if (ctx === 'plist') {
    moveInArray(playlistOrder, from, to);
    renderPlaylistsUI();
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
// ✅ ERROR REPORT -> Formspree
// =======================================================
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

    // add song info (safety)
    if (currentSong) {
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
    } else {
      status.style.color = "#ff4444";
      status.innerText = "Nepodarilo sa odoslať. Skús ešte raz.";
    }
  } catch (e) {
    status.style.color = "#ff4444";
    status.innerText = "Nepodarilo sa odoslať. Skontroluj internet.";
  } finally {
    btn.disabled = false;
  }
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
  toggleSection('dnes', false);
  toggleSection('playlists', false);
  toggleSection('all', false);
  toggleSection('update', false);

  parseXML();
});
