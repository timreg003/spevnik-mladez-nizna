const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyyrD8pCxgQYiERsOsDFJ_XoBEbg6KYe1oM8Wj9IAzkq4yqzMSkfApgcc3aFeD0-Pxgww/exec';
let songs = [], filteredSongs = [], currentSong = null, currentModeList = []; 
let transposeStep = 0, fontSize = 17, chordsVisible = true, isAdmin = false, selectedSongIds = [];
const scale = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "B", "H"];
let autoscrollInterval = null, currentLevel = 1;

function smartReset() {
    stopAutoscroll(); logoutAdmin();
    document.getElementById('song-detail').style.display = 'none';
    document.getElementById('song-list').style.display = 'block';
    document.getElementById('search').value = "";
    currentModeList = [...songs]; filterSongs(); loadPlaylistHeaders(); window.scrollTo(0,0);
}

// ADMIN & EDITOR (S ČISTENÍM)
function tryUnlockAdmin() {
    if (prompt('Heslo:') === "qwer") { 
        isAdmin = true; 
        selectedSongIds = []; // ČISTÝ EDITOR
        document.getElementById('playlist-name').value = ""; 
        document.getElementById('admin-panel').style.display = 'block'; 
        renderAllSongs(); renderEditor(); loadPlaylistHeaders();
    }
}
function logoutAdmin() { isAdmin = false; document.getElementById('admin-panel').style.display = 'none'; renderAllSongs(); loadPlaylistHeaders(); }

// PLAYLISTY (PRESÚVANIE & DNES)
function setAsToday(name) {
    if (!isAdmin) return;
    const current = localStorage.getItem('today_playlist');
    if (current === name) localStorage.removeItem('today_playlist');
    else localStorage.setItem('today_playlist', name);
    loadPlaylistHeaders();
}

function movePlaylist(name, direction) {
    let order = JSON.parse(localStorage.getItem('playlist_order') || "[]");
    const idx = order.indexOf(name);
    if (idx === -1) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= order.length) return;
    [order[idx], order[newIdx]] = [order[newIdx], order[idx]];
    localStorage.setItem('playlist_order', JSON.stringify(order));
    loadPlaylistHeaders();
}

function renderPlaylists(data) {
    const today = localStorage.getItem('today_playlist');
    const todayCont = document.getElementById('today-container');
    todayCont.innerHTML = today ? `<div class="today-box" onclick="openPlaylist('${today}')"><i class="fas fa-star"></i> DNES: ${today}</div>` : '';

    let order = JSON.parse(localStorage.getItem('playlist_order') || "[]");
    data.sort((a,b) => (order.indexOf(a.name) === -1 ? 99 : order.indexOf(a.name)) - (order.indexOf(b.name) === -1 ? 99 : order.indexOf(b.name)));
    if (order.length === 0) localStorage.setItem('playlist_order', JSON.stringify(data.map(p => p.name)));

    document.getElementById('playlists-section').innerHTML = '<h2 class="playlist-header-title" onclick="tryUnlockAdmin()">Playlisty</h2>' + 
    data.map(p => `
        <div class="playlist-item">
            <div onclick="openPlaylist('${p.name}')" style="flex-grow:1; color:#00bfff; cursor:pointer;">
                <i class="fas fa-star" onclick="event.stopPropagation(); setAsToday('${p.name}')" style="margin-right:10px; color:${today === p.name ? '#00bfff':'#222'}"></i>
                ${p.name}
            </div>
            ${isAdmin ? `<div>
                <i class="fas fa-chevron-up" onclick="movePlaylist('${p.name}', -1)" style="padding:10px;"></i>
                <i class="fas fa-chevron-down" onclick="movePlaylist('${p.name}', 1)" style="padding:10px;"></i>
                <i class="fas fa-trash" onclick="deletePlaylist('${p.name}')" style="color:#ff4444; padding:10px;"></i>
            </div>` : ''}
        </div>`).join('');
}

// OSTATNÁ LOGIKA (PÔVODNÁ)
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
        let dId = rawId;
        if (rawId.toUpperCase().startsWith('M')) dId = "Mariánska " + rawId.substring(1).replace(/^0+/, '');
        else if (/^\d+$/.test(rawId)) dId = rawId.replace(/^0+/, '');
        return { id: s.getElementsByTagName('ID')[0]?.textContent.trim(), title: s.getElementsByTagName('title')[0]?.textContent.trim(), originalId: rawId, displayId: dId, origText: text };
    });
    songs.sort((a, b) => {
        if (/^\d+$/.test(a.originalId) && !/^\d+$/.test(b.originalId)) return -1;
        if (!/^\d+$/.test(a.originalId) && /^\d+$/.test(b.originalId)) return 1;
        return a.title.localeCompare(b.title, 'sk');
    });
    filteredSongs = [...songs]; currentModeList = [...songs];
    renderAllSongs(); loadPlaylistHeaders();
}

function renderAllSongs() {
    document.getElementById('piesne-list').innerHTML = filteredSongs.map(s => `
        <div style="display:flex; justify-content:space-between; padding:12px; border-bottom:1px solid #333;" onclick="openSongById('${s.id}', 'all')">
            <span><span style="color:#00bfff;font-weight:bold;">${s.displayId}.</span> ${s.title}</span>
            ${isAdmin ? `<button onclick="event.stopPropagation(); addToSelection('${s.id}')" style="background:#00bfff; color:black; border-radius:4px; font-weight:bold;">+</button>` : ''}
        </div>`).join('');
}

