const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyyrD8pCxgQYiERsOsDFJ_XoBEbg6KYe1oM8Wj9IAzkq4yqzMSkfApgcc3aFeD0-Pxgww/exec';

let songs = [], filteredSongs = [], currentSong = null;
let currentModeList = [];
let transposeStep = 0, fontSize = 17, chordsVisible = true, isAdmin = false, selectedSongIds = [], dnesSelectedIds = [];
const scale = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "B", "H"];
let autoscrollInterval = null, currentLevel = 1, currentListSource = 'all';

window.addEventListener('scroll', () => {
    const btn = document.getElementById("scroll-to-top");
    if (window.scrollY > 300) btn.style.display = "flex";
    else btn.style.display = "none";
}, { passive: true });

function smartReset() {
    stopAutoscroll(); logoutAdmin(); closeDnesEditor();
    document.getElementById('song-detail').style.display = 'none';
    document.getElementById('song-list').style.display = 'block';
    document.getElementById('search').value = "";
    currentModeList = [...songs]; filterSongs();
    loadPlaylistHeaders(); loadDnesFromDrive();
    window.scrollTo(0,0);
}

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
        return { id: s.getElementsByTagName('ID')[0]?.textContent.trim(), title: s.getElementsByTagName('title')[0]?.textContent.trim(), originalId: rawId, displayId: displayId, origText: text };
    });

    // ZORADENIE: čísla → Mariánske → textové
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

    filteredSongs = [...songs]; currentModeList = [...songs];
    renderAllSongs(); loadPlaylistHeaders(); loadDnesFromDrive();
}

