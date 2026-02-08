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
let autoUpdateInFlight = false;

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
  // Update now runs automatically; keep the manual wheel hidden.
  const btn = document.getElementById('fab-newdata-btn');
  if (!btn) return;
  btn.style.display = 'none';
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
    // Auto-update: when new data is available, update immediately (no manual wheel).
    setUpdateBadgeVisible(false);
    if (hasUpdate && !autoUpdateInFlight && !document.hidden){
      autoUpdateInFlight = true;
      try { await runUpdateNow(true); } catch(e) {} finally { autoUpdateInFlight = false; }
    }
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

async function runUpdateNow(fromAuto=false){
  if (!navigator.onLine){
    showToast("Si offline – aktualizácia nie je dostupná.", false);
    return;
  }
  // zavri FAB menu (ak je otvorené) – len ak to spúšťa používateľ
  if (!fromAuto) { try { closeFabMenu(); } catch(e) {} }
  setUpdateBadgeVisible(false);

  setSyncStatus("Aktualizujem…", "sync-warn");

  showToast("Aktualizujem...", true, 0);

  // fetch meta (aby sme po update vedeli badge schovať)
  try { lastRemoteMeta = await fetchRemoteMeta(); } catch(e) {}

  // stiahni a ulož nové dáta
  try { await parseXML(); } catch(e) {}
  try { await Promise.allSettled([loadDnesFromDrive(), loadPlaylistsFromDrive(), loadHistoryFromDrive()]); } catch(e) {}

  // po update si zober najnovšiu meta (ak sa medzitým niečo zmenilo)
  try { lastRemoteMeta = await fetchRemoteMeta(); } catch(e) {}
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
const APP_BUILD = 'v86';
const APP_CACHE_NAME = 'spevnik-v86';

// ===== LITURGIA OVERRIDES POLLING (without GAS meta support) =====
// We poll LiturgiaOverrides.json via GAS action=litOverrideGet and auto-apply changes.
// This makes edits visible on other devices without needing a hard reset.
const LS_LITOV_HASH = 'spevnik_litov_hash_v1';
let litOvPollingStarted = false;

let alelujaLitEditLock = false;

function isAlelujaLitEditing(){
  try{
    if (alelujaLitEditLock) return true;
    const ae = document.activeElement;
    if (!ae) return false;
    const id = String(ae.id||'');
    return id === 'lit-ov-read2' || id === 'lit-ov-refrain' || id === 'lit-ov-psalm' || id === 'lit-ov-verse';
  }catch(e){ return false; }
}


function _hashStrDjb2(str){
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i);
  // force unsigned 32-bit
  return (h >>> 0).toString(16);
}

function _stableStringify(obj){
  // Stable stringify for change detection (sort keys recursively)
  const seen = new WeakSet();
  function norm(x){
    if (x && typeof x === 'object'){
      if (seen.has(x)) return null;
      seen.add(x);
      if (Array.isArray(x)) return x.map(norm);
      const out = {};
      Object.keys(x).sort().forEach(k => { out[k] = norm(x[k]); });
      return out;
    }
    return x;
  }
  try { return JSON.stringify(norm(obj)); } catch(e){ return JSON.stringify(obj || null); }
}

function _getSeenLitOvHash(){
  try { return String(localStorage.getItem(LS_LITOV_HASH) || ''); } catch(e) { return ''; }
}
function _setSeenLitOvHash(h){
  try { localStorage.setItem(LS_LITOV_HASH, String(h || '')); } catch(e) {}
}

async function pollLitOverridesAndAutoApply(){
  if (!navigator.onLine) return;
  try{
    const res = await jsonpRequest(`${SCRIPT_URL}?action=litOverrideGet`);
    if (!res || !res.ok || !res.data) return;
    const remote = res.data;
    const hash = _hashStrDjb2(_stableStringify(remote));
    const seen = _getSeenLitOvHash();
    if (hash && seen && hash === seen) return;

    // Apply & cache
    __litOverrides = remote;
    try{ localStorage.setItem('__litOverrides', JSON.stringify(__litOverrides)); }catch(e){}
    _setSeenLitOvHash(hash);

    // If user is currently viewing Aleluja 999 in Piesne na dnes, rerender immediately
    try{
      const is999 = currentSong && String(currentSong.originalId||'').replace(/^0+/, '') === '999';
      const titleIsAleluja = currentSong && String(currentSong.title||'').trim().toLowerCase() === 'aleluja';
      const isDnes = (currentListSource === 'dnes');
      if (is999 && titleIsAleluja && isDnes){
        // počas písania do editora neprepisuj textarea ani nestrácaj focus
        if (isAlelujaLitEditing()) return;
        // refresh admin panel values (if admin) and song body
        try{ setupAlelujaLitControlsIfNeeded(); }catch(e){}
        try{ renderSong(); }catch(e){}
      }
    }catch(e){}

  }catch(e){ /* ignore */ }
}

function startLitOverridesPolling(){
  if (litOvPollingStarted) return;
  litOvPollingStarted = true;
  pollLitOverridesAndAutoApply();
  setInterval(pollLitOverridesAndAutoApply, 60 * 1000);
  window.addEventListener('online', () => pollLitOverridesAndAutoApply());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollLitOverridesAndAutoApply(); });
}


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


let playlistsKeepOpenUntil = 0;
let searchKeepOpenUntil = 0;
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
  // ochrany pred nechceným zbalením pri písaní / pri načítaní playlistu
  try{
    if (expand === false){
      const now = Date.now();
      if (section === 'playlists' && now < playlistsKeepOpenUntil) return;
      if (section === 'all'){
        const si = document.getElementById('search');
        if ((si && document.activeElement === si) || (now < searchKeepOpenUntil)) return;
      }
    }
  }catch(e){}

  const content = document.getElementById(section + '-section-wrapper');
  const chevron = document.getElementById(section + '-chevron');
  if (!content) return;

  const currentlyOpen = content.style.display !== 'none';
  const willOpen = (expand === null) ? !currentlyOpen : !!expand;

  content.style.display = willOpen ? 'block' : 'none';
  if (chevron) {
    chevron.classList.toggle('fa-chevron-down', !willOpen);
    chevron.classList.toggle('fa-chevron-up', willOpen);
  }
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
        // Ak prišiel nový export, vždy ho spracuj.
        const inDetail = (document.getElementById('song-detail')?.style.display === 'block');
        processXML(xmlText, { source:'network' });
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

    const plainForSearch = String(text||'')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      id: s.getElementsByTagName('ID')[0]?.textContent.trim(),
      title: s.getElementsByTagName('title')[0]?.textContent.trim(),
      originalId: rawId,
      displayId,
      origText: text,
      // normalized search index (title + id + lyrics) so search works on text too
      searchHaystack: normText((displayId||'') + ' ' + (s.getElementsByTagName('title')[0]?.textContent.trim()||'') + ' ' + plainForSearch)
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

  // refresh open song after data update (so changed chords/lyrics show immediately)
  try{
    const detail = document.getElementById('song-detail');
    if (detail && detail.style.display === 'block' && currentSong){
      const sc = document.getElementById('song-content');
      const prevScroll = sc ? sc.scrollTop : 0;
      const cid = String(currentSong.id||'');
      const updated = songs.find(x => String(x.id) === cid);
      if (updated) currentSong = updated;
      renderSong();
      if (sc) sc.scrollTop = prevScroll;
    }
  }catch(e){}

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

function renderAllSongsPreserveScroll(){
  const sc = document.scrollingElement || document.documentElement || document.body;
  const prev = sc ? sc.scrollTop : 0;
  renderAllSongs();
  // Po prerenderi zachovaj pozíciu scrollu (Safari/Android občas skočí).
  requestAnimationFrame(() => {
    try{
      const el = document.getElementById('search');
      if (el && document.activeElement === el && sc) sc.scrollTop = prev;
    }catch(e){}
  });
}

