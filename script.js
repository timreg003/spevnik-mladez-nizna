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
  // params: {action,name,pwd,content}
  const body = new URLSearchParams();
  Object.keys(params || {}).forEach(k => {
    if (params[k] !== undefined && params[k] !== null) body.append(k, String(params[k]));
  });

  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body
  });

  // If Apps Script doesn't return JSON (or CORS blocks), this may throw.
  const txt = await res.text();
  try { return JSON.parse(txt); } catch(e) { return { ok: res.ok, raw: txt }; }
}


async function safeScriptSave(name, content){
  // Try POST (new script), fallback to legacy GET (no-cors)
  try {
    const r = await postToScript({ action:'save', name, pwd: ADMIN_PWD, content });
    if (r && r.ok === false) throw new Error(r.error || 'Save failed');
    return { ok:true, method:'POST', resp:r };
  } catch(e){
    try {
      await fetch(`${SCRIPT_URL}?action=save&name=${encodeURIComponent(name)}&pwd=${ADMIN_PWD}&content=${encodeURIComponent(content)}`, { mode:'no-cors' });
      return { ok:true, method:'GET_NO_CORS' };
    } catch(e2){
      return { ok:false, error: String(e2 || e) };
    }
  }
}

async function safeScriptDelete(name){
  try {
    const r = await postToScript({ action:'delete', name, pwd: ADMIN_PWD });
    if (r && r.ok === false) throw new Error(r.error || 'Delete failed');
    return { ok:true, method:'POST', resp:r };
  } catch(e){
    try {
      await fetch(`${SCRIPT_URL}?action=delete&name=${encodeURIComponent(name)}&pwd=${ADMIN_PWD}`, { mode:'no-cors' });
      return { ok:true, method:'GET_NO_CORS' };
    } catch(e2){
      return { ok:false, error: String(e2 || e) };
    }
  }
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


function isSong999(song){
  const raw = (song?.originalId || "").toString().trim();
  const num = raw.replace(/^0+/, '');
  return num === '999';
}

// Parse into blocks keyed by markers: "1.", "R:", "R2:", "B:"...
// Standard songs: first non-empty line "+N/-N" becomes globalTranspose.
// 999 songs: "+N/-N" may appear as first non-empty line INSIDE a block.
function parseSongBlocks(song){
  const lines = (song.origText || "").split(/\r?\n/);

  // global transpose hint for standard songs
  let globalTranspose = null;
  let i=0;
  while (i < lines.length && lines[i].trim()==="") i++;
  if (i < lines.length && /^[+-]\d+$/.test(lines[i].trim())){
    globalTranspose = lines[i].trim();
    lines.splice(i,1);
  }

  const markerRe = /^(\d+\.|R\d*:\s*|B\d*:\s*)\s*$/;
  const blocks = {};
  let currentKey = "__TOP__";
  blocks[currentKey] = { keyLine:"", transposeHint:null, lines:[] };

  function normKey(k){ return k.replace(/\s+/g,''); }

  for (const ln of lines){
    const t = ln.trim();
    if (markerRe.test(t)){
      currentKey = normKey(t);
      if (!blocks[currentKey]) blocks[currentKey] = { keyLine: normKey(t), transposeHint:null, lines:[] };
      continue;
    }
    if (!blocks[currentKey]) blocks[currentKey] = { keyLine: currentKey==="__TOP__"?"":currentKey, transposeHint:null, lines:[] };
    blocks[currentKey].lines.push(ln);
  }

  if (isSong999(song)){
    // move transpose hints from inside blocks
    Object.keys(blocks).forEach(k => {
      if (k === "__TOP__") return;
      const bl = blocks[k];
      let j=0;
      while (j < bl.lines.length && bl.lines[j].trim()==="") j++;
      if (j < bl.lines.length && /^[+-]\d+$/.test(bl.lines[j].trim())){
        bl.transposeHint = bl.lines[j].trim();
        bl.lines.splice(j,1);
      }
    });
    // ignore global transpose for 999 songs by spec
    globalTranspose = null;
  }

  return { blocks, globalTranspose };
}

function parseOrderString(orderStr){
  const s = (orderStr || "").trim();
  if (!s) return [];
  const out = [];
  let cur = "";
  let depth = 0;
  for (const ch of s){
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth-1);
    if (ch === ',' && depth === 0){
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function renderFormNote(label, note){
  const text = note ? `${label}: ${note}` : label;
  return `<div class="form-note">${escapeHtml(text)}</div>`;
}

function buildSongHtmlByOrder(song, orderStr){
  const { blocks, globalTranspose } = parseSongBlocks(song);
  const steps = parseOrderString(orderStr);
  const seen = new Set();
  let html = "";

  if (globalTranspose){
    html += `<div class="transpose-hint">Transpozícia: ${escapeHtml(globalTranspose)}</div>`;
  }

  // helper: convert chords markup later by caller
  function addText(t){ html += t; }

  for (const raw of steps){
    const noteMatch = /^(PREDOHRA|MEDZIHRA|DOHRA)(?:\((.*)\))?$/i.exec(raw);
    if (noteMatch){
      const lbl = noteMatch[1].toUpperCase();
      const pretty = (lbl === "PREDOHRA") ? "Predohra" : (lbl === "MEDZIHRA") ? "Medzihra" : "Dohra";
      addText(renderFormNote(pretty, (noteMatch[2]||"").trim()));
      addText("\n");
      continue;
    }

    const key = raw.replace(/\s+/g,'');
    const bl = blocks[key];
    if (!bl){
      // unknown token -> show as note
      addText(renderFormNote(raw, ""));
      addText("\n");
      continue;
    }

    if (isSong999(song) && bl.transposeHint && !seen.has(key)){
      addText(`<div class="transpose-hint">Transpozícia: ${escapeHtml(bl.transposeHint)}</div>`);
      seen.add(key);
    }

    if (bl.keyLine){
      addText(`${escapeHtml(bl.keyLine)}\n`);
    }
    addText(bl.lines.join("\n"));
    addText("\n\n");
  }

  return html;
}

/* ===== SONG DETAIL ===== */
function openSongById(id, source) {
  currentListSource = source;
  if (source !== 'dnes') currentSongOrder = '';
  const s = songs.find(x => x.id === id);
  if (!s) return;

  if (source === 'dnes') {
    if (forceOrderSongId === String(id)) {
      currentSongOrder = (forceOrderValue || '').trim();
      forceOrderSongId = null;
      forceOrderValue = '';
    } else {
      currentSongOrder = (dnesOrderMap[id] || '').trim();
    }
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

  if (currentListSource === 'dnes' && (currentSongOrder || '').trim()){
    const tmp = { ...currentSong, origText: text };
    let html = buildSongHtmlByOrder(tmp, currentSongOrder);
    html = html.replace(/\[(.*?)\]/g, '<span class="chord">$1</span>');
    el.innerHTML = html;
  } else {
    // show standard global transpose banner if first line is +N/-N
    const tmp = { ...currentSong, origText: text };
    const parsed = parseSongBlocks(tmp);
    let extra = '';
    if (parsed.globalTranspose){
      extra = `<div class="transpose-hint">Transpozícia: ${escapeHtml(parsed.globalTranspose)}</div>`;
      const lines = (text||'').split(/\r?\n/);
      let i=0; while (i < lines.length && lines[i].trim()==='') i++;
      if (i < lines.length && /^[+-]\d+$/.test(lines[i].trim())) lines.splice(i,1);
      text = lines.join('\n');
    }
    el.innerHTML = extra + text.replace(/\[(.*?)\]/g, '<span class="chord">$1</span>');
  }

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
  if (!trimmed) return { title: DNES_DEFAULT_TITLE, items: [] };

  try {
    const obj = JSON.parse(trimmed);

    // New format: {title, items:[{songId, order}]}
    if (obj && Array.isArray(obj.items)) {
      const items = obj.items.map(it => ({
        id: String(it.songId || it.id || ""),
        order: (it.order || "").toString().trim()
      })).filter(it => it.id);
      return { title: (obj.title || DNES_DEFAULT_TITLE), items };
    }

    // Old format: {title, ids:[...]}
    if (obj && Array.isArray(obj.ids)) {
      const items = obj.ids.map(String).map(id => ({ id, order:"" }));
      return { title: (obj.title || DNES_DEFAULT_TITLE), items };
    }
  } catch(e) {}

  // Very old CSV format: "id,id,id"
  const ids = trimmed.split(',').map(x => x.trim()).filter(Boolean);
  const items = ids.map(id => ({ id, order:"" }));
  return { title: DNES_DEFAULT_TITLE, items };
}
function setDnesTitle(title) {
  dnesTitle = (title || DNES_DEFAULT_TITLE);
  document.getElementById('dnes-title').innerText = dnesTitle.toUpperCase();
}
function getDnesIds() {
  const payload = parseDnesPayload(localStorage.getItem('piesne_dnes') || "");
  return payload.items.map(it => it.id);
}
function loadDnesCacheFirst(showEmptyAllowed) {
  const box = document.getElementById('dnes-section');
  const payload = parseDnesPayload(localStorage.getItem('piesne_dnes') || "");
  setDnesTitle(payload.title);

  dnesOrderMap = {};
  payload.items.forEach(it => { dnesOrderMap[it.id] = (it.order || '').trim(); });

  if (!payload.items.length) {
    if (!showEmptyAllowed && dnesFetchInFlight) {
      box.innerHTML = '<div class="loading">Načítavam...</div>';
      return;
    }
    box.innerHTML = '<div class="dnes-empty">Zoznam piesní na dnešný deň je prázdny <span class="sad-ico"><i class="fa-solid fa-face-sad-tear"></i></span></div>';
    return;
  }

  box.innerHTML = payload.items.map(it => {
    const s = songs.find(x => x.id === it.id);
    if (!s) return '';
    return songRowHTMLClickable(s.displayId, s.title, `openSongById('${s.id}','dnes')`);
  }).join('');
}async function loadDnesFromDrive() {
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
  dnesItems = payload.items.map(it => ({ id: it.id, order: (it.order || '').trim() }));
  dnesSelectedIds = dnesItems.map(it => it.id);

  document.getElementById('dnes-name').value = (payload.items && payload.items.length) ? (payload.title || DNES_DEFAULT_TITLE) : '';
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
    dnesItems.push({ id, order:'' });
    renderDnesSelected();
    const __s = document.getElementById('dnes-search');
    if (__s && __s.value) { __s.value = ''; renderDnesAvailable(); }
  }
}


let formModalIdx = null;
let formModalSongId = null;
let formModalOrder = [];
let formModalAvailable = [];
let formModalIsSaving = false;

function tokenizeOrderStr(orderStr){
  const s = (orderStr||"").trim();
  if (!s) return [];
  const out = [];
  let cur = "";
  let depth = 0;
  for (const ch of s){
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth-1);
    if (ch === ',' && depth === 0){
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function joinOrderTokens(tokens){
  return (tokens||[]).map(t => t.trim()).filter(Boolean).join(',');
}

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
  const lines = (song.origText || "").split(/\r?\n/).slice(0, 160);
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
  formModalSongId = dnesSelectedIds[idx];
  const s = songs.find(x => x.id === formModalSongId);
  if (!s) return;

  const titleEl = document.getElementById('form-modal-title');
  if (titleEl) titleEl.textContent = `${s.displayId}. ${s.title}`;

  formModalAvailable = extractAvailableMarkersFromSong(s);
  formModalOrder = tokenizeOrderStr((dnesItems[idx]?.order || "").trim());

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
  formModalSongId = null;
  formModalOrder = [];
  formModalAvailable = [];
}

function setFormModalSaving(on){
  formModalIsSaving = on;
  const btn = document.getElementById('form-modal-save');
  if (!btn) return;
  if (on){
    btn.classList.add('disabled');
    btn.disabled = true;
  } else {
    btn.classList.remove('disabled');
    btn.disabled = false;
  }
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
    return `<div class="${cls}" onclick="removeOrderToken(${i})">${escapeHtml(t)}</div>`;
  }).join('');
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

  const orderStr = joinOrderTokens(formModalOrder);
  dnesItems[formModalIdx].order = orderStr;

  renderDnesSelected();
  closeFormModal();
  setFormModalSaving(false);
}

function editDnesOrder(idx){
  if (!isAdmin) return;
  const it = dnesItems[idx];
  const s = songs.find(x => x.id === it.id);
  const title = s ? `${s.displayId}. ${s.title}` : it.id;
  const help = "Poradie častí napr.: 1.,R:,2.,R2:,B:\nŠpeciálne kroky: PREDOHRA(text), MEDZIHRA(text), DOHRA(text)\nPríklad: PREDOHRA(G-D-Em-C),1.,R:,2.,R:,DOHRA(R2 2x)";
  const val = prompt(`${title}\n\n${help}`, it.order || "");
  if (val === null) return;
  it.order = val.trim();
  dnesItems[idx] = it;
  renderDnesSelected();
}

function renderDnesSelected() {
  const box = document.getElementById('dnes-selected-editor');
  if (!dnesSelectedIds.length) {
    box.innerHTML = `<div class="dnes-empty">Zoznam piesní na dnešný deň je prázdny <span class="sad-ico"><i class="fa-solid fa-face-sad-tear"></i></span></div>`;
    return;
  }
  box.innerHTML = dnesSelectedIds.map((id, idx) => {
    const s = songs.find(x => x.id === id);
    const left = s ? `${s.displayId}.` : id;
    const right = s ? s.title : '';
    const ord = (dnesItems[idx]?.order || '').trim();
    const badge = ord ? `<div style="margin-top:4px; font-size:12px; opacity:0.85;">Forma: ${escapeHtml(ord)}</div>` : `<div style="margin-top:4px; font-size:12px; opacity:0.65;">Forma: (nezadaná)</div>`;
    return `
      <div class="draggable-item"
           draggable="true"
           data-idx="${idx}"
           ondragstart="onDragStart(event,'dnes')"
           ondragover="onDragOver(event)"
           ondrop="onDrop(event,'dnes')">
        <div style="display:flex; flex-direction:column; gap:2px; flex:1;">
          <div style="display:flex; gap:10px; align-items:center;">
            <div style="color:#00bfff; font-weight:900; min-width:78px; text-align:right; white-space:nowrap;">${escapeHtml(left)}</div>
            <div style="flex:1; overflow-wrap:anywhere;">${escapeHtml(right)}</div>
          </div>
          ${badge}
        </div>
        <button class="small-plus" title="Forma" onclick="event.stopPropagation(); openFormModal(${idx})"><i class="fas fa-list"></i></button>
        <span class="drag-handle"><i class="fas fa-grip-lines"></i></span>
        <button class="small-del" onclick="removeDnesAt(${idx})">X</button>
      </div>`;
  }).join('');
}
function removeDnesAt(idx){
  dnesSelectedIds.splice(idx,1);
  dnesItems.splice(idx,1);
  renderDnesSelected();
}
function clearDnesSelection(){
  dnesSelectedIds = [];
  dnesItems = [];
  const inp = document.getElementById('dnes-name');
  if (inp) inp.value = '';
  setDnesTitle(DNES_DEFAULT_TITLE);
  renderDnesSelected();
}
async function saveDnesEditor() {
  const title = (document.getElementById('dnes-name').value || DNES_DEFAULT_TITLE).trim();
  const items = dnesSelectedIds.map((id, idx) => ({
    songId: id,
    order: (dnesItems[idx]?.order || '').trim()
  }));
  const payload = JSON.stringify({ title, items });

  localStorage.setItem('piesne_dnes', payload);
  setDnesTitle(title);
  loadDnesCacheFirst(true);

  // instant feedback
  showToast("Ukladám…", true);

  try {
    const r = await safeScriptSave('PiesneNaDnes', payload);
    if (!r.ok) throw new Error(r.error || 'save');
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
