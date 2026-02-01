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

// ===== META UPDATE BADGE (export + PiesneNaDnes + PlaylistOrder) =====
const LS_META_SEEN = 'spevnik_meta_seen_v1';
let lastRemoteMeta = null;
let metaPollingStarted = false;

function getSeenMeta(){
  try { return JSON.parse(localStorage.getItem(LS_META_SEEN) || 'null'); } catch(e) { return null; }
}
function setSeenMeta(meta){
  try { localStorage.setItem(LS_META_SEEN, JSON.stringify(meta || null)); } catch(e) {}
}
function metaIsNewer(remote, seen){
  if (!remote || !seen) return false;
  const rE = Number(remote.export || 0);
  const rD = Number(remote.dnes || 0);
  const rO = Number(remote.order || 0);
  const sE = Number(seen.export || 0);
  const sD = Number(seen.dnes || 0);
  const sO = Number(seen.order || 0);
  return (rE > sE) || (rD > sD) || (rO > sO);
}
function setUpdateBadgeVisible(on){
  const btn = document.getElementById('fab-newdata-btn');
  if (!btn) return;
  btn.style.display = on ? 'inline-flex' : 'none';
}

async function fetchRemoteMeta(){
  const data = await jsonpRequest(`${SCRIPT_URL}?action=meta`);
  const meta = (data && data.meta) ? data.meta : (data || null);
  if (meta && typeof meta === 'object') {
    return { export: Number(meta.export||0), dnes: Number(meta.dnes||0), order: Number(meta.order||0) };
  }
  return null;
}

async function checkMetaAndToggleBadge(){
  // Badge check runs every minute. Keep bottom status clean:
  // - show "Offline" when offline
  // - do NOT spam "Aktualizované" every minute
  if (!navigator.onLine){
    setUpdateBadgeVisible(false);
    setSyncStatus("Offline", "sync-warn");
    return;
  }

  // If we just came back online, clear the offline label
  const st = document.getElementById('syncStatus');
  if (st && st.textContent === "Offline") setSyncStatus("", null);

  try {
    const remote = await fetchRemoteMeta();
    if (!remote) {
      setUpdateBadgeVisible(false);
      return;
    }

    lastRemoteMeta = remote;

    const seen = getSeenMeta();
    if (!seen){
      // first run: mark as seen, no badge
      setSeenMeta(remote);
      setUpdateBadgeVisible(false);
      return;
    }

    const hasUpdate = metaIsNewer(remote, seen);
    setUpdateBadgeVisible(hasUpdate);
  } catch(e) {
    // ignore – keep previous badge state
  }
}

function startMetaPolling(){
  if (metaPollingStarted) return;
  metaPollingStarted = true;
  // okamžite po štarte + každú minútu
  checkMetaAndToggleBadge();
  setInterval(checkMetaAndToggleBadge, 60 * 1000);
  window.addEventListener('online', () => checkMetaAndToggleBadge());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkMetaAndToggleBadge(); });
}

async function runUpdateNow(){
  if (!navigator.onLine){
    showToast("Si offline – aktualizácia nie je dostupná.", false);
    return;
  }
  // zavri FAB menu (ak je otvorené)
  try { closeFabMenu(); } catch(e) {}
  setUpdateBadgeVisible(false);

  setSyncStatus("Aktualizujem…", "sync-warn");

  showToast("Aktualizujem...", true, 0);

  // fetch meta (aby sme po update vedeli badge schovať)
  try { lastRemoteMeta = await fetchRemoteMeta(); } catch(e) {}

  // stiahni a ulož nové dáta
  try { await parseXML(); } catch(e) {}
  try { await Promise.allSettled([loadDnesFromDrive(), loadPlaylistsFromDrive(), loadHistoryFromDrive()]); } catch(e) {}

  if (lastRemoteMeta) setSeenMeta(lastRemoteMeta);

  setSyncStatus("Aktualizované", "sync-ok");

  // najstabilnejšie: tvrdý reload UI
  try{ renderAllSongs(); }catch(e){}
  try{ renderDnesUI(); }catch(e){}
  try{ renderPlaylistsUI(true); }catch(e){}
  try{ loadHistoryCacheFirst(true); }catch(e){}

  showToast("Aktualizované", true, 2000);
}


// Build info (for diagnostics)
const APP_BUILD = 'v38';
const APP_CACHE_NAME = 'spevnik-v38';


const SPEVNIK_XML_CACHE_KEY = 'spevnik-export.xml';

async function cacheXmlToCacheStorage(xmlText){
  try{
    if (!('caches' in window)) return;
    const cache = await caches.open(APP_CACHE_NAME + '-data');
    await cache.put(SPEVNIK_XML_CACHE_KEY, new Response(xmlText, { headers: { 'Content-Type': 'text/plain; charset=utf-8' }}));
  }catch(e){}
}

async function readXmlFromCacheStorage(){
  try{
    if (!('caches' in window)) return '';
    const cache = await caches.open(APP_CACHE_NAME + '-data');
    const resp = await cache.match(SPEVNIK_XML_CACHE_KEY);
    if (!resp) return '';
    return await resp.text();
  }catch(e){ return ''; }
}


// Diagnostics state
let lastXmlShownAt = 0;   // when we last rendered from cache/network
let lastXmlSyncAt = 0;    // when we last successfully fetched from network
let lastXmlSyncBytes = 0;