function filterSongs() {
  const el = document.getElementById('search');
  const qRaw = el ? String(el.value || '') : '';
  const q = normText(qRaw).trim();

  // Počas vyhľadávania drž sekciu "Zoznam piesní" otvorenú, ale nikdy netoggle-uj (to spôsobovalo skákanie).
  try{
    const wrap = document.getElementById('all-section-wrapper');
    const ch = document.getElementById('all-chevron');
    const mustOpen = (q.length > 0) || (el && document.activeElement === el);
    if (mustOpen && wrap && wrap.style.display === 'none'){
      wrap.style.display = 'block';
      if (ch){
        ch.classList.remove('fa-chevron-down');
        ch.classList.add('fa-chevron-up');
      }
    }
  }catch(e){}

  if (!q) {
    filteredSongs = [...songs];
  } else {
    filteredSongs = songs.filter(s => s.searchHaystack.includes(q));
  }

  renderAllSongsPreserveScroll();
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
  // Nezmazávaj vyhľadávanie pri návrate zo spevu.
  // Používateľ chce, aby sa posledné vyhľadávanie zachovalo po „Späť na zoznam“.
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
  const rawText = String(text || '').replace(CHORD_TOKEN_RE_G, (m, inner) => `[${normalizeChordName(inner)}]`);
  let safeText = escapeHTML(rawText);

  // chords -> span
  safeText = safeText.replace(CHORD_TOKEN_RE_G, '<span class="chord">$1</span>');

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
    const litM = trimmed.match(/^\[\[LIT-(PSALM|VERSE|READ2)\|(.*)\]\]$/);
    if (litM){
      // zatvor otvorenú sekciu piesne, nech sa to nemieša s gridom
      // pred vložením liturgie musíme vypísať akékoľvek rozpracované riadky,
// inak sa môže stratiť posledná sloha (najmä ak obsahuje iba akordy).
flushPendingSpecialEmpty();
if (pendingLabel && pendingChordLines.length) {
  closeSection();
  openSection();
  out.push(songLineHTML(pendingLabel, pendingChordLines[0], 'song-chordline'));
  for (let k = 1; k < pendingChordLines.length; k++) {
    out.push(songLineHTML('', pendingChordLines[k], 'song-chordline'));
  }
  pendingChordLines.length = 0;
  pendingLabel = '';
  closeSection();
} else if (pendingChordLines.length) {
  if (!sectionOpen) openSection();
  for (const cl of pendingChordLines) out.push(songLineHTML('', cl, 'song-chordline'));
  pendingChordLines.length = 0;
  closeSection();
}
closeSection();
pendingLabel = '';
pendingSpecial = '';
pendingChordLines = [];
pendingBlanks = 0;

      const kind = litM[1];
      let payload = '';
      try { payload = decodeURIComponent(litM[2] || ''); } catch(e){ payload = ''; }

      if (kind === 'READ2'){
        // Druhé čítanie vložené do Aleluja 999 (ak je v daný deň 2. čítanie)
        let lines = String(payload||'').replace(/\r/g,'').split('\n');
        // odstráň prípadnú hlavičku "Druhé čítanie"
        lines = lines.filter(l => !/^Druhé\s+čítanie\b/i.test(String(l||'').trim()));
        payload = lines.join('\n').trim();

        out.push('<div class="aleluja-insert">');
        out.push(`<div class="aleluja-h">${escapeHtml('Druhé čítanie')}</div>`);
        if (payload) out.push(`<pre class="aleluja-center">${escapeHtml(payload)}</pre>`);
        out.push('</div>');
        continue;
      } else if (kind === 'PSALM'){
        // payload typicky obsahuje "R.: ..." – chceme "Žalm  R.: <refren>" v hlavičke a pod tým text žalmu
        const lines = String(payload||'').replace(/\r/g,'').split('\n').map(l=>String(l||'').trim()).filter(Boolean);
        let refrain = '';
        let bodyLines = lines.slice();
        const rLineIdx = bodyLines.findIndex(l => /^R\s*\.?\s*:\s*\S/.test(l));
        if (rLineIdx >= 0){
          const rLine = bodyLines[rLineIdx];
          refrain = rLine.replace(/^R\s*\.?\s*:\s*/i,'').trim();
          bodyLines.splice(rLineIdx, 1);
        }
        payload = bodyLines.join('\n').trim();
        const header = refrain ? `Žalm  R.: ${refrain}` : 'Žalm';

        out.push('<div class="aleluja-insert">');
        out.push(`<div class="aleluja-h">${escapeHtml(header)}</div>`);
        if (payload) out.push(`<pre class="aleluja-center">${escapeHtml(payload)}</pre>`);
        out.push('</div>');
        continue;
      } else {
        // Aklamácia pred evanjeliom – iba verš (bez ďalších čítaní)
        let label = 'Alelujový verš';
        let rawText = String(payload||'');
        // Novší formát: JSON {label,text}
        try {
          const t = rawText.trim();
          if (t && t[0] === '{') {
            const obj = JSON.parse(t);
            if (obj && typeof obj === 'object') {
              if (String(obj.label||'').trim()) label = String(obj.label||'').trim();
              if (obj.text != null) rawText = String(obj.text||'');
            }
          }
        } catch(e) {}

        let lines = rawText.replace(/\r/g,'').split('\n').map(l=>String(l||'').trim()).filter(Boolean);

        // odstráň hlavičky a zvyšky
        lines = lines.filter(l => !/Alelujový verš/i.test(l));
        // odrež všetko po začiatku Evanjelia/Čítania (ak by sa tam niečo dostalo)
        const stopIdx = lines.findIndex(l => /^Čítanie\s+(z|zo)\b/i.test(l) || /^Evanjelium\b/i.test(l));
        if (stopIdx >= 0) lines = lines.slice(0, stopIdx);

        // "Aleluja, aleluja, aleluja." -> vyhoď, nech ostane iba text verša
        lines = lines.filter(l => !/^Aleluja[\s,!.]*$/i.test(l));
        if (lines.length){
          lines[0] = lines[0].replace(/^Aleluja(?:[\s,!.]+Aleluja){0,3}[\s,!.]*/i,'').trim();
          if (!lines[0]) lines.shift();
        }
        payload = lines.join('\n').trim();

        out.push('<div class="aleluja-insert">');
        out.push(`<div class="aleluja-h">${escapeHtml(label)}</div>`);
        if (payload) out.push(`<pre class="aleluja-center">${escapeHtml(payload)}</pre>`);
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

// Chords are in single brackets: [Am] ... (but liturgy blocks use double brackets [[...]]).
// Always ignore [[...]] in chord parsing / transposition.
const CHORD_TOKEN_RE = /\[(?!\[)([^\]\[]+?)\](?!\])/;
const CHORD_TOKEN_RE_G = /\[(?!\[)([^\]\[]+?)\](?!\])/g;

function stripTemplatePrefix(line){
  const t = String(line ?? '');
  return t.startsWith(TEMPLATE_PREFIX) ? t.slice(TEMPLATE_PREFIX.length) : t;
}
function isTemplateChordLine(line){
  return String(line ?? '').startsWith(TEMPLATE_PREFIX);
}

function hasChordInLine(line){
  const t = stripTemplatePrefix(line);
  return CHORD_TOKEN_RE.test(String(t||''));
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
    }
  // Transpose chords first
  if (transposeStep !== 0) {
    text = text.replace(CHORD_TOKEN_RE_G, (m, c) => `[${transposeChord(c, transposeStep)}]`);
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
          const out = String(line).replace(CHORD_TOKEN_RE_G, '');
          keepChordsMode = false;
          return out;
        }

        // chord-only: nechaj bez zásahu
        if (keepChordsMode) return line;
        // ak sme režim práve vypli (kvôli markeru), spadneme ďalej na bežné spracovanie
      }

      // Bežné spracovanie: odstráň akordy
      return String(line).replace(CHORD_TOKEN_RE_G, '');
    }).join('\n');
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
  // Robust transposition:
  // - Supports sharps and flats (C#, Db, Bb...)
  // - Keeps Slovak/German note naming: B (Bb) and H
  const map = {
    "C":0, "C#":1, "DB":1,
    "D":2, "D#":3, "EB":3,
    "E":4,
    "F":5, "F#":6, "GB":6,
    "G":7, "G#":8, "AB":8,
    "A":9, "A#":10, "BB":10,
    "B":10, // in this app: B = Bb
    "H":11
  };
  const outSharp = ["C","C#","D","D#","E","F","F#","G","G#","A","B","H"];
  const outFlat  = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","B","H"];

  // replace every root note occurrence (A-H with optional #/b)
  return String(c||"").replace(/([A-Ha-h])([#b]?)/g, (m0, ltr, acc) => {
    const key = (String(ltr).toUpperCase() + String(acc||"")).replace(/b/i,"b");
    const normKey = key.toUpperCase(); // DB, EB, ...
    const idx = map[normKey];
    if (idx == null) return m0;

    let newIdx = (idx + step) % 12;
    while (newIdx < 0) newIdx += 12;

    const useFlat = (String(acc||"").toLowerCase() === "b") && String(ltr).toUpperCase() !== "B";
    const out = (useFlat ? outFlat : outSharp)[newIdx];
    return out;
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
    const editBtn = isAdmin ? `<button class="history-edit" onclick="event.stopPropagation(); renameHistoryEntry(${ts})">✎</button>` : '';
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
          ${editBtn}${delBtn}
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


function renameHistoryEntry(ts){
  if (!isAdmin) return;
  const arr = parseHistory(localStorage.getItem(LS_HISTORY) || "");
  const idx = arr.findIndex(x => Number(x.ts) === Number(ts));
  if (idx < 0) return;
  const cur = arr[idx];
  const oldTitle = String(cur.title || historyEntryTitle(cur) || '').trim();
  const nextTitle = prompt('Nový názov playlistu v histórii:', oldTitle);
  if (nextTitle == null) return; // cancelled
  cur.title = String(nextTitle || '').trim();
  // persist
  localStorage.setItem(LS_HISTORY, JSON.stringify(arr));
  renderHistoryUI(true);
  // sync to Drive (best effort)
  try {
    fetch(`${SCRIPT_URL}?action=save&name=${encodeURIComponent(HISTORY_NAME)}&pwd=${ADMIN_PWD}&content=${encodeURIComponent(JSON.stringify(arr))}`, { mode:'no-cors' });
  } catch(e) {}
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

  list = (list || []).filter(p => p.name !== "PiesneNaDnes" && p.name !== "PlaylistOrder" && p.name !== "HistoryLog" && p.name !== "LiturgiaOverrides.json");
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
  // zachovaj pozíciu a stav sekcií – nech to po načítaní playlistu "nezroluje"
  const y = (() => { try { return window.scrollY || 0; } catch(e){ return 0; } })();
  try { playlistsKeepOpenUntil = Date.now() + 2500; } catch(e){}

  const openState = {
    dnes: (document.getElementById('dnes-section-wrapper')||{}).style?.display !== 'none',
    playlists: (document.getElementById('playlists-section-wrapper')||{}).style?.display !== 'none',
    all: (document.getElementById('all-section-wrapper')||{}).style?.display !== 'none'
  };

  // show loading immediately
  const sect = document.getElementById('playlists-section');
  if (sect) sect.innerHTML = '<div class="loading">Načítavam...</div>';

  await fetchPlaylistContent(name);
  playlistViewName = name;

  // uisti sa, že sekcia Playlisty ostane otvorená
  toggleSection('playlists', true);

  renderPlaylistsUI(true);
  // obnov aj ostatné sekcie tak, ako boli (nech to nič "nezroluje" / nezatvorí)
  try { toggleSection('dnes', openState.dnes); } catch(e){}
  try { toggleSection('all', openState.all); } catch(e){}


    // vynúť, aby sekcia Playlisty ostala otvorená
  try { toggleSection('playlists', true); } catch(e){}

// obnov scroll (bez skoku na začiatok stránky)
  try { requestAnimationFrame(() => { try { window.scrollTo(0, y); } catch(e){} }); } catch(e){}
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

  // Toto je "Aktualizovať aplikáciu" z ozubeného kolieska:
  // hneď zbaľ všetko a počas celej operácie nech dole svieti "Aktualizujem…"
  try { closeFabMenu(); } catch(e) {}
  try { forceInitialCollapsed(); } catch(e) {}

  setSyncStatus("Aktualizujem…", "sync-warn");
  showToast("Aktualizujem...", true, 0);

  if (!confirm("Vymazať pamäť?")){
    setSyncStatus("Zrušené", "sync-warn");
    showToast("Zrušené", true, 1200);
    return;
  }

  localStorage.clear();
  try {
    const keys = await caches.keys();
    for (const k of keys) await caches.delete(k);
  } catch (e) {}

  setSyncStatus("Aktualizované", "sync-ok");
  showToast("Aktualizované", true, 1800);

  // tvrdý reload
  try { location.reload(true); } catch(e) { location.reload(); }
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

  // --- fix: pri písaní do vyhľadávania sa nesmie zbalovať sekcia "Zoznam piesní"
  try{
    const sIn = document.getElementById('search');
    if (sIn){
      sIn.addEventListener('keydown', (ev)=>{ try{ ev.stopPropagation(); }catch(_){} });
      sIn.addEventListener('keypress', (ev)=>{ try{ ev.stopPropagation(); }catch(_){} });
      sIn.addEventListener('keyup', (ev)=>{ try{ ev.stopPropagation(); }catch(_){} });
      sIn.addEventListener('click', (ev)=>{ try{ ev.stopPropagation(); }catch(_){} });
      sIn.addEventListener('focus', ()=>{ try{ toggleSection('all', true); }catch(_){} });
    }
  }catch(e){}

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
  try {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // Proactively check for a new SW (app shell update)
      try { reg.update(); } catch(e) {}

      reg.addEventListener('updatefound', () => {
        // show "Aktualizujem…" while new SW is installing
        setSyncStatus("Aktualizujem…", "sync-warn");
        showToast("Aktualizujem...", true, 0);
      });
    }).catch(()=>{});
  } catch(e) {}
  // When the new SW takes control, reload to use the new files.
  // Avoid a reload on first install (when there was no controller yet).
  try{
    let reloaded = false;
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      setSyncStatus("Aktualizované", "sync-ok");
      showToast("Aktualizované", true, 1800);
      if (!hadController){
        // first install – just mark as ready
        hadController = true;
        return;
      }
      reloaded = true;
      try { location.reload(); } catch(e) {}
    });
  }catch(e){}
}

// META update badge polling (1x/min) – start immediately (not only in song detail)
startMetaPolling();

// Liturgia overrides polling (1x/min) – keeps Aleluja 999 edits in sync across devices without changing GAS
startLitOverridesPolling();


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
  // Načítaj admin prepísania liturgie (ak existujú) – cacheuje sa do localStorage.
  try { refreshLitOverridesFromDrive(); } catch(e) {}
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
const LIT_CHOICE_PREFIX = 'liturgia_choice_';
const LIT_MASS_CHOICE_PREFIX = 'liturgia_mass_choice_'; // liturgia_mass_choice_YYYY-MM-DD    // liturgia_choice_YYYY-MM-DD

// Admin override (999 Aleluja): prepísanie žalmu / refrénu / aklamácie pred evanjeliom.
// Ukladá sa do Drive (folder "Playlisty") ako jeden JSON súbor, aby to videli všetci.
const LIT_OVERRIDES_FILE = 'LiturgiaOverrides';
const LIT_OVERRIDES_CACHE_KEY = 'liturgia_overrides_cache_v1';
let __litOverrides = null; // {overrides:{key:{psalmRefrain,psalmText,verse}}}

function _litOverrideKey(iso, vidx, midx){
  return `${iso}|v${parseInt(vidx,10)||0}|m${parseInt(midx,10)||0}`;
}

function getLitOverrides(){
  if (__litOverrides && typeof __litOverrides === 'object') return __litOverrides;
  try{
    const raw = localStorage.getItem(LIT_OVERRIDES_CACHE_KEY) || '';
    if (raw){
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object' && obj.overrides && typeof obj.overrides === 'object'){
        __litOverrides = obj;
        return __litOverrides;
      }
    }
  }catch(e){}
  __litOverrides = { version: 1, overrides: {} };
  return __litOverrides;
}

function getLitOverride(iso, vidx, midx){
  const o = getLitOverrides();
  const key = _litOverrideKey(iso, vidx, midx);
  return (o && o.overrides) ? (o.overrides[key] || null) : null;
}

