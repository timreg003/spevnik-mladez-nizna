const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyyrD8pCxgQYiERsOsDFJ_XoBEbg6KYe1oM8Wj9IAzkq4yqzMSkfApgcc3aFeD0-Pxgww/exec';
const ADMIN_PWD = "qwer";

// PIESNE
let songs = [], filteredSongs = [], currentSong = null;
let currentModeList = [];
let currentListSource = 'all';

// ZOBRAZENIE
let transposeStep = 0, fontSize = 17, chordsVisible = true;
const scale = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "B", "H"];

// AUTOSCROLL
let autoscrollInterval = null, currentLevel = 1;

// ADMIN
let isAdmin = false;

// DNES
let dnesSelectedIds = [];
let dnesTitle = "PIESNE NA DNES";

// PLAYLIST EDITOR
let selectedSongIds = [];
let editingPlaylistName = "";

// Scroll-to-top button
window.addEventListener('scroll', () => {
  const btn = document.getElementById("scroll-to-top");
  if (!btn) return;
  btn.style.display = (window.scrollY > 300) ? "flex" : "none";
}, { passive: true });

/* ===== RESET ===== */
function smartReset() {
  stopAutoscroll();
  closeSong();
  closeDnesEditor();
  logoutAdmin(false);

  document.getElementById('search').value = "";
  currentModeList = [...songs];
  filterSongs();

  loadPlaylistHeaders();
  loadDnesFromDrive();

  // default: všetko zbalené
  toggleSection('dnes', false);
  toggleSection('playlists', false);
  toggleSection('all', false);
  toggleSection('update', false);

  window.scrollTo(0, 0);
}

/* ===== LOGIN / LOGOUT ===== */
function toggleAdminAuth() {
  if (!isAdmin) {
    const pwd = prompt("Heslo:");
    if (pwd !== ADMIN_PWD) return;

    isAdmin = true;
    document.getElementById('admin-toggle-text').innerText = "ODHLÁSIŤ";
    // ukáž editory (ale sekcie ostanú podľa toho či sú otvorené)
    document.getElementById('admin-panel').style.display = 'block';
    document.getElementById('dnes-editor-panel').style.display = 'block';
    renderAllSongs();
    loadPlaylistHeaders();
  } else {
    logoutAdmin(true);
  }
}

function logoutAdmin(closeEditors) {
  isAdmin = false;
  document.getElementById('admin-toggle-text').innerText = "PRIHLÁSIŤ";

  if (closeEditors) {
    // schovaj editory
    document.getElementById('admin-panel').style.display = 'none';
    document.getElementById('dnes-editor-panel').style.display = 'none';
    // vyčisti výbery
    selectedSongIds = [];
    dnesSelectedIds = dnesSelectedIds || [];
  }

  renderAllSongs();
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

  // ZORADENIE: čísla -> mariánske -> textové
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
  loadPlaylistHeaders();
  loadDnesFromDrive();
}

/* ===== RENDER SONG LIST ===== */
function renderAllSongs() {
  const el = document.getElementById('piesne-list');
  if (!el) return;

  el.innerHTML = filteredSongs.map(s => `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom: 1px solid #333; color:#fff;" onclick="openSongById('${s.id}', 'all')">
      <span><span style="color:#00bfff;font-weight:bold;">${s.displayId}.</span> ${s.title}</span>
    </div>
  `).join('');
}

