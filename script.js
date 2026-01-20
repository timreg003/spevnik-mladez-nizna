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

/* ===== JSONP helper (bypasses CORS for Apps Script) ===== */
function jsonpRequest(url){
  return new Promise((resolve, reject) => {
    const cb = "cb_" + Date.now() + "_" + Math.random().toString(16).slice(2);
    const s = document.createElement('script');
    const sep = url.includes('?') ? '&' : '?';
    const full = url + sep + "callback=" + cb + "&t=" + Date.now();

    window[cb] = (data) => {
      cleanup();
      resolve(data);
    };

    function cleanup(){
      try { delete window[cb]; } catch(e) { window[cb] = undefined; }
      if (s && s.parentNode) s.parentNode.removeChild(s);
    }

    s.src = full;
    s.async = true;
    s.onerror = () => {
      cleanup();
      reject(new Error("JSONP load failed"));
    };
    document.head.appendChild(s);
  });
}

const ADMIN_PWD = "qwer";
const FORMSPREE_URL = "https://formspree.io/f/mvzzkwlw";

let songs = [], filteredSongs = [];
let currentSong = null;
let currentModeList = [];
let currentListSource = 'all';
let currentDnesOrder = '';

let transposeStep = 0, fontSize = 17, chordsVisible = true;
const scale = ["C","C#","D","D#","E","F","F#","G","G#","A","B","H"];

let autoscrollInterval = null, currentLevel = 1;
let isAdmin = false;

let dnesSelectedIds = [];
let dnesItems = [];
let dnesDirty = false;
let playlistDirty = false;
// Default title shown when the list is empty / freshly cleared
const DNES_DEFAULT_TITLE = "PIESNE NA DNES";
let dnesTitle = DNES_DEFAULT_TITLE;

let selectedSongIds = [];
let historyActiveOrder = "";
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

/* ===== TOAST ===== */
let toastTimer = null;

function setSaveButtonState(disabled){
  document.querySelectorAll('.btn-save').forEach(btn=>{
    if(disabled){
      btn.classList.add('disabled');
      btn.disabled = true;
    }else{
      btn.classList.remove('disabled');
      btn.disabled = false;
    }
  });
}

function setButtonStateById(id, disabled, label){
  const btn = document.getElementById(id);
  if (!btn) return;
  if (!btn.dataset.origText) btn.dataset.origText = btn.innerHTML;
  if (disabled){
    btn.classList.add('disabled');
    btn.disabled = true;
    if (label) btn.innerHTML = label;
  } else {
    btn.classList.remove('disabled');
    btn.disabled = false;
    btn.innerHTML = btn.dataset.origText || btn.innerHTML;
  }
}

function updatePlaylistSaveEnabled(){
  const nameEl = document.getElementById('playlist-name');
  const btn = document.getElementById('playlist-save-btn');
  if (!btn) return;
  const has = !!(nameEl && nameEl.value.trim());
  if (!has){
    btn.classList.add('disabled');
    btn.disabled = true;
  } else {
    btn.classList.remove('disabled');
    btn.disabled = false;
  }
}

function confirmDiscardEdits(){
  if (!isAdmin) return true;
  if (dnesDirty || playlistDirty){
    return confirm('Máš neuložené zmeny v editore. Naozaj chceš pokračovať bez uloženia?');
  }
  return true;
}
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