function setLitOverride(iso, vidx, midx, data){
  const o = getLitOverrides();
  const key = _litOverrideKey(iso, vidx, midx);
  if (!data){
    delete o.overrides[key];
  } else {
    o.overrides[key] = {
      psalmRefrain: String(data.psalmRefrain||'').trim(),
      psalmText: String(data.psalmText||'').trim(),
      read2Text: (data.read2Text==null ? undefined : String(data.read2Text||'').trim()),
      verse: String(data.verse||'').trim()
    };
  }
  try { localStorage.setItem(LIT_OVERRIDES_CACHE_KEY, JSON.stringify(o)); } catch(e){}
}

function deleteLitOverride(iso, vidx, midx){
  try{ setLitOverride(iso, vidx, midx, null); }catch(e){}
}


async function refreshLitOverridesFromDrive(){
  try{
    if (!SCRIPT_URL) return;
    const res = await jsonpRequest(`${SCRIPT_URL}?action=litOverrideGet`);
    if (res && res.ok && res.data){
      __litOverrides = res.data;
      try{ localStorage.setItem('__litOverrides', JSON.stringify(__litOverrides)); }catch(e){}
      // keep hash in sync so polling doesn't falsely report changes
      try{ _setSeenLitOvHash(_hashStrDjb2(_stableStringify(__litOverrides))); }catch(e){}
      return __litOverrides;
    }
  }catch(e){}
  return __litOverrides;
}


async function saveLitOverridesToDrive(){
  if (!isAdmin) return;
  try{
    if (!SCRIPT_URL) return;
    const obj = getLitOverrides();
    obj.updatedAt = Date.now();
    const url = `${SCRIPT_URL}?action=save&pwd=${encodeURIComponent(ADMIN_PWD)}&name=${encodeURIComponent(LIT_OVERRIDES_FILE)}&content=${encodeURIComponent(JSON.stringify(obj))}`;
    const res = await jsonpRequest(url);
    if (res && res.ok){
      __litOverrides = obj;
      try { localStorage.setItem(LIT_OVERRIDES_CACHE_KEY, JSON.stringify(obj)); } catch(e){}
      return true;
    }
  }catch(e){}
  return false;
}

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

  // 1) ISO formát v názve (napr. "2026-02-07" alebo "... 2026-02-07 ...")
  const isoM = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoM) return isoM[1];

  // 2) d.m alebo d. m. alebo d.m.yyyy (dovoli medzery)
  const m = t.match(/(\d{1,2})\s*\.\s*(\d{1,2})(?:\s*\.\s*(\d{4}))?/);
  if (!m) return null;

  const dd = parseInt(m[1],10);
  const mm = parseInt(m[2],10);
  let yyyy = m[3] ? parseInt(m[3],10) : (new Date()).getFullYear();

  if (!(dd>=1 && dd<=31 && mm>=1 && mm<=12)) return null;

  // ak bez roka a vyšlo to "ďaleko v minulosti", skús posun na ďalší rok (typicky prelomy roka)
  if (!m[3]){
    const now = new Date();
    const d = new Date(yyyy, mm-1, dd);
    const diff = d.getTime() - now.getTime();
    const days = diff / (1000*60*60*24);
    if (days < -200) yyyy = yyyy + 1;
  }

  return `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
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
function litMassChoiceKey(iso){ return LIT_MASS_CHOICE_PREFIX + iso; }

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
function getLitMassChoiceIndex(iso){
  try{
    const raw = localStorage.getItem(litMassChoiceKey(iso));
    const n = raw==null ? 0 : parseInt(raw,10);
    return isNaN(n) ? 0 : n;
  }catch(e){ return 0; }
}
function setLitMassChoiceIndex(iso, idx){
  try{ localStorage.setItem(litMassChoiceKey(iso), String(idx)); }catch(e){}
}


// --- Fetch liturgiu cez Google Apps Script (JSONP kvôli CORS) ---
async function fetchLiturgia(iso){
  const url = `${SCRIPT_URL}?action=liturgia&den=${encodeURIComponent(iso)}`;
  return await jsonpRequest(url);
}

// V pôste KBS často pridáva "Ďalšie slávenia: Fakultatívne čítania...".
// Pre bežné zobrazenie chceme mať vždy len hlavnú omšu dňa (bez fakultatívnych),
// aby sa žalmy/čítania nemiešali.
function _litStripAdditionalCelebrationsText(txt){
  const s = String(txt || '');
  // stop na "Ďalšie slávenia:" (KBS)
  const m = s.match(/^\s*Ďalšie\s+slávenia\s*:/mi);
  if (m && m.index != null) return s.slice(0, m.index).trim();
  return s;
}




// Odstráni úvodný "prehľad" (súradnice/☑/✓ a R.:), ktorý KBS zobrazuje pred plným textom.
// Plný text začína až prvým skutočným "Čítanie z/zo..." alebo "Začiatok..." blokom.
function _litDropOverviewKbs(txt){
  const s = String(txt || '');
  // nájdi prvý výskyt plného textu (nie súradnice)
  const re = /(^|\n)\s*(Čítanie\s+(z|zo)\b|Začiatok\b)/i;
  const m = s.match(re);
  if (m && m.index != null){
    let start = m.index;
    // ak match začína znakom nového riadku, preskoč ho
    if (start < s.length && s[start] === '\n') start += 1;
    return s.slice(start).trim();
  }
  return s.trim();
}

function _litSplitOverviewKbs(txt){
  const s = String(txt || '').replace(/\r/g,'');
  const re = /(^|\n)\s*(Čítanie\s+(z|zo)\b|Začiatok\b)/i;
  const m = s.match(re);
  if (m && m.index != null){
    let start = m.index;
    if (start < s.length && s[start] === '\n') start += 1;
    const overviewText = s.slice(0, Math.max(0,start)).trim();
    const bodyText = s.slice(start).trim();
    const overviewLines = overviewText.split('\n').map(l=>String(l||'').trim()).filter(Boolean);
    return { overviewText, overviewLines, bodyText };
  }
  const t = s.trim();
  return { overviewText: t, overviewLines: t.split('\n').map(l=>String(l||'').trim()).filter(Boolean), bodyText: t };
}


// Pre pieseň 999 potrebujeme "plnú" liturgiu (nie len prehľad so súradnicami).
// Krátky text typicky nemá samostatné hlavičky Žalm/Aklamácia/Evanjelium, preto z neho nevytiahneme žalmový text ani verš.
function _litIsFullEnoughFor999Chants(txt){
  const t = String(txt||'');
  if (!t) return false;
  // bežná plná liturgia býva výrazne dlhšia než prehľad
  if (t.length < 4200) return false;
  // musí obsahovať aspoň jednu z jasných hlavičiek žalmu a evanjelia
  if (!/Responzóriový\s+žalm\b/i.test(t) && !/^\s*Žalm\b/im.test(t)) return false;
  if (!/Čítanie\s+zo\s+svätého\s+Evanjelia\b/i.test(t) && !/^\s*Evanjelium\b/im.test(t)) return false;
  // a aspoň jeden koncový vzorec, aby sme vedeli, že je tam telo
  if (!/Počuli\s+sme\b/i.test(t)) return false;
  return true;
}


// --- Načítanie liturgie do UI (sekcia Liturgický kalendár) ---
async function loadLiturgiaForUI(iso, opts){
  const options = opts || {};
  const force = !!options.force;

  const status = document.getElementById('lit-status');
  const content = document.getElementById('lit-content');

  // Zbaľ pri "Aktualizovať" (force), ale NIE pri výbere dňa – inak to na mobile/tablete pôsobí ako refresh.
  if (force){
    try { forceInitialCollapsed(); } catch(e) {}
  }

  if (status){
    status.style.display = 'block';
    status.classList.add('loading');
    status.textContent = 'Načítavam liturgiu...';
  }
  if (content && force){
    content.innerHTML = '';
  }

  const cached = (!force) ? getCachedLit(iso) : null;

  // rýchle zobrazenie z cache + tichý refresh z internetu (ak sme online)
  if (cached && cached.ok && !force){
    renderLitFromData(iso, cached);

    if (navigator.onLine){
      // ak v cache chýbajú telá čítaní (niekedy sa uložila "skrátená" verzia), prepíš to novým fetchom
      const cachedText = String((cached && (cached.text || (cached.variants && cached.variants[0] && cached.variants[0].text))) || '');
      const cachedLooksShort = (!cachedText) || cachedText.length < 4000 || (/\bČítanie\b/i.test(cachedText) && !/Počuli\s+sme\b/i.test(cachedText));

      // refresh vždy, ale pri krátkom obsahu agresívnejšie (prepíše UI)
      (async () => {
        try{
          const fresh = await fetchLiturgia(iso);
          if (fresh && fresh.ok){


            const freshText = String((fresh.text || (fresh.variants && fresh.variants[0] && fresh.variants[0].text)) || '');
            if (freshText && (!cachedText || freshText.length > cachedText.length + 50 || cachedLooksShort)){
              setCachedLit(iso, fresh);
              renderLitFromData(iso, fresh);
            }
          }
        }catch(e){}
      })();
    }
    return cached;
  }

  if (!navigator.onLine){
    if (status){
      status.classList.remove('loading');
      status.textContent = 'Liturgické čítania sa nepodarilo načítať. Skontroluj, či Google Script je publikovaný ako Web app pre „Anyone“ a či je správny link v SCRIPT_URL.';
    }
    return cached || { ok:false, error:'offline' };
  }

  try{
    const data = await fetchLiturgia(iso);
    if (data && data.ok){


      setCachedLit(iso, data);
      renderLitFromData(iso, data);
      return data;
    }
    throw new Error((data && data.error) ? String(data.error) : 'bad_response');
  }catch(err){
    if (status){
      status.classList.remove('loading');
      status.textContent = 'Liturgické čítania sa nepodarilo načítať. Skontroluj, či Google Script je publikovaný ako Web app pre „Anyone“ a či je správny link v SCRIPT_URL.';
    }
    return { ok:false, error:String(err) };
  }
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

function setLitHeader(iso, headerBox){
  const left = document.getElementById('lit-head-left');
  const right = document.getElementById('lit-head-right');
  const w = weekdaySkFromISO(iso);

  if (left){
    if (Array.isArray(headerBox) && headerBox.length){
      left.innerHTML = headerBox
        .map(l => `<div class="lit-head-line">${escapeHtml(String(l||'').trim())}</div>`)
        .join('');
    } else {
      const t = String(headerBox || '').trim();
      left.textContent = t || 'Liturgický kalendár';
    }
  }
  if (right){
    right.textContent = `${dmyFromISO(iso)}${w ? ' (' + w.toLowerCase() + ')' : ''}`;
  }
}


// --- Liturgia: robustné rozsekanie "presne podľa KBS" (čo sa dá z textu) ---
function _litNormalizeText(text){
  let t = String(text||'').replace(/\r/g,'');
  // KBS občas zlepí nadpisy bez \n -> vlož \n pred kľúčové značky
  const keys = [
    'Čítanie zo svätého Evanjelia',
    'Čítanie zo svätého evanjelia',
    'Čítanie z ',
    'Čítanie zo ',
    'Responzóriový žalm',
    'Alelujový verš',
    'Počuli sme Božie slovo.',
    'Počuli sme slovo Pánovo.'
  ];
  keys.forEach(k=>{
    const re = new RegExp(`([^\\n])\\s*(${k.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\\\$&')})`, 'g');
    t = t.replace(re, '$1\n$2');
  });
  // zredukuj prázdne riadky
  t = t.replace(/\n{3,}/g,'\n\n');
  // vyhoď riadky s title "Liturgický kalendár ..." (niekedy sa dostanú do textu)
  t = t.split('\n').filter(l => !/^\s*Liturgick[ýy]\s+kalend[áa]r\b/i.test(l.trim())).join('\n');
  return t.trim();
}

function _litLines(text){
  return _litNormalizeText(text).split('\n').map(l=>String(l||''));
}

// pre rozpoznávanie nadpisov sekcií musíme ignorovať odrážky/ikonky (☑ ✓ • – ...) na začiatku riadku
function _litKeyLine(raw){
  return String(raw||'')
    .replace(/^[\s\u2022\u25E6\u25CF\u2013\u2014\-✓✔☑]+/g, '')
    .trim();
}


