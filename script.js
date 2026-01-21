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
  // iOS: neblokuj štart čakaním na sieť. Najprv ukáž cache (ak existuje), potom v pozadí obnov.
  const saved = localStorage.getItem('offline_spevnik');
  if (saved && saved.trim()) {
    // odlož na ďalší tick, aby sa UI stihlo vykresliť
    setTimeout(() => { try { processXML(saved); } catch(e) {} }, 0);
  }

  try {
    const data = await jsonpRequest(SCRIPT_URL);
    const xmlText = (data && data.xml != null) ? String(data.xml) : "";
    if (xmlText && xmlText.trim()) {
      const prev = saved || "";
      if (xmlText !== prev) {
        localStorage.setItem('offline_spevnik', xmlText);
        // Ak sme ešte nič nezobrazili, alebo nie sme v detaile, prepočítaj.
        const inDetail = (document.getElementById('song-detail')?.style.display === 'block');
        if (!saved || !inDetail) {
          processXML(xmlText);
        }
      }
    }
  } catch (e) {
    // ak nebola cache, nech aspoň ostane loading
    if (!saved) {
      // nič
    }
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
    const payload = parseDnesPayload(localStorage.getItem('piesne_dnes') || '');
    const it = (payload.items||[]).find(x => String(x.songId) === String(id));
    currentDnesOrder = it ? String(it.order||'') : '';
  } else if (source === 'playlist') {
    currentDnesOrder = '';
  } else {
    currentModeList = [...songs];
    currentDnesOrder = '';
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

  // Doplnenie akordov je pri otvorení piesne vždy automaticky zapnuté (ak chceš, vypneš).
  setChordTemplateEnabled(true);
  updateChordTemplateUI();

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

function parseBlockMarker(line){
  const t = String(line || '').trim();
  let m;

  // Číslo slohy: "1", "1.", "1)","1 Text..."
  m = t.match(/^(\d+)(?:[.)])?(?:\s+|$)(.*)$/);
  if (m){
    const num = m[1];
    const rest = (m[2] || '').trim();
    return { key: `${num}.`, rest };
  }

  // Refren: "R:", "R2:", "R text", "R", "Refren", "Refren: text"
  m = t.match(/^R(\d*)\s*:\s*(.*)$/i);
  if (m) return { key: `R${m[1] || ''}:`, rest: (m[2] || '').trim() };
  m = t.match(/^R(\d*)\s+(.*)$/i);
  if (m) return { key: `R${m[1] || ''}:`, rest: (m[2] || '').trim() };
  m = t.match(/^R(\d*)\s*$/i);
  if (m) return { key: `R${m[1] || ''}:`, rest: '' };

  m = t.match(/^Refren\s*:?\s*(.*)$/i);
  if (m) return { key: `R:`, rest: (m[1] || '').trim() };

  // Bridge: "B:", "B1:", "B text", "B", "Bridge", "Bridge: text"
  m = t.match(/^B(\d*)\s*:\s*(.*)$/i);
  if (m) return { key: `B${m[1] || ''}:`, rest: (m[2] || '').trim() };
  m = t.match(/^B(\d*)\s+(.*)$/i);
  if (m) return { key: `B${m[1] || ''}:`, rest: (m[2] || '').trim() };
  m = t.match(/^B(\d*)\s*$/i);
  if (m) return { key: `B${m[1] || ''}:`, rest: '' };

  m = t.match(/^Bridge\s*:?\s*(.*)$/i);
  if (m) return { key: `B:`, rest: (m[1] || '').trim() };

  return null;
}

function splitSongIntoBlocks(origText){
  const lines = (origText||"").split(/\r?\n/);
  const blocks = {};
  let current = null;

  for (let i=0;i<lines.length;i++){
    const ln = lines[i];
    const t = (ln || '').trim();

    const mk = parseBlockMarker(t);
    if (mk){
      current = mk.key.replace(/\s+/g,'');
      if (!blocks[current]) blocks[current] = [];
      if (mk.rest){
        blocks[current].push(mk.rest);
      }
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
      let lines = (blocks[key] || []).slice();
      while (lines.length && lines[0].trim() === "") lines.shift();
      while (lines.length && lines[lines.length-1].trim() === "") lines.pop();
      const firstNonEmpty = (lines.find(l => l.trim() !== "") || "").trim();
      if (/^[+-]\d+$/.test(firstNonEmpty)){
        out.push(`Transpozícia: ${firstNonEmpty}`);
      }
      shownTransFor.add(key);
    }

    out.push(key);
    let lines = (blocks[key] || []).slice();
    while (lines.length && lines[0].trim() === "") lines.shift();
    while (lines.length && lines[lines.length-1].trim() === "") lines.pop();
    // For 999, if first line is transpose, skip it from content (already shown)
    if (is999 && lines.length && /^[+-]\d+$/.test((lines[0]||"").trim())){
      out.push(...lines.slice(1));
    } else {
      out.push(...lines);
    }
  }

  return out.join("\n").trim();
}


function escapeHTML(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseMarkerOnly(trimmed) {
  const t = String(trimmed || '').trim();

  // 1 / 1. / 1) / 1:
  let m = t.match(/^(\d+)(?:[\.)]|:)?$/);
  if (m) return m[1];

  // R:, R2:, R
  m = t.match(/^R(\d*)\:$/i);
  if (m) return 'R' + (m[1] || '');
  m = t.match(/^R(\d*)$/i);
  if (m) return 'R' + (m[1] || '');
  if (/^Refren\:?\s*$/i.test(t)) return 'R';

  // B:, B1:, B
  m = t.match(/^B(\d*)\:$/i);
  if (m) return 'B' + (m[1] || '');
  m = t.match(/^B(\d*)$/i);
  if (m) return 'B' + (m[1] || '');
  if (/^Bridge\:?\s*$/i.test(t)) return 'B';

  return '';
}