/* ===== OPEN SONG ===== */
function openSongById(id, source) {
  currentListSource = source;
  const s = songs.find(x => x.id === id);
  if (!s) return;

  if (source === 'dnes') {
    const ids = getDnesIdsFromStorage();
    currentModeList = ids.map(i => songs.find(x => x.id === i)).filter(Boolean);
  } else if (source === 'playlist') {
    // currentModeList už je nastavený v openPlaylist
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

  document.getElementById('render-title').innerText = s.displayId + '. ' + s.title;

  const firstChordMatch = s.origText.match(/\[(.*?)\]/);
  document.getElementById('original-key-label').innerText = "Tónina: " + (firstChordMatch ? firstChordMatch[1] : "-");

  renderSong();
  window.scrollTo(0, 0);
}

function closeSong() {
  stopAutoscroll();
  const list = document.getElementById('song-list');
  const detail = document.getElementById('song-detail');
  if (detail) detail.style.display = 'none';
  if (list) list.style.display = 'block';
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

function navigateSong(d) {
  if (!currentSong) return;
  const idx = currentModeList.findIndex(s => s.id === currentSong.id);
  const n = currentModeList[idx + d];
  if (n) openSongById(n.id, currentListSource);
}

function transposeChord(c, s) {
  return c.replace(/[A-H][#b]?/g, (n) => {
    let note = n;
    let idx = scale.indexOf(note);
    if (idx === -1) return n;

    let newIdx = (idx + s) % 12;
    while (newIdx < 0) newIdx += 12;
    return scale[newIdx];
  });
}

function transposeSong(d) {
  transposeStep += d;
  document.getElementById('transpose-val').innerText = (transposeStep > 0 ? "+" : "") + transposeStep;
  renderSong();
}
function resetTranspose() {
  transposeStep = 0;
  document.getElementById('transpose-val').innerText = "0";
  renderSong();
}
function toggleChords() {
  chordsVisible = !chordsVisible;
  renderSong();
}
function changeFontSize(d) {
  fontSize += d;
  renderSong();
}

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
  let delay = 260 - (currentLevel * 12);

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

/* ===== FILTER SONGS ===== */
function filterSongs() {
  const t = document.getElementById('search').value.toLowerCase();
  filteredSongs = songs.filter(s =>
    s.title.toLowerCase().includes(t) || s.displayId.toLowerCase().includes(t)
  );
  renderAllSongs();
}

/* ===== DNES: load/save (title + ids) ===== */
function getDnesIdsFromStorage() {
  const raw = (localStorage.getItem('piesne_dnes') || '').trim();
  if (!raw) return [];

  try {
    const obj = JSON.parse(raw);
    if (obj && Array.isArray(obj.ids)) return obj.ids.map(String);
  } catch (e) {}

  // fallback: starý formát CSV
  return raw.split(',').map(x => x.trim()).filter(Boolean);
}

function setDnesTitleOnUI(title) {
  const t = (title || "PIESNE NA DNES").toUpperCase();
  document.getElementById('dnes-title').innerText = t;
  dnesTitle = t;
}

async function loadDnesFromDrive() {
  try {
    const r = await fetch(`${SCRIPT_URL}?action=get&name=PiesneNaDnes&t=${Date.now()}`);
    const text = await r.text();
    if (text != null) localStorage.setItem('piesne_dnes', text.trim());
  } catch(e) {}

  // apply title + ids
  const raw = (localStorage.getItem('piesne_dnes') || '').trim();
  let title = "PIESNE NA DNES";

  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj.title === 'string') title = obj.title;
  } catch (e) {}

  setDnesTitleOnUI(title);
  renderDnesSection();
}

function renderDnesSection() {
  const box = document.getElementById('dnes-section');
  const ids = getDnesIdsFromStorage();

  if (!ids.length) {
    box.innerHTML = '<div class="dnes-empty">Žiadne piesne.</div>';
    return;
  }

  box.innerHTML = ids.map(id => {
    const s = songs.find(x => x.id === id);
    return s ? `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;border-bottom:1px solid #333;color:#fff;" onclick="openSongById('${s.id}','dnes')">
        <span><span style="color:#00bfff;font-weight:bold;">${s.displayId}.</span> ${s.title}</span>
      </div>` : '';
  }).join('');
}

/* Editor dnes */
function closeDnesEditor() {
  if (!isAdmin) return;
  document.getElementById('dnes-editor-panel').style.display = 'none';
}
function openDnesEditor() {
  if (!isAdmin) return;
  document.getElementById('dnes-editor-panel').style.display = 'block';

  dnesSelectedIds = getDnesIdsFromStorage();
  document.getElementById('dnes-name').value = dnesTitle || "PIESNE NA DNES";

  renderDnesEditor();
  filterDnesSearch();
}