// odstráň globálny šum (napr. title "Liturgický kalendár ..."), aby sa nikdy nedostal do čítaní
function _litStripGlobalNoiseLines(lines){
  return (lines||[]).filter(l => {
    const t = String(l||'').trim();
    if (!t) return false;
    if (/^Liturgick[ýy]\s+kalend[áa]r\b/i.test(t)) return false;
    return true;
  });
}

// refrén žalmu (R.: ...) býva v hlavičkovej "Ž" sekcii pred čítaniami
function _litExtractPsalmRefrainFromHeader(lines, startIdx=0, endIdx=220){
  const L = (lines||[]).slice(startIdx, Math.min(lines.length, endIdx)).map(x=>String(x||'').trim()).filter(Boolean);
  for (let i=0;i<L.length;i++){
    const a = L[i];
    if (/^Ž\s*\d+\b/.test(a) || /^Responz[óo]riov[ýy]\s+žalm\b/i.test(a)){
      for (let j=i+1;j<=i+3 && j<L.length;j++){
        const b = L[j];
        if (/^R\s*\.?\s*:\s*\S/i.test(b)){
          let r = b.replace(/^R\s*\.?\s*:\s*/i,'').trim();
          if (!r) return '';
          if (r.length > 180) return '';
          return 'R.: ' + r;
        }
      }
    }
  }
  const any = L.find(x => /^R\s*\.?\s*:\s*\S/i.test(x));
  if (any){
    let r = any.replace(/^R\s*\.?\s*:\s*/i,'').trim();
    if (r && r.length > 180) return '';
    return r ? ('R.: ' + r) : '';
  }
  return '';
}

function _litLooksLikeSmernica(line){
  const raw = String(line||'').trim();
  const l = _litKeyLine(raw);
  if (!raw && !l) return false;

  // ikonky/checkboxy a krátke smernice s referenciami (prehľadová časť na KBS)
  if (/^[✓✔☑]/.test(raw)) return true;
  if (/[✓✔☑]/.test(raw) && /\d/.test(raw)) return true;

  // typicky len referencia (Mal 3, 1-4) / (Iz 58, 7-10) bez ďalšieho textu
  if (l.length <= 40 && /\d/.test(l) && /^[0-3]?\s*[A-Za-zÁČĎÉÍĹĽŇÓÔŔŠŤÚÝŽŽ]{1,10}\s*\d+\s*,\s*\d+/.test(l)) return true;
  if (l.length <= 24 && /^Ž\s*\d/.test(l)) return true;

  return false;
}

function _litLooksLikeReadingCoords(line){
  const l = String(line||'').trim();
  if (!l) return false;
  // typicky: "Hebr 12, 4-7; Ž 103, 1-2. 3-4; Mk 6, 1-6"
  // alebo krátke odkazy v hlavičke. Nechceme ich v názve dňa.
  if (/;/.test(l) && /\d/.test(l)) return true;
  if (/\b\d+\s*,\s*\d+/.test(l)) return true; // 12, 4-7
  if (/^\s*\d+\s*,\s*\d+/.test(l)) return true;
  if (/\bŽ\s*\d+\b/.test(l) && /\d/.test(l)) return true;
  // kniha + kapitola/verše (skratka 2–8 písmen)
  if (/^[A-Za-zÁČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ]{1,8}\s*\d+\s*,\s*\d+/.test(l)) return true;
  return false;
}

function _litIsStartOfContent(line){
  const l = _litKeyLine(line);
  return (
    // prvé/druhé čítanie môže začať aj "Začiatok/Koniec ..." (nielen "Čítanie ...")
    /^(Čítanie|Začiatok|Koniec)\b/i.test(l) ||
    /^Responzóriový\s+žalm\b/i.test(l) ||
    /^Žalm\b/i.test(l) ||
    /^Ž\s*\d+\b/i.test(l) ||
    /^Sekvencia\b/i.test(l) ||
    /^(Alelujový\s+verš|Verš\s+pred\s+evanjeliom|Aklamácia\s+pred\s+evanjeliom)\b/i.test(l) ||
    // evanjelium – rôzne varianty
    /^(Čítanie|Začiatok|Koniec)\s+(zo\s+svätého\s+Evanjelia|zo\s+svätého\s+evanjelia|svätého\s+Evanjelia|svätého\s+evanjelia)\b/i.test(l) ||
    /^Evanjelium\b/i.test(l)
  );
}

function _litExtractFeastTitle(lines){
  const slice = _litStripGlobalNoiseLines((lines||[])).slice(0, 260).map(x=>String(x||'').trim()).filter(Boolean);
  if (!slice.length) return '';

  const weekRe = /(pondelok|utorok|streda|štvrtok|piatok|sobota|nedeľa|nedela)/i;
  const strongRe = /(týždňa|tyzdna|období|obdobi|slávnosť|slavnost|sviatok|spomienka|ľubovoľná spomienka|lubovolna spomienka|féria|feria)/i;

  function isWeekdayOnly(l){
    const t = String(l||'').trim().toLowerCase();
    return ['pondelok','utorok','streda','štvrtok','piatok','sobota','nedeľa','nedela'].includes(t);
  }
  function mostlyUpper(l){
    const t = String(l||'');
    const letters = t.replace(/[^A-Za-zÁÄČĎÉÍĹĽŇÓÔÖŔŠŤÚÝŽáäčďéíĺľňóôöŕšťúýž]/g,'');
    if (letters.length < 8) return false;
    const upp = letters.replace(/[^A-ZÁÄČĎÉÍĹĽŇÓÔÖŔŠŤÚÝŽ]/g,'').length;
    return (upp / letters.length) > 0.65;
  }

  function score(line){
    const l = String(line||'').trim();
    let s = 0;

    // silné liturgické frázy
    if (strongRe.test(l)) s += 14;
    if (/(slávnosť|slavnost|sviatok|spomienka|féria|feria)/i.test(l)) s += 7;
    if (/(týždňa|tyzdna|období|obdobi)/i.test(l)) s += 6;

    // sviatky často majú samostatný názov bez slov "týždňa/období"
    if (!/\d/.test(l) && !isWeekdayOnly(l)){
      if (l.length >= 10) s += 6;
      if (/\bPán\b|\bPána\b|\bPanny\b|\bMárie\b|\bSvät\b/i.test(l)) s += 3;
      if (mostlyUpper(l)) s += 6;
      // typicky 2-6 slov
      const words = l.split(/\s+/).filter(Boolean).length;
      if (words >= 2 && words <= 8) s += 2;
    }

    // mierna preferencia dlhším (ale nie extrémnym) riadkom
    s += Math.min(l.length, 90) / 45;

    // penalizuj čistý deň v týždni ("Utorok")
    if (isWeekdayOnly(l)) s -= 10;

    return s;
  }

  let best = slice[0];
  let bestScore = score(best);

  for (const l of slice){
    const sc = score(l);
    if (sc > bestScore){
      best = l; bestScore = sc;
    }
  }
  return String(best||'').trim();
}


function _litExtractHeaderBoxLines(lines){
  // Chceme zobraziť celú hlavičku dňa (farebný rámček na KBS) – bez smerníc (checkboxy, biblické odkazy, Ž ...).
  const slice = _litStripGlobalNoiseLines((lines||[])).slice(0, 260).map(x=>String(x||'').trim());
  const out = [];
  for (let i=0;i<slice.length;i++){
    const t = slice[i];
    if (!t) continue;

    // hlavička končí pred smernicami / pred prvým obsahom
    if (_litLooksLikeSmernica(t)) break;
    if (_litLooksLikeReadingCoords(t)) continue;
    if (/^R\s*\.?\s*:\s*\S/i.test(t)) break; // R.: z hlavičkovej Ž sekcie nechceme v titulku
    if (_litIsStartOfContent(t)) break;

    // vyhoď čisté odrážky/ikonky
    if (/^[•\-–—]\s*$/.test(t)) continue;

    out.push(t);
    // ochrana – hlavička je krátka
    if (out.length >= 8) break;
  }
  // fallback – aspoň jeden riadok
  if (!out.length){
    const ft = _litExtractFeastTitle(lines);
    if (ft) return [ft];
  }
  return out;
}

function _litDropLeadNoise(lines){
  const out = [];
  let started = false;
  for (let i=0;i<lines.length;i++){
    const raw = String(lines[i]||'');
    const l = raw.trim();
    if (!started){
      if (!l) continue;
      if (_litLooksLikeSmernica(l)) continue;
      if (_litIsStartOfContent(l)) started = true;
      else {
        // Všetko pred prvým "Čítanie..." / "Responzóriový žalm" je hlavička stránky (dátum, meniny, nadpisy).
        // Do chlievikov to nepatrí – nechaj to iba pre header (feastTitle), nie v tele.
        continue;
      }
    }
    if (started){
      // aj po štarte vyhoď explicitné smernice s checkboxmi
      if (_litLooksLikeSmernica(l)) continue;
      out.push(raw);
    }
  }
  return out;
}

// Rozdeľ riadok typu "Čítanie ... Mk 5, 21-43" na (nadpis) + (referencia)
function _litSplitTitleAndRef(line){
  const s = String(line||'').trim();
  if (!s) return { title:'', ref:'' };
  // typické biblické odkazy: "Mk 5, 21-43", "2 Sam 18, 9-10", "Mal 3, 1-4", "Ž 86, 1-2..."
  const m = s.match(/^(.*?)(\b(?:Ž\s*\d+|(?:[1-3]\s*)?[A-ZÁČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ][A-Za-zÁČĎÉÍĹĽŇÓÔŔŠŤÚÝŽáčďéíĺľňóôŕšťúýž]{0,7})\s+\d[\d\s,\.\-–+]*.*)$/);
  if (m && m[1] && m[2]){
    const title = m[1].trim().replace(/[\s—-]+$/,'').trim();
    const ref = m[2].trim();
    // ak title vyjde príliš krátke, nechaj pôvodný riadok ako title
    if (title.length >= 8) return { title, ref };
  }
  return { title:s, ref:'' };
}

function _litFindIndex(lines, re, from=0, to=null){
  const end = (to==null) ? lines.length : to;
  for (let i=from;i<end;i++){
    if (re.test(_litKeyLine(lines[i]))) return i;
  }
  return -1;
}

function _litReadingHasBody(readingLines){
  const lines = (readingLines||[]).map(x=>String(x||'')).filter(x=>x!=null);
  if (!lines.length) return false;

  // odstráň úvodné nadpisové riadky (Čítanie/Začiatok/Koniec) a čisté súradnice
  let start = 0;
  while (start < lines.length){
    const t = _litKeyLine(lines[start]);
    if (!t) { start++; continue; }
    if (/^(Čítanie|Začiatok|Koniec)\b/i.test(t)) { start++; continue; }
    // súradnice typu "Iz 58, 7-10" alebo "1 Kor 9, 16-23"
    if (t.length <= 45 && /\d/.test(t) && /^[0-3]?\s*[A-Za-zÁČĎÉÍĹĽŇÓÔŔŠŤÚÝŽŽ]{1,10}\s*\d+\s*,\s*\d+/.test(t)) { start++; continue; }
    break;
  }

  for (let i=start; i<lines.length; i++){
    const t = _litKeyLine(lines[i]);
    if (!t) continue;

    // ak je to už ďalší nadpis sekcie, nie je to telo
    if (/^(Responzóriový\s+žalm|Žalm|Alelujový\s+verš|Verš\s+pred\s+evanjeliom|Aklamácia\s+pred\s+evanjeliom|Sekvencia|Aleluja|Chvála\s+ti|Sláva\s+ti|Evanjelium|Počuli\s+sme)\b/i.test(t)) continue;

    // reálne telo má aspoň nejaký text (nemusí byť dlhý na jeden riadok – často je zalomený)
    if (t.length >= 18) return true;
  }
  return false;
}

