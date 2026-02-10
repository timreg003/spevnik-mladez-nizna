// ===== Spevník GAS backend (v99) =====
// Execute as: Me, Access: Anyone
// Owner login: password only (OWNER_PWD). Other admins: password only (stored hashed by password), owner may label them with a name.
//
// Features:
// - Export XML file: "Spevník export" (root Drive). Compatible with Spevník+.
// - Drive folder "Playlisty" stores app JSON/text files (playlists, PiesneNaDnes, history, overrides, admin db, versions, changes, key history).
// - Export backups visible in Drive folder "Spevník export - backupy" (keep last 5).
// - Song versions (keep last 10) + trash/restore (owner).
// - Changes feed (last 50) for owner.
// - Key history (história tóniny) visible to everyone; owner can delete entries.
// - doPost supported (frontend uses POST for saving).

const OWNER_PWD = "wert";
const OWNER_NAME = "Timotej";

const MAIN_FILE_NAME = "Spevník export";
const FOLDER_NAME = "Playlisty";

const EXPORT_BACKUP_FOLDER = "Spevník export - backupy";
const EXPORT_BACKUP_KEEP = 5;

// Folder files
const ADMINS_FILE = "Admins.json";
const SONG_VERSIONS_FILE = "SongVersions.json";
const SONG_TRASH_FILE = "SongTrash.json";
const SONG_CHANGES_FILE = "SongChanges.json";
const OWNER_SEEN_CHANGES_FILE = "OwnerSeenChanges.json";
const SONG_KEY_HISTORY_FILE = "SongKeyHistory.json";
const LIT_OVERRIDES_FILE = "LiturgiaOverrides.json";

const SONG_VERSION_KEEP = 10;
const SONG_CHANGES_KEEP = 50;

function authorizeExternalRequests() {
  UrlFetchApp.fetch("https://lc.kbs.sk/?den=2026-02-01&offline=", { muteHttpExceptions: true });
}

function doGet(e) { return _handle_(e); }
function doPost(e) { return _handle_(e); }