function toggleEditor(panelId){
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const willCollapse = !panel.classList.contains('collapsed');
  if (willCollapse){
    if (panelId === 'dnes-editor-panel' && dnesDirty && !confirm('Máš neuložené zmeny v editore Piesne na dnes. Zbaliť bez uloženia?')) return;
    if (panelId === 'admin-panel' && playlistDirty && !confirm('Máš neuložené zmeny v editore playlistu. Zbaliť bez uloženia?')) return;
  }
  panel.classList.toggle('collapsed');
  const ico = panel.querySelector('.editor-toggle-ico');
  if (ico){
    ico.className = panel.classList.contains('collapsed')
      ? 'fas fa-chevron-down editor-toggle-ico'
      : 'fas fa-chevron-up editor-toggle-ico';
  }
}

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
  if (!confirmDiscardEdits()) return;
  stopAutoscroll();
  closeSong();
  playlistViewName = null;
  renderPlaylistsUI(true);
  loadHistoryCacheFirst(true);
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
    document.getElementById('dnes-editor-panel').classList.add('collapsed');
    document.getElementById('admin-panel').style.display = 'block';
    document.getElementById('admin-panel').classList.add('collapsed');

    openDnesEditor(true);
    openPlaylistEditorNew(true);
    renderPlaylistsUI(true);
    loadHistoryCacheFirst(true);
  } else {
    logoutAdmin();
  }
}
function logoutAdmin() {
  if (!confirmDiscardEdits()) return;
  isAdmin = false;
  document.getElementById('admin-toggle-text').innerText = "PRIHLÁSIŤ";
  document.getElementById('dnes-editor-panel').style.display = 'none';
  document.getElementById('admin-panel').style.display = 'none';
  selectedSongIds = [];
  
  // Clear DNES editor input (keep saved title/display)
  const __dn = document.getElementById('dnes-name');
  if (__dn) __dn.value = '';
  const __ds = document.getElementById('dnes-search');
  if (__ds) __ds.value = '';
renderPlaylistsUI(true);
}