function _litSplitIntoSections(text){
  let lines0 = _litStripGlobalNoiseLines(_litLines(text));
  const headerBoxLines = _litExtractHeaderBoxLines(lines0);
  const feastTitle = (headerBoxLines && headerBoxLines.length) ? headerBoxLines[0] : _litExtractFeastTitle(lines0);
  const psalmRefrain = _litExtractPsalmRefrainFromHeader(lines0, 0, 220);

  let lines = lines0.map(l=>String(l||''));
  if (headerBoxLines && headerBoxLines.length){
    const hb = new Set(headerBoxLines.map(x=>String(x||'').trim()).filter(Boolean));
    lines = lines.filter(l => {
      const t = String(l||'').trim();
      return t && !hb.has(t);
    });
  } else if (feastTitle){
    lines = lines.filter(l => String(l||'').trim() && String(l||'').trim() !== feastTitle);
  } else {
    lines = lines.filter(l => String(l||'').trim());
  }

  // odstráň úvodné hlavičky + prehľadové smernice
  lines = _litDropLeadNoise(lines);

  const idxPsalm = (() => {
    // Sometimes the page contains multiple psalms (e.g. optional/facultative readings).
    // Prefer the first psalm section that has an actual body (not only coordinates).
    const cand = [];
    function collect(re){
      for (let i=0;i<lines.length;i++){
        if (re.test(_litKeyLine(lines[i]))) cand.push(i);
      }
    }
    collect(/^Responzóriový\s+žalm\b/i);
    collect(/^Žalm\b/i);
    collect(/^Ž\s*\d+\b/i);

    // unique + sort
    const uniq = Array.from(new Set(cand)).sort((a,b)=>a-b);
    if (!uniq.length) return -1;

    function sectionHasBody(sec){
      let long = 0;
      for (const raw of sec){
        const t = _litKeyLine(raw);
        if (!t) continue;
        if (/^R\s*\.?\s*:/i.test(t)) continue;
        // coords-only line: short + looks like reference
        if (t.length <= 55 && /\d/.test(t) && /^[0-3]?\s*[A-Za-zÁČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ]{1,12}\s*\d+\s*,\s*\d+/.test(t)) continue;
        if (t.length >= 18) long++;
      }
      return long >= 1;
    }

    for (const i of uniq){
      const end = (() => {
        const j = _litFindIndex(lines, /^(Alelujový\s+verš|Verš\s+pred\s+evanjeliom|Aklamácia\s+pred\s+evanjeliom|Sekvencia|Aleluja|Chvála\s+ti|Sláva\s+ti|Čítanie\b|Začiatok\b|Koniec\b|Evanjelium\b)\b/i, i+1);
        return (j > -1) ? j : lines.length;
      })();
      const sec = lines.slice(i, end);
      if (sectionHasBody(sec)) return i;
    }
    return uniq[0];
  })();

  const idxGospel = (() => {
    let i = _litFindIndex(lines, /^Čítanie\s+zo\s+svätého\s+Evanjelia\b/i, 0);
    if (i<0) i = _litFindIndex(lines, /^Čítanie\s+zo\s+svätého\s+evanjelia\b/i, 0);
    if (i<0) i = _litFindIndex(lines, /^Začiatok\s+(zo\s+svätého\s+)?Evanjelia\b/i, 0);
    if (i<0) i = _litFindIndex(lines, /^Začiatok\s+(zo\s+svätého\s+)?evanjelia\b/i, 0);
    if (i<0) i = _litFindIndex(lines, /^Koniec\s+(zo\s+svätého\s+)?Evanjelia\b/i, 0);
    if (i<0) i = _litFindIndex(lines, /^Koniec\s+(zo\s+svätého\s+)?evanjelia\b/i, 0);
    if (i<0) i = _litFindIndex(lines, /^Evanjelium\b/i, 0);
    return i;
  })();

  const searchStart = (idxPsalm>=0) ? idxPsalm : 0;
  let idxAlleluia = _litFindIndex(lines, /^(Alelujový\s+verš|Verš\s+pred\s+evanjeliom|Aklamácia\s+pred\s+evanjeliom)\b/i, searchStart);
  if (idxAlleluia < 0 && idxGospel >= 0){
    idxAlleluia = _litFindIndex(lines, /^(Aleluja\b|Chvála\s+ti\b|Sláva\s+ti\b)/i, searchStart, idxGospel);
  }

  let idxRead2 = -1;
  if (idxPsalm >= 0){
    const lim = (idxAlleluia>=0) ? idxAlleluia : (idxGospel>=0 ? idxGospel : lines.length);
    for (let i=idxPsalm+1;i<lim;i++){
      const l = _litKeyLine(lines[i]);
      if (/^(Čítanie|Začiatok|Koniec)\b/i.test(l) &&
          !/^Čítanie\s+zo\s+svätého\s+Evanjelia\b/i.test(l) &&
          !/^Čítanie\s+zo\s+svätého\s+evanjelia\b/i.test(l)){
        idxRead2 = i;
        break;
      }
    }
  }

  let idxSeq = -1;
  const seqStart = (idxRead2>=0) ? idxRead2 : (idxPsalm>=0 ? idxPsalm : 0);
  const seqEnd = (idxAlleluia>=0) ? idxAlleluia : (idxGospel>=0 ? idxGospel : lines.length);
  for (let i=seqStart;i<seqEnd;i++){
    const l = _litKeyLine(lines[i]);
    if (/^Sekvencia\b/i.test(l)){
      idxSeq = i;
      break;
    }
  }

  const end1 = (idxPsalm>=0) ? idxPsalm : (idxAlleluia>=0 ? idxAlleluia : (idxGospel>=0 ? idxGospel : lines.length));
  const endPsalm = (idxRead2>=0) ? idxRead2 : (idxSeq>=0 ? idxSeq : (idxAlleluia>=0 ? idxAlleluia : (idxGospel>=0 ? idxGospel : lines.length)));
  const endRead2 = (idxSeq>=0) ? idxSeq : (idxAlleluia>=0 ? idxAlleluia : (idxGospel>=0 ? idxGospel : lines.length));
  const endSeq = (idxAlleluia>=0) ? idxAlleluia : (idxGospel>=0 ? idxGospel : lines.length);
  const endAlleluia = (idxGospel>=0) ? idxGospel : lines.length;

  const reading1 = lines.slice(0, Math.max(0,end1));
  const psalm = (idxPsalm>=0) ? lines.slice(idxPsalm, Math.max(idxPsalm,endPsalm)) : [];
  const reading2 = (idxRead2>=0) ? lines.slice(idxRead2, Math.max(idxRead2,endRead2)) : [];
  const sequence = (idxSeq>=0) ? lines.slice(idxSeq, Math.max(idxSeq,endSeq)) : [];
  const alleluia = (idxAlleluia>=0) ? lines.slice(idxAlleluia, Math.max(idxAlleluia,endAlleluia)) : [];
  const gospel = (idxGospel>=0) ? lines.slice(idxGospel) : [];

  return { feastTitle, headerBoxLines, psalmRefrain, reading1, psalm, reading2, sequence, alleluia, gospel };
}

// Rozdeľ jeden deň na viac "omší/variantov" (napr. 25.12, vigília, ráno/večer...) bez hardcodovania názvov.
function _litSplitIntoMasses(text){
  const linesAll = _litStripGlobalNoiseLines(_litLines(text));
  const lines = linesAll.map(l=>String(l||''));

  // Indexy začiatkov "prvého čítania" – KBS niekedy používa aj "Začiatok..." / "Koniec...".
  // Každý formulár/omša začína prvým čítaním (nie evanjelium).
  const readStartIdx = [];
  const gospelStartRe = /^(Čítanie\s+zo\s+svätého\s+Evanjelia\b|Čítanie\s+zo\s+svätého\s+evanjelia\b|Začiatok\s+zo\s+svätého\s+Evanjelia\b|Začiatok\s+zo\s+svätého\s+evanjelia\b|Začiatok\s+svätého\s+Evanjelia\b|Začiatok\s+svätého\s+evanjelia\b|Koniec\s+zo\s+svätého\s+Evanjelia\b|Koniec\s+zo\s+svätého\s+evanjelia\b|Evanjelium\b)/i;

  for (let i=0;i<lines.length;i++){
    const t = String(lines[i]||'').trim();
    if (!t) continue;

    // Nesmie to byť evanjelium, žalm, aklamácia, sekvencia.
    if (gospelStartRe.test(t)) continue;
    if (/^Responzóriový\s+žalm\b/i.test(t) || /^Žalm\b/i.test(t) || /^Ž\s*\d+\b/i.test(t)) continue;
    if (/^(Alelujový\s+verš|Verš\s+pred\s+evanjeliom|Aklamácia\s+pred\s+evanjeliom)\b/i.test(t)) continue;
    if (/^Sekvencia\b/i.test(t)) continue;

    if (/^(Čítanie|Začiatok|Koniec)\b/i.test(t)){
      readStartIdx.push(i);
    }
  }

  if (!readStartIdx.length){
    return [{ title:'', text:String(text||'') }];
  }

  // Robustné delenie: nový blok začína až po tom, čo sme už v predchádzajúcom bloku videli evanjelium.
  // NOTE: do not redeclare `gospelStartRe` in this scope (it breaks the whole app).
  // Use a secondary regex name if we need a narrower match.
  const gospelStartRe2 = /^(Čítanie\s+zo\s+svätého\s+Evanjelia\b|Čítanie\s+zo\s+svätého\s+evanjelia\b|Evanjelium\b)/i;

  const starts = [readStartIdx[0]];
  let currentStart = readStartIdx[0];

  for (let k=1;k<readStartIdx.length;k++){
    const i = readStartIdx[k];
    let sawGospel = false;
    for (let j=currentStart; j<i; j++){
      const t = String(lines[j]||'').trim();
      if (gospelStartRe2.test(t)){ sawGospel = true; break; }
    }
    if (sawGospel){
      starts.push(i);
      currentStart = i;
    }
  }

  const feastTitle = _litExtractFeastTitle(linesAll);

  const blocks = [];
  for (let b=0;b<starts.length;b++){
    const s = starts[b];
    const e = (b<starts.length-1) ? starts[b+1] : lines.length;
    const chunkLines = lines.slice(s, e);

    // názov bloku: hľadaj tesne pred začiatkom (KBS tam často dá "Omša ...", "Vigília ...", atď.)
    let title = '';
    for (let j=s-1; j>=0 && j>=s-30; j--){
      const t = String(lines[j]||'').trim();
      if (!t) continue;
      if (_litLooksLikeSmernica(t)) continue;
      if (/^Počuli\s+sme\b/i.test(t)) continue;
      if (/^alebo\b/i.test(t)) continue;
      if (/^(\d{1,2}\.\d{1,2}\.|\d{1,2}\.\s*\d{1,2}\.)/.test(t)) continue;
      if (/^(Čítanie\s+|Responzóriový\s+žalm|Alelujový\s+verš|Verš\s+pred\s+evanjeliom|Aklamácia\s+pred\s+evanjeliom|Sekvencia|Evanjelium)\b/i.test(t)) continue;
      if (feastTitle && t === feastTitle) continue;
      title = t;
      break;
    }

    blocks.push({ title, text: chunkLines.join('\n') });
  }

  return blocks;
}

function _litEscapeLines(lines){
  return (lines||[]).map(l=>escapeHtml(String(l||'')));
}

function _litParagraphsFromLines(lines){
  const paras = [];
  let cur = [];
  for (const raw of (lines||[])){
    const l = String(raw||'');
    if (!l.trim()){
      if (cur.length){ paras.push(cur); cur=[]; }
      continue;
    }
    cur.push(l);
  }
  if (cur.length) paras.push(cur);
  return paras;
}

function _litRenderBody(lines){
  const paras = _litParagraphsFromLines(lines);
  if (!paras.length) return '';
  const out = [];
  out.push('<div class="lit-body">');
  for (const p of paras){
    const html = p.map(x=>{
      const t = String(x||'');
      const trim = t.trim();
      // zvýrazni "alebo" / "alebo večer" (KBS voľby) – modro, ale nech ostane v tom istom odstavci
      if (/^alebo\b/i.test(trim)){
        return `<span class="lit-or">${escapeHtml(t)}</span>`;
      }
      return escapeHtml(t);
    }).join('<br>');
    out.push(`<p>${html}</p>`);
  }
  out.push('</div>');
  return out.join('');
}

function _litPullFirstHeading(lines, re){
  // nájdi prvý riadok, ktorý je "nadpis" (Čítanie..., Responzóriový žalm...)
  for (let i=0;i<lines.length;i++){
    const l = String(lines[i]||'').trim();
    if (re.test(l)) return { idx:i, text:l };
  }
  return { idx:-1, text:'' };
}