function parseMarkerWithText(trimmed) {
  const t = String(trimmed || '').trim();
  let m;

  // 1 Text... / 1) Text... / 1: Text...
  m = t.match(/^(\d+)(?:[\.)]|:)?\s+(.*)$/);
  if (m) return { label: m[1], text: m[2] };

  // R: text / R2: text / R text
  m = t.match(/^R(\d*)\:\s*(.*)$/i);
  if (m) return { label: 'R' + (m[1] || ''), text: m[2] };
  m = t.match(/^R(\d*)\s+(.*)$/i);
  if (m) return { label: 'R' + (m[1] || ''), text: m[2] };

  // Refren text / Refren: text
  m = t.match(/^Refren\:?\s*(.*)$/i);
  if (m && m[1]) return { label: 'R', text: m[1] };

  // B: text / B1: text / B text
  m = t.match(/^B(\d*)\:\s*(.*)$/i);
  if (m) return { label: 'B' + (m[1] || ''), text: m[2] };
  m = t.match(/^B(\d*)\s+(.*)$/i);
  if (m) return { label: 'B' + (m[1] || ''), text: m[2] };

  // Bridge text / Bridge: text
  m = t.match(/^Bridge\:?\s*(.*)$/i);
  if (m && m[1]) return { label: 'B', text: m[1] };

  return null;
}

// Predohra / Medzihra / Dohra – podporí aj formát "Predohra: text" aj "Predohra text"
function parseSpecialWithText(trimmed){
  const t = String(trimmed || '').trim();
  let m = t.match(/^(Predohra|Medzihra|Dohra)\s*:\s*(.*)$/i);
  if (m){
    const kind = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    const rest = (m[2]||'').trim();
    return { kind, rest };
  }
  m = t.match(/^(Predohra|Medzihra|Dohra)\s+(.*)$/i);
  if (m){
    const kind = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    const rest = (m[2]||'').trim();
    return { kind, rest };
  }
  return null;
}

function parseSpecialMarkerOnly(trimmed){
  const t = String(trimmed || '').trim();
  const m = t.match(/^(Predohra|Medzihra|Dohra)\s*:?\s*$/i);
  if (!m) return '';
  return m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
}

function songLineHTML(label, text, extraClass) {
  const safeLabel = escapeHTML(label || '');
  let safeText = escapeHTML(text || '');

  // chords -> span
  safeText = safeText.replace(/\[(.*?)\]/g, '<span class="chord">$1</span>');

  const cls = extraClass ? `song-line ${extraClass}` : 'song-line';
  return `<div class="${cls}"><span class="song-label">${safeLabel}</span><span class="song-line-text">${safeText}</span></div>`;
}

