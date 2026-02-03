/**
 * Spusti RAZ v editore (Run), aby si udelil povolenie na externé requesty (UrlFetchApp).
 * Potom až bude fungovať: web app (exec) bude vedieť načítavať liturgiu.
 */
function authorizeExternalRequests() {
  // Stačí ľubovoľný externý request – tento je stabilný.
  UrlFetchApp.fetch("https://lc.kbs.sk/?den=2026-02-01&offline=", { muteHttpExceptions: true });
}

function doGet(e) {
  const ADMIN_PWD = "qwer";
  const mainFileName = "Spevník export";
  const folderName = "Playlisty";

  const action = (e && e.parameter && e.parameter.action) ? String(e.parameter.action) : "";
  const callback = (e && e.parameter && e.parameter.callback) ? String(e.parameter.callback) : "";

  function getFolder() {
    const it = DriveApp.getFoldersByName(folderName);
    return it.hasNext() ? it.next() : DriveApp.createFolder(folderName);
  }

  function jsonOut(obj) {
    const payload = JSON.stringify(obj);
    if (callback) {
      return ContentService
        .createTextOutput(callback + "(" + payload + ");")
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService
      .createTextOutput(payload)
      .setMimeType(ContentService.MimeType.JSON);
  }

  function isDeletedContent(content) {
    return typeof content === "string" && content.trim() === "deleted";
  }

  function getNewestFileByNameInFolder(name, folder) {
    const files = folder.getFilesByName(name);
    let newest = null;
    while (files.hasNext()) {
      const f = files.next();
      if (f.isTrashed()) continue;
      if (!newest || f.getLastUpdated().getTime() > newest.getLastUpdated().getTime()) newest = f;
    }
    return newest;
  }

  function getNewestFileByNameRoot(name) {
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
      const c = file.getBlob().getDataAsString();
      if (isDeletedContent(c)) return 0;
    } catch (err) {}
    return file.getLastUpdated().getTime();
  }

  // ---------------- META ----------------
  if (action === "meta") {
    const folder = getFolder();
    const exportFile = getNewestFileByNameRoot(mainFileName);
    const dnesFile = getNewestFileByNameInFolder("PiesneNaDnes", folder);
    const orderFile = getNewestFileByNameInFolder("PlaylistOrder", folder);

    return jsonOut({
      ok: true,
      meta: {
        export: safeMtime(exportFile),
        dnes: safeMtime(dnesFile),
        order: safeMtime(orderFile)
      }
    });
  }

  // ---------------- LIST ----------------
  if (action === "list") {
    const folder = getFolder();
    const files = folder.getFiles();
    const list = [];
    while (files.hasNext()) {
      const file = files.next();
      if (file.isTrashed()) continue;
      try {
        const content = file.getBlob().getDataAsString();
        if (isDeletedContent(content)) continue;
      } catch (err) {}
      list.push({ name: file.getName() });
    }
    return jsonOut({ ok: true, list: list });
  }

  // ---------------- GET ----------------
  if (action === "get") {
    const name = String((e.parameter && e.parameter.name) ? e.parameter.name : "");
    const folder = getFolder();
    const file = getNewestFileByNameInFolder(name, folder);
    if (!file) return jsonOut({ ok: false, error: "not_found", text: "" });

    const content = file.getBlob().getDataAsString();
    if (isDeletedContent(content)) return jsonOut({ ok: false, error: "deleted", text: "" });

    return jsonOut({ ok: true, text: content });
  }

  // ---------------- SAVE (ADMIN) ----------------
  if (action === "save") {
    if (String((e.parameter && e.parameter.pwd) ? e.parameter.pwd : "") !== ADMIN_PWD) {
      return jsonOut({ ok: false, error: "unauthorized" });
    }

    const name = String((e.parameter && e.parameter.name) ? e.parameter.name : "");
    const content = String((e.parameter && e.parameter.content) ? e.parameter.content : "");
    const folder = getFolder();

    const files = folder.getFilesByName(name);
    while (files.hasNext()) files.next().setTrashed(true);
    folder.createFile(name, content, MimeType.PLAIN_TEXT);

    return jsonOut({ ok: true });
  }

  // ---------------- DELETE (ADMIN) ----------------
  if (action === "delete") {
    if (String((e.parameter && e.parameter.pwd) ? e.parameter.pwd : "") !== ADMIN_PWD) {
      return jsonOut({ ok: false, error: "unauthorized" });
    }

    const name = String((e.parameter && e.parameter.name) ? e.parameter.name : "");
    const folder = getFolder();
    const files = folder.getFilesByName(name);
    while (files.hasNext()) files.next().setTrashed(true);

    folder.createFile(name, "deleted", MimeType.PLAIN_TEXT);
    return jsonOut({ ok: true });
  }

  // ---------------- LITURGIA ----------------
  if (action === "liturgia") {
    const den = String((e.parameter && e.parameter.den) ? e.parameter.den : "");
    if (!den || !/^\d{4}-\d{2}-\d{2}$/.test(den)) return jsonOut({ ok: false, error: "bad_date" });

    const baseUrl = "https://lc.kbs.sk/?den=" + encodeURIComponent(den) + "&offline=";

    function decodeEntities(s) {
      if (!s) return "";
      s = s.replace(/&nbsp;/g, " ")
           .replace(/&amp;/g, "&")
           .replace(/&quot;/g, "\"")
           .replace(/&apos;/g, "'")
           .replace(/&lt;/g, "<")
           .replace(/&gt;/g, ">");
      s = s.replace(/&#(\d+);/g, function(_, n) {
        try { return String.fromCharCode(parseInt(n, 10)); } catch (e) { return _; }
      });
      s = s.replace(/&#x([0-9a-fA-F]+);/g, function(_, n) {
        try { return String.fromCharCode(parseInt(n, 16)); } catch (e) { return _; }
      });
      return s;
    }

    function stripTags(s){ return String(s||"").replace(/<[^>]+>/g, ""); }

    function pickTitleFromHtml(html){
      let m = String(html||"").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (m && m[1]) return decodeEntities(stripTags(m[1])).trim();
      m = String(html||"").match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      if (m && m[1]) return decodeEntities(stripTags(m[1])).trim();
      return "";
    }

    function htmlToText(h) {
      let t = String(h || "");
      t = t.replace(/\r/g, "");
      t = t.replace(/<\s*br\s*\/?\s*>/gi, "\n");
      t = t.replace(/<\s*script[^>]*>[\s\S]*?<\/\s*script\s*>/gi, "");
      t = t.replace(/<\s*style[^>]*>[\s\S]*?<\/\s*style\s*>/gi, "");
      t = t.replace(/<[^>]+>/g, "");
      t = decodeEntities(t);
      t = t.replace(/\n{3,}/g, "\n\n");
      return t.trim();
    }

    function extractPsalmAndAlleluia(text){
      const lines = text.split("\n").map(x => String(x||"").trim()).filter(x => x.length);

      let psalmText = "";
      const idxPsalm = lines.findIndex(l => /Responzóriový žalm/i.test(l));
      if (idxPsalm >= 0){
        let start = Math.max(0, idxPsalm-10);
        for (let j=idxPsalm-1;j>=0 && j>=idxPsalm-10;j--){
          if (/^R\.\s*:/i.test(lines[j])) { start = j; break; }
        }
        let end = lines.length;
        for (let k=idxPsalm+1;k<lines.length;k++){
          if (/Alelujový verš|Evanjelium|Čítanie/i.test(lines[k])) { end = k; break; }
        }
        psalmText = lines.slice(start, end).join("\n").trim();
      }

      let alleluiaVerse = "";
      const idxAv = lines.findIndex(l => /Alelujový verš/i.test(l));
      if (idxAv >= 0){
        let end = lines.length;
        for (let k=idxAv+1;k<lines.length;k++){
          if (/Evanjelium/i.test(lines[k])) { end = k; break; }
        }
        alleluiaVerse = lines.slice(idxAv+1, Math.min(end, idxAv+14)).join("\n").trim();
      }
      if (!alleluiaVerse){
        const hit = lines.find(l => /^Aleluja/i.test(l));
        if (hit) alleluiaVerse = hit.trim();
      }
      return { psalmText, alleluiaVerse };
    }

    function fetchHtml(url){
      const resp = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
          "Accept-Language": "sk-SK,sk;q=0.9,en;q=0.8",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      });
      const code = resp.getResponseCode();
      const html = resp.getContentText() || "";
      return { code, html };
    }

    function normLabel(labelText, title){
      const base = String(labelText||"").trim() || String(title||"").trim();
      const low = base.toLowerCase();
      if (low.includes("féri")) return "Féria";
      if (/^(slávnosť|sviatok|spomienka|ľubovoľná spomienka)/i.test(base)) return base;
      if (/\bsv\.|\bsvät/i.test(base)) return "Sviatok: " + base;
      return base || "Féria";
    }

    let base;
    try {
      base = fetchHtml(baseUrl);
    } catch (err) {
      return jsonOut({
        ok: false,
        error: "fetch_failed",
        detail: String(err),
        hint: "V editore spusti authorizeExternalRequests() a sprav redeploy web app."
      });
    }

    if (!base || !base.html) return jsonOut({ ok:false, error:"empty" });
    if (base.code < 200 || base.code >= 300) {
      return jsonOut({
        ok:false,
        error:"http_" + base.code,
        sample: String(base.html).substring(0, 200)
      });
    }

    // zisti možné varianty (féria/sviatok) – linky s den=YYYY-MM-DD
    const variantMap = {};
    variantMap[baseUrl] = "Féria";

    const aRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = aRe.exec(base.html)) !== null){
      let href = String(m[1]||"");
      let txt = decodeEntities(stripTags(m[2]||"")).replace(/\s+/g," ").trim();
      if (!href) continue;

      if (href.startsWith("/")) href = "https://lc.kbs.sk" + href;
      if (href.startsWith("?")) href = "https://lc.kbs.sk/" + href;

      if (!href.includes("den=" + den)) continue;
      if (!href.includes("offline=")) href += (href.includes("?") ? "&" : "?") + "offline=";

      if (!variantMap[href]) variantMap[href] = txt || "";
    }

    const urls = Object.keys(variantMap).slice(0, 6);
    const variants = [];

    for (let i=0;i<urls.length;i++){
      const url = urls[i];
      let resp;
      try { resp = fetchHtml(url); } catch(e){ resp = null; }
      if (!resp || !resp.html) continue;
      if (resp.code < 200 || resp.code >= 300) continue;

      const title = pickTitleFromHtml(resp.html);
      const text = htmlToText(resp.html);
      const ext = extractPsalmAndAlleluia(text);
      const label = normLabel(variantMap[url], title);

      variants.push({
        label: label,
        title: title,
        psalmText: ext.psalmText,
        alleluiaVerse: ext.alleluiaVerse,
        text: text
      });
    }

    if (!variants.length){
      const title = pickTitleFromHtml(base.html);
      const text = htmlToText(base.html);
      const ext = extractPsalmAndAlleluia(text);
      variants.push({
        label: "Féria",
        title: title,
        psalmText: ext.psalmText,
        alleluiaVerse: ext.alleluiaVerse,
        text: text
      });
    }

    return jsonOut({ ok:true, den: den, variants: variants });
  }

  // ---------------- DEFAULT: export XML ----------------
  let newest = null;
  const files = DriveApp.getFilesByName(mainFileName);
  const all = [];
  while (files.hasNext()) {
    const file = files.next();
    if (file.isTrashed()) continue;
    all.push(file);
    if (!newest || file.getLastUpdated().getTime() > newest.getLastUpdated().getTime()) newest = file;
  }

  const xml = newest ? newest.getBlob().getDataAsString() : "";

  all.sort((a,b) => b.getLastUpdated().getTime() - a.getLastUpdated().getTime());
  for (let i=4;i<all.length;i++) all[i].setTrashed(true);

  if (callback) return jsonOut({ ok:true, xml: xml });
  return ContentService.createTextOutput(xml).setMimeType(ContentService.MimeType.XML);
}