/* ===== JSONP helper (bypasses CORS for Apps Script) ===== */
function jsonpRequest(url){
  return new Promise((resolve, reject) => {
    const cb = "cb_" + Date.now() + "_" + Math.random().toString(16).slice(2);
    const s = document.createElement('script');
    const JSONP_TIMEOUT_MS = 15000;
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { delete window[cb]; } catch(e) {}
      try { s.remove(); } catch(e) {}
      reject(new Error('jsonp timeout'));
    }, JSONP_TIMEOUT_MS);
    const sep = url.includes('?') ? '&' : '?';
    const full = url + sep + "callback=" + cb + "&t=" + Date.now();

    window[cb] = (data) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
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
      if (done) return;
      done = true;
      clearTimeout(timer);
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
let dnesShowOriginal = false; // v detaile piesne z 'Piesne na dnes' prepínač: DNES vs ORIGINÁL

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


function normSimple(s){
  return String(s||'').trim().toLowerCase();
}
function isAleluja999Song(song){
  if (!song) return false;
  const id = String(song.originalId||"").replace(/^0+/,'');
  const title = normSimple(song.title);
  return id === '999' && title === 'aleluja';
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
let syncStatusTimer = null;

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
function showToast(message, ok=true, durationMs=1700){
  const t = document.getElementById("toast");
  if (!t) return;
  t.style.display = "block";
  t.innerText = message;
  t.style.borderColor = ok ? "#00c853" : "#ff4444";
  clearTimeout(toastTimer);
  // durationMs <= 0 => sticky (nechaj zobrazené)
  if (typeof durationMs === 'number' && durationMs > 0){
    toastTimer = setTimeout(() => { t.style.display = "none"; }, durationMs);
  }
}


function setSyncStatus(text, kind){
  return;
  const el = document.getElementById('syncStatus');
  if (!el) return;

  // clear any pending auto-hide timer
  if (syncStatusTimer){
    clearTimeout(syncStatusTimer);
    syncStatusTimer = null;
  }

  el.textContent = text || '';
  el.classList.remove('sync-ok','sync-warn','sync-err');
  if (kind) el.classList.add(kind);

  // Auto-hide "Aktualizované" after a short moment
  if (el.textContent === "Aktualizované"){
    syncStatusTimer = setTimeout(() => {
      const el2 = document.getElementById('syncStatus');
      if (!el2) return;
      if (el2.textContent === "Aktualizované"){
        el2.textContent = "";
        el2.classList.remove('sync-ok','sync-warn','sync-err');
      }
    }, 1600);
  }
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
  // Enable/disable update button based on connectivity (diagnostics should work offline)
  const ub = document.getElementById('fab-update-btn');
  if (ub){
    const online = navigator.onLine;
    ub.disabled = !online;
    if (!online) ub.classList.add('disabled');
    else ub.classList.remove('disabled');
  }
  m.style.display = "block";
  m.setAttribute("aria-hidden", "false");
}
function toggleFabMenu(ev){
  // stop click bubbling so outside-click handler doesn’t close immediately
  if (ev) ev.stopPropagation();

  if (!navigator.onLine){
    // don't block opening the menu (diagnostics still useful)
    showToast("Si offline – aktualizácia nie je dostupná.", false);
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

/* ===== DIAGNOSTIKA ===== */
function fmtDateTime(ts){
  if (!ts) return '-';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleString('sk-SK');
  } catch(e){ return '-'; }
}
function buildDiagnosticsText(){
  const online = navigator.onLine ? 'áno' : 'nie';
  const src = localStorage.getItem('spevnik_last_source') || '-';
  const shownAt = parseInt(localStorage.getItem('spevnik_last_shown_at')||'0',10) || 0;
  const syncAt = parseInt(localStorage.getItem('spevnik_last_sync_at')||'0',10) || 0;
  const syncBytes = parseInt(localStorage.getItem('spevnik_last_sync_bytes')||'0',10) || 0;
  const songsCount = Array.isArray(songs) ? songs.length : 0;
  const ua = navigator.userAgent || '';
  const lines = [];
  lines.push(`App: ${APP_BUILD}`);
  lines.push(`Cache: ${APP_CACHE_NAME}`);
  lines.push(`Online: ${online}`);
  lines.push(`Posledné zobrazenie: ${fmtDateTime(shownAt)} (${src})`);
  lines.push(`Posledná synchronizácia: ${fmtDateTime(syncAt)} (${syncBytes ? syncBytes + ' znakov' : '-'})`);
  lines.push(`Počet piesní: ${songsCount}`);
  lines.push(`Aktuálna pieseň: ${currentSong ? (currentSong.displayId + ' – ' + currentSong.title) : '-'}`);
  lines.push(`Zdroj: ${SCRIPT_URL}`);
  lines.push(`UA: ${ua}`);
  return lines.join('\n');
}
function openDiagnostics(){
  closeFabMenu();
  const modal = document.getElementById('diag-modal');
  if (!modal) return;
  const txt = buildDiagnosticsText();
  const ta = document.getElementById('diag-text');
  if (ta) ta.value = txt;
  const summary = document.getElementById('diag-summary');
  if (summary){
    const online = navigator.onLine;
    const syncAt = parseInt(localStorage.getItem('spevnik_last_sync_at')||'0',10) || 0;
    summary.innerHTML = `
      <div><b>Verzia:</b> ${escapeHtml(APP_BUILD)} &nbsp; <b>Cache:</b> ${escapeHtml(APP_CACHE_NAME)}</div>
      <div><b>Online:</b> ${online ? 'áno' : 'nie'} &nbsp; <b>Posledný sync:</b> ${escapeHtml(fmtDateTime(syncAt))}</div>
      <div><b>Piesní:</b> ${Array.isArray(songs) ? songs.length : 0}</div>
    `;
  }
  modal.style.display = 'flex';
}
function closeDiagnostics(){
  const modal = document.getElementById('diag-modal');
  if (modal) modal.style.display = 'none';
}
async function copyDiagnostics(){
  const ta = document.getElementById('diag-text');
  const txt = ta ? ta.value : buildDiagnosticsText();
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(txt);
    } else {
      // fallback
      const tmp = document.createElement('textarea');
      tmp.value = txt;
      tmp.style.position='fixed';
      tmp.style.left='-9999px';
      document.body.appendChild(tmp);
      tmp.focus();
      tmp.select();
      document.execCommand('copy');
      tmp.remove();
    }
    showToast('Diagnostika skopírovaná.', true);
  } catch(e){
    showToast('Nepodarilo sa skopírovať.', false);
  }
}

// click on overlay closes
document.addEventListener('click', (e) => {
  const modal = document.getElementById('diag-modal');
  if (!modal || modal.style.display !== 'flex') return;
  if (e.target === modal) closeDiagnostics();
});

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


function forceInitialCollapsed(){
  try{
    const search = document.getElementById('search');
    if (search) search.value = '';
  }catch(e){}
  // vždy začni na domovskej obrazovke (zoznam)
  const list = document.getElementById('song-list');
  const detail = document.getElementById('song-detail');
  if (list) list.style.display = 'block';
  if (detail) detail.style.display = 'none';

  // zatvor všetky sekcie
  ['dnes','playlists','all','lit','history','admin','skuska'].forEach(id=>{
    const c = document.getElementById(id+'-section-wrapper');
    const ch = document.getElementById(id+'-chevron');
    if (c) c.style.display = 'none';
    if (ch) ch.className = 'fas fa-chevron-down section-chevron';
  });

  // zruš prípadné obnovenie focus/scroll
  try{ window.scrollTo(0,0); }catch(e){}
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

// Ak je localStorage prázdny (iOS ho vie vyčistiť), skús Cache Storage.
let cacheStorageText = '';
if (!saved || !saved.trim()){
  cacheStorageText = await readXmlFromCacheStorage();
  if (cacheStorageText && cacheStorageText.trim()){
    setTimeout(() => { try { processXML(cacheStorageText, { source:'cache' }); } catch(e) {} }, 0);
  }
}

  if (saved && saved.trim()) {
    // odlož na ďalší tick, aby sa UI stihlo vykresliť
    setTimeout(() => { try { processXML(saved, { source:'cache' }); } catch(e) {} }, 0);
  }

  try {
    const data = await jsonpRequest(SCRIPT_URL);
    const xmlText = (data && data.xml != null) ? String(data.xml) : "";
    if (xmlText && xmlText.trim()) {
      const prev = saved || "";
      if (xmlText !== prev) {
        localStorage.setItem('offline_spevnik', xmlText);
        cacheXmlToCacheStorage(xmlText);
        // diagnostics: remember when we successfully synced from network
        try {
          const now = Date.now();
          localStorage.setItem('spevnik_last_sync_at', String(now));
          localStorage.setItem('spevnik_last_sync_bytes', String(xmlText.length));
        } catch(e) {}
        // Ak sme ešte nič nezobrazili, alebo nie sme v detaile, prepočítaj.
        const inDetail = (document.getElementById('song-detail')?.style.display === 'block');
        if (!saved || !inDetail) {
          processXML(xmlText, { source:'network' });
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
function processXML(xmlText, opts = null) {
  // diagnostics
  try {
    lastXmlShownAt = Date.now();
    localStorage.setItem('spevnik_last_shown_at', String(lastXmlShownAt));
    const src = (opts && opts.source) ? String(opts.source) : '';
    if (src) localStorage.setItem('spevnik_last_source', src);
  } catch(e) {}

  try {
    const t1 = parseInt(localStorage.getItem('spevnik_last_sync_at')||'0',10) || 0;
    const b1 = parseInt(localStorage.getItem('spevnik_last_sync_bytes')||'0',10) || 0;
    if (t1) lastXmlSyncAt = t1;
    if (b1) lastXmlSyncBytes = b1;
  } catch(e) {}

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

  // Doplnenie akordov: default ON, ale piesne 999 nechávame úplne bez automatických zásahov.
  const __is999 = String(s.originalId||"").replace(/^0+/,'') === '999';
  setChordTemplateEnabled(!__is999);
  updateChordTemplateUI();


  // V detaile piesne z 'Piesne na dnes' vždy defaultne zobraz verziu DNES
  setDnesShowOriginal(false);

  try { setupAlelujaLitControlsIfNeeded(); } catch(e) {}

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
  m = t.match(/^(\d+)(?:[\.)]|:)?(?:\s+|$)(.*)$/);
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
  let s = (tok||"").trim();
  if (!s) return "";
  // normalize numbers: "2" -> "2."
  let m = s.match(/^(\d+)\.?$/);
  if (m) return `${m[1]}.`;
  // normalize R/B: "R" "R2" "R:" -> "R:" / "R2:"
  m = s.match(/^R(\d*)\s*:?$/i);
  if (m) return `R${m[1]||""}:`;
  m = s.match(/^B(\d*)\s*:?$/i);
  if (m) return `B${m[1]||""}:`;
  // keep specials as-is
  m = s.match(/^(PREDOHRA|MEDZIHRA|DOHRA|POZNAMKA|POZNÁMKA)(?:\(.*\))?$/i);
  if (m) return s.toUpperCase().replace(/\s+/g,'');
  return s;
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

  // 999: bez akýchkoľvek automatických úprav textu/akordov. Len poskladaj vybrané bloky tak, ako sú.
  if (is999){
    let out = [];
    const markerRe = /^(\d+\.|R\d*:|B\d*:)$/
    for (const tokRaw of tokens){
      const tok = normalizeOrderToken(tokRaw);

      const m = tok.match(/^(PREDOHRA|MEDZIHRA|DOHRA|POZNAMKA|POZNÁMKA)(?:\((.*)\))?$/i);
      if (m){
        const kind = m[1].toUpperCase();
        const txt = (m[2] || '').trim();
        out.push(`${kind[0]}${kind.slice(1).toLowerCase()}: ${txt}`.trim());
        continue;
      }

      const key = tok;
      if (!markerRe.test(key)) continue;
      out.push(key);
      const lines = (blocks[key] || []);
      out.push(...lines);
    }
    return out.join("\n");
  }

  const topTrans = extractTopTranspose(song.origText);
  let out = [];
  if (!is999 && topTrans){
    out.push(`Transpozícia: ${topTrans}`);
}

  const shownTransFor = new Set();

  const markerRe = /^(\d+\.|R\d*:|B\d*:)$/
  for (const tokRaw of tokens){
    const tok = normalizeOrderToken(tokRaw);

    const m = tok.match(/^(PREDOHRA|MEDZIHRA|DOHRA|POZNAMKA|POZNÁMKA)(?:\((.*)\))?$/i);
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
function normalizeSpecialKind(name){
  const t = String(name || '').trim();
  if (/^predohra$/i.test(t)) return 'Predohra';
  if (/^medzihra$/i.test(t)) return 'Medzihra';
  if (/^dohra$/i.test(t)) return 'Dohra';
  if (/^ž?alm$/i.test(t) || /^zalm$/i.test(t)) return 'Žalm';
  if (/^alelujo?v[ýy]\s*ver[sš]$/i.test(t) || /^alelujo?v\s*ver[sš]$/i.test(t) || /^alelujo?v[yý]\s*vers$/i.test(t)) return 'Alelujový verš';
  if (/^pozn[aá]mka$/i.test(t) || /^poznamka$/i.test(t)) return 'Poznámka';
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

function parseSpecialWithText(trimmed){
  const t = String(trimmed || '').trim();
  let m = t.match(/^(Predohra|Medzihra|Dohra|Poznámka|Poznamka|Žalm|Zalm|Alelujový verš|Alelujovy vers|Alelujový vers)\s*:\s*(.*)$/i);
  if (m){
    const kind = normalizeSpecialKind(m[1]);
    const rest = (m[2]||'').trim();
    return { kind, rest };
  }
  m = t.match(/^(Predohra|Medzihra|Dohra|Poznámka|Poznamka|Žalm|Zalm|Alelujový verš|Alelujovy vers|Alelujový vers)\s+(.*)$/i);
  if (m){
    const kind = normalizeSpecialKind(m[1]);
    const rest = (m[2]||'').trim();
    return { kind, rest };
  }
  return null;
}

function parseSpecialMarkerOnly(trimmed){
  const t = String(trimmed || '').trim();
  const m = t.match(/^(Predohra|Medzihra|Dohra|Poznámka|Poznamka|Žalm|Zalm|Alelujový verš|Alelujovy vers|Alelujový vers)\s*:?\s*$/i);
  if (!m) return '';
  return normalizeSpecialKind(m[1]);
}


function normalizeChordName(ch){
  const c = String(ch||'').trim();
  // požiadavka: A# -> B, A#m -> B (m sa zahodí)
  const m = c.match(/^A#(.*)$/i);
  if (m){
    let rest = m[1] || '';
    if (rest.startsWith('m') || rest.startsWith('M')) rest = rest.slice(1);
    return 'B' + rest;
  }
  return c;
}

function songLineHTML(label, text, extraClass) {
  const safeLabel = escapeHTML(label || '');
  const rawText = String(text || '').replace(/\[(.*?)\]/g, (m, inner) => `[${normalizeChordName(inner)}]`);
  let safeText = escapeHTML(rawText);

  // chords -> span
  safeText = safeText.replace(/\[(.*?)\]/g, '<span class="chord">$1</span>');

  const cls = extraClass ? `song-line ${extraClass}` : 'song-line';
  return `<div class="${cls}"><span class="song-label">${safeLabel}</span><span class="song-line-text">${safeText}</span></div>`;
}



function songTextToHTML(text) {
  const lines = String(text || '').split('\n');
  let pendingLabel = '';
  let pendingSpecial = '';
  let pendingChordLines = [];
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

  function flushPendingSpecialEmpty(){
    if (!pendingSpecial) return;
    closeSection();
    out.push('<div class="song-section">');
    out.push(songLineHTML('', `${pendingSpecial}:`, 'song-special-row'));
    out.push('<div class="song-line song-blank"><span class="song-label"></span><span class="song-line-text"></span></div>');
    out.push('</div>');
    pendingSpecial = '';
  }

  for (const raw of lines) {
    const line = String(raw ?? '');
    const trimmed = line.trim();

    // Aleluja 999 – vložené bloky (Žalm / Alelujový verš) ako samostatné chlieviky
    const litM = trimmed.match(/^\[\[LIT-(PSALM|VERSE)\|(.*)\]\]$/);
    if (litM){
      // zatvor otvorenú sekciu piesne, nech sa to nemieša s gridom
      closeSection();
      pendingLabel = '';
      pendingSpecial = '';
      pendingChordLines = [];
      pendingBlanks = 0;

      const kind = litM[1];
      let payload = '';
      try { payload = decodeURIComponent(litM[2] || ''); } catch(e){ payload = ''; }

      if (kind === 'PSALM'){
        // payload typicky začína "R.: ..." – chceme "Žalm: <refren>" v hlavičke a pod tým slohy
        const lines = String(payload||'').replace(/\r/g,'').split('\n').map(l=>String(l||'').trim()).filter(Boolean);
        let refrain = '';
        let bodyLines = lines.slice();
        const rLineIdx = bodyLines.findIndex(l => /^R\.?\s*:?/i.test(l));
        if (rLineIdx >= 0){
          const rLine = bodyLines[rLineIdx];
          refrain = rLine.replace(/^R\.?\s*:?\s*/i,'').trim();
          bodyLines.splice(rLineIdx, 1);
        }
        payload = bodyLines.join('\n').trim();
        const header = refrain ? `Žalm: ${refrain}` : 'Žalm';

        out.push('<div class="aleluja-insert">');
        out.push(`<div class="aleluja-h">${escapeHtml(header)}</div>`);
        if (payload) out.push(`<pre>${escapeHtml(payload)}</pre>`);
        out.push('</div>');
        continue;
      } else {
        // Alelujový verš – bez "Aleluja, aleluja, aleluja."
        let lines = String(payload||'').replace(/\r/g,'').split('\n').map(l=>String(l||'').trim()).filter(Boolean);
        lines = lines.filter(l => !/^Aleluja[\s,!.]*$/i.test(l));
        if (lines.length){
          lines[0] = lines[0].replace(/^Aleluja[\s,!.]*/i,'').trim();
          lines[0] = lines[0].replace(/^Aleluja[\s,!.]*/i,'').trim();
          if (!lines[0]) lines.shift();
        }
        payload = lines.join('\n').trim();

        out.push('<div class="aleluja-insert">');
        out.push(`<div class="aleluja-h">${escapeHtml('Alelujový verš')}</div>`);
        if (payload) out.push(`<pre>${escapeHtml(payload)}</pre>`);
        out.push('</div>');
        continue;
      }
    }


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
      flushPendingSpecialEmpty();
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
      flushPendingSpecialEmpty();
      pendingSpecial = spOnly;
      continue;
    }
    const sp = parseSpecialWithText(trimmed);
    if (sp){
      pendingLabel = '';
      flushPendingSpecialEmpty();
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
      // ak čaká špeciál a prišiel nový marker, zobraz špeciál ako prázdny blok
      flushPendingSpecialEmpty();
      // nový blok -> zavri starý
      // Ak máme rozpracovaný blok, kde prišiel marker (napr. "1"),
      // nasledovali iba akordové riadky (bez textu) a potom prišiel nový marker,
      // NESMIEME tieto akordy zahodiť. Je to bežné pri niektorých piesňach (aj 999),
      // kde je obsahom slohy iba sled akordov.
      if (pendingLabel && pendingChordLines.length) {
        closeSection();
        openSection();
        out.push(songLineHTML(pendingLabel, pendingChordLines[0], 'song-chordline'));
        for (let k = 1; k < pendingChordLines.length; k++) {
          out.push(songLineHTML('', pendingChordLines[k], 'song-chordline'));
        }
        pendingChordLines.length = 0;
        pendingLabel = '';
        // Ukonči tento akordový-only blok.
        closeSection();
      } else if (pendingChordLines.length) {
        // Máme "dozvuky" akordových riadkov, ktoré patria k predchádzajúcemu bloku.
        // Najmä pri 999 piesňach je bežné, že po texte nasledujú ešte ďalšie akordové riadky
        // (bez textu) a až potom príde nový marker. Tieto riadky musia zostať v TOM ISTOM
        // odseku/bloku (nie v novom song-section).
        if (!sectionOpen) openSection();
        for (const cl of pendingChordLines) out.push(songLineHTML('', cl, 'song-chordline'));
        pendingChordLines.length = 0;
        // teraz môžeme uzavrieť predchádzajúci blok pred novým markerom
        closeSection();
      }

      closeSection();
      pendingLabel = only;
      continue;
    }

    // Marker + text in one line (e.g. "1 Text", "R: Text", "Bridge text")
    const withText = parseMarkerWithText(trimmed);
    if (withText) {
      flushPendingSpecialEmpty();
      closeSection();
      openSection();

      // If there are pending chordlines, put the FIRST on the SAME row as the marker label (e.g. "2").
      // Any additional chordlines render above the lyric text (without label).
      // Then render the lyric text on the next row (without a label).
      if (pendingChordLines.length){
        out.push(songLineHTML(withText.label, pendingChordLines[0], 'song-chordline'));
        for (let k=1; k<pendingChordLines.length; k++){
          out.push(songLineHTML('', pendingChordLines[k], 'song-chordline'));
        }
        pendingChordLines.length = 0;
        out.push(songLineHTML('', withText.text));
      } else {
        out.push(songLineHTML(withText.label, withText.text));
      }
      continue;
    }
    // Ak čaká špeciálny blok (Predohra/Medzihra/Dohra/Poznámka):
    // - pri zapnutej akordovej šablóne (doplnenie akordov) NESMIEME chytiť akordy z nasledujúcej slohy,
    //   preto chord-only riadky necháme pre ďalší blok.
    if (pendingSpecial && isChordOnlyLine(line)) {
      if (typeof chordTemplateEnabled === 'function' && chordTemplateEnabled()) {
        flushPendingSpecialEmpty();
        pendingChordLines.push(line);
        continue;
      } else {
        closeSection();
        out.push('<div class="song-section">');
        out.push(songLineHTML('', `${pendingSpecial}: ${line.trim()}`, 'song-special-row'));
        out.push('</div>');
        pendingSpecial = '';
        pendingChordLines.length = 0;
        continue;
      }
    }
    // štandardne prilep špeciál na prvý nasledujúci textový riadok
    if (pendingSpecial){
      closeSection();
      out.push('<div class="song-section">');
      out.push(songLineHTML('', `${pendingSpecial}: ${line.trim()}`, 'song-special-row'));
      out.push('</div>');
      pendingSpecial = '';
      pendingChordLines.length = 0;
      continue;
    }


        // Chord-only line: buffer it and render above the next content line.
    // If the section/song ends with chord-only lines, we will render them at the end.
    if (isChordOnlyLine(line)) {
      pendingChordLines.push(line);
      continue;
    }

// Normal line: if we have a pending label, use it only for this first content line
    if (pendingLabel) {
      closeSection();
      openSection();

      // If there are pending chordlines, put the FIRST on the SAME row as the verse label.
      // Any additional chordlines render above the lyric line (without label).
      // Then render the lyric text on the next row (without a label).
      if (pendingChordLines.length){
        out.push(songLineHTML(pendingLabel, pendingChordLines[0], 'song-chordline'));
        for (let k=1; k<pendingChordLines.length; k++){
          out.push(songLineHTML('', pendingChordLines[k], 'song-chordline'));
        }
        pendingChordLines.length = 0;
        out.push(songLineHTML('', line));
      } else {
        // No chordline -> render the lyric line with the label as usual
        out.push(songLineHTML(pendingLabel, line));
      }
      pendingLabel = '';
      continue;
    } else {
      // pokračovanie aktuálneho bloku (ak existuje), inak voľný text

      if (sectionOpen){
        if (pendingChordLines.length){ for (const cl of pendingChordLines) out.push(songLineHTML('', cl, 'song-chordline')); pendingChordLines.length = 0; }
        out.push(songLineHTML('', line));
      } else {
        if (pendingChordLines.length){ for (const cl of pendingChordLines) out.push(songLineHTML('', cl, 'song-chordline')); pendingChordLines.length = 0; }
        out.push(songLineHTML('', line));
      }
    }
  }

  // ak ostal rozpracovaný špeciál bez obsahu, zobraz ho ako prázdny blok
  flushPendingSpecialEmpty();

  // If chord-only lines remain without following lyric (e.g., chord-only songs/verses), render them now.
  if (pendingLabel && pendingChordLines.length){
    closeSection();
    openSection();
    out.push(songLineHTML(pendingLabel, pendingChordLines[0], 'song-chordline'));
    for (let k=1; k<pendingChordLines.length; k++){
      out.push(songLineHTML('', pendingChordLines[k], 'song-chordline'));
    }
    pendingChordLines.length = 0;
    pendingLabel = '';
  }
  if (pendingChordLines.length){
    if (!sectionOpen) openSection();
    for (const cl of pendingChordLines) out.push(songLineHTML('', cl, 'song-chordline'));
    pendingChordLines.length = 0;
  }
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

/* ===== DNES: PREPÍNAČ ZOBRAZENIA (DNES vs ORIGINÁL) ===== */
function updateDnesViewUI(){
  const grp = document.getElementById('dnes-view-group');
  const btn = document.getElementById('dnes-view-btn');
  const lab = document.getElementById('dnes-view-label');
  if (!grp || !btn || !lab) return;

  const isDnes = (currentListSource === 'dnes');
  grp.style.display = isDnes ? '' : 'none';

  if (!isDnes) return;

  if (dnesShowOriginal){
    lab.textContent = 'ORIG';
    btn.title = 'Zobraziť verziu na dnes';
    btn.classList.add('active');
  } else {
    lab.textContent = 'DNES';
    btn.title = 'Zobraziť originál';
    btn.classList.remove('active');
  }
}

function setDnesShowOriginal(v){
  dnesShowOriginal = !!v;
  updateDnesViewUI();
}

function toggleDnesView(){
  if (currentListSource !== 'dnes') return;
  dnesShowOriginal = !dnesShowOriginal;
  updateDnesViewUI();
  renderSong();
}




const TEMPLATE_PREFIX = '\u2063'; // invisible separator for auto-inserted chordlines
function stripTemplatePrefix(line){
  const t = String(line ?? '');
  return t.startsWith(TEMPLATE_PREFIX) ? t.slice(TEMPLATE_PREFIX.length) : t;
}
function isTemplateChordLine(line){
  return String(line ?? '').startsWith(TEMPLATE_PREFIX);
}

function hasChordInLine(line){
  const t = stripTemplatePrefix(line);
  return /\[[^\]]+\]/.test(String(t||''));
}

function stripChordsFromLine(line){
  const t = stripTemplatePrefix(line);
  return String(t||'').replace(/\[[^\]]+\]/g, '');
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
  const t = stripTemplatePrefix(line);
  return (String(t||'').match(/\[[^\]]+\]/g) || []);
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

    // --- SPECIAL blocks (Predohra / Medzihra / Dohra / Poznámka) ---
    const spOnly = parseSpecialMarkerOnly(trimmed);
    const spWith = parseSpecialWithText(trimmed);
    if (spOnly || spWith){
      pushCur();
      // keep original line in header, collect following lines into body until next marker
      cur = { kind:'special', label: spOnly || (spWith ? spWith.kind : ''), type:'special', header: line, body: [] };
      continue;
    }

    const only = parseMarkerOnly(trimmed);
    const withText = parseMarkerWithText(trimmed);

    if (only){
      pushCur();
      const cls = classifyLabel(only);
      // normalize header to marker only (so chord-template never ends up "before" marker)
      cur = { kind:'block', label: only, type: cls.type, index: cls.index, header: only, body: [] };
      continue;
    }

    if (withText){
      pushCur();
      const cls = classifyLabel(withText.label);

      // For verse/chorus/bridge: normalize to marker on its own line.
      // This prevents a synthetic chordline from being inserted *above* a "2 text" line (which would escape into previous block).
      if (cls.type === 'verse' || cls.type === 'chorus' || cls.type === 'bridge'){
        cur = { kind:'block', label: withText.label, type: cls.type, index: cls.index, header: withText.label, body: [withText.text] };
      } else {
        // preserve original line for other kinds
        cur = { kind:'block', label: withText.label, type: cls.type, index: cls.index, header: null, body: [line] };
      }
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
    if (pat) insertBefore.set(info.lineIndex, TEMPLATE_PREFIX + pat);
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
        if (!hasChordInLine(line)) insertBefore.set(infos[i].lineIndex, TEMPLATE_PREFIX + now);
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
  let text = (currentListSource === 'dnes' && currentDnesOrder && !dnesShowOriginal)
    ? buildOrderedSongText(currentSong, currentDnesOrder)
    : currentSong.origText;

  const is999 = String(currentSong.originalId||"").replace(/^0+/,'') === '999';
  const isAleluja999 = isAleluja999Song(currentSong);

  // Aleluja (999) – v 'Piesne na dnes' vlož Žalm pred a Alelujový verš po (podľa dátumu z názvu priečinka).
  if (isAleluja999 && currentListSource === 'dnes') {
    try {
      const iso = getIsoDateFromDnesTitleSafe();
      text = injectPsalmAndAlleluiaBlocks(text, iso);
    } catch(e) {}
  }




  try {
  if (!is999){
    // Akordová šablóna zo slohy 1 (overlay) + doplnenie 2. polovice prvého refrenu (iba v rámci toho refrenu)
    text = applyChordTemplateOverlay(text);

    // Zredukuj extrémne medzery (najmä po značkách 1., R:, B:, Refren, Bridge, Predohra..., Transpozícia...)
  // - odstráni prázdne riadky hneď po značke
  // - zredukuje viac prázdnych riadkov za sebou
  text = String(text || '').replace(/^(\d+\.|R\d*:|B\d*:|Refren:?|Bridge:?|Predohra.*|Medzihra.*|Dohra.*|Transpozícia:.*)\s*\n\s*\n+/gmi, '$1\n');
  text = text.replace(/\n\s*\n\s*\n+/g, '\n\n');

  // Pri poradí (editor "forma") nech sú bloky úplne bez medzier
  if (currentListSource === 'dnes' && currentDnesOrder && !dnesShowOriginal) {
    text = text.replace(/\n\s*\n+/g, '\n');
  }

  // Transpose chords first
  if (transposeStep !== 0) {
    text = text.replace(/\[(.*?)\]/g, (m, c) => `[${transposeChord(c, transposeStep)}]`);
  }

  // Hide chords if needed
  if (!chordsVisible) {
    // Bežne pri OFF vyhadzujeme všetky [akordy].
    // ALE: pri riadkoch Predohra/Medzihra/Dohra chceme vždy zobraziť presne to,
    // čo je v zdrojovom riadku – aj keď sú tam iba akordy.
    // Platí to aj pre obsahový riadok/riadky hneď za markerom "Predohra:" (marker-only).
    const lines = String(text || '').split('\n');
    let keepChordsMode = false; // po "Predohra:" necháme akordy aj v nasledujúcich chord-only riadkoch

    text = lines.map((line) => {
      const trimmed = (line || '').trim();

      const isSpecialLine = /^(Predohra|Medzihra|Dohra)\b/i.test(trimmed);
      const isSpecialMarkerOnly = /^(Predohra|Medzihra|Dohra|Poznámka|Poznamka|Žalm|Zalm|Alelujový verš|Alelujovy vers|Alelujový vers)\s*:?\s*$/i.test(trimmed);

      // Začiatok špeciálneho bloku: nechaj všetko tak a zapni režim pre následné akordové riadky
      if (isSpecialLine) {
        keepChordsMode = !!isSpecialMarkerOnly;
        return line; // nič neodstraňuj
      }

      // Režim po marker-only Predohra/Medzihra/Dohra:
      // - ak nasledujú chord-only riadky, nechaj ich (aby sa neprilepili na text slohy)
      // - ak príde bežný text, tento riadok spracuj bežne a režim ukonči
      if (keepChordsMode) {
        // Ak narazíme na nový marker (1., R:, B:, Refren, Bridge...), ukonči režim
        if (parseMarkerOnly(trimmed) || parseMarkerWithText(trimmed) || parseSpecialWithText(trimmed) || parseSpecialMarkerOnly(trimmed)) {
          keepChordsMode = false;
        } else if (trimmed === '') {
          // prázdny riadok ukončí špeciálny blok
          keepChordsMode = false;
        } else if (!isChordOnlyLine(line)) {
          // normálny text: tento riadok spracuj bežne, potom režim ukonči
          const out = String(line).replace(/\[.*?\]/g, '');
          keepChordsMode = false;
          return out;
        }

        // chord-only: nechaj bez zásahu
        if (keepChordsMode) return line;
        // ak sme režim práve vypli (kvôli markeru), spadneme ďalej na bežné spracovanie
      }

      // Bežné spracovanie: odstráň akordy
      return String(line).replace(/\[.*?\]/g, '');
    }).join('\n');
  }

  // Failsafe: never show empty content
  if (!text || !text.trim()) text = currentSong.origText || '';

  // +1 / -2 (samostatný riadok) -> Transpozícia: +1
  text = text.replace(/^\s*([+-]\d+)\s*\n/, 'Transpozícia: $1\n');

  }

  const el = document.getElementById('song-content');
  el.innerHTML = songTextToHTML(text);
  el.style.fontSize = fontSize + 'px';

  // sync presentation overlay
  updatePresentationUI();
  updateChordTemplateUI();
  } catch (err){
    // Safe fallback: show raw text so the app never becomes unusable
    const el = document.getElementById('song-content');
    if (el){
      const safeText = (text == null) ? '' : String(text);
      el.innerHTML = `
        <div class="safe-mode-box">
          <div class="safe-title">Bezpečný režim</div>
          <div class="safe-sub">Nastala chyba pri zobrazení piesne. Zobrazený je surový text.</div>
          <pre class="safe-pre">${escapeHtml(safeText)}</pre>
        </div>`;
      el.style.fontSize = fontSize + 'px';
    }
    console.error('renderSong error', err);
    showToast('Chyba pri zobrazení – použil sa bezpečný režim.', false);
    try { updatePresentationUI(); } catch(e) {}
    try { updateChordTemplateUI(); } catch(e) {}
  }
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
  const seen = new Set();
  const arr = [];

  for (const ln of lines){
    const t = (ln || '').trim();
    if (!t) continue;
    const mk = parseBlockMarker(t);
    if (mk){
      const key = String(mk.key || '').replace(/\s+/g,'');
      if (!seen.has(key)){
        seen.add(key);
        arr.push(key);
      }
    }
  }
  // nezoraďovať – chceme poradie podľa textu konkrétnej piesne
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
    let m = s.match(/^(PREDOHRA|MEDZIHRA|DOHRA|POZNAMKA|POZNÁMKA)(?:\((.*)\))?$/i);
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
    const isSpecial = /^(PREDOHRA|MEDZIHRA|DOHRA|POZNAMKA|POZNÁMKA)\b/i.test(t);
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
  const isSpecial = /^(PREDOHRA|MEDZIHRA|DOHRA|POZNAMKA|POZNÁMKA)\b/i.test(t);
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
  const m = t.match(/^(PREDOHRA|MEDZIHRA|DOHRA|POZNAMKA|POZNÁMKA)(?:\((.*)\))?$/i);
  if (!m) return null;
  return { kind: m[1].toUpperCase(), note: (m[2] || '').trim() };
}

function editSpecialToken(i){
  const parsed = parseSpecialTokenString(formModalOrder[i]);
  if (!parsed) return;

  const kindSk = (parsed.kind === 'PREDOHRA' ? 'Predohra' : (parsed.kind === 'MEDZIHRA' ? 'Medzihra' : (parsed.kind === 'DOHRA' ? 'Dohra' : 'Poznámka')));
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
  // Povoliť vložiť aj viackrát (napr. 2× Medzihra)

  // Predvyplň poznámku z textu piesne, ak existuje "Predohra: ..." atď.
  let preset = '';
  const s = songs.find(x => x.id === formModalSongId);
  if (s && s.origText){
    const kindSk = (String(kind||'').toUpperCase() === 'PREDOHRA' ? 'Predohra' : (String(kind||'').toUpperCase() === 'MEDZIHRA' ? 'Medzihra' : (String(kind||'').toUpperCase() === 'DOHRA' ? 'Dohra' : 'Poznámka')));
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

// Backwards-compatible alias
function hardReset(){
  return hardResetApp();
}

async function hardResetApp() {
  if (!navigator.onLine){
    showToast("Si offline – aktualizácia nie je dostupná.", false);
    return;
  }
  closeFabMenu();
  setSyncStatus("Aktualizujem…", "sync-warn");
  if (!confirm("Vymazať pamäť?")) return;

  localStorage.clear();
  try {
    const keys = await caches.keys();
    for (const k of keys) await caches.delete(k);
  } catch (e) {}
  setSyncStatus("Aktualizované", "sync-ok");
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

  // Fast: change font-size without re-rendering (prevents lag on iOS/Android)
  const el = document.getElementById('song-content');
  if (el) el.style.fontSize = v + 'px';

  try { updatePresentationUI(); } catch(e) {}
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
    if (e.cancelable) e.preventDefault();
    active = true;
    startDist = dist(e.touches[0], e.touches[1]);
    startSize = fontSize;
  }, { passive: false });

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

// iOS Safari: block native page zoom while we handle pinch ourselves
document.addEventListener('gesturestart', (e) => {
  if (area.style.display !== 'none' && e.cancelable) e.preventDefault();
}, { passive: false });
document.addEventListener('gesturechange', (e) => {
  if (area.style.display !== 'none' && e.cancelable) e.preventDefault();
}, { passive: false });

}


// Pri niektorých prehliadačoch (najmä mobil + bfcache) sa po refreshi obnoví rozbalený stav.
// Toto ho vždy zresetuje na zbalené sekcie.
window.addEventListener('pageshow', () => {
  try { forceInitialCollapsed(); } catch(e) {}
  try { setTimeout(()=>{ try{ forceInitialCollapsed(); } catch(e){} }, 0); } catch(e) {}
});
document.addEventListener('DOMContentLoaded', () => {
  forceInitialCollapsed();
  // 🔒 vždy začni so zavretými sekciami (aj keď prehliadač obnovil stav formulárov)
  try{
    const search = document.getElementById('search');
    if (search) search.value = '';
    document.querySelectorAll('.section-content').forEach(el => { el.style.display = 'none'; });
    ['dnes','playlists','all','lit','history'].forEach(id => {
      const ch = document.getElementById(id+'-chevron');
      if (ch) ch.className = 'fas fa-chevron-down section-chevron';
    });
  }catch(e){}

  // vždy začni na domovskej obrazovke (zoznam)
  try{ closeSong(); }catch(e){}

  setSyncStatus(navigator.onLine ? "Aktualizujem…" : "Offline", navigator.onLine ? "sync-warn" : "sync-warn");
  // restore song font size (detail)
  const savedSong = parseInt(localStorage.getItem(LS_SONG_FONT_SIZE) || String(fontSize), 10);
  if (!isNaN(savedSong)) fontSize = Math.max(12, Math.min(34, savedSong));
  updateFontSizeLabel();
  initSongPinchToZoom();
  updateChordTemplateUI();
// Try to request persistent storage (helps iOS/Android keep offline cache longer)
try {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
} catch(e) {}

// PWA offline
if ('serviceWorker' in navigator) {
  try { navigator.serviceWorker.register('sw.js'); } catch(e) {}
}

// META update badge polling (1x/min) – start immediately (not only in song detail)
startMetaPolling();


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



/* =======================
   Liturgický kalendár + Aleluja 999 (Žalm + verš)
   - Lit kalendár je samostatná sekcia.
   - Defaultne dnešný deň.
   - Hlavička: d.m.yyyy (deň v týždni) + Féria/Sviatok.
   - Pri viacerých možnostiach výber s ľudskými názvami.
   - Aleluja 999 v "Piesne na dnes": vloží Žalm pred a verš po + dá výber.
======================= */

const LIT_CACHE_PREFIX = 'liturgia_cache_';      // liturgia_cache_YYYY-MM-DD
const LIT_CHOICE_PREFIX = 'liturgia_choice_';    // liturgia_choice_YYYY-MM-DD

function isoToday(){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

function weekdaySkFromISO(iso){
  try{
    const d = new Date(iso + 'T00:00:00');
    const names = ['nedeľa','pondelok','utorok','streda','štvrtok','piatok','sobota'];
    return names[d.getDay()] || '';
  }catch(e){ return ''; }
}

function dmyFromISO(iso){
  try{
    const [y,m,d] = iso.split('-').map(x=>parseInt(x,10));
    return `${d}.${m}.${y}`;
  }catch(e){ return iso; }
}

// Z názvu "Piatok 30.1" / "Piatok 30.1." / "Piatok 30.1.2026" -> ISO YYYY-MM-DD
function parseIsoFromDnesTitle(title){
  const t = String(title||'').trim();
  // nájdi prvý výskyt d.m alebo d.m.yyyy
  const m = t.match(/(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?/);
  if (!m) return null;
  const dd = parseInt(m[1],10);
  const mm = parseInt(m[2],10);
  let yyyy = m[3] ? parseInt(m[3],10) : (new Date()).getFullYear();
  if (!(dd>=1 && dd<=31 && mm>=1 && mm<=12)) return null;
  const d = new Date(yyyy, mm-1, dd);
  // ak bez roka a vyšlo to "ďaleko v minulosti", skús posun na ďalší rok (typicky prelomy roka)
  if (!m[3]){
    const now = new Date();
    const diff = d.getTime() - now.getTime();
    const days = diff / (1000*60*60*24);
    if (days < -200) {
      yyyy = yyyy + 1;
    }
  }
  const iso = `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
  return iso;
}

function getIsoDateFromDnesTitleSafe(){
  try{
    const payload = parseDnesPayload(localStorage.getItem('piesne_dnes') || '');
    return parseIsoFromDnesTitle(payload.title) || isoToday();
  }catch(e){
    return isoToday();
  }
}

function litCacheKey(iso){ return LIT_CACHE_PREFIX + iso; }
function litChoiceKey(iso){ return LIT_CHOICE_PREFIX + iso; }

function getCachedLit(iso){
  try{
    const raw = localStorage.getItem(litCacheKey(iso));
    if (!raw) return null;
    return JSON.parse(raw);
  }catch(e){ return null; }
}
function setCachedLit(iso, obj){
  try{
    localStorage.setItem(litCacheKey(iso), JSON.stringify(obj));
  }catch(e){}
}
function getLitChoiceIndex(iso){
  try{
    const raw = localStorage.getItem(litChoiceKey(iso));
    const n = raw==null ? 0 : parseInt(raw,10);
    return isNaN(n) ? 0 : n;
  }catch(e){ return 0; }
}
function setLitChoiceIndex(iso, idx){
  try{ localStorage.setItem(litChoiceKey(iso), String(idx)); }catch(e){}
}

function litFeastSummary(variants){
  if (!Array.isArray(variants) || !variants.length) return '';
  function pretty(v){
    const label = (v && v.label) ? String(v.label).trim() : '';
    const title = (v && v.title) ? String(v.title).trim() : '';
    if (!label) return title;
    // Ak je label iba "Féria" a máme detailný titulok dňa, zobraz titulok
    if (label.toLowerCase() === 'féria' && title) return title;
    // Ak máme sviatok/spomienku a titulok, spoj
    if (title && !label.toLowerCase().includes(title.toLowerCase())) return `${label} — ${title}`;
    return label;
  }
  const labels = variants.map(pretty).filter(Boolean);
  const uniq = [];
  labels.forEach(x => { if (!uniq.includes(x)) uniq.push(x); });
  return uniq.join(' / ');
}

function setLitHeader(iso, variants){
  const left = document.getElementById('lit-head-left');
  const right = document.getElementById('lit-head-right');
  if (left){
    const w = weekdaySkFromISO(iso);
    left.textContent = `${dmyFromISO(iso)}${w ? ' ' + w.toLowerCase() : ''}`;
  }
  // vpravo už nič netreba (dátum je pekne vľavo)
  if (right) right.textContent = '';
}


function trimLitTextStart(text){
  const lines = String(text||'').replace(/\r/g,'').split('\n').map(l=>String(l||'').trim());
  // drop empty-only, but keep structure later
  // nájdi prvý "hlavný" liturgický nadpis (typicky: '4. nedeľa v Cezročnom období' alebo 'Slávnosť ...')
  const idx = lines.findIndex(l =>
    /\bv\s+(cezročnom|adventnom|vianočnom|pôstnom|velkonočnom|veľkonočnom)\s+obdob/i.test(l) ||
    /^\d+\.\s*(nedeľa|nedela)\b/i.test(l) ||
    /^(slávnosť|sviatok|spomienka|ľubovoľná spomienka)/i.test(l)
  );
  const cut = idx >= 0 ? idx : 0;
  const sliced = lines.slice(cut);
  // odstráň úplne krátke "šumy" (napr. 'Z', 'A', 'B', 'C' samostatne)
  const cleaned = [];
  for (const l of sliced){
    if (!l) { cleaned.push(''); continue; }
    if (l.length <= 2 && /^[A-ZÁČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ]$/i.test(l)) continue;
    cleaned.push(l);
  }
  // zredukuj veľké medzery
  return cleaned.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}

function litTextToCardsHTML(text){
  const t = trimLitTextStart(text);
  if (!t) return '<div style="opacity:.8;">—</div>';

  const rawLines = t.replace(/\r/g,'').split('\n').map(l=>String(l||''));
  // prvý neprázdny riadok = názov dňa/slávenia (napr. "4. nedeľa v Cezročnom období")
  let i = 0;
  while (i < rawLines.length && !rawLines[i].trim()) i++;
  const feast = (rawLines[i]||'').trim();
  i++;

  const sections = [];
  let cur = null;

  function pushCur(){
    if (!cur) return;
    const body = cur.body.join('\n').replace(/\n{3,}/g,'\n\n').trim();
    if (cur.title || cur.sub || body){
      sections.push({ title: cur.title, sub: cur.sub, body });
    }
    cur = null;
  }
  function start(title){
    pushCur();
    cur = { title: title||'', sub:'', body:[] };
  }

  function looksLikeRef(line){
    const l = line.trim();
    if (!l) return false;
    // typicky "Sof 2, 3; 3, 12-13" alebo "Ž 146, 6c-7..."
    if (l.length > 70) return false;
    if (!/\d/.test(l)) return false;
    return (/^[A-Za-zÁČĎÉÍĹĽŇÓÔŔŠŤÚÝŽŽ]{1,8}\s*\d/.test(l) || /^Ž\s*\d/.test(l));
  }

  function headerType(line){
    const l = line.trim();
    if (!l) return '';
    if (/^Responzóriový\s+žalm\b/i.test(l) || /^Žalm\b/i.test(l)) return 'Žalm';
    if (/^Alelujový\s+verš\b/i.test(l)) return 'Alelujový verš';
    if (/^Druhé\s+čítanie\b/i.test(l)) return 'Druhé čítanie';
    if (/^Prvé\s+čítanie\b/i.test(l)) return 'Prvé čítanie';
    if (/^Evanjelium\b/i.test(l) || /^Čítanie\s+zo\s+svätého\s+evanjelia\b/i.test(l)) return 'Evanjelium';
    if (/^Čítanie\s+z\b/i.test(l)) return l; // chceme presný nadpis "Čítanie z ..."
    return '';
  }

  // default: začni prvým čítaním, ak ho nájdeme
  start('Prvé čítanie');

  for (; i < rawLines.length; i++){
    const raw = rawLines[i];
    const l = raw.trim();

    if (!l){
      if (cur) cur.body.push('');
      continue;
    }

    // implicitné začiatky blokov podľa referencií
    if (/^Ž\s*\d/.test(l) && cur && cur.title !== 'Žalm'){
      start('Žalm');
      // tento riadok je sub (referencia)
      cur.sub = l;
      continue;
    }

    if (/^Aleluja\b/i.test(l) && cur && cur.title !== 'Alelujový verš' && cur.title !== 'Evanjelium'){
      start('Alelujový verš');
      // ak je riadok len "Aleluja, aleluja, aleluja.", nech ho nedávame
      if (!/^Aleluja[\s,!.]*$/i.test(l)) cur.body.push(raw);
      continue;
    }

    // explicitné hlavičky blokov
    const ht = headerType(l);
    if (ht){
      // pri "Čítanie z ..." chceme title = celý riadok
      if (ht === 'Žalm' || ht === 'Alelujový verš' || ht === 'Druhé čítanie' || ht === 'Prvé čítanie' || ht === 'Evanjelium'){
        start(ht);
      } else {
        // ht je plný text "Čítanie z ..."
        // ak už máme niečo v prvom čítaní, ďalšie "Čítanie z" bude druhé čítanie (typicky)
        if (cur && (cur.title === 'Prvé čítanie' || /^Čítanie\s+z\b/i.test(cur.title))){
          start('Druhé čítanie');
        } else {
          start('Prvé čítanie');
        }
        // zároveň si tento riadok uložíme ako "nadpis čítania z..."
        cur.title = l;
      }
      continue;
    }

    // subref (prvý krát v sekcii)
    if (cur && !cur.sub && looksLikeRef(l)){
      cur.sub = l;
      continue;
    }

    if (!cur) start('');
    cur.body.push(raw);
  }
  pushCur();

  // Vyskladaj HTML
  const out = ['<div class="lit-cards">'];

  if (feast){
    out.push('<div class="lit-block lit-feast">');
    out.push('<div class="lit-h">'+escapeHtml(feast)+'</div>');
    out.push('</div>');
  }

  for (const s of sections){
    // preskoč úplne prázdne
    if (!s.title && !s.sub && !s.body) continue;

    out.push('<div class="lit-block">');
    if (s.title) out.push('<div class="lit-h">'+escapeHtml(s.title)+'</div>');
    if (s.sub) out.push('<div class="lit-sub">'+escapeHtml(s.sub)+'</div>');
    if (s.body) out.push('<pre>'+escapeHtml(s.body)+'</pre>');
    out.push('</div>');
  }

  out.push('</div>');
  return out.join('');
}

function renderLitFromData(iso, data){
  const status = document.getElementById('lit-status');
  const content = document.getElementById('lit-content');
  const row = document.getElementById('lit-variant-row');
  const sel = document.getElementById('lit-variant-select');

  const variants = (data && Array.isArray(data.variants)) ? data.variants : [];
  setLitHeader(iso, variants);

  // variants selector
  if (row && sel){
    if (variants.length > 1){
      row.style.display = 'flex';
      sel.innerHTML = variants.map((v,i)=>{
        let label = (v && v.label) ? String(v.label).trim() : ('Možnosť ' + (i+1));
        const title = (v && v.title) ? String(v.title).trim() : '';
        if (label.toLowerCase()==='féria' && title) label = 'Féria — ' + title;
        else if (title && label && !label.toLowerCase().includes(title.toLowerCase())) label = label + ' — ' + title;
        return `<option value="${i}">${escapeHtml(label)}</option>`;
      }).join('');
      const idx = Math.min(getLitChoiceIndex(iso), variants.length-1);
      sel.value = String(idx);
    } else {
      row.style.display = 'none';
      sel.innerHTML = '';
      setLitChoiceIndex(iso, 0);
    }
  }

  const idx = variants.length ? Math.min(getLitChoiceIndex(iso), variants.length-1) : 0;
  const chosen = variants.length ? variants[idx] : (data || {});

  // obsah – pekné formátovanie do chlievikov
  let outText = '';
  if (chosen && chosen.text) outText = String(chosen.text);
  if (!outText){
    const ps = chosen && chosen.psalmText ? String(chosen.psalmText) : '';
    const av = chosen && chosen.alleluiaVerse ? String(chosen.alleluiaVerse) : '';
    outText = [ps && ('Responzóriový žalm\n'+ps), av && ('Alelujový verš\n'+av)].filter(Boolean).join('\n\n');
  }

  if (status){
    status.style.display = 'none';
    status.classList.remove('loading');
  }
  if (content){
    content.innerHTML = litTextToCardsHTML(outText);
  }
}


async function fetchLiturgia(iso){
  // JSONP cez GAS (kvôli CORS)
  const url = `${SCRIPT_URL}?action=liturgia&den=${encodeURIComponent(iso)}`;
  const data = await jsonpRequest(url);
  return data;
}

async function loadLiturgiaForUI(iso, {force=false}={}){
  const status = document.getElementById('lit-status');
  const content = document.getElementById('lit-content');

  if (status){
    status.style.display = 'block';
    status.textContent = 'Načítavam...';
    status.classList.add('loading');
  }
  if (content) content.textContent = '';

  // cache first
  const cached = getCachedLit(iso);
  if (cached && cached.ok && !force){
    try{ renderLitFromData(iso, cached); }catch(e){}
    // ticho doťahuj online, ak sme online
    if (navigator.onLine){
      fetchLiturgia(iso).then(d=>{
        if (d && d.ok){
          setCachedLit(iso, d);
          // refresh UI len ak stále pozeráme ten istý dátum
          const input = document.getElementById('lit-date-input');
          if (input && input.value === iso){
            renderLitFromData(iso, d);
          }
        }
      }).catch(()=>{});
    }
    return;
  }

  // ak sme offline a nemáme cache
  if (!navigator.onLine){
    if (status){
      status.classList.remove('loading');
      status.textContent = 'Liturgické čítania sa nepodarilo načítať (offline).';
    }
    return;
  }

  try{
    const data = await fetchLiturgia(iso);
    if (data && data.ok){
      setCachedLit(iso, data);
      renderLitFromData(iso, data);
    } else {
      if (status){
        status.classList.remove('loading');
        status.textContent = (data && data.error) ? ('Liturgické čítania sa nepodarilo načítať: ' + data.error) : 'Liturgické čítania sa nepodarilo načítať.';
      }
    }
  }catch(e){
    if (status){
      status.classList.remove('loading');
      status.textContent = 'Liturgické čítania sa nepodarilo načítať. Skontroluj, či Google Script je publikovaný ako Web app pre „Anyone“ a či je správny link v SCRIPT_URL.';
    }
  }
}

function initLitCalendarUI(){
  const input = document.getElementById('lit-date-input');
  const btn = document.getElementById('lit-date-btn');
  const sel = document.getElementById('lit-variant-select');

  if (!input || !btn) return;

  // default dnes
  if (!input.value) input.value = isoToday();

  // klik na tlačidlo – pokus o showPicker (Chrome), inak click na input
  btn.addEventListener('click', () => {
    try{
      // Chrome/Edge: showPicker funguje, ak je input viditeľný v DOM
      if (typeof input.showPicker === 'function') input.showPicker();
      // fallback: zameraj a vyvolaj natívny picker (niektoré prehliadače blokujú programmatic click)
      input.focus();
      input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }catch(e){}
  });

  input.addEventListener('change', () => {
    setLitChoiceIndex(input.value, 0);
    loadLiturgiaForUI(input.value, {force:false});
  });

  if (sel){
    sel.addEventListener('change', () => {
      const iso = input.value || isoToday();
      const idx = parseInt(sel.value,10) || 0;
      setLitChoiceIndex(iso, idx);

      // rerender from cache
      const cached = getCachedLit(iso);
      if (cached && cached.ok){
        renderLitFromData(iso, cached);
      }
      // ak je otvorená Aleluja 999, prepočítaj
      try{ if (currentSong && String(currentSong.originalId||"").replace(/^0+/,'')==='999') renderSong(); }catch(e){}
      try{ setupAlelujaLitControlsIfNeeded(); }catch(e){}
    });
  }

  // prvé načítanie
  loadLiturgiaForUI(input.value, {force:false});
}

let __litInited = false;
(function hookToggleSection(){
  const _toggle = window.toggleSection;
  if (typeof _toggle !== 'function') return;
  window.toggleSection = function(name){
    _toggle(name);
    if (name === 'lit'){
      // sekcia sa práve otvorila
      if (!__litInited){
        __litInited = true;
        setTimeout(() => { try { initLitCalendarUI(); } catch(e) {} }, 0);
      }
    }
  };
})();

/* ----- Aleluja 999 vloženie blokov ----- */
function cleanPsalmText(ps){
  const lines = String(ps||'').split('\n').map(s=>String(s||'').trim());
  // drop empty
  let out = lines.filter(l=>l.length);
  // drop anything before first R.:
  const rIdx = out.findIndex(l => /^R\.\s*:/.test(l) || /^R:/.test(l));
  if (rIdx > 0) out = out.slice(rIdx);
  // stop on next big section marker
  const stopIdx = out.findIndex(l => /(Alelujový verš|Evanjelium|Čítanie|Druhé čítanie|Prvé čítanie)/i.test(l));
  if (stopIdx >= 0) out = out.slice(0, stopIdx);
  // remove headers
  out = out.filter(l => !/Responzóriový žalm/i.test(l));
  return out.join('\n').trim();
}

function cleanAlleluiaVerse(av){
  let lines = String(av||'').replace(/\r/g,'').split('\n').map(s=>String(s||'').trim()).filter(l=>l.length);

  // odstráň "Alelujový verš" hlavičky
  lines = lines.filter(l => !/Alelujový verš/i.test(l));

  // zahoď všetko po začiatku Evanjelia
  const stopIdx = lines.findIndex(l => /(Evanjelium|Čítanie)/i.test(l));
  if (stopIdx >= 0) lines = lines.slice(0, stopIdx);

  // odstráň samostatné riadky "Aleluja..." (triple aleluja atď.)
  lines = lines.filter(l => !/^Aleluja[\s,!.]*$/i.test(l));

  // ak je prvý riadok typu "Aleluja, aleluja, aleluja. Radujte sa..." odstráň len prefix
  if (lines.length){
    lines[0] = lines[0].replace(/^Aleluja[\s,!.]*/i,'').trim();
    // ešte raz: niektoré verzie začínajú "Aleluja." + text
    lines[0] = lines[0].replace(/^Aleluja[\s,!.]*/i,'').trim();
    if (!lines[0]) lines.shift();
  }

  // keep concise (max 6 lines)
  if (lines.length > 6) lines = lines.slice(0,6);
  return lines.join('\n').trim();
}

function injectPsalmAndAlleluiaBlocks(alelujaText, iso){
  const cached = getCachedLit(iso);
  if (!cached || !cached.ok || !Array.isArray(cached.variants) || !cached.variants.length){
    if (navigator.onLine){
      fetchLiturgia(iso).then(d=>{
        if (d && d.ok){
          setCachedLit(iso, d);
          try { renderSong(); } catch(e) {}
          try { setupAlelujaLitControlsIfNeeded(); } catch(e) {}
        }
      }).catch(()=>{});
    }
    return alelujaText;
  }

  const variants = cached.variants;
  const idx = Math.min(getLitChoiceIndex(iso), variants.length-1);
  const v = variants[idx] || variants[0];

  const fullText = (v && v.text) ? String(v.text) : '';
  let psRaw = (v && v.psalmText) ? String(v.psalmText) : '';
  let avRaw = (v && v.alleluiaVerse) ? String(v.alleluiaVerse) : '';

  // Najspoľahlivejšie je rezať z plného textu dňa – zabránime tomu, aby sa do Aleluja vložili čítania.
  if (fullText){
    const mPsalm = fullText.match(/Responzóriový\s+žalm[\s\S]*?(?=(Druhé\s+čítanie|Alelujový\s+verš|Evanjelium|$))/i)
               || fullText.match(/\n\s*(Ž\s*\d[^\n]*[\s\S]*?)(?=(Druhé\s+čítanie|Alelujový\s+verš|Evanjelium|$))/i);
    if (mPsalm) psRaw = mPsalm[1] ? mPsalm[1] : mPsalm[0];

    const mVerse = fullText.match(/Alelujový\s+verš[\s\S]*?(?=(Evanjelium|$))/i)
               || fullText.match(/\n\s*(Aleluja[^\n]*[\s\S]*?)(?=(Evanjelium|$))/i);
    if (mVerse) avRaw = mVerse[1] ? mVerse[1] : mVerse[0];
  }

  const ps = cleanPsalmText(psRaw);
  const av = cleanAlleluiaVerse(avRaw);

  const core = String(alelujaText||'').trim();

  // Presne 3 bloky: Žalm, text Aleluja, Alelujový verš
  const parts = [];
  if (ps){
    parts.push(`[[LIT-PSALM|${encodeURIComponent(ps)}]]`);
  }
  parts.push(core);
  if (av){
    parts.push(`[[LIT-VERSE|${encodeURIComponent(av)}]]`);
  }
  return parts.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}




function setupAlelujaLitControlsIfNeeded(){
  const box = document.getElementById('aleluja-lit-controls');
  if (!box) return;

  const is999 = currentSong && String(currentSong.originalId||"").replace(/^0+/,'') === '999';
  const isDnes = (currentListSource === 'dnes');

  if (!isAleluja999 || !isDnes){
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }

  const iso = getIsoDateFromDnesTitleSafe();
  const w = weekdaySkFromISO(iso);
  const labelLine = `Aleluja – žalm a verš ${dmyFromISO(iso)}${w ? ' ' + w.toLowerCase() : ''}`;
  const cached = getCachedLit(iso);
  const variants = cached && cached.ok && Array.isArray(cached.variants) ? cached.variants : [];
  const summary = litFeastSummary(variants);

  // UI
  box.className = 'aleluja-controls';
  box.style.display = 'block';

  if (!variants.length){
    box.innerHTML = `<div class="tiny-label">${labelLine}</div><div class="loading">Načítavam liturgiu...</div>`;
    // dotiahni
    if (navigator.onLine){
      fetchLiturgia(iso).then(d=>{
        if (d && d.ok){
          setCachedLit(iso, d);
          try { setupAlelujaLitControlsIfNeeded(); } catch(e) {}
          try { renderSong(); } catch(e) {}
        }
      }).catch(()=>{});
    }
    return;
  }

  const idx = Math.min(getLitChoiceIndex(iso), variants.length-1);
  const options = variants.map((v,i)=>{
    let label = (v && v.label) ? String(v.label).trim() : ('Možnosť ' + (i+1));
        const title = (v && v.title) ? String(v.title).trim() : '';
        if (label.toLowerCase()==='féria' && title) label = 'Féria — ' + title;
        else if (title && label && !label.toLowerCase().includes(title.toLowerCase())) label = label + ' — ' + title;
    const sel = (i===idx) ? 'selected' : '';
    return `<option value="${i}" ${sel}>${escapeHtml(label)}</option>`;
  }).join('');

  box.innerHTML = `
    <div class="tiny-label">Aleluja – žalm a verš (${escapeHtml(dmyFromISO(iso))})</div>
    ${summary ? `<div style="margin:6px 0 8px 0; opacity:.9;">${escapeHtml(summary)}</div>` : ``}
    ${variants.length>1 ? `
      <div style="display:flex; gap:10px; align-items:center;">
        <span class="tiny-label">Vybrať:</span>
        <select id="aleluja-lit-select" style="flex:1; padding:10px 12px; border-radius:12px; border:1px solid rgba(255,255,255,0.14); background:rgba(255,255,255,0.04); color:#fff;">
          ${options}
        </select>
      </div>` : ``}
  `;

  const selEl = document.getElementById('aleluja-lit-select');
  if (selEl){
    selEl.addEventListener('change', () => {
      const n = parseInt(selEl.value,10) || 0;
      setLitChoiceIndex(iso, n);
      try { renderSong(); } catch(e) {}
      // sync lit section if open
      const litSelect = document.getElementById('lit-variant-select');
      const litInput = document.getElementById('lit-date-input');
      if (litSelect && litInput && litInput.value === iso){
        litSelect.value = String(n);
      }
    });
  }
}