function renderDnesEditor() {
  const box = document.getElementById('dnes-selected-editor');
  box.innerHTML = dnesSelectedIds.map((id, i) => {
    const s = songs.find(x => x.id === id);
    return `
      <div class="editor-item" style="display:flex;padding:5px;background:#222;margin-bottom:2px;border-radius:5px;align-items:center;justify-content:space-between;">
        <span style="font-size:12px;">${s ? (s.displayId + '. ' + s.title) : id}</span>
        <div>
          <button onclick="moveDnesEdit(${i},-1)">↑</button>
          <button onclick="moveDnesEdit(${i},1)">↓</button>
          <button onclick="removeDnesEdit(${i})" style="color:red;">X</button>
        </div>
      </div>`;
  }).join('');
}
function moveDnesEdit(i, d) {
  const n = i + d;
  if (n < 0 || n >= dnesSelectedIds.length) return;
  [dnesSelectedIds[i], dnesSelectedIds[n]] = [dnesSelectedIds[n], dnesSelectedIds[i]];
  renderDnesEditor();
}
function removeDnesEdit(i) {
  dnesSelectedIds.splice(i, 1);
  renderDnesEditor();
}
function clearDnesSelection() {
  dnesSelectedIds = [];
  renderDnesEditor();
}
function addToDnesSelection(id) {
  if (!dnesSelectedIds.includes(id)) dnesSelectedIds.push(id);
  renderDnesEditor();
}
function filterDnesSearch() {
  const t = document.getElementById('dnes-search').value.toLowerCase();
  const filt = songs.filter(s => s.title.toLowerCase().includes(t) || s.displayId.toLowerCase().includes(t));

  document.getElementById('dnes-available-list').innerHTML = filt.slice(0, 30).map(s => `
    <div style="padding:8px;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center;">
      <span><span style="color:#00bfff;font-weight:bold;">${s.displayId}.</span> ${s.title}</span>
      <button onclick="addToDnesSelection('${s.id}')" style="background:#00bfff;color:black;border-radius:6px;font-weight:bold;">+</button>
    </div>`).join('');
}

async function saveDnesEditor() {
  if (!isAdmin) return;

  const titleInput = (document.getElementById('dnes-name').value || "PIESNE NA DNES").trim();
  const payload = JSON.stringify({ title: titleInput, ids: dnesSelectedIds });

  localStorage.setItem('piesne_dnes', payload);
  setDnesTitleOnUI(titleInput);
  renderDnesSection();

  await fetch(`${SCRIPT_URL}?action=save&name=PiesneNaDnes&pwd=${ADMIN_PWD}&content=${encodeURIComponent(payload)}`, { mode: 'no-cors' });
}

/* ===== PLAYLISTY (základ) ===== */
function loadPlaylistHeaders() {
  fetch(`${SCRIPT_URL}?action=list`)
    .then(r => r.json())
    .then(d => {
      renderPlaylists(d);
      d.forEach(p => fetch(`${SCRIPT_URL}?action=get&name=${encodeURIComponent(p.name)}`)
        .then(r => r.text())
        .then(t => localStorage.setItem('playlist_' + p.name, t))
      );
    })
    .catch(() => renderPlaylists([]));
}