function renderAllSongs() {
    document.getElementById('piesne-list').innerHTML = filteredSongs.map(s => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom: 1px solid #333; color: #fff;" onclick="openSongById('${s.id}', 'all')">
            <span><span style="color:#00bfff;font-weight:bold;">${s.displayId}.</span> ${s.title}</span>
            ${isAdmin ? `<button onclick="event.stopPropagation(); addToSelection('${s.id}')" style="background:#00bfff; color:black; border-radius:4px; font-weight:bold; width:30px; height:30px; border:none;">+</button>` : ''}
        </div>`).join('');
}

function openSongById(id, source) {
    currentListSource = source;
    const s = songs.find(x => x.id === id);
    if (!s) return;
    if (source === 'dnes') currentModeList = (localStorage.getItem('piesne_dnes')||'').split(',').map(id => songs.find(x => x.id === id)).filter(x=>x);
    else if (source === 'all') currentModeList = [...songs];
    currentSong = JSON.parse(JSON.stringify(s));
    transposeStep = 0; document.getElementById('transpose-val').innerText = "0";
    currentLevel = 1; updateSpeedUI(); stopAutoscroll();
    document.getElementById('song-list').style.display = 'none';
    document.getElementById('song-detail').style.display = 'block';
    document.getElementById('render-title').innerText = s.displayId + '. ' + s.title;
    const firstChordMatch = s.origText.match(/\[(.*?)\]/);
    document.getElementById('original-key-label').innerText = "Tónina: " + (firstChordMatch ? firstChordMatch[1] : "-");
    renderSong(); window.scrollTo(0,0);
}

function renderSong() {
    if (!currentSong) return;
    let text = currentSong.origText;
    if (transposeStep !== 0) text = text.replace(/\[(.*?)\]/g, (m, c) => `[${transposeChord(c, transposeStep)}]`);
    if (!chordsVisible) text = text.replace(/\[.*?\]/g, '');
    const el = document.getElementById('song-content');
    el.innerHTML = text.replace(/\[(.*?)\]/g, '<span class="chord">$1</span>');
    el.style.fontSize = fontSize + 'px';
}

function navigateSong(d) {
    const idx = currentModeList.findIndex(s => s.id === currentSong.id);
    const n = currentModeList[idx + d];
    if (n) openSongById(n.id, currentListSource);
}

function transposeChord(c, s) {
    return c.replace(/[A-H][#b]?/g, (n) => {
        let note = n; if (n==='B') note='B'; if (n==='H') note='H';
        let idx = scale.indexOf(note); if (idx === -1) return n;
        let newIdx = (idx + s) % 12; while (newIdx < 0) newIdx += 12;
        return scale[newIdx];
    });
}

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
    clearInterval(autoscrollInterval); autoscrollInterval = null;
    document.getElementById('scroll-btn').classList.remove('active');
    document.getElementById('scroll-btn').innerHTML = '<i class="fas fa-play"></i>';
}
function changeScrollSpeed(d) {
    currentLevel += d; if (currentLevel<1) currentLevel=1; if (currentLevel>20) currentLevel=20;
    updateSpeedUI(); if (autoscrollInterval) startScrolling();
}
function updateSpeedUI() { document.getElementById('speed-label').innerText = "Rýchlosť: " + currentLevel; }

function filterSongs() {
    const t = document.getElementById('search').value.toLowerCase();
    filteredSongs = songs.filter(s => s.title.toLowerCase().includes(t) || s.displayId.toLowerCase().includes(t));
    renderAllSongs();
}
function closeSong() { stopAutoscroll(); document.getElementById('song-list').style.display = 'block'; document.getElementById('song-detail').style.display = 'none'; }
function transposeSong(d) { transposeStep += d; document.getElementById('transpose-val').innerText = (transposeStep>0?"+":"")+transposeStep; renderSong(); }
function resetTranspose() { transposeStep = 0; document.getElementById('transpose-val').innerText = "0"; renderSong(); }
function toggleChords() { chordsVisible = !chordsVisible; renderSong(); }
function changeFontSize(d) { fontSize += d; renderSong(); }

/* PIESNE NA DNES - SYNC */
async function loadDnesFromDrive() {
    try {
        const r = await fetch(`${SCRIPT_URL}?action=get&name=PiesneNaDnes&t=${Date.now()}`);
        const t = await r.text();
        if (t !== null) localStorage.setItem('piesne_dnes', t.trim());
    } catch(e) {}
    renderDnesSection();
}

function renderDnesSection() {
    const box = document.getElementById('dnes-section');
    const ids = (localStorage.getItem('piesne_dnes') || '').split(',').filter(x => x);
    if (!ids.length) { box.innerHTML = '<div class="dnes-empty">Žiadne piesne na dnes.</div>'; return; }
    box.innerHTML = ids.map(id => {
        const s = songs.find(x => x.id === id);
        return s ? `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px;border-bottom:1px solid #333;color:#fff;" onclick="openSongById('${s.id}','dnes')">
            <span><span style="color:#00bfff;font-weight:bold;">${s.displayId}.</span> ${s.title}</span>
        </div>` : '';
    }).join('');
}

function openDnesEditor() {
    if (prompt('Heslo:') !== 'qwer') return;
    document.getElementById('dnes-editor-panel').style.display = 'block';
    dnesSelectedIds = (localStorage.getItem('piesne_dnes') || '').split(',').filter(x => x);
    renderDnesEditor(); filterDnesSearch();
}
function closeDnesEditor() { document.getElementById('dnes-editor-panel').style.display = 'none'; }
function renderDnesEditor() {
    const box = document.getElementById('dnes-selected-editor');
    box.innerHTML = dnesSelectedIds.map((id, i) => {
        const s = songs.find(x => x.id === id);
        return `<div class="editor-item" style="display:flex;padding:5px;background:#222;margin-bottom:2px;border-radius:5px;align-items:center;justify-content:space-between;">
            <span style="font-size:12px;">${s ? s.title : id}</span>
            <div>
                <button onclick="moveDnesEdit(${i},-1)">↑</button>
                <button onclick="removeDnesEdit(${i})" style="color:red;">X</button>
            </div>
        </div>`;
    }).join('');
}
function moveDnesEdit(i, d) {
    const n = i + d; if (n<0 || n>=dnesSelectedIds.length) return;
    [dnesSelectedIds[i], dnesSelectedIds[n]] = [dnesSelectedIds[n], dnesSelectedIds[i]];
    renderDnesEditor();
}
function removeDnesEdit(i) { dnesSelectedIds.splice(i, 1); renderDnesEditor(); }
function clearDnesSelection() { dnesSelectedIds = []; renderDnesEditor(); }
function addToDnesSelection(id) { if(!dnesSelectedIds.includes(id)) dnesSelectedIds.push(id); renderDnesEditor(); }

async function saveDnesEditor() {
    const s = dnesSelectedIds.join(',');
    localStorage.setItem('piesne_dnes', s);
    renderDnesSection(); closeDnesEditor();
    await fetch(`${SCRIPT_URL}?action=save&name=PiesneNaDnes&pwd=qwer&content=${encodeURIComponent(s)}`, { mode: 'no-cors' });
}
function filterDnesSearch() {
    const t = document.getElementById('dnes-search').value.toLowerCase();
    const filt = songs.filter(s => s.title.toLowerCase().includes(t) || s.displayId.toLowerCase().includes(t));
    document.getElementById('dnes-available-list').innerHTML = filt.slice(0,10).map(s => `
        <div style="padding:8px;border-bottom:1px solid #333;display:flex;justify-content:space-between;">
            <span>${s.title}</span><button onclick="addToDnesSelection('${s.id}')">+</button>
        </div>`).join('');
}

/* PLAYLISTY */
function tryUnlockAdmin() {
    if (prompt('Heslo:') === 'qwer') {
        isAdmin = true; document.getElementById('admin-panel').style.display = 'block';
        renderAllSongs(); loadPlaylistHeaders();
    }
}
function logoutAdmin() { isAdmin = false; document.getElementById('admin-panel').style.display = 'none'; renderAllSongs(); }
function loadPlaylistHeaders() {
    fetch(`${SCRIPT_URL}?action=list`).then(r => r.json()).then(d => {
        renderPlaylists(d);
        d.forEach(p => fetch(`${SCRIPT_URL}?action=get&name=${encodeURIComponent(p.name)}`).then(r=>r.text()).then(t=>localStorage.setItem('playlist_'+p.name, t)));
    });
}
function renderPlaylists(d) {
    const sect = document.getElementById('playlists-section');
    sect.innerHTML = d.map(p => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:15px;border-bottom:1px solid #333;">
            <span onclick="openPlaylist('${p.name}')" style="flex-grow:1;color:#fff;"><i class="fas fa-music" style="color:#00bfff;margin-right:10px;"></i>${p.name}</span>
            ${isAdmin ? `<i class="fas fa-trash" onclick="deletePlaylist('${p.name}')" style="color:red;padding:10px;"></i>` : ''}
        </div>`).join('');
}
function openPlaylist(name) {
    const ids = (localStorage.getItem('playlist_'+name) || '').split(',');
    currentModeList = ids.map(id => songs.find(x => x.id === id)).filter(x => x);
    document.getElementById('piesne-list').innerHTML = `<h2 style="text-align:center;color:#00bfff;">${name}</h2>` + 
    currentModeList.map(s => `<div onclick="openSongById('${s.id}','playlist')" style="padding:15px;border-bottom:1px solid #333;">${s.displayId}. ${s.title}</div>`).join('');
    window.scrollTo(0,0);
}

function filterSongs() {
    const t = document.getElementById('search').value.toLowerCase();
    filteredSongs = songs.filter(s => s.title.toLowerCase().includes(t) || s.displayId.toLowerCase().includes(t));
    renderAllSongs();
}
function closeSong() { stopAutoscroll(); document.getElementById('song-list').style.display = 'block'; document.getElementById('song-detail').style.display = 'none'; }
function transposeSong(d) { transposeStep += d; document.getElementById('transpose-val').innerText = (transposeStep>0?"+":"")+transposeStep; renderSong(); }
function resetTranspose() { transposeStep = 0; document.getElementById('transpose-val').innerText = "0"; renderSong(); }
function toggleChords() { chordsVisible = !chordsVisible; renderSong(); }
function changeFontSize(d) { fontSize += d; renderSong(); }

async function hardResetApp() {
    if (confirm("Vymazať pamäť?")) {
        localStorage.clear();
        const keys = await caches.keys();
        for (const k of keys) await caches.delete(k);
        location.reload(true);
    }
}

document.addEventListener('DOMContentLoaded', parseXML);