function songTextToHTML(text) {
  const lines = String(text || '').split('\n');
  let pendingLabel = '';
  let pendingSpecial = '';
  let pendingChordLine = '';
  let sectionOpen = false;
  // Buffer empty lines so we can drop them if they end up at the end of a section
  // (sloha/refren/bridge). This saves vertical space without removing spacing inside blocks.
  let pendingBlanks = 0;
  const out = [];

  function openSection(){
    if (!sectionOpen){
      out.push('<div class="song-section">');
      sectionOpen = true;
    }
  }
  function closeSection(){
    if (sectionOpen){
      out.push('</div>');
      sectionOpen = false;
    }
  }

  for (const raw of lines) {
    const line = String(raw ?? '');
    const trimmed = line.trim();

    // Blank line (buffer; we'll decide later whether to render it)
    if (!trimmed) {
      pendingBlanks++;
      continue;
    }

    // If we have buffered blanks, decide whether to flush them now.
    // - If we are about to close a section or start a new marker section, we DROP them (trailing blanks).
    // - If we are continuing normal text inside a section, we keep them.
    const willCloseOrStartNewBlock = (
      !!parseSpecialMarkerOnly(trimmed) ||
      !!parseSpecialWithText(trimmed) ||
      !!parseMarkerOnly(trimmed) ||
      !!parseMarkerWithText(trimmed) ||
      /^Transpozícia:\s*([+-]?\d+)\s*$/i.test(trimmed)
    );
    if (pendingBlanks > 0) {
      // If we have a pendingLabel or pendingSpecial, blanks are not useful between marker and first text.
      const markerWaiting = !!pendingLabel || !!pendingSpecial;
      if (!willCloseOrStartNewBlock && !markerWaiting) {
        for (let i = 0; i < pendingBlanks; i++) {
          out.push('<div class="song-line song-blank"><span class="song-label"></span><span class="song-line-text"></span></div>');
        }
      }
      pendingBlanks = 0;
    }

    // Transpozícia (special row)
    const mt = trimmed.match(/^Transpozícia:\s*([+-]?\d+)\s*$/i);
    if (mt) {
      pendingLabel = '';
      pendingSpecial = '';
      closeSection();
      out.push(
        `<div class="song-line song-transpose-row"><span class="song-label"></span><span class="song-line-text">Transpozícia: <span class="song-transpose">${escapeHTML(mt[1])}</span></span></div>`
      );
      continue;
    }

    // Predohra / Medzihra / Dohra (zvýraznené riadky)
    const spOnly = parseSpecialMarkerOnly(trimmed);
    if (spOnly){
      pendingLabel = '';
      pendingSpecial = spOnly;
      continue;
    }
    const sp = parseSpecialWithText(trimmed);
    if (sp){
      pendingLabel = '';
      pendingSpecial = '';
      closeSection();
      const txt = sp.kind + (sp.rest ? `: ${sp.rest}` : ':');
      out.push('<div class="song-section">');
      out.push(songLineHTML('', txt, 'song-special-row'));
      out.push('</div>');
      continue;
    }

    // Marker-only line (1., R:, B:, Refren, Bridge...)
    const only = parseMarkerOnly(trimmed);
    if (only) {
      // nový blok -> zavri starý
      // Ak je tu rozpracovaný chordline bez textu, je to sirota -> zahodíme ho
      pendingChordLine = '';
      closeSection();
      pendingLabel = only;
      continue;
    }

    // Marker + text in one line (e.g. "1 Text", "R: Text", "Bridge text")
    const withText = parseMarkerWithText(trimmed);
    if (withText) {
      closeSection();
      openSection();
      if (pendingChordLine){ out.push(songLineHTML('', pendingChordLine, 'song-chordline')); pendingChordLine=''; }
      out.push(songLineHTML(withText.label, withText.text));
      continue;
    }

    // Ak čaká Predohra/Medzihra/Dohra, prilep ju na prvý nasledujúci textový riadok
    if (pendingSpecial){
      closeSection();
      out.push('<div class="song-section">');
      out.push(songLineHTML('', `${pendingSpecial}: ${line.trim()}`, 'song-special-row'));
      out.push('</div>');
      pendingSpecial = '';
      pendingChordLine = '';
      continue;
    }

        // Chord-only line: buffer it and render above the next non-marker text line
    if (isChordOnlyLine(line)) {
      pendingChordLine = line;
      continue;
    }

// Normal line: if we have a pending label, use it only for this first content line
    if (pendingLabel) {
      closeSection();
      openSection();

      // If there is a pending chordline, put it on the SAME row as the verse label.
      // Then render the lyric text on the next row (without a label).
      if (pendingChordLine){
        out.push(songLineHTML(pendingLabel, pendingChordLine, 'song-chordline'));
        pendingChordLine = '';
        out.push(songLineHTML('', line));
        pendingLabel = '';
      } else {
        out.push(songLineHTML(pendingLabel, line));
        pendingLabel = '';
      }
    } else {
        out.push(songLineHTML(pendingLabel, line));
        pendingLabel = '';
      }
    } else {
      // pokračovanie aktuálneho bloku (ak existuje), inak voľný text
      if (sectionOpen){
        if (pendingChordLine){ out.push(songLineHTML('', pendingChordLine, 'song-chordline')); pendingChordLine=''; }
        out.push(songLineHTML('', line));
      } else {
        if (pendingChordLine){ out.push(songLineHTML('', pendingChordLine, 'song-chordline')); pendingChordLine=''; }
        out.push(songLineHTML('', line));
      }
    }
  }

  // Ak ostal chordline bez nasledujúceho textu, nezobrazuj ho
  pendingChordLine = '';
  closeSection();
  return out.join('');
}

/* ===== AKORDOVÁ ŠABLÓNA ZO SLOHY 1 (overlay) =====
   Pravidlá:
   - Zdroj: VŽDY iba sloha 1
   - Aplikuje sa: IBA na slohy (2,3,4...) – nikdy na refreny/bridge
   - Ak cieľová sloha obsahuje aspoň jeden akord (inline alebo chordline), nič sa do nej nedopĺňa
   - Doplnenie: akordy sa vkladajú ako RIADOK NAD text (chordline), nie do textu
   - Extra: Ak je v slohe 1 akord len v prvej časti (napr. 3 z 6 riadkov), predpokladá sa opakovanie
           a šablóna sa doplní aj pre zvyšné riadky (4-6) cyklením od začiatku.
   - Refren: Ak má refren akordy len v prvej časti, doplní sa iba DRUHÁ časť TOHO ISTÉHO refrenu
             (neprenáša sa do ďalších refrenov).
*/

const LS_CHORD_TEMPLATE_ON = 'chord_template_on';
function chordTemplateEnabled(){
  const v = localStorage.getItem(LS_CHORD_TEMPLATE_ON);
  // default: ON (ak používateľ nevypne)
  return v == null ? true : (v === '1');
}

function setChordTemplateEnabled(on){
  localStorage.setItem(LS_CHORD_TEMPLATE_ON, on ? '1' : '0');
}

function toggleChordTemplate(){
  setChordTemplateEnabled(!chordTemplateEnabled());
  updateChordTemplateUI();
  renderSong();
}

function updateChordTemplateUI(){
  const btn = document.getElementById('tmpl-btn');
  const lab = document.getElementById('tmpl-label');
  if (!btn || !lab) return;
  const on = chordTemplateEnabled();
  btn.classList.toggle('active', on);
  lab.textContent = on ? 'ON' : 'OFF';
}


function hasChordInLine(line){
  return /\[[^\]]+\]/.test(String(line||''));
}

function stripChordsFromLine(line){
  return String(line||'').replace(/\[[^\]]+\]/g, '');
}

function isChordOnlyLine(line){
  if (!hasChordInLine(line)) return false;
  // Allow common repeat / bar markers on chord lines (/: :/ | - etc.)
  const rest = stripChordsFromLine(line)
    .replace(/[|:\/\-.,]/g, '')
    .trim();
  return rest === '';
}