function renderPlaylists(d) {
  const sect = document.getElementById('playlists-section');

  if (!d || !d.length) {
    sect.innerHTML = '<div class="dnes-empty">Žiadne playlisty.</div>';
    return;
  }

  sect.innerHTML = d.map(p => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:15px;border-bottom:1px solid #333;">
      <span onclick="openPlaylist('${p.name}')" style="flex-grow:1;color:#fff;">
        <i class="fas fa-music" style="color:#00bfff;margin-right:10px;"></i>${p.name}
      </span>
      ${isAdmin ? `<i class="fas fa-trash" onclick="event.stopPropagation(); deletePlaylist('${p.name}')" style="color:red;padding:10px;"></i>` : ''}
    </div>
  `).join('');
}

function openPlaylist(name) {
  const ids = (localStorage.getItem('playlist_' + name) || '').split(',').map(x => x.trim()).filter(Boolean);
  currentModeList = ids.map(id => songs.find(x => x.id === id)).filter(Boolean);

  // zobraz playlist v piesne-list
  toggleSection('all', true);
  document.getElementById('piesne-list').innerHTML =
    `<h2 style="text-align:center;color:#00bfff;">${name}</h2>` +
    currentModeList.map(s => `
      <div onclick="openSongById('${s.id}','playlist')" style="padding:15px;border-bottom:1px solid #333;color:#fff;">
        <span style="color:#00bfff;font-weight:bold;">${s.displayId}.</span> ${s.title}
      </div>
    `).join('');

  window.scrollTo(0, 0);
}

async function deletePlaylist(name) {
  if (!isAdmin) return;
  if (!confirm(`Vymazať playlist "${name}"?`)) return;

  await fetch(`${SCRIPT_URL}?action=delete&name=${encodeURIComponent(name)}&pwd=${ADMIN_PWD}`, { mode: 'no-cors' });
  localStorage.removeItem('playlist_' + name);
  loadPlaylistHeaders();
}

/* Playlist editor (výber piesní) */
function clearSelection() {
  selectedSongIds = [];
  renderPlaylistEditorSelected();
}
function addToSelection(id) {
  if (!selectedSongIds.includes(id)) selectedSongIds.push(id);
  renderPlaylistEditorSelected();
}
function renderPlaylistEditorSelected() {
  const box = document.getElementById('selected-list-editor');
  box.innerHTML = selectedSongIds.map((id, i) => {
    const s = songs.find(x => x.id === id);
    return `
      <div class="editor-item" style="display:flex;padding:5px;background:#222;margin-bottom:2px;border-radius:5px;align-items:center;justify-content:space-between;">
        <span style="font-size:12px;">${s ? (s.displayId + '. ' + s.title) : id}</span>
        <div>
          <button onclick="movePlaylistEdit(${i},-1)">↑</button>
          <button onclick="movePlaylistEdit(${i},1)">↓</button>
          <button onclick="removePlaylistEdit(${i})" style="color:red;">X</button>
        </div>
      </div>`;
  }).join('');
}
function movePlaylistEdit(i, d) {
  const n = i + d;
  if (n < 0 || n >= selectedSongIds.length) return;
  [selectedSongIds[i], selectedSongIds[n]] = [selectedSongIds[n], selectedSongIds[i]];
  renderPlaylistEditorSelected();
}
function removePlaylistEdit(i) {
  selectedSongIds.splice(i, 1);
  renderPlaylistEditorSelected();
}
function filterPlaylistSearch() {
  const t = document.getElementById('playlist-search').value.toLowerCase();
  const filt = songs.filter(s => s.title.toLowerCase().includes(t) || s.displayId.toLowerCase().includes(t));

  document.getElementById('playlist-available-list').innerHTML = filt.slice(0, 30).map(s => `
    <div style="padding:8px;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center;">
      <span><span style="color:#00bfff;font-weight:bold;">${s.displayId}.</span> ${s.title}</span>
      <button onclick="addToSelection('${s.id}')" style="background:#00bfff;color:black;border-radius:6px;font-weight:bold;">+</button>
    </div>`).join('');
}
async function savePlaylist() {
  if (!isAdmin) return;

  const name = (document.getElementById('playlist-name').value || '').trim();
  if (!name) return alert("Zadaj názov playlistu.");

  const content = selectedSongIds.join(',');
  localStorage.setItem('playlist_' + name, content);

  await fetch(`${SCRIPT_URL}?action=save&name=${encodeURIComponent(name)}&pwd=${ADMIN_PWD}&content=${encodeURIComponent(content)}`, { mode: 'no-cors' });

  selectedSongIds = [];
  renderPlaylistEditorSelected();
  loadPlaylistHeaders();
}

/* ===== AKTUALIZÁCIA ===== */
async function hardResetApp() {
  if (!confirm("Vymazať pamäť?")) return;

  localStorage.clear();

  try {
    const keys = await caches.keys();
    for (const k of keys) await caches.delete(k);
  } catch (e) {}

  location.reload(true);
}

/* ===== SEKČIE ===== */
function toggleSection(section, expand = null) {
  const content = document.getElementById(section + '-section-wrapper');
  const chevron = document.getElementById(section + '-chevron');
  if (!content || !chevron) return;

  const show = expand !== null ? expand : (content.style.display === 'none');
  content.style.display = show ? 'block' : 'none';
  chevron.className = show ? 'fas fa-chevron-up section-chevron' : 'fas fa-chevron-down section-chevron';

  // keď admin a otvoríš dnes sekciu, rovno ukáž editor a načítaj ho
  if (section === 'dnes' && show && isAdmin) {
    document.getElementById('dnes-editor-panel').style.display = 'block';
    openDnesEditor();
  }
  if (section === 'playlists' && show && isAdmin) {
    document.getElementById('admin-panel').style.display = 'block';
    renderPlaylistEditorSelected();
    filterPlaylistSearch();
  }
}

/* ===== INIT ===== */
document.addEventListener('DOMContentLoaded', () => {
  parseXML();

  // všetko zbalené
  toggleSection('dnes', false);
  toggleSection('playlists', false);
  toggleSection('all', false);
  toggleSection('update', false);
});