function _litRenderReadingCard(label, lines){
  if (!lines || !lines.some(x=>String(x||'').trim())) return '';
  const out = [];
  const clean = lines.map(x=>String(x||'')).filter(x=>x!=null);

  // 1) prvý "Čítanie z/zo ..." riadok (KBS nadpis) a biblický odkaz ako menší riadok
  const h = _litPullFirstHeading(clean, /^(Čítanie|Začiatok|Koniec)\b/i);
  let bodyLines = clean.slice();
  let headingLine = '';
  let refLine = '';
  if (h.idx >= 0){
    const split = _litSplitTitleAndRef(h.text);
    headingLine = split.title;
    refLine = split.ref;
    bodyLines.splice(h.idx,1);
  }

  // Poznámka: "malý komentár" (sivé na KBS) je v tejto UI presne biblický odkaz (refLine).

  
  // 2b) Niekedy sa v závere čítania objaví aj R.: (refren žalmu) – nech to nie je duplicitne aj v čítaní.
  bodyLines = bodyLines.filter(l => !/^R\s*\.?\s*:\s*\S/i.test(String(l||'').trim()));
// 3) "Počuli sme ..." nech je modré a oddelené
  let closing = '';
  const closeIdx = bodyLines.findIndex(l => /^Počuli\s+sme\b/i.test(String(l||'').trim()));
  if (closeIdx >= 0){
    closing = String(bodyLines[closeIdx]||'').trim();
    bodyLines.splice(closeIdx,1);
  }

  out.push('<div class="lit-block">');
  out.push(`<div class="lit-h lit-h-center">${escapeHtml(label)}</div>`);
  if (headingLine) out.push(`<div class="lit-line lit-blue">${escapeHtml(headingLine)}</div>`);
  if (refLine) out.push(`<div class="lit-line lit-blue lit-small">${escapeHtml(refLine)}</div>`);
  out.push(_litRenderBody(bodyLines));
  if (closing) out.push(`<div class="lit-line lit-blue">${escapeHtml(closing)}</div>`);
  out.push('</div>');
  return out.join('');
}

function _litRenderSequenceCard(lines){
  if (!lines || !lines.some(x=>String(x||'').trim())) return '';
  let body = lines.map(x=>String(x||''));
  body = body.filter(l => !/^Sekvencia\b/i.test(String(l||'').trim()));
  return [
    '<div class="lit-block">',
      `<div class="lit-h lit-h-center">${escapeHtml('SEKVENCIA')}</div>`,
      _litRenderBody(body),
    '</div>'
  ].join('');
}

function _litRenderPsalmCard(lines, refrainOverride){
  if (!lines || !lines.some(x=>String(x||'').trim())) return '';
  const clean = lines.map(x=>String(x||''));

  // nadpis "Responzóriový žalm — Ž ..."
  const h = _litPullFirstHeading(clean, /^Responzóriový\s+žalm\b/i);
  let headingLine = '';
  let bodyLines = clean.slice();
  if (h.idx >= 0){
    headingLine = h.text;
    bodyLines.splice(h.idx,1);
  } else {
    // fallback: prvý riadok
    headingLine = String(bodyLines.shift()||'').trim();
  }

  // refrén (R.: ...) – na KBS je často v hornej "Ž" sekcii (smernice), nie priamo v texte žalmu.
  // Preto: 1) skús nájsť v tele, 2) ak nie je, použi override z GAS.
  let refrain = '';
  const rIdx = bodyLines.findIndex(l => /^R\s*\.?\s*:\s*\S/i.test(String(l||'').trim()));
  if (rIdx >= 0){
    refrain = String(bodyLines[rIdx]||'').trim();
    bodyLines.splice(rIdx,1);
  } else if (refrainOverride){
    refrain = String(refrainOverride).trim();
  }

  return [
    '<div class="lit-block">',
      `<div class="lit-h lit-h-center">${escapeHtml('ŽALM')}</div>`,
      headingLine ? `<div class="lit-line lit-blue">${escapeHtml(headingLine)}</div>` : '',
      refrain ? `<div class="lit-line lit-blue lit-center">${escapeHtml(refrain)}</div>` : '',
      _litRenderBody(bodyLines),
    '</div>'
  ].join('');
}

function _litRenderAlleluiaCard(lines){
  if (!lines || !lines.some(x=>String(x||'').trim())) return '';
  let bodyLines = lines.map(x=>String(x||'')).filter(Boolean);

  bodyLines = bodyLines.filter(l => !/^(Alelujový\s+verš|Verš\s+pred\s+evanjeliom|Aklamácia\s+pred\s+evanjeliom)\b/i.test(String(l||'').trim()));

  const cleaned = [];
  let hadAlleluiaWord = false;
  for (const l0 of bodyLines){
    let t = String(l0||'').trim();
    if (!t) continue;
    if (/^Aleluja\b/i.test(t)) hadAlleluiaWord = true;
    if (/^Aleluja[\s,!.]*$/i.test(t)) continue;
    t = t.replace(/^Aleluja(?:[\s,!.]+Aleluja){0,3}[\s,!.]*/i,'').trim();
    if (t) cleaned.push(t);
  }

  let acclTitle = '';
  if (cleaned.length){
    const first = cleaned[0];
    if (/^(Chvála\s+ti|Sláva\s+ti)/i.test(first)){
      acclTitle = first;
      cleaned.shift();
    }
  }
  if (!acclTitle && hadAlleluiaWord){
    acclTitle = 'Aleluja'; // bez bodky
  }

  return [
    '<div class="lit-block">',
      `<div class="lit-h lit-h-center">${escapeHtml('ALELUJA')}</div>`,
      acclTitle ? `<div class="lit-line lit-blue lit-center">${escapeHtml(acclTitle)}</div>` : '',
      _litRenderBody(cleaned),
    '</div>'
  ].join('');
}

function _litRenderGospelCard(lines){
  if (!lines || !lines.some(x=>String(x||'').trim())) return '';
  const clean = lines.map(x=>String(x||''));

  // nadpis evanjelia do tela (KBS niekedy používa aj "Začiatok/Koniec ...")
  let headingLine = '';
  const h = _litPullFirstHeading(clean, /^(Čítanie|Začiatok|Koniec)\s+(zo\s+svätého\s+Evanjelia|zo\s+svätého\s+evanjelia|svätého\s+Evanjelia|svätého\s+evanjelia)\b/i);
  const h2 = _litPullFirstHeading(clean, /^Evanjelium\b/i);
  const idx = (h.idx>=0) ? h.idx : (h2.idx>=0 ? h2.idx : -1);
  if (idx >= 0){
    headingLine = String(clean[idx]||'').trim();
    clean.splice(idx,1);
  }

// malý komentár (napr. "Chlapec rástol..." alebo podobné) – nech je menší modrý
  let commentLine = '';
  for (let i=0;i<clean.length;i++){
    const l = String(clean[i]||'').trim();
    if (!l) continue;
    if (l.length <= 120 && !/^Počuli\s+sme/i.test(l)){
      commentLine = l;
      clean.splice(i,1);
    }
    break;
  }

  // "Počuli sme slovo Pánovo."
  let closing = '';
  const closeIdx = clean.findIndex(l => /^Počuli\s+sme\b/i.test(String(l||'').trim()));
  if (closeIdx >= 0){
    closing = String(clean[closeIdx]||'').trim();
    clean.splice(closeIdx,1);
  }

  return [
    '<div class="lit-block">',
      `<div class="lit-h lit-h-center">${escapeHtml('EVANJELIUM')}</div>`,
      headingLine ? `<div class="lit-line lit-blue">${escapeHtml(headingLine)}</div>` : '',
      commentLine ? `<div class="lit-line lit-blue lit-small">${escapeHtml(commentLine)}</div>` : '',
      _litRenderBody(clean),
      closing ? `<div class="lit-line lit-blue">${escapeHtml(closing)}</div>` : '',
    '</div>'
  ].join('');
}


function _litPickMainVariantForCalendar(variants){
  const arr = Array.isArray(variants) ? variants : [];
  if (!arr.length) return 0;
  // prefer "Féria" (hlavný deň), potom prázdny label, potom prvý ne-"alebo"
  let idx = arr.findIndex(v => v && typeof v.label === 'string' && /f[ée]ria/i.test(v.label));
  if (idx >= 0) return idx;
  idx = arr.findIndex(v => v && (!v.label || !String(v.label).trim()));
  if (idx >= 0) return idx;
  idx = arr.findIndex(v => {
    const lab = String((v && v.label) || '').trim().toLowerCase();
    return lab && lab !== 'alebo' && !lab.startsWith('alebo ');
  });
  return idx >= 0 ? idx : 0;
}