function extractChordsInline(line){
  return (String(line||'').match(/\[[^\]]+\]/g) || []);
}

function classifyLabel(label){
  const t = String(label||'');
  if (/^\d+$/.test(t)) return { type: 'verse', index: parseInt(t,10) };
  if (/^R\d*$/i.test(t)) return { type: 'chorus', index: 0 };
  if (/^B\d*$/i.test(t)) return { type: 'bridge', index: 0 };
  return { type: 'other', index: 0 };
}

function splitTextIntoSegments(text){
  const lines = String(text||'').split('\n');
  const segs = [];
  let cur = null;

  function pushCur(){
    if (cur) segs.push(cur);
    cur = null;
  }

  for (const line of lines){
    const trimmed = String(line).trim();
    const only = parseMarkerOnly(trimmed);
    const withText = parseMarkerWithText(trimmed);

    if (only){
      pushCur();
      const cls = classifyLabel(only);
      cur = { kind:'block', label: only, type: cls.type, index: cls.index, header: line, body: [] };
      continue;
    }
    if (withText){
      pushCur();
      const cls = classifyLabel(withText.label);
      // marker+text je súčasť tela (zachováme originálny riadok)
      cur = { kind:'block', label: withText.label, type: cls.type, index: cls.index, header: null, body: [line] };
      continue;
    }

    if (!cur){
      segs.push({ kind:'plain', lines:[line] });
    } else {
      cur.body.push(line);
    }
  }

  pushCur();
  return segs;
}

function getLyricInfos(blockBody){
  const infos = [];
  const body = Array.isArray(blockBody) ? blockBody : [];

  // Map chord-only lines to the next *non-blank* non-chord-only line index.
  // This keeps template alignment stable even when there are blank lines.
  const chordlineForIndex = new Map();
  for (let i=0; i<body.length; i++){
    const line = String(body[i] ?? '');
    if (!isChordOnlyLine(line)) continue;

    let j = i + 1;
    while (j < body.length) {
      const nxt = String(body[j] ?? '');
      if (isChordOnlyLine(nxt)) { j++; continue; }
      if (!nxt.trim()) { j++; continue; }
      break;
    }
    if (j < body.length) chordlineForIndex.set(j, line.trim());
  }

  for (let i=0; i<body.length; i++){
    const line = String(body[i] ?? '');

    // chord-only line itself is not a lyric line
    if (isChordOnlyLine(line)) continue;

    // treat blank lines as spacing; don't count them as lyric lines for template mapping
    if (!line.trim()) continue;

    let chordPattern = chordlineForIndex.get(i) || '';
    let inline = [];
    if (!chordPattern){
      inline = extractChordsInline(line);
      chordPattern = inline.length ? inline.join(' ') : '';
    }

    infos.push({
      lineIndex: i,
      chordPattern,
      hasAnyChords: !!chordPattern,
      hasChordlineAbove: chordlineForIndex.has(i)
    });
  }

  return infos;
}

function blockHasAnyChordsRaw(block){
  const body = (block && Array.isArray(block.body)) ? block.body : [];
  return body.some(l => hasChordInLine(l));
}

function fillTrailingByRepeating(patterns){
  const out = patterns.slice();
  let lastNonEmpty = -1;
  for (let i=0;i<out.length;i++) if (out[i]) lastNonEmpty = i;
  const p = lastNonEmpty + 1;
  if (p <= 0 || p >= out.length) return out;
  // dopĺň iba ak po p sú všetky prázdne
  for (let i=p;i<out.length;i++){
    if (out[i]) return out;
  }
  for (let i=p;i<out.length;i++){
    out[i] = out[i] || out[i % p] || '';
  }
  return out;
}

function buildVerse1TemplateFromSegments(segs){
  const verse1 = segs.find(s => s.kind==='block' && s.type==='verse' && s.index===1);
  if (!verse1) return null;

  const infos = getLyricInfos(verse1.body);
  const patterns = infos.map(x => x.chordPattern || '');
  const filled = fillTrailingByRepeating(patterns);

  // Ak v slohe 1 nie je žiadny akord, nerob nič
  if (!filled.some(p => p)) return null;
  return filled;
}

function applyVerse1TemplateToVerseBlock(block, template){
  if (!template) return block;
  if (!block || block.type!=='verse' || block.index===1) return block;
  // ak sloha už má akordy, nezasahuj
  if (blockHasAnyChordsRaw(block)) return block;

  const body = block.body.slice();
  const lyricInfos = getLyricInfos(body);
  const insertBefore = new Map();

  let li = 0;
  for (const info of lyricInfos){
    const pat = template[li] || '';
    if (pat) insertBefore.set(info.lineIndex, pat);
    li++;
  }

  if (insertBefore.size === 0) return block;

  const newBody = [];
  for (let i=0;i<body.length;i++){
    if (insertBefore.has(i)) newBody.push(insertBefore.get(i));
    newBody.push(body[i]);
  }

  return { ...block, body: newBody };
}