/* ===== XML LOAD ===== */
async function parseXML() {
  try {
    const data = await jsonpRequest(SCRIPT_URL);
    const xmlText = (data && data.xml != null) ? String(data.xml) : "";
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
  loadHistoryCacheFirst(false);

  // then refresh
  loadDnesFromDrive();
  loadPlaylistsFromDrive();
  loadHistoryFromDrive();
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
  const qRaw = document.getElementById('search').value;
  const q = normText(qRaw).trim();
  filteredSongs = songs.filter(s => {
    const title = normText(s.title);
    const id = normText(s.displayId);
    return title.includes(q) || id.includes(q);
  });
  renderAllSongs();
  if (q.length > 0) {
    toggleSection('all', true);
    toggleSection('dnes', false);
    toggleSection('playlists', false);
  }
}

/* ===== SONG DETAIL ===== */
function openSongById(id, source) {
  currentListSource = source;
  const s = songs.find(x => x.id === id);
  if (!s) return;

  if (source === 'dnes') {
    const ids = getDnesIds();
    currentModeList = ids.map(i => songs.find(x => x.id === i)).filter(Boolean);
    // pick order for this song (from dnesItems if available, else from stored payload)
    const payload = parseDnesPayload(localStorage.getItem('piesne_dnes') || '');
    const it = (payload.items||[]).find(x => String(x.songId) === String(id));
    currentDnesOrder = historyActiveOrder || (it ? String(it.order||'') : '');
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
  document.getElementById('original-key-label').innerText = "Pôvodná tónina: " + (firstChordMatch ? firstChordMatch[1] : "-");

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
  const __s = document.getElementById('search');
  if (__s) __s.value = '';
  filterSongs();
}

function navigateSong(d) {
  if (!currentSong) return;
  const idx = currentModeList.findIndex(s => s.id === currentSong.id);
  const n = currentModeList[idx + d];
  if (n) openSongById(n.id, currentListSource);
}

function splitSongIntoBlocks(origText){
  const lines = (origText||"").split(/\r?\n/);
  const markerRe = /^(\d+\.|R\d*:\s*|B\d*:\s*)\s*$/;
  const blocks = {};
  let current = null;
  for (let i=0;i<lines.length;i++){
    const ln = lines[i];
    const t = ln.trim();
    if (markerRe.test(t)){
      current = t.replace(/\s+/g,'');
      if (!blocks[current]) blocks[current] = [];
      continue;
    }
    if (current){
      blocks[current].push(ln);
    }
  }
  return blocks;
}

function extractTopTranspose(origText){
  const first = (origText||"").split(/\r?\n/)[0]?.trim() || "";
  if (/^[+-]\d+$/.test(first)) return first;
  return "";
}

function normalizeOrderToken(tok){
  return (tok||"").trim();
}

function joinOrderTokens(tokens){ return (tokens||[]).map(t=>t.trim()).filter(Boolean).join(','); }

function parseOrderTokens(orderStr){
  const s = (orderStr||"").trim();
  if (!s) return [];
  const out = [];
  let cur = "";
  let depth = 0;
  for (const ch of s){
    if (ch==='(') depth++;
    if (ch===')') depth = Math.max(0, depth-1);
    if (ch===',' && depth===0){
      if (cur.trim()) out.push(cur.trim());
      cur="";
    }else{
      cur+=ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function buildOrderedSongText(song, orderStr){
  const tokens = parseOrderTokens(orderStr);
  if (!tokens.length) return song.origText;

  const is999 = String(song.originalId||"").replace(/^0+/,'') === '999';
  const blocks = splitSongIntoBlocks(song.origText);

  const topTrans = extractTopTranspose(song.origText);
  let out = [];
  if (!is999 && topTrans){
    out.push(`Transpozícia: ${topTrans}`);
}

  const shownTransFor = new Set();

  const markerRe = /^(\d+\.|R\d*:|B\d*:)$/
  for (const tokRaw of tokens){
    const tok = normalizeOrderToken(tokRaw);

    const m = tok.match(/^(PREDOHRA|MEDZIHRA|DOHRA)(?:\((.*)\))?$/i);
    if (m){
      const kind = m[1].toUpperCase();
      const note = (m[2]||"").trim();
      out.push(kind.charAt(0) + kind.slice(1).toLowerCase() + (note?`: ${note}`:""));
      continue;
    }

    const key = tok.replace(/\s+/g,'');
    if (!markerRe.test(key)) continue;

    // 999: look for transpose line right after marker inside that block (we can't see it after split, so detect by scanning raw lines)
    if (is999 && !shownTransFor.has(key)){
      // try to find first trans line inside block content if present as first non-empty line
      const lines = blocks[key] || [];
      const firstNonEmpty = (lines.find(l => l.trim() !== "") || "").trim();
      if (/^[+-]\d+$/.test(firstNonEmpty)){
        out.push(`Transpozícia: ${firstNonEmpty}`);
      }
      shownTransFor.add(key);
    }

    out.push(key);
    const lines = blocks[key] || [];
    // For 999, if first line is transpose, skip it from content (already shown)
    if (is999 && lines.length && /^[+-]\d+$/.test((lines[0]||"").trim())){
      out.push(...lines.slice(1));
    } else {
      out.push(...lines);
    }
  }

  return out.join("\n").trim();
}


function renderSong() {
  if (!currentSong) return;
  let text = (currentListSource === 'dnes' && currentDnesOrder) ? buildOrderedSongText(currentSong, currentDnesOrder) : currentSong.origText;

  if (transposeStep !== 0) {
    text = text.replace(/\[(.*?)\]/g, (m, c) => `[${transposeChord(c, transposeStep)}]`);
  }
  if (!chordsVisible) {
    text = text.replace(/\[.*?\]/g, '');
  }

  // Style special lines / markers (keep \n, rely on pre-wrap in CSS)
  // If the song starts with +1 / -2 line, show it as Transpozícia
  text = text.replace(/^([+-]\d+)\s*$/m, 'Transpozícia: $1');
  text = text.replace(/^Transpozícia:\s*([+-]?\d+)\s*$/gm, 'Transpozícia: <span class="song-transpose">$1</span>');
  text = text.replace(/^Transpozícia:\s*([+-]?\d+)\s*$/gm, '<span class="song-transpose-line">Transpozícia: $1</span>');
  text = text.replace(/^(Predohra|Medzihra|Dohra)(:.*)?$/gmi, (m0) => `<span class="song-special">${m0}</span>`);
  text = text.replace(/^(\d+\.|R\d*:|B\d*:)\s*$/gm, '<span class="song-marker">$1</span>');

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
  if (!trimmed) return { title: DNES_DEFAULT_TITLE, ids: [], items: [] };

  try {
    const obj = JSON.parse(trimmed);
    if (obj) {
      const title = obj.title || DNES_DEFAULT_TITLE;
      if (Array.isArray(obj.items)) {
        const items = obj.items.map(x => ({
          songId: String(x.songId || x.id || ''),
          order: (x.order || '').toString()
        })).filter(x => x.songId);
        const ids = items.map(x => x.songId);
        return { title, ids, items };
      }
      if (Array.isArray(obj.ids)) {
        const ids = obj.ids.map(String);
        return { title, ids, items: ids.map(id => ({ songId:id, order:'' })) };
      }
    }
  } catch(e) {}

  const ids = trimmed.split(',').map(x => x.trim()).filter(Boolean);
  return { title: DNES_DEFAULT_TITLE, ids, items: ids.map(id => ({ songId:id, order:'' })) };
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
    const data = await jsonpRequest(`${SCRIPT_URL}?action=get&name=PiesneNaDnes`);
    const t = (data && data.text != null) ? String(data.text) : "";
    localStorage.setItem('piesne_dnes', t.trim());
  } catch(e) {}
  dnesFetchInFlight = false;
  loadDnesCacheFirst(true);
  if (isAdmin) openDnesEditor(true);
}

/* dnes editor (zachované) */

let formModalIdx = null;
let formModalOrder = [];
let formModalAvailable = [];

function extractAvailableMarkersFromSong(song){
  const lines = (song.origText || "").split(/\r?\n/);
  const markerRe = /^(\d+\.|R\d*:\s*|B\d*:\s*)\s*$/;
  const set = new Set();
  for (const ln of lines){
    const t = ln.trim();
    if (markerRe.test(t)) set.add(t.replace(/\s+/g,''));
  }
  const arr = Array.from(set);
  arr.sort((a,b)=>{
    const an = /^\d+\./.test(a), bn = /^\d+\./.test(b);
    if (an && bn) return parseInt(a) - parseInt(b);
    if (an && !bn) return -1;
    if (!an && bn) return 1;
    const ar = /^R\d*:/.test(a), br = /^R\d*:/.test(b);
    if (ar && !br) return -1;
    if (!ar && br) return 1;
    return a.localeCompare(b,'sk');
  });
  return arr;
}

function buildPreviewHtml(song){
  const lines = (song.origText || "").split(/\r?\n/).slice(0, 180);
  const markerRe = /^(\d+\.|R\d*:\s*|B\d*:\s*)\s*$/;
  return lines.map((ln,idx)=>{
    const t = ln.trim();
    if (markerRe.test(t)) return `<div class="mk">${escapeHtml(t.replace(/\s+/g,''))}</div>`;
    if (idx === 0 && /^[+-]\d+$/.test(t)) return `<div class="mk">Transpozícia v texte: ${escapeHtml(t)}</div>`;
    return `<div>${escapeHtml(ln)}</div>`;
  }).join('');
}

function openFormModal(idx){
  if (!isAdmin) return;
  formModalIdx = idx;
  const songId = dnesSelectedIds[idx];
  const s = songs.find(x => x.id === songId);
  if (!s) return;

  const titleEl = document.getElementById('form-modal-title');
  if (titleEl) titleEl.textContent = `${s.displayId}. ${s.title}`;

  formModalAvailable = extractAvailableMarkersFromSong(s);
  formModalOrder = parseOrderTokens((dnesItems[idx]?.order || '').trim());

  const prev = document.getElementById('form-preview');
  if (prev) prev.innerHTML = buildPreviewHtml(s);

  renderFormModalButtons();
  renderFormModalOrder();
  setFormModalSaving(false);

  const modal = document.getElementById('form-modal');
  if (modal) modal.style.display = 'flex';
}

function closeFormModal(){
  const modal = document.getElementById('form-modal');
  if (modal) modal.style.display = 'none';
  formModalIdx = null;
  formModalOrder = [];
  formModalAvailable = [];
}

function setFormModalSaving(on){
  const btn = document.getElementById('form-modal-save');
  if (!btn) return;
  btn.disabled = !!on;
  btn.classList.toggle('disabled', !!on);
}

function renderFormModalButtons(){
  const box = document.getElementById('form-buttons');
  if (!box) return;
  box.innerHTML = formModalAvailable.map(m => `<button class="chip-btn" onclick="addOrderToken('${m}')">${escapeHtml(m)}</button>`).join('');
}

function renderFormModalOrder(){
  const box = document.getElementById('form-order');
  if (!box) return;
  if (!formModalOrder.length){
    box.innerHTML = '<div style="opacity:0.75;">Zatiaľ žiadne poradie. Klikni na časti nižšie.</div>';
    return;
  }
  box.innerHTML = formModalOrder.map((t, i) => {
    const isSpecial = /^(PREDOHRA|MEDZIHRA|DOHRA)\b/i.test(t);
    const cls = isSpecial ? 'chip special' : 'chip';
    return `<div class="${cls}" draggable="true" ondragstart="onFormChipDragStart(${i})" ondragover="onFormChipDragOver(event)" ondrop="onFormChipDrop(${i})" onclick="removeOrderToken(${i})">${escapeHtml(t)}</div>`;
  }).join('');
}
let formDragFrom = null;

function onFormChipDragStart(i){
  formDragFrom = i;
}
function onFormChipDragOver(ev){
  ev.preventDefault();
}
function onFormChipDrop(i){
  if (formDragFrom === null) return;
  const from = formDragFrom;
  const to = i;
  formDragFrom = null;
  if (from === to) return;
  const item = formModalOrder.splice(from,1)[0];
  formModalOrder.splice(to,0,item);
  renderFormModalOrder();
}


function addOrderToken(tok){
  const t = (tok||"").trim();
  if (!t) return;
  formModalOrder.push(t);
  renderFormModalOrder();
}

function removeOrderToken(i){
  if (i < 0 || i >= formModalOrder.length) return;
  formModalOrder.splice(i,1);
  renderFormModalOrder();
}

function addSpecialStep(kind){
  const note = prompt(`${kind} – poznámka (voliteľné):`, "");
  if (note === null) return;
  const token = note.trim() ? `${kind}(${note.trim()})` : `${kind}`;
  formModalOrder.push(token);
  renderFormModalOrder();
}

function saveFormModal(){
  if (!isAdmin) return;
  if (formModalIdx === null) return;
  setFormModalSaving(true);
  dnesItems[formModalIdx].order = joinOrderTokens(formModalOrder);
  renderDnesSelected();
  closeFormModal();
  setFormModalSaving(false);
}

function openDnesEditor(silent=false) {
  if (!isAdmin && !silent) return;
  const payload = parseDnesPayload(localStorage.getItem('piesne_dnes') || "");
  dnesSelectedIds = [...payload.ids];
  dnesItems = (payload.items && payload.items.length) ? payload.items.map(x=>({ songId:String(x.songId), order:(x.order||'') })) : dnesSelectedIds.map(id=>({ songId:id, order:'' }));
  const __dn=document.getElementById('dnes-name');
  if (__dn) __dn.oninput = () => { dnesDirty = true; };
  __dn.value = (payload.ids.length === 0 && (payload.title || DNES_DEFAULT_TITLE) === DNES_DEFAULT_TITLE) ? '' : (payload.title || DNES_DEFAULT_TITLE);
  dnesDirty = true;
    renderDnesSelected();
  renderDnesAvailable();
}
function filterDnesSearch(){ renderDnesAvailable(); }
function renderDnesAvailable() {
  const tRaw = document.getElementById('dnes-search').value;
  const t = normText(tRaw).trim();
  const list = t ? songs.filter(s => normText(s.title).includes(t) || normText(s.displayId).includes(t)) : songs;

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
    dnesItems.push({ songId:id, order:'' });
    dnesDirty = true;
    renderDnesSelected();
    const __s = document.getElementById('dnes-search');
    if (__s && __s.value) { __s.value = ''; renderDnesAvailable(); }

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
        <button class="small-plus" title="Forma" onclick="event.stopPropagation(); openFormModal(${idx})"><i class="fas fa-list"></i></button>
        <button class="small-del" onclick="removeDnesAt(${idx})">X</button>
      </div>`;
  }).join('');
}
function removeDnesAt(idx){ dnesSelectedIds.splice(idx,1); dnesDirty = true; renderDnesSelected(); }
function clearDnesSelection(){
  dnesSelectedIds=[];
  dnesDirty = true;
  const inp = document.getElementById('dnes-name');
  // keep section title as default, but editor input should be empty so admin doesn't need to delete it
  if (inp) inp.value = '';
  setDnesTitle(DNES_DEFAULT_TITLE);
  renderDnesSelected();
}
async function saveDnesEditor() {
  setButtonStateById('dnes-save-btn', true, '<i class="fas fa-check"></i>');
  showToast('Ukladám…', true);
  const title = (document.getElementById('dnes-name').value || DNES_DEFAULT_TITLE).trim();
  // build items with order
  const items = dnesSelectedIds.map((id, idx) => ({ songId: id, order: (dnesItems[idx]?.order || '') }));
  const payload = JSON.stringify({ title, items });

  localStorage.setItem('piesne_dnes', payload);
  setDnesTitle(title);
  loadDnesCacheFirst(true);

  try {
    await fetch(`${SCRIPT_URL}?action=save&name=PiesneNaDnes&pwd=${ADMIN_PWD}&content=${encodeURIComponent(payload)}`, { mode:'no-cors' });
    dnesDirty = false;
    showToast("Uložené ✅", true);
    setButtonStateById('dnes-save-btn', false);
  } catch(e) {
    showToast("Nepodarilo sa uložiť ❌", false);
    setButtonStateById('dnes-save-btn', false);
  }
}


/* ===== HISTÓRIA (public) ===== */
let historyFetchInFlight = false;
let historyOpen = {}; // ts -> boolean open
let historySearchQ = "";

function parseHistory(raw){
  const t = (raw || "").trim();
  if (!t) return [];
  try { const arr = JSON.parse(t); return Array.isArray(arr) ? arr : []; }
  catch(e){ return []; }
}

function historyEntryTitle(h){
  const t = (h && (h.title || h.label || h.date) || "").toString().trim();
  return t || "Záznam";
}

function isSong999(song){
  if (!song) return false;
  const n = String(song.originalId||"").replace(/^0+/,'');
  return n === "999";
}

function entryMatchesSearch(h, qNorm){
  if (!qNorm) return true;
  const items = (h.items || []);
  for (const it of items){
    const sid = String(it.songId || it.id || "");
    const s = songs.find(x => String(x.id) === sid);
    if (!s) continue;
    if (isSong999(s)) continue; // ignore in search
    const n = normText(s.title) + " " + normText(s.displayId) + " " + normText(s.originalId);
    if (n.includes(qNorm)) return true;
  }
  return false;
}

function toggleHistoryEntry(ts){
  historyOpen[ts] = !historyOpen[ts];
  renderHistoryUI(true);
}

function filterHistorySearch(){
  const el = document.getElementById('history-search');
  historySearchQ = (el ? el.value : "") || "";
  renderHistoryUI(true);
}

function renderHistoryUI(showEmptyAllowed){
  const box = document.getElementById('history-section');
  if (!box) return;

  const arr = parseHistory(localStorage.getItem(LS_HISTORY) || "");
  if (!arr.length){
    if (!showEmptyAllowed && historyFetchInFlight){
      box.innerHTML = '<div class="loading">Načítavam...</div>';
      return;
    }
    box.innerHTML = '<div class="dnes-empty">Zatiaľ žiadna história.</div>';
    return;
  }

  const qNorm = normText(historySearchQ.trim());
  const sorted = [...arr].sort((a,b) => (b.ts||0)-(a.ts||0));
  const filtered = sorted.filter(h => entryMatchesSearch(h, qNorm));

  if (qNorm){
    filtered.forEach(h => { historyOpen[h.ts] = true; });
  }

  if (!filtered.length){
    box.innerHTML = '<div class="dnes-empty">Nič sa nenašlo.</div>';
    return;
  }

  box.innerHTML = filtered.map((h) => {
    const ts = Number(h.ts||0);
    const open = !!historyOpen[ts];
    const delBtn = isAdmin ? `<button class="history-del" onclick="event.stopPropagation(); deleteHistoryEntry(${ts})">X</button>` : '';
    const title = historyEntryTitle(h);
    const items = (h.items || []);

    let lines = "";
    if (open){
      lines = `<div class="history-songs">` + items.map(it => {
        const sid = String(it.songId || it.id || "");
        const s = songs.find(x => String(x.id) === sid);
        if (!s) return '';
        if (qNorm && isSong999(s)) return '';
        const form = (it.order || "").trim();
        const formTxt = form ? ` (${escapeHtml(form)})` : '';
        return `
          <div class="history-line">
            <div class="hid">${escapeHtml(s.displayId)}.</div>
            <div class="htitle">${escapeHtml(s.title)}${formTxt}</div>
          </div>`;
      }).join('') + `</div>`;
    }

    return `
      <div class="history-card">
        <div class="history-head" onclick="toggleHistoryEntry(${ts})">
          <div class="history-title">${escapeHtml(title)}</div>
          ${delBtn}
        </div>
        ${lines}
      </div>`;
  }).join('');
}

function loadHistoryCacheFirst(showEmptyAllowed){
  renderHistoryUI(showEmptyAllowed);
}

async function loadHistoryFromDrive(){
  historyFetchInFlight = true;
  renderHistoryUI(false);
  try {
    const data = await jsonpRequest(`${SCRIPT_URL}?action=get&name=${encodeURIComponent(HISTORY_NAME)}`);
    const t = (data && data.text != null) ? String(data.text) : "";
    localStorage.setItem(LS_HISTORY, (t||"").trim());
  } catch(e) {}
  historyFetchInFlight = false;
  renderHistoryUI(true);
}

function buildHistoryEntryFromCurrentDnes(){
  const payload = parseDnesPayload(localStorage.getItem('piesne_dnes') || "");
  const items = payload.items && payload.items.length ? payload.items : (payload.ids||[]).map(id => ({ songId:id, order:"" }));
  const now = Date.now();
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  const iso = `${yyyy}-${mm}-${dd}`;
  const title = (payload.title || "").trim();
  const fallback = todayLabelSk(d);
  return { ts: now, date: iso, title: title || fallback, items: items.map(x=>({ songId:String(x.songId||x.id), order:(x.order||"") })) };
}

async function saveDnesToHistory(){
  if (!isAdmin) return;
  showToast('Ukladám do histórie…', true);

  const arr = parseHistory(localStorage.getItem(LS_HISTORY) || "");
  arr.push(buildHistoryEntryFromCurrentDnes());
  localStorage.setItem(LS_HISTORY, JSON.stringify(arr));
  renderHistoryUI(true);

  try {
    await fetch(`${SCRIPT_URL}?action=save&name=${encodeURIComponent(HISTORY_NAME)}&pwd=${ADMIN_PWD}&content=__DELETED__${encodeURIComponent(JSON.stringify(arr))}`, { mode:'no-cors' });
    showToast('Uložené do histórie ✅', true);
  } catch(e) {
    showToast('Nepodarilo sa uložiť do histórie ❌', false);
  } finally {
    loadHistoryFromDrive();
  }
}

function deleteHistoryEntry(ts){
  if (!isAdmin) return;
  if (!confirm('Vymazať tento záznam z histórie?')) return;
  const arr = parseHistory(localStorage.getItem(LS_HISTORY) || "");
  const next = arr.filter(x => Number(x.ts) !== Number(ts));
  localStorage.setItem(LS_HISTORY, JSON.stringify(next));
  renderHistoryUI(true);
  try { fetch(`${SCRIPT_URL}?action=save&name=${encodeURIComponent(HISTORY_NAME)}&pwd=${ADMIN_PWD}&content=__DELETED__${encodeURIComponent(JSON.stringify(next))}`, { mode:'no-cors' }); } catch(e) {}
  loadHistoryFromDrive();
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

  let list = [];
  try {
    const data = await jsonpRequest(`${SCRIPT_URL}?action=list`);
    list = (data && data.list) ? data.list : (Array.isArray(data) ? data : []);
  } catch(e) {
    playlistsFetchInFlight = false;
    loadPlaylistsCacheFirst(true);
    return;
  }

  list = (list || []).filter(p => p.name !== "PiesneNaDnes" && p.name !== "PlaylistOrder" && p.name !== "HistoryLog");
  const names = list.map(p => p.name);

  let order = [];
  try {
    const od = await jsonpRequest(`${SCRIPT_URL}?action=get&name=PlaylistOrder`);
    const txt = (od && od.text != null) ? String(od.text).trim() : "";
    const arr = JSON.parse(txt || "[]");
    if (Array.isArray(arr)) order = arr.map(String);
  } catch(e) {}

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


async function openPlaylistAndRender(name){
  await fetchPlaylistContent(name);
  playlistViewName = name;
  toggleSection('playlists', true);
  renderPlaylistsUI(true);
  window.scrollTo(0,0);
}

function openPlaylist(nameEnc) {
  const name = decodeURIComponent(nameEnc);
  openPlaylistAndRender(name);
}

function closePlaylistView(){
  playlistViewName = null;
  renderPlaylistsUI(true);
}


async function fetchPlaylistContent(name){
  try{
    const gd = await jsonpRequest(`${SCRIPT_URL}?action=get&name=${encodeURIComponent(name)}`);
    const t = (gd && gd.text != null) ? String(gd.text).trim() : "";
    localStorage.setItem('playlist_' + name, t);
    return t;
  }catch(e){
    return (localStorage.getItem('playlist_' + name) || "").trim();
  }
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
// persist to Drive
  try {
    await fetch(`${SCRIPT_URL}?action=save&name=${encodeURIComponent(newName)}&pwd=${ADMIN_PWD}&content=${encodeURIComponent(payload)}`, { mode:'no-cors' });
    await fetch(`${SCRIPT_URL}?action=save&name=PlaylistOrder&pwd=${ADMIN_PWD}&content=${encodeURIComponent(JSON.stringify(playlistOrder))}`, { mode:'no-cors' });
    // best-effort delete old name on backend if renamed
    if (oldName && newName !== oldName) {
      try { await fetch(`${SCRIPT_URL}?action=delete&name=${encodeURIComponent(oldName)}&pwd=${ADMIN_PWD}`, { mode:'no-cors' }); } catch(e) {}
      try { await fetch(`${SCRIPT_URL}?action=save&name=${encodeURIComponent(oldName)}&pwd=${ADMIN_PWD}&content=`, { mode:'no-cors' }); } catch(e) {}
    }
    playlistDirty = false;
    showToast('Uložené ✅', true);
    setButtonStateById('playlist-save-btn', false);
    updatePlaylistSaveEnabled();
    setButtonStateById('dnes-save-btn', false);
  } catch(e) {
    showToast('Nepodarilo sa uložiť ❌', false);
    setButtonStateById('playlist-save-btn', false);
    updatePlaylistSaveEnabled();
    setButtonStateById('dnes-save-btn', false);
  }
}

async function editPlaylist(nameEnc){
  if (!isAdmin) return;
  const name = decodeURIComponent(nameEnc);
  editingPlaylistName = name;
  const nameEl = document.getElementById('playlist-name');
  if (nameEl) nameEl.value = name;
  updatePlaylistSaveEnabled();

  let raw = (localStorage.getItem('playlist_' + name) || '').trim();
  if (!raw) { raw = await fetchPlaylistContent(name); }
  raw = (raw||'').trim();
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