function _litKbsLikeHtmlFromText(rawText){
  const s = String(rawText||'').replace(/\r/g,'');
  const lines = s.split('\n');

  let html = '<div class="kbs-like">';
  let inPsalm = false;
  let lastH4 = '';

  function esc(x){ return escapeHtml(String(x||'')); }

  for (let i=0;i<lines.length;i++){
    const lineRaw = lines[i];
    const line = String(lineRaw||'').trimEnd();

    if (!line.trim()){
      html += '<div class="kbs-gap"></div>';
      continue;
    }

    // headings
    if (/^#{5}\s+/.test(line)){
      inPsalm = false;
      html += '<div class="kbs-h5">'+esc(line.replace(/^#{5}\s+/,''))+'</div>';
      continue;
    }
    if (/^#{4}\s+/.test(line)){
      const h = line.replace(/^#{4}\s+/, '').trim();
      const isGospel = /^Evanjelium\b/i.test(h);
      const prevWasVerse = /(\bverš\b|aklamáci)/i.test(String(lastH4||''));
      if (isGospel && prevWasVerse){
        // medzi veršom/aklamáciou a evanjeliom nech sú dva prázdne riadky
        html += '<div class="kbs-gap"></div><div class="kbs-gap"></div>';
      }
      inPsalm = /^Responzóriový\s+žalm\b/i.test(h);
      lastH4 = h;
      html += '<div class="kbs-h4">'+esc(h)+'</div>';
      continue;
    }

    // responses
    if (/^Počuli\s+sme\b/i.test(line)){
      html += '<div class="kbs-response">'+esc(line)+'</div>';
      continue;
    }

    // keep psalm line breaks
    if (inPsalm){
      html += '<div class="kbs-psalm-line">'+esc(line)+'</div>';
      continue;
    }

    html += '<div class="kbs-line">'+esc(line)+'</div>';
  }

  html += '</div>';
  return html;
}

function renderLitFromData(iso, data){
  const status = document.getElementById('lit-status');
  const content = document.getElementById('lit-content');
  const row = document.getElementById('lit-variant-row');
  const sel = document.getElementById('lit-variant-select');

  const variants = (data && Array.isArray(data.variants)) ? data.variants : [];

  // selector v Liturgickom kalendári nepoužívame (len zobrazíme "KBS-look" pre hlavný deň)
  if (row) row.style.display = 'none';
  if (sel) sel.innerHTML = '';

  if (status){
    status.classList.remove('loading');
    status.textContent = '';
    if (!navigator.onLine){
      status.textContent = 'Si offline – zobrazuje sa uložená verzia (ak existuje).';
    }
  }

  if (!content) return;

  // vyber hlavný variant (Féria) a zober iba telo pod "súradnicami"
  const vidx = _litPickMainVariantForCalendar(variants);
  const v = variants[vidx] || variants[0] || {};
  const fullText = String((v && v.text) ? v.text : (data && data.text ? data.text : ''));

  const bodyText = _litDropOverviewKbs(fullText);
  content.innerHTML = _litKbsLikeHtmlFromText(bodyText);
}
function initLitCalendarUI(){
  const input = document.getElementById('lit-date-input');
  const btn = document.getElementById('lit-date-btn');
  const sel = document.getElementById('lit-variant-select');
  const popup = document.getElementById('lit-cal-popup');

  if (!input || !btn) return;

  function isTouch(){
    return (('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0));
  }

  function openCustomCalendar(initialIso, onPick){
    if (!popup) return;
    const todayIso = isoToday();
    let cur = initialIso || todayIso;
    let curDate = new Date(cur + 'T00:00:00');
    let viewY = curDate.getFullYear();
    let viewM = curDate.getMonth();

    const dow = ['Po','Ut','St','Št','Pi','So','Ne'];
    const monthNames = ['január','február','marec','apríl','máj','jún','júl','august','september','október','november','december'];

    function isoOf(y,m,d){
      const mm = String(m+1).padStart(2,'0');
      const dd = String(d).padStart(2,'0');
      return `${y}-${mm}-${dd}`;
    }

    function render(){
      const first = new Date(viewY, viewM, 1);
      const last = new Date(viewY, viewM+1, 0);
      // JS: 0=Ne..6=So, my chceme Po..Ne
      const jsDow = first.getDay();
      const offset = (jsDow + 6) % 7; // Po=0
      const daysInMonth = last.getDate();

      const selectedIso = cur;

      const cells = [];
      for (let i=0;i<offset;i++) cells.push('<button type="button" class="lit-cal-day is-empty"></button>');
      for (let d=1; d<=daysInMonth; d++){
        const iso = isoOf(viewY, viewM, d);
        const cls = ['lit-cal-day'];
        if (iso === todayIso) cls.push('is-today');
        if (iso === selectedIso) cls.push('is-selected');
        cells.push(`<button type="button" class="${cls.join(' ')}" data-iso="${iso}">${d}</button>`);
      }
      const html = [];
      html.push('<div class="lit-cal-inner" role="dialog" aria-modal="true">');
      html.push('<div class="lit-cal-head">');
      html.push('<button type="button" class="lit-cal-nav" data-nav="prev">‹</button>');
      html.push(`<div class="lit-cal-month">${monthNames[viewM]} ${viewY}</div>`);
      html.push('<button type="button" class="lit-cal-nav" data-nav="next">›</button>');
      html.push('</div>');
      html.push('<div class="lit-cal-grid">');
      for (const d of dow) html.push(`<div class="lit-cal-dow">${d}</div>`);
      html.push(cells.join(''));
      html.push('</div>');
      html.push('<div class="lit-cal-actions">');
      html.push('<button type="button" class="btn-neutral" data-action="cancel">Zrušiť</button>');
      html.push('<button type="button" class="btn-primary" data-action="today">Dnes</button>');
      html.push('</div>');
      html.push('</div>');
      popup.innerHTML = html.join('');
    }

    function close(){
      popup.style.display = 'none';
      popup.setAttribute('aria-hidden','true');
      popup.innerHTML = '';
    }

    render();
    popup.style.display = 'flex';
    popup.setAttribute('aria-hidden','false');

    // kliky
    popup.onclick = (ev) => {
      const t = ev.target;
      if (!t) return;
      if (t === popup){ close(); return; }
      const nav = t.getAttribute('data-nav');
      if (nav){
        if (nav === 'prev') viewM -= 1;
        if (nav === 'next') viewM += 1;
        if (viewM < 0){ viewM = 11; viewY -= 1; }
        if (viewM > 11){ viewM = 0; viewY += 1; }
        render();
        return;
      }
      const action = t.getAttribute('data-action');
      if (action){
        if (action === 'cancel'){ close(); return; }
        if (action === 'today'){
          cur = todayIso;
          close();
          onPick(todayIso);
          return;
        }
      }
      const iso = t.getAttribute('data-iso');
      if (iso){
        cur = iso;
        close();
        onPick(iso);
      }
    };
  }

  // default dnes
  if (!input.value) input.value = isoToday();

  // klik na tlačidlo:
  // - mobile/tablet: natívny date picker
  // - PC: ak je k dispozícii showPicker(), použi ho; inak vlastný mini kalendár
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const iso = input.value || isoToday();

    // Touch (iOS/Android): natívny picker
    if (isTouch()){
      try{
        if (typeof input.showPicker === 'function'){ input.showPicker(); return; }
        input.focus(); input.click(); return;
      }catch(e){}
    }

    // Desktop/PC: vlastný mini kalendár (spoľahlivé)
    openCustomCalendar(iso, (pickedIso) => {
      input.value = pickedIso;
      setLitChoiceIndex(pickedIso, 0);
      setLitMassChoiceIndex(pickedIso, 0);
      loadLiturgiaForUI(pickedIso, {force:false});
    });
  });
  // niektoré PC/prehliadače "zožerú" click, tak pridaj aj pointerdown
  btn.addEventListener('pointerdown', (ev) => {
    try{
      ev.preventDefault();
      ev.stopPropagation();
      btn.click();
    }catch(e){}
  });

  // stop bublanie (aby to nevyzeralo ako "zbalenie" sekcií na touch zariadeniach)
  input.addEventListener('click', (e)=>{ try{ e.stopPropagation(); }catch(_){} });
  input.addEventListener('change', (e) => {
    try{ e.stopPropagation(); }catch(_){}
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
  // Vstup: text žalmu z KBS (môže obsahovať nadpisy, smernice, R.: aj zvyšky ďalších častí).
  // Výstup: iba čisté riadky žalmu + prípadný riadok "R.: ..." (nech sa dá vytiahnuť do hlavičky).
  let lines = String(ps||'').replace(/\r/g,'').split('\n').map(x=>String(x||'').trim());

  // vyhoď prázdne a hlavičky
  lines = lines.filter(l => l.length);

  // stop na ďalšie sekcie
  const stopIdx = lines.findIndex(l => /(Alelujový\s+verš|Verš\s+pred\s+evanjeliom|Aklamácia\s+pred\s+evanjeliom|Čítanie\s+zo\s+svätého\s+Evanjelia|Čítanie\s+zo\s+svätého\s+evanjelia|Evanjelium\b)/i.test(l));
  if (stopIdx >= 0) lines = lines.slice(0, stopIdx);

  // odstráň nadpisy typu "Responzóriový žalm ..." alebo samotné "Žalm" / "Ž 86, ..."
  lines = lines.filter(l => !/^Responzóriový\s+žalm\b/i.test(l));
  lines = lines.filter(l => !/^Žalm\b/i.test(l));
  lines = lines.filter(l => !/^Ž\s*\d+\b/i.test(l));

  // ak je refrén bez "R.:" (zriedkavo), nechaj ho tak – song renderer vie vybrať iba s R.
  // takže tu nič ďalšie nerobíme.

  return lines.join('\n').trim();
}

function cleanAlleluiaVerse(av){
  let lines = String(av||'').replace(/\r/g,'').split('\n').map(s=>String(s||'').trim()).filter(l=>l.length);

  // odstráň hlavičky (Alelujový verš / aklamácia)
  lines = lines.filter(l => !/(Alelujový\s+verš|Verš\s+pred\s+evanjeliom|Aklamácia\s+pred\s+evanjeliom)/i.test(l));

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
          // Nevyhadzuj používateľa z textarea počas úprav v editore.
          if (!isAlelujaLitEditing()){
            try { renderSong(); } catch(e) {}
            try { setupAlelujaLitControlsIfNeeded(); } catch(e) {}
          }
        }
      }).catch(()=>{});
    }
    return alelujaText;
  }

  const variants = cached.variants;
  const vidx = Math.min(getLitChoiceIndex(iso), variants.length-1);
  const v = variants[vidx] || variants[0];

  // Z liturgie odstráň voliteľné "Ďalšie slávenia" (najmä v pôste),
  // potom vyber omšu (ak je text rozdelený na viac omší).
  const baseText = (v && v.text) ? String(v.text) : '';
  const masses = _litSplitIntoMasses(baseText);
  const midx = Math.min(getLitMassChoiceIndex(iso), masses.length-1);

  const ov = (function(){
    try { return getLitOverride(iso, vidx, midx) || {}; } catch(e){ return {}; }
  })();
  const mass = masses[midx] || masses[0] || { title:'', text: baseText };

  // Pre parsovanie odhoď úvodný prehľad (KBS) – ale ak sa nedá, nechaj pôvodné.
  const massTextRaw = String(mass.text||'');
  const massText = _litDropOverviewKbs(massTextRaw);

  const parsed = _litSplitIntoSections(massText);

  // Aklamácia pred evanjeliom (nie vždy "Alelujový verš") – label nesmie obsahovať celý verš.
  function _deriveAclamationLabel(lines, verseText){
    const arr = Array.isArray(lines) ? lines : [];
    const first = arr.map(x=>String(x||'').trim()).find(l => l && !/^(Alelujový\s+verš|Verš\s+pred\s+evanjeliom|Aklamácia\s+pred\s+evanjeliom)\b/i.test(l)) || '';
    if (first){
      if (/^Aleluja\b/i.test(first)) return 'Aleluja';
      if (/^(Chvála\s+ti|Sláva\s+ti|Česť\s+a\s+sláva)\b/i.test(first)) return first;
      return 'Aleluja';
    }
    // fallback podľa textu (ak parsed.alleluia nie je prítomné)
    const vtxt = String(verseText||'').trim();
    if (/^(Chvála\s+ti|Sláva\s+ti|Česť\s+a\s+sláva)\b/i.test(vtxt)) return 'Aklamácia pred evanjeliom';
    return 'Aleluja';
  }

  // --- Žalm (refrén + telo) ---
  const psalmFromVar = (v && v.psalmText) ? String(v.psalmText) : '';
  const psalmFromParsed = ((parsed && parsed.psalm) ? (parsed.psalm||[]).join('\n') : '');
  const psalmClean = cleanPsalmText(String(psalmFromVar || psalmFromParsed || ''));
  const psalmCleanTrim = String(psalmClean||'').replace(/\r/g,'').trim();

  // refrén môže byť v hlavičke (parsed.psalmRefrain) alebo v texte
  let refrainLine = '';
  try { refrainLine = String((v && v.psalmRefrain) ? v.psalmRefrain : (parsed && parsed.psalmRefrain) || '').trim(); } catch(e) {}
  // KBS niekedy uvádza refrén ako „... alebo Aleluja.“ – chceme len prvú časť.
  if (refrainLine && /\balebo\b/i.test(refrainLine)){
    refrainLine = refrainLine.split(/\balebo\b/i)[0].trim();
  }
  let psalmBodyOnly = psalmCleanTrim;

  if (!refrainLine){
    const plines = psalmCleanTrim.split('\n').map(x=>String(x||'').trim()).filter(Boolean);
    const rIdx = plines.findIndex(l => /^R\s*\.?\s*:\s*\S/i.test(l));
    if (rIdx >= 0){
      const rLine = plines[rIdx];
      refrainLine = rLine.startsWith('R') ? rLine : ('R.: ' + rLine);
      plines.splice(rIdx, 1);
      psalmBodyOnly = plines.join('\n').trim();
    }
  } else {
    if (!/^R\s*\.?\s*:\s*/i.test(refrainLine)){
      refrainLine = 'R.: ' + refrainLine;
    }
  }

  // ADMIN OVERRIDE – žalm
  try {
    if (ov) {
      if (ov.psalmRefrain != null){
        const rr = String(ov.psalmRefrain||'').trim();
        refrainLine = rr ? rr : ''; // admin môže zámerne zmazať
        if (refrainLine && !/^R\s*\.?\s*:\s*/i.test(refrainLine)) refrainLine = 'R.: ' + refrainLine;
      }
      if (ov.psalmText != null){
        psalmBodyOnly = String(ov.psalmText||'').trim();
      }
    }
  } catch(e) {}

  const psPayload = (refrainLine ? (refrainLine + '\n') : '') + String(psalmBodyOnly||'').trim();

  // --- Druhé čítanie (ak existuje) ---
  let read2Text = (parsed && parsed.reading2 ? (parsed.reading2||[]).join('\n') : '').trim();

  // ADMIN OVERRIDE – druhé čítanie (keď existuje / alebo ak ho admin doplní)
  try {
    if (ov && ov.read2Text != null) {
      read2Text = String(ov.read2Text||'').trim();
    }
  } catch(e) {}

  // --- Verš / aklamácia pred evanjeliom ---
  const avSrcRaw = (v && v.alleluiaVerse) ? String(v.alleluiaVerse) : '';
  let av = cleanAlleluiaVerse(avSrcRaw || ((parsed && parsed.alleluia) ? (parsed.alleluia||[]).join('\n') : ''));
  try {
    if (ov && ov.verse != null) {
      const vv = String(ov.verse||'').trim();
      if (vv) av = vv;
      if (ov.verse === '') av = ''; // admin zámerne zmaže
    }
  } catch(e) {}

  const alleluiaLabel = _deriveAclamationLabel(parsed && parsed.alleluia, avSrcRaw);

  // ak label nie je "Aleluja" a prvý riadok textu verša je rovnaký ako label, odstráň ho (aby sa neduplikoval)
  try {
    const lbl = String(alleluiaLabel||'').trim();
    if (lbl && lbl.toLowerCase() !== 'aleluja'){
      const avLines = String(av||'').split('\n').map(x=>String(x||'').trim()).filter(Boolean);
      if (avLines.length >= 2 && avLines[0].toLowerCase() === lbl.toLowerCase()){
        av = avLines.slice(1).join('\n').trim();
      }
    }
  } catch(e) {}

  const core = String(alelujaText||'').trim();
  const parts = [];

  // Podľa tvojej požiadavky: ak existuje DRUHÉ čítanie, ukáž ho namiesto žalmu.
  if (read2Text){
    parts.push(`[[LIT-READ2|${encodeURIComponent(read2Text)}]]`);
  } else if (psPayload.trim()){
    parts.push(`[[LIT-PSALM|${encodeURIComponent(psPayload.trim())}]]`);
  }

  parts.push(core);

  if (av){
    const payload = { label: (alleluiaLabel||'').trim(), text: String(av||'').trim() };
    parts.push(`[[LIT-VERSE|${encodeURIComponent(JSON.stringify(payload))}]]`);
  }

  // Ak sa nepodarilo vytiahnuť nič (ani read2/žalm/verš), a sme online, skús si vynútiť refetch do cache.
  if (!read2Text && !psPayload.trim() && !av && navigator.onLine){
    fetchLiturgia(iso).then(d=>{
      if (d && d.ok){
        try{
          if (d.text) d.text = _litStripAdditionalCelebrationsText(d.text);
          if (Array.isArray(d.variants)) d.variants = d.variants.map(x=>({...x, text:_litStripAdditionalCelebrationsText(x && x.text)}));
        }catch(e){}
        setCachedLit(iso, d);
        if (!isAlelujaLitEditing()){
          try { renderSong(); } catch(e) {}
          try { setupAlelujaLitControlsIfNeeded(); } catch(e) {}
        }
      }
    }).catch(()=>{});
  }

  return parts.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
function setupAlelujaLitControlsIfNeeded(){
  if (isAlelujaLitEditing()) return;

  const box = document.getElementById('aleluja-lit-controls');
  if (!box) return;

  const is999 = currentSong && String(currentSong.originalId||"").replace(/^0+/, '') === '999';
  const titleIsAleluja = currentSong && String(currentSong.title||'').trim().toLowerCase() === 'aleluja';
  const isDnes = (currentListSource === 'dnes');

  if (!is999 || !titleIsAleluja || !isDnes){
    box.innerHTML = '';
    box.style.display = 'none';
    return;
  }

  box.style.display = 'block';

  const iso = getIsoDateFromDnesTitleSafe();

  // Liturgia pre daný deň (cache-first). Ak chýba cache, skús načítať online.
  const cached = getCachedLit(iso);
  if (!cached || !cached.ok){
    if (!navigator.onLine){
      box.innerHTML = '<div class="lit-choice-hint">Si offline. Pre tento deň ešte nemáš uložené liturgické čítania – zobrazí sa len text piesne.</div>';
      return;
    }
    box.innerHTML = '<div class="lit-choice-hint">Načítavam liturgiu pre tento deň…</div>';
    fetchLiturgia(iso).then(d=>{
      if (d && d.ok){
        setCachedLit(iso, d);
        if (!isAlelujaLitEditing()){
          try { renderSong(); } catch(e) {}
          try { setupAlelujaLitControlsIfNeeded(); } catch(e) {}
        }
      }
    }).catch(()=>{});
    return;
  }

  const variants = Array.isArray(cached.variants) && cached.variants.length ? cached.variants : [{ label:'', title:'', text: (cached.text||'') }];

  // Použi hlavný variant dňa (féria), bez výberu fakultatívnych čítaní.
  let vidx = 0;
  try{
    vidx = _litPickMainVariantForCalendar(variants);
  }catch(e){ vidx = 0; }
  if (vidx < 0 || vidx >= variants.length) vidx = 0;

  const v = variants[vidx] || variants[0] || { title:'', text:'' };

  // Omše v rámci vybranej varianty (napr. 25.12. – v noci / na úsvite / vo dne)
  const baseText = String((v && v.text) ? v.text : (cached.text||''));
  const masses = _litSplitIntoMasses(baseText);
  let midx = getLitMassChoiceIndex(iso);
  if (midx < 0 || midx >= masses.length){
    midx = 0;
    setLitMassChoiceIndex(iso, 0);
  }

  // UI – výber omše (pre každého; ukladá sa lokálne)
  const showMassSel = masses.length > 1;

  let ui = '';
  if (showMassSel){
    ui += '<div class="lit-choice-card">';
    ui += '<div class="lit-choice-row">';
    ui += '<span class="tiny-label">Omša:</span> ';
    ui += '<select id="aleluja-mass-select">';
    for (let i=0;i<masses.length;i++){
      const mt = String((masses[i] && masses[i].title) ? masses[i].title : (`Omša ${i+1}`)).trim() || (`Omša ${i+1}`);
      ui += `<option value="${i}" ${i===midx?'selected':''}>${escapeHtml(mt)}</option>`;
    }
    ui += '</select>';
    ui += '</div>';
    ui += '<div class="lit-choice-note">Výber sa ukladá len v tomto zariadení.</div>';
    ui += '</div>';
  }

// Admin editor (globálne override) – len ak si prihlásený
  let adminHtml = '';
  if (isAdmin){
    const mass = masses[midx] || masses[0] || { title:'', text: baseText };
    const massText = _litDropOverviewKbs(String(mass.text||''));
    const parsed = _litSplitIntoSections(massText);

    // override pre tento deň + variant + omšu
    const ov = (function(){
      try { return getLitOverride(iso, vidx, midx) || {}; } catch(e){ return {}; }
    })();

    // default žalm
    const psalmFromVar = (v && v.psalmText) ? String(v.psalmText) : '';
    const psalmFromParsed = ((parsed && parsed.psalm) ? (parsed.psalm||[]).join('\n') : '');
    const psalmClean = cleanPsalmText(psalmFromVar || psalmFromParsed || '');

    function extractRefrain(psalmText){
      const plines = String(psalmText||'').split('\n').map(x=>String(x||'').trim()).filter(Boolean);
      const rIdx = plines.findIndex(l => /^R\s*\.?\s*:\s*\S/i.test(l));
      if (rIdx >= 0){
        return plines[rIdx].replace(/^R\s*\.?\s*:\s*/i,'').trim();
      }
      return '';
    }
    function stripPsalmForBody(psalmText){
      let lines = String(psalmText||'').replace(/\r/g,'').split('\n');
      // odstráň hlavičky
      if (lines.length && /^Responzóriový\s+žalm\b/i.test(String(lines[0]||'').trim())) lines.shift();
      // odstráň riadok R.:
      lines = lines.filter(l => !/^R\s*\.?\s*:\s*\S/i.test(String(l||'').trim()));
      return lines.map(x=>String(x||'').trim()).filter(Boolean).join('\n').trim();
    }

    let refrain = String((v && v.psalmRefrain) ? v.psalmRefrain : (parsed && parsed.psalmRefrain) || '').trim();
    if (!refrain) refrain = extractRefrain(psalmClean);
    if (refrain && /\balebo\b/i.test(refrain)) refrain = refrain.split(/\balebo\b/i)[0].trim();
    let psBody = stripPsalmForBody(psalmClean);

    // default druhé čítanie (ak existuje)
    let read2Text = (parsed && parsed.reading2 ? (parsed.reading2||[]).join('\n') : '').trim();

    // default verš (aklamácia)
    const avSrcRaw = (v && v.alleluiaVerse) ? String(v.alleluiaVerse) : '';
    let verse = cleanAlleluiaVerse(avSrcRaw || ((parsed && parsed.alleluia) ? (parsed.alleluia||[]).join('\n') : ''));

    // aplikuj override do UI
    if (ov){
      if (ov.psalmRefrain != null && String(ov.psalmRefrain||'').trim() !== '') refrain = String(ov.psalmRefrain||'').trim();
      if (ov.psalmText != null && String(ov.psalmText||'').trim() !== '') psBody = String(ov.psalmText||'').trim();
      if (ov.read2Text != null) read2Text = String(ov.read2Text||'').trim();
      if (ov.verse != null) verse = String(ov.verse||'').trim();
    }

    const hasRead2 = !!read2Text;

    adminHtml = `
      <div class="lit-admin-card">
        <div class="lit-admin-title">✏️ Úprava vloženého textu (pieseň 999 – Aleluja)</div>
        <div class="lit-admin-sub">Deň <b>${escapeHtml(iso)}</b> • možnosť: <b>${escapeHtml(String((v && v.label) || (v && v.title) || ''))}</b>${(masses.length>1)?(' • omša: <b>'+escapeHtml(String(mass.title||'').trim()||('Omša '+(midx+1)))+'</b>'):''}</div>

        <div class="lit-admin-grid">
          ${hasRead2 ? `
            <label class="lit-admin-label">Text druhého čítania</label>
            <textarea id="lit-ov-read2" class="lit-admin-ta" rows="10" spellcheck="false">${escapeHtml(read2Text||'')}</textarea>
          ` : `
            <label class="lit-admin-label">Refren žalmu</label>
            <textarea id="lit-ov-refrain" class="lit-admin-ta" rows="2" spellcheck="false">${escapeHtml(refrain||'')}</textarea>

            <label class="lit-admin-label">Text žalmu</label>
            <textarea id="lit-ov-psalm" class="lit-admin-ta" rows="8" spellcheck="false">${escapeHtml(psBody||'')}</textarea>
          `}

          <label class="lit-admin-label">Verš / aklamácia pred evanjeliom</label>
          <textarea id="lit-ov-verse" class="lit-admin-ta" rows="4" spellcheck="false">${escapeHtml(verse||'')}</textarea>
        </div>

        <div class="lit-admin-actions">
          <button id="lit-ov-save" class="btn small">Uložiť (pre všetkých)</button>
          <button id="lit-ov-clear" class="btn small ghost">Zmazať override</button>
        </div>
      </div>
    `;
  }

  box.innerHTML = ui + (adminHtml || '');
  // bind mass select (local)
  const selM = document.getElementById('aleluja-mass-select');

  if (selM){
    selM.addEventListener('change', ()=>{
      const idx = parseInt(selM.value,10);
      setLitMassChoiceIndex(iso, isNaN(idx)?0:idx);
      try { renderSong(); } catch(e) {}
      try { setupAlelujaLitControlsIfNeeded(); } catch(e) {}
    });
  }

  // bind admin actions
  if (isAdmin){
    const btnSave = document.getElementById('lit-ov-save');
    const btnClear = document.getElementById('lit-ov-clear');

    if (btnSave){
      btnSave.addEventListener('click', async ()=>{
        try{
          const ov = {};
          const tRead2 = document.getElementById('lit-ov-read2');
          if (tRead2){
            ov.read2Text = String(tRead2.value||'').trim();
          } else {
            const taR = document.getElementById('lit-ov-refrain');
            const taB = document.getElementById('lit-ov-psalm');
            ov.psalmRefrain = taR ? String(taR.value||'').trim() : '';
            ov.psalmText = taB ? String(taB.value||'').trim() : '';
          }
          const taV = document.getElementById('lit-ov-verse');
          ov.verse = taV ? String(taV.value||'').trim() : '';

          setLitOverride(iso, vidx, midx, ov);
          await saveLitOverridesToDrive();
          // znovu vyrenderuj pieseň
          try { renderSong(); } catch(e) {}
        }catch(e){}
      });
    }
    if (btnClear){
      btnClear.addEventListener('click', async ()=>{
        try{
          deleteLitOverride(iso, vidx, midx);
          await saveLitOverridesToDrive();
          try { renderSong(); } catch(e) {}
          try { setupAlelujaLitControlsIfNeeded(); } catch(e) {}
        }catch(e){}
      });
    }
  }
}