function fillHalfChorusOnce(segs){
  let done = false;
  return segs.map(seg => {
    if (done) return seg;
    if (!(seg && seg.kind==='block' && seg.type==='chorus')) return seg;
    if (!blockHasAnyChordsRaw(seg)) return seg; // bez akordov nič

    const body = seg.body.slice();
    const infos = getLyricInfos(body);
    const patterns = infos.map(x => x.chordPattern || '');
    const filled = fillTrailingByRepeating(patterns);

    // nič na doplnenie
    if (filled.join('\u0000') === patterns.join('\u0000')) return seg;

    const insertBefore = new Map();
    for (let i=0;i<infos.length;i++){
      const wasEmpty = !patterns[i];
      const now = filled[i] || '';
      if (wasEmpty && now){
        // ak lyric riadok už náhodou obsahuje akordy, nestrkaj nad neho
        const line = String(body[infos[i].lineIndex] ?? '');
        if (!hasChordInLine(line)) insertBefore.set(infos[i].lineIndex, now);
      }
    }
    if (insertBefore.size === 0) return seg;

    const newBody = [];
    for (let i=0;i<body.length;i++){
      if (insertBefore.has(i)) newBody.push(insertBefore.get(i));
      newBody.push(body[i]);
    }

    done = true;
    return { ...seg, body: newBody };
  });
}

function applyChordTemplateOverlay(text){
  if (!chordTemplateEnabled()) return text;

  let segs = splitTextIntoSegments(text);

  // 1) Doplň druhú polovicu refrenu iba v prvom refrene, kde sú akordy len v prvej časti
  segs = fillHalfChorusOnce(segs);

  // 2) Šablóna zo slohy 1 (doplní sa aj na koniec ak chýbajú)
  const verseTemplate = buildVerse1TemplateFromSegments(segs);
  if (!verseTemplate) {
    // stále vráť text s prípadným chorus half-fill
    return segs.map(s => {
      if (s.kind==='plain') return s.lines.join('\n');
      return (s.header ? [s.header, ...s.body] : s.body).join('\n');
    }).join('\n');
  }

  // 3) Aplikuj iba na slohy 2+ (nie na refreny/bridge)
  segs = segs.map(seg => {
    if (!(seg && seg.kind==='block')) return seg;
    if (seg.type !== 'verse') return seg;
    if (seg.index === 1) return seg;
    return applyVerse1TemplateToVerseBlock(seg, verseTemplate);
  });

  return segs.map(s => {
    if (s.kind==='plain') return s.lines.join('\n');
    return (s.header ? [s.header, ...s.body] : s.body).join('\n');
  }).join('\n');
}


