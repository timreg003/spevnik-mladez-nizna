const OWNER_PWD = "wert";
const OWNER_NAME = "Timotej";

const MAIN_FILE_NAME = "Spevník export"; // XML in Drive root
const FOLDER_NAME = "Playlisty";         // Drive folder for auxiliary files

// Internal json files in folder
const ADMINS_FILE = "Admins.json";
const SONG_VERS_FILE = "SongVersion.json";       // keep last 10 versions per song
const KEY_HIST_FILE = "KeyHistory.json";         // key change history per song
const CHANGES_FILE = "Changes.json";             // last 50 changes feed
const HISTORY_FILE = "HistoryLog";               // history of 'Piesne na dnes'
const LIT_OVERRIDES_FILE = "LiturgiaOverrides.json";

function authorizeExternalRequests() {
  UrlFetchApp.fetch("https://lc.kbs.sk/?den=2026-02-01&offline=", { muteHttpExceptions: true });
}

function doGet(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  const action = p.action ? String(p.action) : "";
  const callback = p.callback ? String(p.callback) : "";

  function out(obj) {
    const payload = JSON.stringify(obj);
    if (callback) {
      return ContentService
        .createTextOutput(`${callback}(${payload});`)
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService
      .createTextOutput(payload)
      .setMimeType(ContentService.MimeType.JSON);
  }

  function getOrCreateFolder() {
    const it = DriveApp.getFoldersByName(FOLDER_NAME);
    return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
  }

  function isDeletedMarker(s) {
    return typeof s === "string" && s.trim() === "deleted";
  }

  function newestFileByNameInFolder(name, folder) {
    const files = folder.getFilesByName(name);
    let newest = null;
    while (files.hasNext()) {
      const f = files.next();
      if (f.isTrashed()) continue;
      if (!newest || f.getLastUpdated().getTime() > newest.getLastUpdated().getTime()) newest = f;
    }
    return newest;
  }

  function newestFileByNameRoot(name) {
    const files = DriveApp.getFilesByName(name);
    let newest = null;
    while (files.hasNext()) {
      const f = files.next();
      if (f.isTrashed()) continue;
      if (!newest || f.getLastUpdated().getTime() > newest.getLastUpdated().getTime()) newest = f;
    }
    return newest;
  }

  function safeMtime(file) {
    if (!file) return 0;
    try {
      const content = file.getBlob().getDataAsString();
      if (isDeletedMarker(content)) return 0;
    } catch (err) {}
    return file.getLastUpdated().getTime();
  }

  function readTextFileInFolder(folder, filename) {
    const f = newestFileByNameInFolder(filename, folder);
    if (!f) return "";
    const txt = f.getBlob().getDataAsString("UTF-8");
    if (!txt || isDeletedMarker(txt)) return "";
    return txt;
  }

  function readJsonFileInFolder(folder, filename, fallback) {
    const txt = readTextFileInFolder(folder, filename);
    if (!txt) return fallback;
    try { return JSON.parse(txt); } catch (e) { return fallback; }
  }

  function writeTextFileInFolder(folder, filename, content) {
    const old = folder.getFilesByName(filename);
    while (old.hasNext()) old.next().setTrashed(true);
    folder.createFile(filename, String(content || ""), MimeType.PLAIN_TEXT);
  }

  function writeJsonFileInFolder(folder, filename, obj) {
    writeTextFileInFolder(folder, filename, JSON.stringify(obj, null, 2));
  }

  function escapeRegExp(s){
    return String(s||"").replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
  }

  // ===== AUTH / ADMINS =====

  function loadAdmins(folder){
    const data = readJsonFileInFolder(folder, ADMINS_FILE, { list: [] });
    const list = Array.isArray(data.list) ? data.list : [];
    return { list: list.map(a => ({
      id: String(a.id || ""),
      pwd: String(a.pwd || ""),
      name: String(a.name || ""),
      perms: a.perms || {}
    })) };
  }

  function saveAdmins(folder, admins){
    writeJsonFileInFolder(folder, ADMINS_FILE, admins);
  }

  function sessionFromPwd(pwd, folder){
    const pw = String(pwd||"");
    if (pw === OWNER_PWD) {
      return {
        pwd: pw,
        isOwner: true,
        owner: true,
        perms: { A:true, B:true, C:true, D:true, E:true },
        name: OWNER_NAME
      };
    }
    const admins = loadAdmins(folder).list;
    for (let i=0;i<admins.length;i++){
      if (String(admins[i].pwd||"") === pw) {
        return {
          pwd: pw,
          isOwner: false,
          owner: false,
          perms: admins[i].perms || {},
          name: admins[i].name || "Admin"
        };
      }
    }
    return null;
  }

  function requireSession(){
    const folder = getOrCreateFolder();
    const s = sessionFromPwd(p.pwd ? String(p.pwd) : "", folder);
    return { folder, session: s };
  }

  function hasPerm(sess, key){
    if (!sess) return false;
    if (sess.isOwner) return true;
    return !!(sess.perms && sess.perms[key]);
  }

  // ===== META =====
  if (action === "meta") {
    const folder = getOrCreateFolder();
    const exportFile = newestFileByNameRoot(MAIN_FILE_NAME);
    const dnesFile = newestFileByNameInFolder("PiesneNaDnes", folder);
    const orderFile = newestFileByNameInFolder("PlaylistOrder", folder);
    const histFile = newestFileByNameInFolder(HISTORY_FILE, folder);
    const changesFile = newestFileByNameInFolder(CHANGES_FILE, folder);

    return out({
      ok: true,
      meta: {
        export: safeMtime(exportFile),
        dnes: safeMtime(dnesFile),
        order: safeMtime(orderFile),
        history: safeMtime(histFile),
        changes: safeMtime(changesFile)
      }
    });
  }

  // ===== AUTH =====
  if (action === "auth") {
    const folder = getOrCreateFolder();
    const pwd = p.pwd ? String(p.pwd) : "";
    const sess = sessionFromPwd(pwd, folder);
    if (!sess) return out({ ok:false, error:"bad_pwd" });
    return out({ ok:true, session: sess });
  }

  // ===== ADMINS: LIST (owner only) =====
  if (action === "adminsList") {
    const { folder, session } = requireSession();
    if (!session || !session.isOwner) return out({ ok:false, error:"unauthorized" });
    const data = loadAdmins(folder);
    return out({ ok:true, list: data.list.map(a => ({ id:a.id, pwd:a.pwd, name:a.name, perms:a.perms })) });
  }

  // ===== ADMINS: SAVE (owner only) =====
  if (action === "adminsSave") {
    const { folder, session } = requireSession();
    if (!session || !session.isOwner) return out({ ok:false, error:"unauthorized" });

    const payload = p.payload ? String(p.payload) : "";
    let obj;
    try { obj = JSON.parse(payload); } catch(e){ return out({ ok:false, error:"bad_payload" }); }

    const pwd = String(obj.pwd || "").trim();
    const name = String(obj.name || "").trim();
    const perms = obj.perms || {};
    if (!pwd) return out({ ok:false, error:"missing_pwd" });
    if (pwd === OWNER_PWD) return out({ ok:false, error:"reserved_pwd" });

    const data = loadAdmins(folder);
    let found = false;
    for (let i=0;i<data.list.length;i++){
      if (String(data.list[i].id) === String(obj.id||"") || String(data.list[i].pwd) === pwd){
        data.list[i].pwd = pwd;
        data.list[i].name = name;
        data.list[i].perms = perms;
        found = true;
        break;
      }
    }
    if (!found){
      const id = Utilities.getUuid().replace(/-/g, "");
      data.list.push({ id, pwd, name, perms });
    }
    saveAdmins(folder, data);
    return out({ ok:true });
  }

  // ===== ADMINS: DELETE (owner only) =====
  if (action === "adminsDelete") {
    const { folder, session } = requireSession();
    if (!session || !session.isOwner) return out({ ok:false, error:"unauthorized" });

    const id = p.id ? String(p.id) : "";
    const data = loadAdmins(folder);
    data.list = data.list.filter(a => String(a.id) !== id);
    saveAdmins(folder, data);
    return out({ ok:true });
  }

  // ===== LIST files (playlists etc) =====
  if (action === "list") {
    const folder = getOrCreateFolder();
    const files = folder.getFiles();
    const list = [];
    while (files.hasNext()) {
      const file = files.next();
      if (file.isTrashed()) continue;
      try {
        const content = file.getBlob().getDataAsString();
        if (isDeletedMarker(content)) continue;
      } catch (err) {}
      list.push({ name: file.getName() });
    }
    return out({ ok: true, list });
  }

  // ===== GET file =====
  if (action === "get") {
    const name = p.name ? String(p.name) : "";
    if (!name) return out({ ok: false, error: "missing_name", text: "" });

    const folder = getOrCreateFolder();
    const file = newestFileByNameInFolder(name, folder);
    if (!file) return out({ ok: false, error: "not_found", text: "" });

    const content = file.getBlob().getDataAsString();
    if (isDeletedMarker(content)) return out({ ok: false, error: "deleted", text: "" });

    return out({ ok: true, text: content });
  }

  // ===== SAVE file (admin) =====
  if (action === "save") {
    const { folder, session } = requireSession();
    if (!session) return out({ ok: false, error: "unauthorized" });

    const name = p.name ? String(p.name) : "";
    const content = p.content ? String(p.content) : "";
    if (!name) return out({ ok: false, error: "missing_name" });

    // permission gates for A/B
    const low = name.toLowerCase();
    if (low === "piesnenadnes" || low === HISTORY_FILE.toLowerCase()) {
      if (!hasPerm(session, 'A')) return out({ ok:false, error:"forbidden" });
    }
    if (low === "playlistorder") {
      if (!hasPerm(session, 'B')) return out({ ok:false, error:"forbidden" });
    }
    // playlists: any non-system file, require B
    const sys = (low === "piesnenadnes" || low === "playlistorder" || low === HISTORY_FILE.toLowerCase() || low.endsWith('.json'));
    if (!sys && !hasPerm(session, 'B')) return out({ ok:false, error:"forbidden" });

    // write
    const old = folder.getFilesByName(name);
    while (old.hasNext()) old.next().setTrashed(true);
    folder.createFile(name, content, MimeType.PLAIN_TEXT);

    // simple history snapshots for HistoryLog
    if (low === HISTORY_FILE.toLowerCase()) {
      // keep last 5 backups on Drive (visible)
      try{
        const bkpName = `HistoryLog_backup_${new Date().getTime()}.json`;
        folder.createFile(bkpName, content, MimeType.PLAIN_TEXT);
        // prune
        const it = folder.getFiles();
        const arr = [];
        while (it.hasNext()){
          const f = it.next();
          const n = f.getName();
          if (n.indexOf('HistoryLog_backup_')===0) arr.push(f);
        }
        arr.sort((a,b)=>b.getLastUpdated().getTime()-a.getLastUpdated().getTime());
        for (let i=5;i<arr.length;i++) arr[i].setTrashed(true);
      }catch(e){}
    }

    return out({ ok: true });
  }

  // ===== DELETE file (admin) =====
  if (action === "delete") {
    const { folder, session } = requireSession();
    if (!session) return out({ ok: false, error: "unauthorized" });

    const name = p.name ? String(p.name) : "";
    if (!name) return out({ ok: false, error: "missing_name" });

    // only owner can delete system files
    const low = name.toLowerCase();
    const system = (low === "piesnenadnes" || low === "playlistorder" || low === HISTORY_FILE.toLowerCase());
    if (system && !session.isOwner) return out({ ok:false, error:"forbidden" });

    const old = folder.getFilesByName(name);
    while (old.hasNext()) old.next().setTrashed(true);
    folder.createFile(name, "deleted", MimeType.PLAIN_TEXT);
    return out({ ok: true });
  }

  // ===== LITURGIA =====
  if (action === "liturgia") {
    const den = p.den ? String(p.den) : "";
    if (!den || !/^\d{4}-\d{2}-\d{2}$/.test(den)) {
      return out({ ok: false, error: "bad_date" });
    }

    const url = "https://lc.kbs.sk/?den=" + encodeURIComponent(den) + "&offline=";

    try {
      const resp = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: {
          "User-Agent": "Mozilla/5.0 (Spevnik; GAS)",
          "Accept-Language": "sk-SK,sk;q=0.9,en;q=0.8",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      });

      const code = resp.getResponseCode();
      const html = resp.getContentText() || "";

      if (code < 200 || code >= 300 || !html) {
        return out({ ok: false, error: "http_" + code });
      }

      const text = _htmlToText(html);

      return out({
        ok: true,
        den,
        text,
        variants: [{ label: "Féria", title: "", text }]
      });

    } catch (err) {
      return out({ ok: false, error: "fetch_failed", detail: String(err) });
    }
  }

  // ===== LIT OVERRIDES GET/SAVE/DELETE =====
  if (action === "litOverrideGet") {
    const folder = getOrCreateFolder();
    const data = readJsonFileInFolder(folder, LIT_OVERRIDES_FILE, { overrides: {} });
    return out({ ok: true, data });
  }

  if (action === "litOverrideSave") {
    const { folder, session } = requireSession();
    if (!session || !hasPerm(session,'C')) return out({ ok: false, error: "unauthorized" });

    const key = p.key ? String(p.key) : "";
    const payload = p.payload ? String(p.payload) : "";
    if (!key || !payload) return out({ ok: false, error: "missing_key_or_payload" });

    let obj;
    try { obj = JSON.parse(payload); } catch (e) { return out({ ok:false, error:"bad_payload_json" }); }

    const data = readJsonFileInFolder(folder, LIT_OVERRIDES_FILE, { overrides: {} });
    data.overrides[key] = obj;
    writeJsonFileInFolder(folder, LIT_OVERRIDES_FILE, data);

    return out({ ok: true });
  }

  if (action === "litOverrideDelete") {
    const { folder, session } = requireSession();
    if (!session || !hasPerm(session,'C')) return out({ ok: false, error: "unauthorized" });

    const key = p.key ? String(p.key) : "";
    if (!key) return out({ ok: false, error: "missing_key" });

    const data = readJsonFileInFolder(folder, LIT_OVERRIDES_FILE, { overrides: {} });
    if (data.overrides && data.overrides[key]) {
      delete data.overrides[key];
      writeJsonFileInFolder(folder, LIT_OVERRIDES_FILE, data);
    }
    return out({ ok: true });
  }

  // ===== SONG SAVE (D/E) =====

  function firstChordFromText(txt){
    const m = String(txt||"").match(/\[([^\]]+)\]/);
    if (!m) return "";
    return String(m[1]||"").trim();
  }

  function normalizeKey(k){
    // take first token up to whitespace or slash
    const s = String(k||"").trim();
    if (!s) return "";
    return s.split(/[\s/]+/)[0];
  }

  function pushSongVersion(folder, songId, who, title, author, songtext){
    const data = readJsonFileInFolder(folder, SONG_VERS_FILE, { versions: {} });
    if (!data.versions) data.versions = {};
    const sid = String(songId);
    const arr = Array.isArray(data.versions[sid]) ? data.versions[sid] : [];
    arr.unshift({ ts: Date.now(), who: who||"", song: { id:sid, title:title||"", author:author||"", songtext:songtext||"" } });
    while (arr.length > 10) arr.pop();
    data.versions[sid] = arr;
    writeJsonFileInFolder(folder, SONG_VERS_FILE, data);
  }

  function addChange(folder, entry){
    const data = readJsonFileInFolder(folder, CHANGES_FILE, { list: [] });
    const arr = Array.isArray(data.list) ? data.list : [];
    arr.unshift(entry);
    while (arr.length > 50) arr.pop();
    data.list = arr;
    writeJsonFileInFolder(folder, CHANGES_FILE, data);
  }

  function addKeyHistory(folder, songId, who, fromKey, toKey){
    const data = readJsonFileInFolder(folder, KEY_HIST_FILE, { keys: {} });
    if (!data.keys) data.keys = {};
    const sid = String(songId);
    const arr = Array.isArray(data.keys[sid]) ? data.keys[sid] : [];
    const ts = String(new Date().getTime());
    arr.unshift({ ts, who: who||"", date: "1.1.2026", from: fromKey||"", to: toKey||"" });
    data.keys[sid] = arr;
    writeJsonFileInFolder(folder, KEY_HIST_FILE, data);
  }

  function getKeyHistory(folder, songId){
    const data = readJsonFileInFolder(folder, KEY_HIST_FILE, { keys: {} });
    const sid = String(songId);
    const arr = data.keys && Array.isArray(data.keys[sid]) ? data.keys[sid] : [];
    return arr;
  }

  function updateSongInXml(xml, payload){
    const sid = String(payload.id||"").trim();
    const title = String(payload.title||"");
    const author = String(payload.author||"");
    const songtext = String(payload.songtext||"");

    if (!sid) throw new Error('missing_id');

    // match <song> block containing this ID
    const re = new RegExp(`(<song>[\\s\\S]*?<ID><!\\[CDATA\\[${escapeRegExp(sid)}\\]\\]><\\/ID>[\\s\\S]*?<\\/song>)`, 'm');
    const m = xml.match(re);

    function replCdata(block, tag, value){
      const r = new RegExp(`(<${tag}><!\\[CDATA\\[)[\\s\\S]*?(\\]\\]><\\/${tag}>)`, 'm');
      if (r.test(block)) return block.replace(r, `$1${value}$2`);
      // if missing, insert before </song>
      return block.replace(/<\/song>\s*$/m, `  <${tag}><![CDATA[${value}]]></${tag}>\n</song>`);
    }

    if (m && m[1]){
      let block = m[1];
      block = replCdata(block, 'author', author);
      block = replCdata(block, 'title', title);
      block = replCdata(block, 'songtext', songtext);
      return xml.replace(re, block);
    }

    // not found => create new
    const lang = 'cz';
    const newSong = [
      '    <song>',
      `        <ID><![CDATA[${sid}]]></ID>`,
      `        <lang><![CDATA[${lang}]]></lang>`,
      `        <songtext><![CDATA[${songtext}]]></songtext>`,
      `        <author><![CDATA[${author}]]></author>`,
      '        <authorId><![CDATA[]]></authorId>',
      '        <groupname><![CDATA[[local]]]></groupname>',
      `        <title><![CDATA[${title}]]></title>`,
      '    </song>'
    ].join('\n');

    // insert before </InetSongDb>
    const outXml = xml.replace(/\n<\/InetSongDb>\s*$/m, `\n${newSong}\n</InetSongDb>`);
    if (outXml === xml) {
      // fallback if formatting differs
      return xml.replace(/<\/InetSongDb>\s*$/m, `\n${newSong}\n</InetSongDb>`);
    }
    return outXml;
  }

  function writeExportXml(xml){
    // create new root file and keep last 5
    const old = DriveApp.getFilesByName(MAIN_FILE_NAME);
    while (old.hasNext()) old.next().setTrashed(true);
    DriveApp.createFile(MAIN_FILE_NAME, xml, MimeType.XML);

    const all = [];
    const files = DriveApp.getFilesByName(MAIN_FILE_NAME);
    while (files.hasNext()) {
      const f = files.next();
      if (!f.isTrashed()) all.push(f);
    }
    all.sort((a, b) => b.getLastUpdated().getTime() - a.getLastUpdated().getTime());
    for (let i = 5; i < all.length; i++) all[i].setTrashed(true);

    return newestFileByNameRoot(MAIN_FILE_NAME);
  }

  if (action === "songSave") {
    const { folder, session } = requireSession();
    if (!session) return out({ ok:false, error:"unauthorized" });
    if (!(hasPerm(session,'D') || hasPerm(session,'E'))) return out({ ok:false, error:"forbidden" });

    const payloadRaw = p.payload ? String(p.payload) : "";
    let payload;
    try { payload = JSON.parse(payloadRaw); } catch(e){ return out({ ok:false, error:"bad_payload" }); }

    const sid = String(payload.id||"").trim();
    if (!sid) return out({ ok:false, error:"missing_id" });

    const exportFile = newestFileByNameRoot(MAIN_FILE_NAME);
    if (!exportFile) return out({ ok:false, error:"export_missing" });

    const xmlOld = exportFile.getBlob().getDataAsString("UTF-8");
    const beforeKey = normalizeKey(firstChordFromText(xmlOld.match(new RegExp(`<song>[\\s\\S]*?<ID><!\\[CDATA\\[${escapeRegExp(sid)}\\]\\]><\\/ID>[\\s\\S]*?<songtext><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/songtext>`, 'm'))?.[1] || ""));
    const afterKey = normalizeKey(firstChordFromText(payload.songtext || ""));

    // store version BEFORE change for owner
    try{
      pushSongVersion(folder, sid, session.name || "", String(payload.title||""), String(payload.author||""), String(payload.songtext||""));
    }catch(e){}

    // update xml
    let xmlNew;
    try { xmlNew = updateSongInXml(xmlOld, payload); } catch(err){ return out({ ok:false, error:"xml_update_failed", detail:String(err) }); }

    const newFile = writeExportXml(xmlNew);

    // key history
    try{
      if (afterKey && afterKey !== beforeKey) addKeyHistory(folder, sid, session.name || "", beforeKey, afterKey);
    }catch(e){}

    // changes feed
    try{
      addChange(folder, {
        ts: Date.now(),
        who: session.name || "",
        type: payload.isNew ? 'new_song' : 'edit_song',
        songId: sid,
        title: String(payload.title||""),
        author: String(payload.author||"")
      });
    }catch(e){}

    return out({ ok:true, exportMtime: safeMtime(newFile) });
  }

  if (action === "songVersions") {
    const { folder, session } = requireSession();
    if (!session || !session.isOwner) return out({ ok:false, error:"unauthorized" });
    const id = p.id ? String(p.id) : "";
    const data = readJsonFileInFolder(folder, SONG_VERS_FILE, { versions: {} });
    const arr = (data.versions && Array.isArray(data.versions[id])) ? data.versions[id] : [];
    return out({ ok:true, id, versions: arr });
  }

  // key history API (public list; delete/clear owner)
  if (action === "keyHistoryGet") {
    const folder = getOrCreateFolder();
    const id = p.id ? String(p.id) : "";
    return out({ ok:true, id, list: getKeyHistory(folder, id) });
  }

  if (action === "keyHistoryDelete") {
    const { folder, session } = requireSession();
    if (!session || !session.isOwner) return out({ ok:false, error:"unauthorized" });
    const id = p.id ? String(p.id) : "";
    const ts = p.ts ? String(p.ts) : "";
    const data = readJsonFileInFolder(folder, KEY_HIST_FILE, { keys: {} });
    const arr = (data.keys && Array.isArray(data.keys[id])) ? data.keys[id] : [];
    data.keys[id] = arr.filter(r => String(r.ts||"") !== ts);
    writeJsonFileInFolder(folder, KEY_HIST_FILE, data);
    return out({ ok:true });
  }

  if (action === "keyHistoryClear") {
    const { folder, session } = requireSession();
    if (!session || !session.isOwner) return out({ ok:false, error:"unauthorized" });
    const id = p.id ? String(p.id) : "";
    const data = readJsonFileInFolder(folder, KEY_HIST_FILE, { keys: {} });
    if (data.keys) data.keys[id] = [];
    writeJsonFileInFolder(folder, KEY_HIST_FILE, data);
    return out({ ok:true });
  }

  // changes feed (owner)
  if (action === "changesGet") {
    const { folder, session } = requireSession();
    if (!session || !session.isOwner) return out({ ok:false, error:"unauthorized" });
    const data = readJsonFileInFolder(folder, CHANGES_FILE, { list: [] });
    return out({ ok:true, list: Array.isArray(data.list) ? data.list : [] });
  }

  // DEFAULT: return export XML
  const newest = newestFileByNameRoot(MAIN_FILE_NAME);
  const xml = newest ? newest.getBlob().getDataAsString("UTF-8") : "";

  // keep last 5 root export copies
  const all = [];
  const files = DriveApp.getFilesByName(MAIN_FILE_NAME);
  while (files.hasNext()) {
    const f = files.next();
    if (!f.isTrashed()) all.push(f);
  }
  all.sort((a, b) => b.getLastUpdated().getTime() - a.getLastUpdated().getTime());
  for (let i = 5; i < all.length; i++) all[i].setTrashed(true);

  if (callback) return out({ ok:true, xml: xml });

  return ContentService
    .createTextOutput(xml)
    .setMimeType(ContentService.MimeType.XML);
}

function _htmlToText(html) {
  if (!html) return "";
  let t = String(html);

  t = t.replace(/<script[\s\S]*?<\/script>/gi, "\n");
  t = t.replace(/<style[\s\S]*?<\/style>/gi, "\n");
  t = t.replace(/<br\s*\/?\s*>/gi, "\n");
  t = t.replace(/<\/(p|div|li|tr|h1|h2|h3|h4|h5|h6)>/gi, "\n");
  t = t.replace(/<[^>]+>/g, " ");

  t = t.replace(/&nbsp;/g, " ");
  t = t.replace(/&amp;/g, "&");
  t = t.replace(/&quot;/g, "\"");
  t = t.replace(/&#39;/g, "'");
  t = t.replace(/&lt;/g, "<");
  t = t.replace(/&gt;/g, ">");

  t = t.replace(/[ \t]+/g, " ");
  t = t.replace(/\n[ \t]+/g, "\n");
  t = t.replace(/\n{3,}/g, "\n\n");

  return t.trim();
}
