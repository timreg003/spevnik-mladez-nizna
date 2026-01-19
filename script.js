const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyyrD8pCxgQYiERsOsDFJ_XoBEbg6KYe1oM8Wj9IAzkq4yqzMSkfApgcc3aFeD0-Pxgww/exec';

let songs = [], filteredSongs = [], currentSong = null;
let currentModeList = []; 
let transposeStep = 0, fontSize = 17, chordsVisible = true, isAdmin = false, selectedSongIds = [];
const scale = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "B", "H"];
let autoscrollInterval = null;
let currentLevel = 1;

window.addEventListener('scroll', () => {
    const btn = document.getElementById("scroll-to-top");
    if (window.scrollY > 300) btn.style.display = "flex";
    else btn.style.display = "none";
}, { passive: true });

function smartReset() {
    stopAutoscroll(); logoutAdmin();
    document.getElementById('song-detail').style.display = 'none';
    document.getElementById('song-list').style.display = 'block';
    document.getElementById('search').value = "";
    currentModeList = [...songs]; filterSongs(); 
    loadPlaylistHeaders(); renderTodayPlaylist();
    window.scrollTo(0,0);
}

function logoutAdmin() {
    isAdmin = false;
    document.getElementById('admin-panel').style.display = 'none';
    selectedSongIds = []; renderAllSongs(); loadPlaylistHeaders();
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

    // Triedenie: Čísla -> Mariánske -> Ostatné
    songs.sort((a, b) => {
        const idA = a.originalId.toUpperCase();
        const idB = b.originalId.toUpperCase();
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
    renderAllSongs(); loadPlaylistHeaders(); renderTodayPlaylist();
}

function renderAllSongs() {
    document.getElementById('piesne-list').innerHTML = filteredSongs.map(s => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom: 1px solid #333; color: #fff;" onclick="openSongById('${s.id}', 'all')">
            <span><span style="color:#00bfff;font-weight:bold;">${s.displayId}.</span> ${s.title}</span>
            ${isAdmin ? `<button onclick="event.stopPropagation(); addToSelection('${s.id}')" style="background:#00bfff; color:black; border-radius:4px; font-weight:bold; width:30px; height:30px; border:none;">+</button>` : ''}
        </div>`).join('');
}

function openSongById(id, source) {
    const s = songs.find(x => x.id === id); if (!s) return;
    if (source === 'all') currentModeList = [...songs];
    currentSong = JSON.parse(JSON.stringify(s));
    transposeStep = 0; document.getElementById('transpose-val').innerText = "0";
    currentLevel = 1; updateSpeedUI(); stopAutoscroll();
    document.getElementById('song-list').style.display = 'none';
    document.getElementById('song-detail').style.display = 'block';
    document.getElementById('render-title').innerText = s.displayId + '. ' + s.title;
    document.getElementById('form-subject').value = "Chyba v piesni: " + s.displayId + ". " + s.title;
    const firstChordMatch = s.origText.match(/\[(.*?)\]/);
    document.getElementById('original-key-label').innerText = "Pôvodná tónina: " + (firstChordMatch ? firstChordMatch[1] : "-");
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
    if (n) { transposeStep = 0; openSongById(n.id, 'playlist'); }
}

function toggleAutoscroll() {
    if (autoscrollInterval) stopAutoscroll();
    else {
        document.getElementById('scroll-btn').innerHTML = '<i class="fas fa-pause"></i>';
        document.getElementById('scroll-btn').classList.add('active');
        startScrolling();
    }
}

function startScrolling() {
    if (autoscrollInterval) clearInterval(autoscrollInterval);
    let delay = 260 - (currentLevel * 12); if (delay < 5) delay = 5;
    autoscrollInterval = setInterval(() => {
        window.scrollBy({ top: 1, behavior: 'auto' });
        if (document.getElementById('song-content').getBoundingClientRect().bottom <= window.innerHeight) stopAutoscroll();
    }, delay);
}

function stopAutoscroll() {
    if (autoscrollInterval) { clearInterval(autoscrollInterval); autoscrollInterval = null; }
    document.getElementById('scroll-btn').innerHTML = '<i class="fas fa-play"></i>';
    document.getElementById('scroll-btn').classList.remove('active');
}

function changeScrollSpeed(delta) {
    currentLevel += delta;
    if (currentLevel < 1) currentLevel = 1; if (currentLevel > 20) currentLevel = 20;
    updateSpeedUI(); if (autoscrollInterval) startScrolling();
}

function updateSpeedUI() { 
    const lb = document.getElementById('speed-label');
    if(lb) lb.innerText = "Rýchlosť: " + currentLevel; 
}

function transposeChord(c, s) {
    return c.replace(/[A-H][#b]?/g, (n) => {
        let note = n === 'B' ? 'B' : (n === 'H' ? 'H' : n);
        let idx = scale.indexOf(note); if (idx === -1) return n;
        let newIdx = (idx + s) % 12; while (newIdx < 0) newIdx += 12;
        return scale[newIdx];
    });
}

function filterSongs() {
    const t = document.getElementById('search').value.toLowerCase();
    filteredSongs = songs.filter(s => s.title.toLowerCase().includes(t) || s.displayId.toLowerCase().includes(t));
    renderAllSongs();
}

function closeSong() { stopAutoscroll(); document.getElementById('song-list').style.display = 'block'; document.getElementById('song-detail').style.display = 'none'; }
function transposeSong(d) { transposeStep += d; document.getElementById('transpose-val').innerText = (transposeStep > 0 ? "+" : "") + transposeStep; renderSong(); }
function resetTranspose() { transposeStep = 0; document.getElementById('transpose-val').innerText = "0"; renderSong(); }
function toggleChords() { chordsVisible = !chordsVisible; renderSong(); }
function changeFontSize(d) { fontSize += d; renderSong(); }

function tryUnlockAdmin() {
    let p = prompt('Zadaj heslo:');
    if (p === "qwer") { 
        isAdmin = true; 
        selectedSongIds = []; 
        document.getElementById('playlist-name').value = "";
        document.getElementById('admin-panel').style.display = 'block'; 
        renderAllSongs(); renderEditor(); loadPlaylistHeaders(); 
    }
}

function addToSelection(id) { if(!selectedSongIds.includes(id)) selectedSongIds.push(id); renderEditor(); }
function clearSelection() { selectedSongIds = []; document.getElementById('playlist-name').value = ""; renderEditor(); }
function removeFromSelection(idx) { selectedSongIds.splice(idx, 1); renderEditor(); }
function moveInSelection(idx, d) {
    const newIdx = idx + d; if (newIdx < 0 || newIdx >= selectedSongIds.length) return;
    [selectedSongIds[idx], selectedSongIds[newIdx]] = [selectedSongIds[newIdx], selectedSongIds[idx]];
    renderEditor();
}

function renderEditor() {
    const container = document.getElementById('selected-list-editor');
    if (selectedSongIds.length === 0) { container.innerHTML = '<div style="color:#666;text-align:center;padding:10px;">Výber je prázdny</div>'; return; }
    container.innerHTML = selectedSongIds.map((id, index) => {
        const s = songs.find(x => x.id === id);
        return `<div style="display:flex;align-items:center;background:#1e1e1e;margin-bottom:4px;padding:8px;border-radius:8px;gap:8px;border:1px solid #333;">
            <span style="flex-grow:1;font-size:13px;color:white;">${s ? s.title : id}</span>
            <div style="display:flex;gap:4px;">
                <button onclick="moveInSelection(${index},-1)" style="padding:5px;background:#333;"><i class="fas fa-chevron-up"></i></button>
                <button onclick="moveInSelection(${index},1)" style="padding:5px;background:#333;"><i class="fas fa-chevron-down"></i></button>
                <button onclick="removeFromSelection(${index})" style="padding:5px;background:#ff4444;"><i class="fas fa-times"></i></button>
            </div>
        </div>`;
    }).join('');
}

function editPlaylist(name) {
    const cached = localStorage.getItem('playlist_' + name);
    if (!cached) return;
    selectedSongIds = cached.split(',').filter(x => x);
    document.getElementById('playlist-name').value = name;
    document.getElementById('admin-panel').style.display = 'block';
    renderEditor(); window.scrollTo(0,0);
}

async function savePlaylist() {
    const name = document.getElementById('playlist-name').value;
    if (!name || !selectedSongIds.length) return alert('Zadaj názov');
    const idsToSave = selectedSongIds.join(',');
    const url = `${SCRIPT_URL}?action=save&name=${encodeURIComponent(name)}&pwd=qwer&content=${idsToSave}`;
    logoutAdmin();
    try { await fetch(url, { mode: 'no-cors' }); setTimeout(() => { loadPlaylistHeaders(); }, 500); } catch (e) {}
}

async function cacheAllPlaylists(playlistData) {
    for (const p of playlistData) {
        try {
            const r = await fetch(`${SCRIPT_URL}?action=get&name=${encodeURIComponent(p.name)}`);
            const t = await r.text(); localStorage.setItem('playlist_' + p.name, t);
        } catch(e) {}
    }
}

function loadPlaylistHeaders() {
    fetch(`${SCRIPT_URL}?action=list`).then(r => r.json()).then(d => { 
        const savedOrder = JSON.parse(localStorage.getItem('playlists_order') || '[]');
        if (savedOrder.length > 0) {
            d.sort((a, b) => {
                let idxA = savedOrder.indexOf(a.name); let idxB = savedOrder.indexOf(b.name);
                if (idxA === -1) idxA = 999; if (idxB === -1) idxB = 999;
                return idxA - idxB;
            });
        }
        localStorage.setItem('offline_playlists', JSON.stringify(d)); 
        renderPlaylists(d); cacheAllPlaylists(d);
    }).catch(() => { const saved = localStorage.getItem('offline_playlists'); if (saved) renderPlaylists(JSON.parse(saved)); });
}

function movePlaylist(name, direction) {
    const current = JSON.parse(localStorage.getItem('offline_playlists') || '[]');
    const idx = current.findIndex(p => p.name === name);
    if (idx === -1) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= current.length) return;
    [current[idx], current[newIdx]] = [current[newIdx], current[idx]];
    localStorage.setItem('playlists_order', JSON.stringify(current.map(p => p.name)));
    renderPlaylists(current);
}

function setAsToday(name) {
    if (!isAdmin) return;
    const currentToday = localStorage.getItem('today_playlist_name');
    if (currentToday === name) localStorage.removeItem('today_playlist_name');
    else localStorage.setItem('today_playlist_name', name);
    renderPlaylists(JSON.parse(localStorage.getItem('offline_playlists') || '[]'));
    renderTodayPlaylist();
}

function renderTodayPlaylist() {
    const name = localStorage.getItem('today_playlist_name');
    const container = document.getElementById('today-playlist-container');
    if (!name) { 
        container.innerHTML = `<div style="text-align:center; color:#444; font-size:12px; padding:10px; border:1px dashed #333; border-radius:12px;">Žiadny vybratý playlist na dnes</div>`;
        return; 
    }
    container.innerHTML = `<div onclick="openPlaylist('${name}')" style="background: #00bfff; color: black; padding: 15px; border-radius: 12px; font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 10px; cursor: pointer; box-shadow: 0 4px 15px rgba(0,191,255,0.3);"><i class="fas fa-star"></i> DNES: ${name}</div>`;
}

function openPlaylist(name) {
    document.getElementById('piesne-list').innerHTML = `<div style="text-align:center;padding:50px;color:#00bfff;"><i class="fas fa-spinner fa-spin"></i> Sťahujem...</div>`;
    const cached = localStorage.getItem('playlist_' + name);
    if (cached) processOpenPlaylist(name, cached);
    else {
        fetch(`${SCRIPT_URL}?action=get&name=${encodeURIComponent(name)}`)
        .then(r => r.text()).then(t => { localStorage.setItem('playlist_' + name, t); processOpenPlaylist(name, t); })
        .catch(() => { document.getElementById('piesne-list').innerText = "Nedostupné."; });
    }
}

function processOpenPlaylist(name, t) {
    const ids = t.split(',');
    currentModeList = ids.map(id => songs.find(s => s.id === id)).filter(x => x);
    document.getElementById('piesne-list').innerHTML = `<div style="text-align:center;padding:15px;border-bottom:2px solid #00bfff;margin-bottom:15px;"><h2 style="margin:0;">${name}</h2><button onclick="smartReset()" style="background:none;color:#ff4444;border:1px solid #ff4444;padding:6px 16px;border-radius:20px;margin-top:10px;font-weight:bold;">ZAVRIEŤ</button></div>` +
    currentModeList.map(s => `<div onclick="openSongById('${s.id}','playlist')" style="padding:15px;border-bottom:1px solid #333;color:#fff;"><span style="color:#00bfff;font-weight:bold;">${s.displayId}.</span> ${s.title}</div>`).join('');
    window.scrollTo(0,0);
}

function renderPlaylists(d) {
    const sect = document.getElementById('playlists-section');
    const todayName = localStorage.getItem('today_playlist_name');
    let html = `<h2 class="playlist-header-title" onclick="tryUnlockAdmin()" style="cursor:pointer;padding:10px 0;text-align:center;">Playlisty <small style="font-size:10px;opacity:0.5;display:block;">(klikni pre správu)</small></h2>`;
    if (!d || d.length === 0) {
        html += `<div style="text-align:center; color:#444; padding:20px; font-size:14px;">Žiadne vytvorené playlisty</div>`;
    } else {
        html += d.map(p => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:15px;border-bottom:1px solid #333;" onclick="openPlaylist('${p.name}')">
            <div style="display:flex; align-items:center; flex-grow:1; color:#fff;">
                <i class="fas fa-star" onclick="event.stopPropagation(); setAsToday('${p.name}')" style="margin-right:15px; color: ${todayName === p.name ? '#00bfff' : '#222'}; opacity: ${isAdmin || todayName === p.name ? '1':'0.1'}; cursor:${isAdmin ? 'pointer':'default'};"></i>
                <span>${p.name}</span>
            </div>
            ${isAdmin ? `<div style="display:flex;gap:5px;"><i class="fas fa-chevron-up" onclick="event.stopPropagation(); movePlaylist('${p.name}', -1)" style="color:#666; padding:8px;"></i><i class="fas fa-chevron-down" onclick="event.stopPropagation(); movePlaylist('${p.name}', 1)" style="color:#666; padding:8px;"></i><i class="fas fa-edit" onclick="event.stopPropagation(); editPlaylist('${p.name}')" style="color:#00bfff;padding:8px;"></i><i class="fas fa-trash" onclick="event.stopPropagation(); deletePlaylist('${p.name}')" style="color:#ff4444;padding:8px;"></i></div> : ''}
        </div>`).join('');
    }
    sect.innerHTML = html;
}

async function deletePlaylist(n) { if (confirm(`Vymazať ${n}?`)) { try { await fetch(`${SCRIPT_URL}?action=delete&name=${encodeURIComponent(n)}&pwd=qwer`, { mode: 'no-cors' }); setTimeout(() => { loadPlaylistHeaders(); }, 500); } catch(e) {} } }

async function submitErrorForm(e) {
    e.preventDefault(); const btn = document.getElementById('submit-btn'); btn.disabled = true; btn.innerText = "ODOSIELAM...";
    try { await fetch("https://formspree.io/f/mvzzkwlw", { method: "POST", body: new FormData(e.target), headers: { 'Accept': 'application/json' } }); document.getElementById('form-status').style.display = "block"; e.target.reset(); setTimeout(() => { document.getElementById('form-status').style.display = "none"; }, 4000); } catch (err) {}
    finally { btn.disabled = false; btn.innerText = "ODOSLAŤ"; }
}

async function hardResetApp() { if (confirm("Vynútiť aktualizáciu?")) { localStorage.clear(); window.location.reload(true); } }

document.addEventListener('DOMContentLoaded', parseXML);