function openSongById(id, source) {
    const s = songs.find(x => x.id === id); if (!s) return;
    if (source === 'all') currentModeList = [...songs];
    currentSong = JSON.parse(JSON.stringify(s));
    transposeStep = 0; document.getElementById('transpose-val').innerText = "0";
    currentLevel = 1; stopAutoscroll();
    document.getElementById('song-list').style.display = 'none';
    document.getElementById('song-detail').style.display = 'block';
    document.getElementById('render-title').innerText = s.displayId + '. ' + s.title;
    renderSong(); window.scrollTo(0,0);
}

function renderSong() {
    let text = currentSong.origText;
    if (transposeStep !== 0) text = text.replace(/\[(.*?)\]/g, (m, c) => `[${transposeChord(c, transposeStep)}]`);
    if (!chordsVisible) text = text.replace(/\[.*?\]/g, '');
    const el = document.getElementById('song-content');
    el.innerHTML = text.replace(/\[(.*?)\]/g, '<span class="chord">$1</span>');
    el.style.fontSize = fontSize + 'px';
}

function transposeChord(c, s) {
    return c.replace(/[A-H][#b]?/g, (n) => {
        let note = n === 'B' ? 'B' : (n === 'H' ? 'H' : n);
        let idx = scale.indexOf(note); if (idx === -1) return n;
        let newIdx = (idx + s) % 12; while (newIdx < 0) newIdx += 12;
        return scale[newIdx];
    });
}

function loadPlaylistHeaders() {
    fetch(`${SCRIPT_URL}?action=list`).then(r => r.json()).then(d => renderPlaylists(d));
}

function openPlaylist(name) {
    fetch(`${SCRIPT_URL}?action=get&name=${encodeURIComponent(name)}`).then(r => r.text()).then(t => {
        const ids = t.split(',');
        currentModeList = ids.map(id => songs.find(s => s.id === id)).filter(x => x);
        document.getElementById('piesne-list').innerHTML = `<h2 style="text-align:center; color:#00bfff;">${name}</h2>` + 
        currentModeList.map(s => `<div onclick="openSongById('${s.id}','playlist')" style="padding:15px; border-bottom:1px solid #333;">${s.displayId}. ${s.title}</div>`).join('');
    });
}

function addToSelection(id) { if(!selectedSongIds.includes(id)) selectedSongIds.push(id); renderEditor(); }
function renderEditor() {
    document.getElementById('selected-list-editor').innerHTML = selectedSongIds.map((id, i) => {
        const s = songs.find(x => x.id === id);
        return `<div style="color:white; padding:5px; border-bottom:1px solid #333;">${s ? s.title : id} <button onclick="selectedSongIds.splice(${i},1);renderEditor()">X</button></div>`;
    }).join('');
}
async function savePlaylist() {
    const name = document.getElementById('playlist-name').value;
    await fetch(`${SCRIPT_URL}?action=save&name=${encodeURIComponent(name)}&pwd=qwer&content=${selectedSongIds.join(',')}`, { mode: 'no-cors' });
    smartReset();
}

function filterSongs() { const t = document.getElementById('search').value.toLowerCase(); filteredSongs = songs.filter(s => s.title.toLowerCase().includes(t) || s.displayId.toLowerCase().includes(t)); renderAllSongs(); }
function closeSong() { stopAutoscroll(); document.getElementById('song-list').style.display = 'block'; document.getElementById('song-detail').style.display = 'none'; }
function navigateSong(d) { const idx = currentModeList.findIndex(s => s.id === currentSong.id); if (currentModeList[idx + d]) openSongById(currentModeList[idx+d].id, 'playlist'); }
function transposeSong(d) { transposeStep += d; document.getElementById('transpose-val').innerText = (transposeStep > 0 ? "+" : "") + transposeStep; renderSong(); }
function resetTranspose() { transposeStep = 0; document.getElementById('transpose-val').innerText = "0"; renderSong(); }
function toggleChords() { chordsVisible = !chordsVisible; renderSong(); }
function changeFontSize(d) { fontSize += d; renderSong(); }
function toggleAutoscroll() { if (autoscrollInterval) stopAutoscroll(); else { document.getElementById('scroll-btn').classList.add('active'); startScrolling(); } }
function stopAutoscroll() { clearInterval(autoscrollInterval); autoscrollInterval = null; document.getElementById('scroll-btn').classList.remove('active'); }
function startScrolling() { clearInterval(autoscrollInterval); autoscrollInterval = setInterval(() => { window.scrollBy(0, 1); }, 260 - (currentLevel * 12)); }
function changeScrollSpeed(d) { currentLevel = Math.max(1, Math.min(20, currentLevel + d)); document.getElementById('speed-label').innerText = "Rýchlosť: " + currentLevel; if(autoscrollInterval) startScrolling(); }
async function submitErrorForm(e) { e.preventDefault(); await fetch("https://formspree.io/f/mvzzkwlw", { method: "POST", body: new FormData(e.target) }); document.getElementById('form-status').style.display = "block"; e.target.reset(); }

document.addEventListener('DOMContentLoaded', parseXML);