function renderSong() {
  if (!currentSong) return;
  let text = (currentListSource === 'dnes' && currentDnesOrder)
    ? buildOrderedSongText(currentSong, currentDnesOrder)
    : currentSong.origText;

  // Akordová šablóna zo slohy 1 (overlay) + doplnenie 2. polovice prvého refrenu (iba v rámci toho refrenu)
  text = applyChordTemplateOverlay(text);

  // Zredukuj extrémne medzery (najmä po značkách 1., R:, B:, Refren, Bridge, Predohra..., Transpozícia...)
  // - odstráni prázdne riadky hneď po značke
  // - zredukuje viac prázdnych riadkov za sebou
  text = String(text || '').replace(/^(\d+\.|R\d*:|B\d*:|Refren:?|Bridge:?|Predohra.*|Medzihra.*|Dohra.*|Transpozícia:.*)\s*\n\s*\n+/gmi, '$1\n');
  text = text.replace(/\n\s*\n\s*\n+/g, '\n\n');

  // Pri poradí (editor "forma") nech sú bloky úplne bez medzier
  if (currentListSource === 'dnes' && currentDnesOrder) {
    text = text.replace(/\n\s*\n+/g, '\n');
  }

  // Transpose chords first
  if (transposeStep !== 0) {
    text = text.replace(/\[(.*?)\]/g, (m, c) => `[${transposeChord(c, transposeStep)}]`);
  }

  // Hide chords if needed
  if (!chordsVisible) {
    text = text.replace(/\[.*?\]/g, '');
  }

  // Failsafe: never show empty content
  if (!text || !text.trim()) text = currentSong.origText || '';

  // +1 / -2 (samostatný riadok) -> Transpozícia: +1
  text = text.replace(/^\s*([+-]\d+)\s*\n/, 'Transpozícia: $1\n');

  const el = document.getElementById('song-content');
  el.innerHTML = songTextToHTML(text);
  el.style.fontSize = fontSize + 'px';

  // sync presentation overlay
  updatePresentationUI();
  updateChordTemplateUI();
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

/* ===== PREZENTAČNÝ REŽIM ===== */
let presentationActive = false;
let __wakeLock = null;

async function enterPresentationMode() {
  presentationActive = true;
  document.body.classList.add('present');
  const pc = document.getElementById('presentControls');
  if (pc) pc.setAttribute('aria-hidden', 'false');

  // fullscreen (best effort)
  try {
    if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    }
  } catch (e) {}

  // wake lock (best effort)
  try {
    if ('wakeLock' in navigator) {
      __wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) { __wakeLock = null; }

  updatePresentationUI();
}

async function exitPresentationMode() {
  presentationActive = false;
  document.body.classList.remove('present');
  const pc = document.getElementById('presentControls');
  if (pc) pc.setAttribute('aria-hidden', 'true');

  try {
    if (__wakeLock) {
      await __wakeLock.release();
      __wakeLock = null;
    }
  } catch (e) { __wakeLock = null; }

  try {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
  } catch (e) {}

  updatePresentationUI();
}

function togglePresentationMode() {
  if (presentationActive) exitPresentationMode();
  else enterPresentationMode();
}

function presentPlayPause() {
  toggleAutoscroll();
  updatePresentationUI();
}
function presentSlower() {
  changeScrollSpeed(-1);
  updatePresentationUI();
}
function presentFaster() {
  changeScrollSpeed(1);
  updatePresentationUI();
}

function updatePresentationUI() {
  const speed = document.getElementById('psSpeed');
  if (speed) speed.textContent = 'Rýchlosť: ' + currentLevel;

  const btn = document.getElementById('psPlayPause');
  if (btn) {
    btn.innerHTML = autoscrollInterval ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
  }
}

/* ===== AUTOSCROLL ===== */
function toggleAutoscroll() {
  if (autoscrollInterval) stopAutoscroll();
  else {
    document.getElementById('scroll-btn').classList.add('active');
    document.getElementById('scroll-btn').innerHTML = '<i class="fas fa-pause"></i>';
    startScrolling();
    updatePresentationUI();
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
  updatePresentationUI();
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
  updatePresentationUI();
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
let formModalSongId = null;

function extractAvailableMarkersFromSong(song){
  const lines = (song.origText || "").split(/\r?\n/);
  const set = new Set();

  for (const ln of lines){
    const t = (ln || '').trim();
    if (!t) continue;
    const mk = parseBlockMarker(t);
    if (mk){
      set.add(String(mk.key || '').replace(/\s+/g,''));
    }
  }

  // zoradenie: čísla, potom R, potom B
  const arr = Array.from(set);
  arr.sort((a,b)=>{
    const an = /^\d+\./.test(a), bn = /^\d+\./.test(b);
    if (an && bn) return parseInt(a) - parseInt(b);
    if (an && !bn) return -1;
    if (!an && bn) return 1;

    const ar = /^R\d*:/.test(a), br = /^R\d*:/.test(b);
    if (ar && !br) return -1;
    if (!ar && br) return 1;

    const ab = /^B\d*:/.test(a), bb = /^B\d*:/.test(b);
    if (ab && !bb) return -1;
    if (!ab && bb) return 1;

    return a.localeCompare(b,'sk');
  });
  return arr;
}


function buildPreviewHtml(song){
  const lines = (song.origText || "").split(/\r?\n/).slice(0, 180);
  const markerRe = /^(\d+\.|R\d*:\s*|B\d*:\s*)\s*$/;
  return lines.map((ln,idx)=>{
    const t = ln.trim();
    if (/^(Predohra|Medzihra|Dohra)\b/i.test(t)) return `<div class="mk">${escapeHtml(t)}</div>`;
    if (markerRe.test(t)) return `<div class="mk">${escapeHtml(t.replace(/\s+/g,''))}</div>`;
    if (idx === 0 && /^[+-]\d+$/.test(t)) return `<div class="mk">Transpozícia v texte: ${escapeHtml(t)}</div>`;
    return `<div>${escapeHtml(ln)}</div>`;
  }).join('');
}

function openFormModal(idx){
  if (!isAdmin) return;
  formModalIdx = idx;
  const songId = dnesSelectedIds[idx];
  formModalSongId = songId;
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
  renderFormModalHistory();
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
  formModalSongId = null;
  const h = document.getElementById('form-history');
  if (h) h.innerHTML = '';
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

function normalizeOrderString(orderStr){
  const tokens = parseOrderTokens(String(orderStr || ''));
  if (!tokens.length) return '';
  const normTokens = tokens.map(t=>{
    let s = String(t || '').trim();
    if (!s) return '';

    // špeciálne kroky (Predohra/Medzihra/Dohra)
    let m = s.match(/^(PREDOHRA|MEDZIHRA|DOHRA)(?:\((.*)\))?$/i);
    if (m){
      const kind = m[1].toUpperCase();
      const note = (m[2] || '').trim();
      return note ? `${kind}(${note})` : kind;
    }

    // čísla sloh
    m = s.match(/^(\d+)\.?$/);
    if (m) return `${m[1]}.`;

    // R/B
    m = s.match(/^R(\d*):?$/i);
    if (m) return `R${m[1] || ''}:`;
    m = s.match(/^B(\d*):?$/i);
    if (m) return `B${m[1] || ''}:`;

    return s.replace(/\s+/g,'');
  }).filter(Boolean);

  return normTokens.join(',');
}

function getSongOrderHistoryForModal(songId){
  const sid = String(songId || '');
  if (!sid) return [];
  const arr = parseHistory(localStorage.getItem(LS_HISTORY) || "");
  if (!Array.isArray(arr) || !arr.length) return [];

  // orderNorm -> {ts,title,order}
  const best = new Map();
  for (const h of arr){
    const ts = Number(h.ts || 0);
    const title = historyEntryTitle(h);
    const items = Array.isArray(h.items) ? h.items : [];
    const it = items.find(x => String(x.songId || x.id || '') === sid);
    if (!it) continue;

    const orderNorm = normalizeOrderString(it.order || '');
    if (!orderNorm) continue;

    const prev = best.get(orderNorm);
    if (!prev || ts > prev.ts){
      best.set(orderNorm, { ts, title, order: orderNorm });
    }
  }

  const out = Array.from(best.values());
  out.sort((a,b) => (b.ts||0) - (a.ts||0));
  return out;
}


function applyHistoryOrder(orderStr){
  formModalOrder = parseOrderTokens(String(orderStr || ''));
  renderFormModalOrder();
}

function applyHistoryOrderEncoded(enc){
  try { applyHistoryOrder(decodeURIComponent(String(enc || ''))); } catch(e) { applyHistoryOrder(''); }
}

function renderFormModalHistory(){
  const box = document.getElementById('form-history');
  if (!box) return;

  if (!formModalSongId){
    box.innerHTML = '';
    return;
  }

  const s = songs.find(x => String(x.id) === String(formModalSongId));
  if (s && isSong999(s)){
    box.innerHTML = '<div class="form-history-empty">Pre pieseň 999 sa história poradia nezobrazuje.</div>';
    return;
  }

  const hist = getSongOrderHistoryForModal(formModalSongId).slice(0, 12);
  if (!hist.length){
    box.innerHTML = '<div class="form-history-empty">Zatiaľ nie je v histórii uložené žiadne poradie pre túto pieseň.</div>';
    return;
  }
  box.innerHTML = hist.map(h => {
    const enc = encodeURIComponent(String(h.order || ''));
    return `<div class="form-history-item" onclick="applyHistoryOrderEncoded('${enc}')">
      <div class="fh-title">${escapeHtml(h.title)}</div>
      <div class="fh-order">${escapeHtml(h.order)}</div>
    </div>`;
  }).join('');
}


function renderFormModalOrder(){
  const box = document.getElementById('form-order');
  if (!box) return;
  if (!formModalOrder.length){
    box.innerHTML = '<div style="opacity:0.75;">Zatiaľ žiadne poradie. Klikni na časti nižšie.</div>';
    return;
  }
  // Mobile-friendly: arrows + remove (no drag&drop)
  box.innerHTML = formModalOrder.map((t, i) => {
    const isSpecial = /^(PREDOHRA|MEDZIHRA|DOHRA)\b/i.test(t);
    const cls = isSpecial ? 'chip special' : 'chip';
    const leftDisabled = i === 0 ? 'disabled' : '';
    const rightDisabled = i === formModalOrder.length - 1 ? 'disabled' : '';
    return `<div class="${cls}">` +
      `<button class="chip-move" title="Posunúť doľava" ${leftDisabled} onclick="moveOrderToken(${i},-1)">‹</button>` +
      `<span class="chip-text" title="${isSpecial ? 'Upraviť' : ''}" onclick="onFormChipTextClick(${i})">${escapeHtml(t)}</span>` +
      `<button class="chip-move" title="Posunúť doprava" ${rightDisabled} onclick="moveOrderToken(${i},+1)">›</button>` +
      `<button class="chip-x" title="Odstrániť" onclick="removeOrderToken(${i});">✕</button>` +
    `</div>`;
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

function onFormChipTextClick(i){
  if (i < 0 || i >= formModalOrder.length) return;
  const t = String(formModalOrder[i] || '').trim();
  const isSpecial = /^(PREDOHRA|MEDZIHRA|DOHRA)\b/i.test(t);
  if (isSpecial) editSpecialToken(i);
}

function moveOrderToken(i, dir){
  const from = Number(i);
  const d = Number(dir);
  if (!Number.isFinite(from) || !Number.isFinite(d)) return;
  const to = from + (d < 0 ? -1 : 1);
  if (from < 0 || from >= formModalOrder.length) return;
  if (to < 0 || to >= formModalOrder.length) return;
  const item = formModalOrder.splice(from, 1)[0];
  formModalOrder.splice(to, 0, item);
  renderFormModalOrder();
}

function parseSpecialTokenString(tok){
  const t = String(tok || '').trim();
  const m = t.match(/^(PREDOHRA|MEDZIHRA|DOHRA)(?:\((.*)\))?$/i);
  if (!m) return null;
  return { kind: m[1].toUpperCase(), note: (m[2] || '').trim() };
}

function editSpecialToken(i){
  const parsed = parseSpecialTokenString(formModalOrder[i]);
  if (!parsed) return;

  const kindSk = parsed.kind === 'PREDOHRA' ? 'Predohra' : (parsed.kind === 'MEDZIHRA' ? 'Medzihra' : 'Dohra');
  const hint = `Poznámka pre ${kindSk} (prázdne = bez poznámky).\nZadaj /del pre odstránenie kroku.`;
  const next = prompt(hint, parsed.note || '');
  if (next === null) return;
  const v = String(next).trim();
  if (v.toLowerCase() === '/del'){
    removeOrderToken(i);
    return;
  }
  formModalOrder[i] = v ? `${parsed.kind}(${v})` : `${parsed.kind}`;
  renderFormModalOrder();
}

function addSpecialStep(kind){
  // Ak už existuje, radšej ho uprav
  const re = new RegExp('^' + String(kind || '').toUpperCase() + '(\\(|$)', 'i');
  const existingIdx = formModalOrder.findIndex(t => re.test(String(t || '').trim()));
  if (existingIdx >= 0){
    editSpecialToken(existingIdx);
    return;
  }

  // Predvyplň poznámku z textu piesne, ak existuje "Predohra: ..." atď.
  let preset = '';
  const s = songs.find(x => x.id === formModalSongId);
  if (s && s.origText){
    const kindSk = String(kind||'').toUpperCase() === 'PREDOHRA' ? 'Predohra' : (String(kind||'').toUpperCase() === 'MEDZIHRA' ? 'Medzihra' : 'Dohra');
    const rx = new RegExp('^' + kindSk + '\\s*:\\s*(.*)$', 'im');
    const m = String(s.origText).match(rx);
    if (m && m[1]) preset = String(m[1]).trim();
  }

  const note = prompt(`${kind} – poznámka (voliteľné):`, preset);
  if (note === null) return;
  const token = String(note).trim() ? `${String(kind).toUpperCase()}(${String(note).trim()})` : `${String(kind).toUpperCase()}`;
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

  // Mobile touch reorder
  enableTouchReorder(box, 'dnes');
}
function removeDnesAt(idx){
  dnesSelectedIds.splice(idx,1);
  if (Array.isArray(dnesItems)) dnesItems.splice(idx,1);
  dnesDirty = true;
  renderDnesSelected();
}
function clearDnesSelection(){
  dnesSelectedIds=[];
  dnesItems=[];
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
  const entry = buildHistoryEntryFromCurrentDnes();
  const titleNorm = normText(historyEntryTitle(entry));

  // Ak už existuje záznam s rovnakým názvom, prepíš ho (zabráni duplikátom)
  const next = arr.filter(h => normText(historyEntryTitle(h)) !== titleNorm);
  next.push(entry);

  localStorage.setItem(LS_HISTORY, JSON.stringify(next));
  renderHistoryUI(true);

  try {
    await fetch(`${SCRIPT_URL}?action=save&name=${encodeURIComponent(HISTORY_NAME)}&pwd=${ADMIN_PWD}&content=${encodeURIComponent(JSON.stringify(next))}`, { mode:'no-cors' });
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
  try { fetch(`${SCRIPT_URL}?action=save&name=${encodeURIComponent(HISTORY_NAME)}&pwd=${ADMIN_PWD}&content=${encodeURIComponent(JSON.stringify(next))}`, { mode:'no-cors' }); } catch(e) {}
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

  // Vyčisti lokálny cache o playlisty, ktoré už na Drive nie sú
  try {
    const cached = getCachedPlaylistNames();
    cached.forEach(n => {
      if (!names.includes(n)) localStorage.removeItem('playlist_' + n);
    });
  } catch(e) {}

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

  if (isAdmin) enableTouchReorder(sect, 'plist');
}


async function openPlaylistAndRender(name){
  // show loading immediately
  const sect = document.getElementById('playlists-section');
  if (sect) sect.innerHTML = '<div class="loading">Načítavam...</div>';
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

  enableTouchReorder(box, 'plsel');
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

  applyReorder(ctx, from, to);
}
function moveInArray(arr, from, to){ const item = arr.splice(from,1)[0]; arr.splice(to,0,item); }

// Jedno miesto, ktoré rieši presun poradia pre drag&drop aj touch.
function applyReorder(ctx, from, to) {
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

// Touch/pointer reordering pre mobile (iOS/Android) – HTML5 drag&drop tam býva nespoľahlivé.
function enableTouchReorder(container, ctx) {
  if (!container || container.__touchReorderEnabled) return;
  container.__touchReorderEnabled = true;

  let draggingItem = null;
  let fromIdx = -1;
  let lastX = 0, lastY = 0;

  function getPoint(ev) {
    if (ev.touches && ev.touches[0]) return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
    if (ev.changedTouches && ev.changedTouches[0]) return { x: ev.changedTouches[0].clientX, y: ev.changedTouches[0].clientY };
    return { x: ev.clientX, y: ev.clientY };
  }

  function start(ev) {
    const handle = ev.target.closest('.drag-handle');
    if (!handle) return;
    const item = handle.closest('.draggable-item');
    if (!item || !container.contains(item)) return;

    draggingItem = item;
    fromIdx = parseInt(item.getAttribute('data-idx'), 10);
    if (isNaN(fromIdx)) {
      const items = Array.from(container.querySelectorAll('.draggable-item'));
      fromIdx = items.indexOf(item);
    }
    const p = getPoint(ev);
    lastX = p.x; lastY = p.y;
    draggingItem.classList.add('touch-dragging');
    ev.preventDefault();

    window.addEventListener('pointermove', move, { passive:false });
    window.addEventListener('pointerup', end, { passive:false, once:true });
    window.addEventListener('touchmove', move, { passive:false });
    window.addEventListener('touchend', end, { passive:false, once:true });
  }

  function move(ev) {
    if (!draggingItem) return;
    const p = getPoint(ev);
    lastX = p.x; lastY = p.y;
    ev.preventDefault();
  }

  function end(ev) {
    if (!draggingItem) return;
    ev.preventDefault();
    const el = document.elementFromPoint(lastX, lastY);
    const over = el ? el.closest('.draggable-item') : null;
    const items = Array.from(container.querySelectorAll('.draggable-item'));
    const toIdx = over && container.contains(over) ? items.indexOf(over) : -1;
    const f = fromIdx;
    cleanup();
    if (f >= 0 && toIdx >= 0 && f !== toIdx) applyReorder(ctx, f, toIdx);
  }

  function cleanup() {
    if (draggingItem) draggingItem.classList.remove('touch-dragging');
    draggingItem = null;
    fromIdx = -1;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('touchmove', move);
  }

  // pointerdown funguje na novších iOS aj Android; touchstart je fallback.
  container.addEventListener('pointerdown', start, { passive:false });
  container.addEventListener('touchstart', start, { passive:false });
}

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
  updateChordTemplateUI();

  toggleSection('dnes', false);
  toggleSection('playlists', false);
  toggleSection('all', false);

  const __pn = document.getElementById('playlist-name');
  if (__pn) __pn.addEventListener('input', () => { updatePlaylistSaveEnabled(); playlistDirty = true; });
  updatePlaylistSaveEnabled();

  // ak užívateľ ukončí fullscreen (napr. systémovým gestom), vypni prezentáciu
  document.addEventListener('fullscreenchange', () => {
    if (presentationActive && !document.fullscreenElement) {
      exitPresentationMode();
    }
  });

  parseXML();
});