function _handle_(e){
  const p = _mergeParams_(e);
  const action = p.action ? String(p.action) : "";
  const callback = p.callback ? String(p.callback) : "";

  function out(obj){
    const payload = JSON.stringify(obj);
    if (callback){
      return ContentService.createTextOutput(`${callback}(${payload});`).setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JSON);
  }

  // --- META ---
  if (action === "meta"){
    const folder = _getOrCreateFolder_();
    const exportFile = _newestFileByNameRoot_(MAIN_FILE_NAME);
    const dnesFile = _newestFileByNameInFolder_("PiesneNaDnes", folder);
    const orderFile = _newestFileByNameInFolder_("PlaylistOrder", folder);

    // history file names may vary
    const histCandidates = ["HistoryLog","History","Historia","PiesneNaDnesHistory","PiesneNaDnesHistoria"];
    let historyM = 0;
    for (const n of histCandidates){
      historyM = Math.max(historyM, _safeMtime_(_newestFileByNameInFolder_(n, folder)));
    }

    return out({ ok:true, meta:{
      export: _safeMtime_(exportFile),
      dnes: _safeMtime_(dnesFile),
      order: _safeMtime_(orderFile),
      history: historyM
    }});
  }

  // --- DIAG ---
  if (action === "diag"){
    const f = _newestFileByNameRoot_(MAIN_FILE_NAME);
    if (!f) return out({ ok:true, exportFound:false, exportName: MAIN_FILE_NAME });

    let parsedOk = true, rootName = "", ns = "";
    try{
      const txt = f.getBlob().getDataAsString("UTF-8");
      const doc = XmlService.parse(txt);
      const r = doc.getRootElement();
      rootName = r.getName();
      ns = (r.getNamespace() && r.getNamespace().getURI()) ? r.getNamespace().getURI() : "";
    }catch(e){ parsedOk = false; }

    return out({ ok:true, exportFound:true, exportName: f.getName(), exportMtime: f.getLastUpdated().getTime(), exportSize: f.getSize(), parsedOk, rootName, ns });
  }

  // --- AUTH ---
  if (action === "auth" || action === "adminAuth"){
    const sess = _sessionFromPwd_(String(p.pwd || ""));
    if (!sess) return out({ ok:false, error:"unauthorized" });
    return out({ ok:true, session:{
      pwd:String(p.pwd||""),
      isOwner:!!sess.isOwner,
      owner:!!sess.isOwner,
      perms:sess.perms,
      name:sess.name
    }});
  }

  // --- Generic folder LIST ---
  if (action === "list"){
    const folder = _getOrCreateFolder_();
    const files = folder.getFiles();
    const list = [];
    while (files.hasNext()){
      const f = files.next();
      if (f.isTrashed()) continue;
      try{
        const c = f.getBlob().getDataAsString();
        if (_isDeletedMarker_(c)) continue;
      }catch(e){}
      list.push({ name: f.getName() });
    }
    return out({ ok:true, list });
  }

  // --- Generic folder GET ---
  if (action === "get"){
    const name = String(p.name || "");
    if (!name) return out({ ok:false, error:"missing_name", text:"" });
    const folder = _getOrCreateFolder_();
    const f = _newestFileByNameInFolder_(name, folder);
    if (!f) return out({ ok:false, error:"not_found", text:"" });
    const txt = f.getBlob().getDataAsString("UTF-8");
    if (_isDeletedMarker_(txt)) return out({ ok:false, error:"deleted", text:"" });
    return out({ ok:true, text: txt });
  }

  // --- Generic folder SAVE ---
  if (action === "save"){
    const sess = _sessionFromPwd_(String(p.pwd || ""));
    if (!sess) return out({ ok:false, error:"unauthorized" });

    const name = String(p.name || "");
    const content = String(p.content || "");
    if (!name) return out({ ok:false, error:"missing_name" });

    // non-owner restriction: A can edit PiesneNaDnes/history, B can edit playlists/order
    if (!sess.isOwner){
      const low = name.toLowerCase();
      const system = [ADMINS_FILE, SONG_VERSIONS_FILE, SONG_TRASH_FILE, SONG_CHANGES_FILE, OWNER_SEEN_CHANGES_FILE, SONG_KEY_HISTORY_FILE, LIT_OVERRIDES_FILE].map(x=>x.toLowerCase());
      if (system.includes(low) || low === MAIN_FILE_NAME.toLowerCase()) return out({ ok:false, error:"unauthorized" });

      const isDnes = (low === "piesnenadnes");
      const isOrder = (low === "playlistorder");
      const isHist = ["historylog","history","historia","piesnenadneshistory","piesnenadneshistoria"].includes(low);
      const isPlaylist = !(isDnes || isOrder || isHist);

      if ((isDnes || isHist) && !sess.perms.A) return out({ ok:false, error:"unauthorized" });
      if ((isPlaylist || isOrder) && !sess.perms.B) return out({ ok:false, error:"unauthorized" });
    }

    const folder = _getOrCreateFolder_();
    _replaceFileInFolder_(folder, name, content);
    return out({ ok:true });
  }

  // --- Generic folder DELETE ---
  if (action === "delete"){
    const sess = _sessionFromPwd_(String(p.pwd || ""));
    if (!sess) return out({ ok:false, error:"unauthorized" });

    const name = String(p.name || "");
    if (!name) return out({ ok:false, error:"missing_name" });

    if (!sess.isOwner){
      const low = name.toLowerCase();
      const system = [ADMINS_FILE, SONG_VERSIONS_FILE, SONG_TRASH_FILE, SONG_CHANGES_FILE, OWNER_SEEN_CHANGES_FILE, SONG_KEY_HISTORY_FILE, LIT_OVERRIDES_FILE].map(x=>x.toLowerCase());
      if (system.includes(low) || low === MAIN_FILE_NAME.toLowerCase()) return out({ ok:false, error:"unauthorized" });

      const isDnes = (low === "piesnenadnes");
      const isOrder = (low === "playlistorder");
      const isHist = ["historylog","history","historia","piesnenadneshistory","piesnenadneshistoria"].includes(low);
      const isPlaylist = !(isDnes || isOrder || isHist);

      if ((isDnes || isHist) && !sess.perms.A) return out({ ok:false, error:"unauthorized" });
      if ((isPlaylist || isOrder) && !sess.perms.B) return out({ ok:false, error:"unauthorized" });
    }

    const folder = _getOrCreateFolder_();
    _replaceFileInFolder_(folder, name, "deleted");
    return out({ ok:true });
  }

  // --- ADMINS (owner only) ---
  if (action === "adminList" || action === "adminsGet"){
    if (!_isOwnerPwd_(String(p.pwd||""))) return out({ ok:false, error:"unauthorized" });
    const folder = _getOrCreateFolder_();
    const db = _readJsonFileInFolder_(folder, ADMINS_FILE) || { admins:{} };
    const list = [];
    for (const id in (db.admins||{})){
      const a = db.admins[id] || {};
      list.push({ id, pwd:String(a.pwd||""), name:String(a.name||""), perms:a.perms||{A:false,B:false,C:false,D:false,E:false} });
    }
    list.sort((x,y)=>(x.name||"").localeCompare(y.name||"", "sk"));
    return out({ ok:true, list });
  }

  if (action === "adminUpsert" || action === "adminsUpsert"){
    if (!_isOwnerPwd_(String(p.pwd||""))) return out({ ok:false, error:"unauthorized" });
    const payload = String(p.payload||"");
    let obj;
    try{ obj = JSON.parse(payload); }catch(e){ return out({ ok:false, error:"bad_payload_json" }); }

    const newPwd = String(obj.pwd||"").trim();
    if (!newPwd) return out({ ok:false, error:"missing_admin_pwd" });

    const newId = _sha256Hex_(newPwd);
    const folder = _getOrCreateFolder_();
    const db = _readJsonFileInFolder_(folder, ADMINS_FILE) || { admins:{} };
    if (!db.admins) db.admins = {};

    const incomingId = String(obj.id||"").trim();
    if (incomingId && incomingId !== newId){
      if (db.admins[incomingId]) delete db.admins[incomingId];
    }

    db.admins[newId] = {
      pwd: newPwd, // owner wants plaintext visible
      name: String(obj.name||""),
      perms: obj.perms || {A:false,B:false,C:false,D:false,E:false}
    };

    _writeJsonFileInFolder_(folder, ADMINS_FILE, db);
    return out({ ok:true, id:newId });
  }

  if (action === "adminDelete" || action === "adminsDelete"){
    if (!_isOwnerPwd_(String(p.pwd||""))) return out({ ok:false, error:"unauthorized" });
    const id = String(p.id||"");
    if (!id) return out({ ok:false, error:"missing_id" });
    const folder = _getOrCreateFolder_();
    const db = _readJsonFileInFolder_(folder, ADMINS_FILE) || { admins:{} };
    if (db.admins && db.admins[id]) delete db.admins[id];
    _writeJsonFileInFolder_(folder, ADMINS_FILE, db);
    return out({ ok:true });
  }

  // --- SONG SAVE (D/E) ---
  if (action === "songSave"){
    const sess = _requirePerm_(String(p.pwd||""), ["D","E"]);
    if (!sess) return out({ ok:false, error:"unauthorized" });

    const payload = String(p.payload||"");
    if (!payload) return out({ ok:false, error:"missing_payload" });
    let obj;
    try{ obj = JSON.parse(payload); }catch(e){ return out({ ok:false, error:"bad_payload_json" }); }

    const id = String(obj.id||"").trim();
    const num = String(obj.author||"").trim();
    const title = String(obj.title||"").trim();
    const songtext = (obj.songtext != null) ? String(obj.songtext) : "";
    const mode = String(obj.mode||""); // D/E
    const transposeStep = (obj.transposeStep != null) ? Number(obj.transposeStep) : null;

    if (!id || !num || !title) return out({ ok:false, error:"missing_fields" });

    const exportFile = _newestFileByNameRoot_(MAIN_FILE_NAME);
    if (!exportFile) return out({ ok:false, error:"missing_export_file" });

    const xmlText = exportFile.getBlob().getDataAsString("UTF-8");
    let doc;
    try{ doc = XmlService.parse(xmlText); }catch(e){ return out({ ok:false, error:"export_parse_failed", detail:String(e) }); }

    const root = doc.getRootElement();
    const ns = root.getNamespace();
    if (root.getName() !== "InetSongDb") return out({ ok:false, error:"bad_export_root", detail:root.getName() });

    const who = sess.isOwner ? OWNER_NAME : sess.name;

    // find song
    const songs = root.getChildren("song", ns);
    let songEl = null;
    for (let i=0;i<songs.length;i++){
      const sid = _getChildText_(songs[i], ns, "ID");
      if (String(sid) === id){ songEl = songs[i]; break; }
    }

    let existed = false;
    let oldPlain = null;

    if (songEl){
      existed = true;
      oldPlain = _songToPlain_(songEl, ns);

      // save version before change
      _saveSongVersion_(id, oldPlain, who);

      // D guard (server-side): allow chord changes only when transposeStep provided
      const isE = !!sess.perms.E;
      const isD = !!sess.perms.D && !isE;
      if (isD && mode === "D"){
        const oldCh = _extractChords_(String(oldPlain.songtext||""));
        const newCh = _extractChords_(songtext);
        if (oldCh !== newCh){
          if (!(transposeStep != null && isFinite(transposeStep) && Math.abs(transposeStep) <= 11)){
            return out({ ok:false, error:"chords_changed_in_D" });
          }
        }
      }

      // apply
      _setChildCdata_(songEl, ns, "author", num);
      _setChildCdata_(songEl, ns, "title", title);
      _setChildCdata_(songEl, ns, "songtext", songtext);

    }else{
      // create new
      songEl = XmlService.createElement("song", ns);
      const tags = ["ID","lang","songtext","author","authorId","groupname","title","youtube","step"];
      for (const t of tags) songEl.addContent(XmlService.createElement(t, ns));
      _setChildCdata_(songEl, ns, "ID", id);
      _setChildCdata_(songEl, ns, "lang", "sk");
      _setChildCdata_(songEl, ns, "songtext", songtext);
      _setChildCdata_(songEl, ns, "author", num);
      _setChildCdata_(songEl, ns, "authorId", "");
      _setChildCdata_(songEl, ns, "groupname", "");
      _setChildCdata_(songEl, ns, "title", title);
      _setChildCdata_(songEl, ns, "youtube", "");
      _setChildCdata_(songEl, ns, "step", "");
      root.addContent(songEl);
      existed = false;
    }

    // publish
    const newXml = XmlService.getPrettyFormat().format(doc);
    _publishExport_(newXml);

    // key history + changes feed
    try{
      const newKey = _firstChordRoot_(songtext);
      const oldKey = oldPlain ? _firstChordRoot_(String(oldPlain.songtext||"")) : "";
      _maybeAppendKeyHistory_(id, oldKey, newKey, who, existed);
      _appendChanges_(id, num, title, who, { existed, oldPlain, newPlain:{id,num,title,songtext}, transposeStep });
    }catch(e){}

    return out({ ok:true });
  }

  // --- SONG VERSIONS (owner) ---
  if (action === "songVersions"){
    if (!_isOwnerPwd_(String(p.pwd||""))) return out({ ok:false, error:"unauthorized" });
    const id = String(p.id||"");
    if (!id) return out({ ok:false, error:"missing_id" });
    const folder = _getOrCreateFolder_();
    const db = _readJsonFileInFolder_(folder, SONG_VERSIONS_FILE) || { versions:{} };
    const versions = (db.versions && db.versions[id]) ? db.versions[id] : [];
    return out({ ok:true, id, versions });
  }

  // --- KEY HISTORY GET (public) ---
  if (action === "keyHistoryGet"){
    const id = String(p.id||p.songId||"");
    if (!id) return out({ ok:false, error:"missing_id" });
    const folder = _getOrCreateFolder_();
    const db = _readJsonFileInFolder_(folder, SONG_KEY_HISTORY_FILE) || { keys:{} };
    const list = (db.keys && db.keys[id]) ? db.keys[id] : [];
    return out({ ok:true, id, list });
  }

  // --- KEY HISTORY DELETE (owner) ---
  if (action === "keyHistoryDelete"){
    if (!_isOwnerPwd_(String(p.pwd||""))) return out({ ok:false, error:"unauthorized" });
    const id = String(p.id||p.songId||"");
    const ts = String(p.ts||"");
    if (!id) return out({ ok:false, error:"missing_id" });

    const folder = _getOrCreateFolder_();
    const db = _readJsonFileInFolder_(folder, SONG_KEY_HISTORY_FILE) || { keys:{} };
    const arr = (db.keys && db.keys[id]) ? db.keys[id] : [];
    db.keys[id] = arr.filter(x => String(x.ts) !== ts);
    _writeJsonFileInFolder_(folder, SONG_KEY_HISTORY_FILE, db);
    return out({ ok:true });
  }

  if (action === "keyHistoryClear"){
    if (!_isOwnerPwd_(String(p.pwd||""))) return out({ ok:false, error:"unauthorized" });
    const id = String(p.id||p.songId||"");
    if (!id) return out({ ok:false, error:"missing_id" });
    const folder = _getOrCreateFolder_();
    const db = _readJsonFileInFolder_(folder, SONG_KEY_HISTORY_FILE) || { keys:{} };
    db.keys[id] = [];
    _writeJsonFileInFolder_(folder, SONG_KEY_HISTORY_FILE, db);
    return out({ ok:true });
  }

  // --- CHANGES GET (owner) ---
  if (action === "changesGet"){
    if (!_isOwnerPwd_(String(p.pwd||""))) return out({ ok:false, error:"unauthorized" });
    const folder = _getOrCreateFolder_();
    const db = _readJsonFileInFolder_(folder, SONG_CHANGES_FILE) || { list:[] };
    return out({ ok:true, list: db.list || [] });
  }

  if (action === "changesSeenGet"){
    if (!_isOwnerPwd_(String(p.pwd||""))) return out({ ok:false, error:"unauthorized" });
    const folder = _getOrCreateFolder_();
    const db = _readJsonFileInFolder_(folder, OWNER_SEEN_CHANGES_FILE) || { seen:{} };
    return out({ ok:true, seen: db.seen || {} });
  }

  if (action === "changesSeenSet"){
    if (!_isOwnerPwd_(String(p.pwd||""))) return out({ ok:false, error:"unauthorized" });
    const payload = String(p.payload||"");
    let obj;
    try{ obj = JSON.parse(payload); }catch(e){ return out({ ok:false, error:"bad_payload_json" }); }
    const ids = Array.isArray(obj.ids) ? obj.ids.map(String) : [];
    const seenVal = (obj.seen != null) ? !!obj.seen : true;
    const folder = _getOrCreateFolder_();
    const db = _readJsonFileInFolder_(folder, OWNER_SEEN_CHANGES_FILE) || { seen:{} };
    if (!db.seen) db.seen = {};
    for (const id of ids) db.seen[id] = seenVal;
    _writeJsonFileInFolder_(folder, OWNER_SEEN_CHANGES_FILE, db);
    return out({ ok:true });
  }

  // --- LITURGIA FETCH ---
  if (action === "liturgia"){
    const den = String(p.den||"");
    if (!den || !/^\d{4}-\d{2}-\d{2}$/.test(den)) return out({ ok:false, error:"bad_date" });

    const url = "https://lc.kbs.sk/?den=" + encodeURIComponent(den) + "&offline=";
    try{
      const resp = UrlFetchApp.fetch(url, {
        muteHttpExceptions:true,
        followRedirects:true,
        headers:{
          "User-Agent":"Mozilla/5.0 (Spevnik; GAS)",
          "Accept-Language":"sk-SK,sk;q=0.9,en;q=0.8",
          "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      });
      const code = resp.getResponseCode();
      const html = resp.getContentText() || "";
      if (code < 200 || code >= 300 || !html) return out({ ok:false, error:"http_"+code });
      const text = _htmlToText_(html);
      return out({ ok:true, den, text, variants:[{ label:"Féria", title:"", text }] });
    }catch(err){
      return out({ ok:false, error:"fetch_failed", detail:String(err) });
    }
  }

  // --- LIT OVERRIDES ---
  if (action === "litOverrideGet"){
    const folder = _getOrCreateFolder_();
    const data = _readJsonFileInFolder_(folder, LIT_OVERRIDES_FILE) || { overrides:{} };
    return out({ ok:true, data });
  }

  if (action === "litOverrideSave"){
    const sess = _requirePerm_(String(p.pwd||""), ["C"]);
    if (!sess) return out({ ok:false, error:"unauthorized" });

    const key = String(p.key||"");
    const payload = String(p.payload||"");
    if (!key || !payload) return out({ ok:false, error:"missing_key_or_payload" });

    let obj;
    try{ obj = JSON.parse(payload); }catch(e){ return out({ ok:false, error:"bad_payload_json" }); }

    const folder = _getOrCreateFolder_();
    const data = _readJsonFileInFolder_(folder, LIT_OVERRIDES_FILE) || { overrides:{} };
    data.overrides[key] = obj;
    _writeJsonFileInFolder_(folder, LIT_OVERRIDES_FILE, data);
    return out({ ok:true });
  }

  if (action === "litOverrideDelete"){
    const sess = _requirePerm_(String(p.pwd||""), ["C"]);
    if (!sess) return out({ ok:false, error:"unauthorized" });

    const key = String(p.key||"");
    if (!key) return out({ ok:false, error:"missing_key" });

    const folder = _getOrCreateFolder_();
    const data = _readJsonFileInFolder_(folder, LIT_OVERRIDES_FILE) || { overrides:{} };
    if (data.overrides && data.overrides[key]) delete data.overrides[key];
    _writeJsonFileInFolder_(folder, LIT_OVERRIDES_FILE, data);
    return out({ ok:true });
  }

  // --- DEFAULT: return export XML ---
  const newest = _newestFileByNameRoot_(MAIN_FILE_NAME);
  const xml = newest ? newest.getBlob().getDataAsString("UTF-8") : "";
  _keepOnlyNewestRootExport_();

  if (callback) return out({ ok:true, xml });
  return ContentService.createTextOutput(xml).setMimeType(ContentService.MimeType.XML);
}

// ================= Helpers =================

function _mergeParams_(e){
  const p = {};
  const ep = (e && e.parameter) ? e.parameter : {};
  Object.keys(ep).forEach(k => p[k] = ep[k]);

  try{
    if (e && e.postData && e.postData.contents){
      const body = String(e.postData.contents || "");
      if (body){
        // JSON
        try{
          const obj = JSON.parse(body);
          if (obj && typeof obj === 'object'){
            Object.keys(obj).forEach(k => { if (p[k] == null) p[k] = obj[k]; });
            return p;
          }
        }catch(_){ }

        // x-www-form-urlencoded
        if (body.includes('=')){
          body.split('&').forEach(pair => {
            const idx = pair.indexOf('=');
            if (idx < 0) return;
            const k = decodeURIComponent(pair.slice(0, idx));
            const v = decodeURIComponent(pair.slice(idx+1));
            if (p[k] == null) p[k] = v;
          });
        }
      }
    }
  }catch(e2){}

  return p;
}

function _sha256Hex_(s){
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s||""), Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

function _isDeletedMarker_(s){ return typeof s === 'string' && s.trim() === 'deleted'; }

function _getOrCreateFolder_(){
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function _newestFileByNameInFolder_(name, folder){
  const it = folder.getFilesByName(name);
  let newest = null;
  while (it.hasNext()){
    const f = it.next();
    if (f.isTrashed()) continue;
    if (!newest || f.getLastUpdated().getTime() > newest.getLastUpdated().getTime()) newest = f;
  }
  return newest;
}

function _newestFileByNameRoot_(name){
  const it = DriveApp.getFilesByName(name);
  let newest = null;
  while (it.hasNext()){
    const f = it.next();
    if (f.isTrashed()) continue;
    if (!newest || f.getLastUpdated().getTime() > newest.getLastUpdated().getTime()) newest = f;
  }
  return newest;
}

function _safeMtime_(file){
  if (!file) return 0;
  try{
    const c = file.getBlob().getDataAsString();
    if (_isDeletedMarker_(c)) return 0;
  }catch(e){}
  return file.getLastUpdated().getTime();
}

function _readJsonFileInFolder_(folder, name){
  const f = _newestFileByNameInFolder_(name, folder);
  if (!f) return null;
  const txt = f.getBlob().getDataAsString('UTF-8');
  if (!txt || _isDeletedMarker_(txt)) return null;
  try{ return JSON.parse(txt); }catch(e){ return null; }
}

function _writeJsonFileInFolder_(folder, name, obj){
  const old = folder.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);
  folder.createFile(name, JSON.stringify(obj, null, 2), MimeType.PLAIN_TEXT);
}

function _replaceFileInFolder_(folder, name, content){
  const old = folder.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);
  folder.createFile(name, String(content||""), MimeType.PLAIN_TEXT);
}

function _keepOnlyNewestRootExport_(){
  const arr = [];
  const it = DriveApp.getFilesByName(MAIN_FILE_NAME);
  while (it.hasNext()){
    const f = it.next();
    if (!f.isTrashed()) arr.push(f);
  }
  arr.sort((a,b)=>b.getLastUpdated().getTime()-a.getLastUpdated().getTime());
  for (let i=1;i<arr.length;i++){
    try{ arr[i].setTrashed(true); }catch(e){}
  }
}

function _ensureBackupFolder_(){
  const it = DriveApp.getFoldersByName(EXPORT_BACKUP_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(EXPORT_BACKUP_FOLDER);
}

function _rotateBackups_(folder){
  const arr = [];
  const it = folder.getFiles();
  while (it.hasNext()){
    const f = it.next();
    if (!f.isTrashed()) arr.push(f);
  }
  arr.sort((a,b)=>b.getLastUpdated().getTime()-a.getLastUpdated().getTime());
  for (let i=EXPORT_BACKUP_KEEP;i<arr.length;i++){
    try{ arr[i].setTrashed(true); }catch(e){}
  }
}

function _backupExport_(xmlText){
  try{
    const folder = _ensureBackupFolder_();
    const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm-ss');
    // IMPORTANT: DriveApp MimeType.XML is NOT valid -> store as plain text
    folder.createFile(MAIN_FILE_NAME + ' ' + ts, xmlText, MimeType.PLAIN_TEXT);
    _rotateBackups_(folder);
  }catch(e){}
}

function _publishExport_(xmlText){
  _backupExport_(xmlText);
  DriveApp.createFile(MAIN_FILE_NAME, xmlText, MimeType.PLAIN_TEXT);
  _keepOnlyNewestRootExport_();
}

function _isOwnerPwd_(pwd){ return String(pwd||"") === OWNER_PWD; }

function _sessionFromPwd_(pwd){
  const pass = String(pwd||"");
  if (!pass) return null;
  if (pass === OWNER_PWD){
    return { isOwner:true, name:OWNER_NAME, perms:{A:true,B:true,C:true,D:true,E:true} };
  }
  const folder = _getOrCreateFolder_();
  const db = _readJsonFileInFolder_(folder, ADMINS_FILE) || { admins:{} };
  const hash = _sha256Hex_(pass);
  const a = (db.admins && db.admins[hash]) ? db.admins[hash] : null;
  if (!a) return null;
  const pr = a.perms || {};
  return { isOwner:false, name:String(a.name||"Admin"), perms:{A:!!pr.A,B:!!pr.B,C:!!pr.C,D:!!pr.D,E:!!pr.E} };
}

function _requirePerm_(pwd, list){
  const sess = _sessionFromPwd_(pwd);
  if (!sess) return null;
  if (sess.isOwner) return sess;
  for (const c of list){
    if (sess.perms && sess.perms[c]) return sess;
  }
  return null;
}

function _getChildText_(el, ns, tag){
  const c = el.getChild(tag, ns);
  return c ? c.getText() : "";
}

function _songToPlain_(songEl, ns){
  const tags = ["ID","lang","songtext","author","authorId","groupname","title","youtube","step"];
  const o = {};
  tags.forEach(t => o[t] = _getChildText_(songEl, ns, t));
  return o;
}

function _setChildCdata_(songEl, ns, tag, value){
  let el = songEl.getChild(tag, ns);
  if (!el){
    el = XmlService.createElement(tag, ns);
    songEl.addContent(el);
  }
  el.removeContent();
  el.addContent(XmlService.createCdata(String(value||"")));
}

function _saveSongVersion_(id, plainSong, who){
  const folder = _getOrCreateFolder_();
  const db = _readJsonFileInFolder_(folder, SONG_VERSIONS_FILE) || { versions:{} };
  if (!db.versions) db.versions = {};
  if (!db.versions[id]) db.versions[id] = [];
  db.versions[id].unshift({ ts: Date.now(), who, song: plainSong });
  while (db.versions[id].length > SONG_VERSION_KEEP) db.versions[id].pop();
  _writeJsonFileInFolder_(folder, SONG_VERSIONS_FILE, db);
}

function _extractChords_(txt){
  const m = String(txt||"").match(/\[[^\]]*\]/g) || [];
  return m.join('|');
}

function _normalizeToSharps_(note){
  const n = String(note||"").toUpperCase();
  const map = { "DB":"C#","EB":"D#","GB":"F#","AB":"G#","BB":"A#","CB":"B","FB":"E" };
  return map[n] || n;
}

function _firstChordRoot_(txt){
  const m = String(txt||"").match(/\[([^\]]+)\]/);
  if (!m) return "";
  const chord = String(m[1]||"").trim();
  if (!chord) return "";
  const mm = chord.match(/^([A-G])([#b]?)/i);
  if (!mm) return "";
  return _normalizeToSharps_((mm[1]||"").toUpperCase() + (mm[2]||""));
}

function _maybeAppendKeyHistory_(songId, oldKey, newKey, who, existed){
  newKey = String(newKey||"");
  oldKey = String(oldKey||"");
  if (!newKey) return;

  // B: always check on save and write only if changed or new
  const should = (!existed) || (oldKey && oldKey !== newKey);
  if (!should) return;

  const folder = _getOrCreateFolder_();
  const db = _readJsonFileInFolder_(folder, SONG_KEY_HISTORY_FILE) || { keys:{} };
  if (!db.keys) db.keys = {};
  if (!db.keys[songId]) db.keys[songId] = [];

  db.keys[songId].push({ ts: Date.now(), who, from: existed ? oldKey : "", to: newKey });
  _writeJsonFileInFolder_(folder, SONG_KEY_HISTORY_FILE, db);
}

function _appendChanges_(songId, num, title, who, ctx){
  const existed = !!ctx.existed;
  const oldPlain = ctx.oldPlain;
  const newPlain = ctx.newPlain;
  const transposeStep = ctx.transposeStep;

  const types = [];
  if (!existed) types.push('new');
  if (existed && oldPlain){
    if (String(oldPlain.title||"") !== String(title||"")) types.push('title');
    if (String(oldPlain.author||"") !== String(num||"")) types.push('number');

    // text compare without chords
    const oldNoCh = String(oldPlain.songtext||"").replace(/\[[^\]]*\]/g, '');
    const newNoCh = String(newPlain.songtext||"").replace(/\[[^\]]*\]/g, '');
    if (oldNoCh !== newNoCh) types.push('text');

    const oldCh = _extractChords_(oldPlain.songtext||"");
    const newCh = _extractChords_(newPlain.songtext||"");
    if (oldCh !== newCh){
      if (transposeStep != null && isFinite(transposeStep)) types.push('transpose');
      else types.push('chords');
    }
  }

  // key change
  const oldKey = oldPlain ? _firstChordRoot_(String(oldPlain.songtext||"")) : "";
  const newKey = _firstChordRoot_(String(newPlain.songtext||""));
  if (newKey && (oldKey !== newKey)) types.push('key');

  if (!types.length) return;

  const folder = _getOrCreateFolder_();
  const db = _readJsonFileInFolder_(folder, SONG_CHANGES_FILE) || { list:[] };
  if (!Array.isArray(db.list)) db.list = [];

  const id = String(Date.now()) + '_' + String(songId);
  db.list.unshift({
    id,
    ts: Date.now(),
    who,
    songId,
    number: String(num||""),
    title: String(title||""),
    types,
    titleFrom: oldPlain ? String(oldPlain.title||"") : "",
    titleTo: String(title||""),
    numberFrom: oldPlain ? String(oldPlain.author||"") : "",
    numberTo: String(num||""),
    keyFrom: oldKey,
    keyTo: newKey
  });

  while (db.list.length > SONG_CHANGES_KEEP) db.list.pop();
  _writeJsonFileInFolder_(folder, SONG_CHANGES_FILE, db);
}

function _htmlToText_(html){
  if (!html) return "";
  let t = String(html);
  t = t.replace(/<script[\s\S]*?<\/script>/gi, "\n");
  t = t.replace(/<style[\s\S]*?<\/style>/gi, "\n");
  t = t.replace(/<br\s*\/?>(?=\s*)/gi, "\n");
  t = t.replace(/<\/(p|div|li|tr|h1|h2|h3|h4|h5|h6)>/gi, "\n");
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(/&nbsp;/g, " ");
  t = t.replace(/&amp;/g, "&");
  t = t.replace(/&quot;/g, '"');
  t = t.replace(/&#39;/g, "'");
  t = t.replace(/&lt;/g, "<");
  t = t.replace(/&gt;/g, ">");
  t = t.replace(/[ \t]+/g, " ");
  t = t.replace(/\n[ \t]+/g, "\n");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}
