const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyyrD8pCxgQYiERsOsDFJ_XoBEbg6KYe1oM8Wj9IAzkq4yqzMSkfApgcc3aFeD0-Pxgww/exec';

let songs = [], filteredSongs = [], currentSong = null;
let currentModeList = []; 
let transposeStep = 0, fontSize = 17, chordsVisible = true, isAdmin = false, selectedSongIds = [], adminPassword = "";
const scale = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "B", "H"];

let autoscrollInterval = null;
let currentLevel = 1;

function smartReset() {
    stopAutoscroll();
    document.getElementById('admin-panel').style.display = 'none';
    document.getElementById('song-detail').style.display = 'none';
    document.getElementById('song-list').style.display = 'block';
    document.getElementById('search').value = "";
    currentModeList = [...songs];
    filterSongs();
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
        if (rawId.startsWith('M')) displayId = "Mariánska " + rawId.substring(1).replace(/^0+/, '');
        else if (/^\d+$/.test(rawId)) displayId = rawId.replace(/^0+/, '');
        return { 
            id: s.getElementsByTagName('ID')[0]?.textContent.trim(), 
            title: s.getElementsByTagName('title')[0]?.textContent.trim(), 
            originalId: rawId, displayId: displayId, origText: text 
        };
    });

    songs.sort((a, b) => {
        const isNumA = /^\d+$/.test(a.originalId), isNumB = /^\d+$/.test(b.originalId);
        const isMarA = a.originalId.startsWith('M'), isMarB = b.originalId.startsWith('M');
        if (isNumA && !isNumB) return -1;
        if (!isNumA && isNumB) return 1;
        if (isNumA && isNumB) return parseInt(a.originalId) - parseInt(b.originalId);
        if (isMarA && !isMarB) return -1;
        if (!isMarA && isMarB) return 1;
        if (isMarA && isMarB) return (parseInt(a.originalId.substring(1)) || 0) - (parseInt(b.originalId.substring(1)) || 0);
        return a.originalId.localeCompare(b.originalId);
    });

    filteredSongs = [...songs];
    currentModeList = [...songs];
    renderAllSongs();
    loadPlaylistHeaders();
}

function renderAllSongs() {
    document.getElementById('piesne-list').innerHTML = filteredSongs.map(s => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom: 1px solid #333;" onclick="openSongById('${s.id}', 'all')">
            <span><span style="color:#00bfff;font-weight:bold;">${s.displayId}.</span> ${s.title}</span>
            ${isAdmin ? `<button onclick="event.stopPropagation(); addToSelection('${s.id}')" style="background:#00bfff; color:black; border-radius:4px; font-weight:bold; width:30px; height:30px; border:none;">+</button>` : ''}
        </div>`).join('');
}

async function submitErrorForm(e) {
    e.preventDefault();
    const btn = document.getElementById('submit-btn');
    const status = document.getElementById('form-status');
    btn.disabled = true; btn.innerText = "ODOSIELAM...";
    try {
        const response = await fetch("https://formspree.io/f/mvzzkwlw", {
            method: "POST",
            body: new FormData(e.target),
            headers: { 'Accept': 'application/json' }
        });
        if (response.ok) {
            status.innerText = "Vďaka! Správa bola odoslaná.";
            status.style.display = "block";
            e.target.reset();
            setTimeout(() => { status.style.display = "none"; }, 4000);
        }
    } catch (err) { alert("Chyba spojenia."); }
    finally { btn.disabled = false; btn.innerText = "ODOSLAŤ"; }
}

function openSongById(id, source) {
    const s = songs.find(x => x.id === id); if (!s) return;
    if (source === 'all') currentModeList = [...songs];
    currentSong = JSON.parse(JSON.stringify(s));
    transposeStep = 0; currentLevel = 1; updateSpeedUI(); stopAutoscroll();
    document.getElementById('song-list').style.display = 'none';
    document.getElementById('song-detail').style.display = 'block';
    document.getElementById('render-title').innerText = s.displayId + '. ' + s.title;
    document.getElementById('form-subject').value = "Chyba v piesni: " + s.displayId + ". " + s.title;
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

function navigateSong(d) {
    const idx = currentModeList.findIndex(s => s.id === currentSong.id);
    const n = currentModeList[idx + d]; if (n) openSongById(n.id, 'playlist');
}

function toggleAutoscroll() {
    if (autoscrollInterval) stopAutoscroll();
    else {
        document.getElementById('scroll-btn').innerHTML = '<i class="fas fa-pause"></i>';
        document.getElementById('scroll-btn').classList.add('active');
        document.getElementById('scroll-to-top').style.display = 'block';
        startScrolling();
    }
}

function startScrolling() {
    if (autoscrollInterval) clearInterval(autoscrollInterval);
    let delay = 260 - (currentLevel * 12); if (delay < 5) delay = 5;
    autoscrollInterval = setInterval(() => {
        window.scrollBy(0, 1);
        const content = document.getElementById('song-content');
        const contentBottom = content.getBoundingClientRect().bottom;
        // Zastaviť, keď spodok textu dosiahne spodok obrazovky
        if (contentBottom <= window.innerHeight) stopAutoscroll();
    }, delay);
}

function stopAutoscroll() {
    if (autoscrollInterval) { clearInterval(autoscrollInterval); autoscrollInterval = null; }
    document.getElementById('scroll-btn').innerHTML = '<i class="fas fa-play"></i>';
    document.getElementById('scroll-btn').classList.remove('active');
    document.getElementById('scroll-to-top').style.display = 'none';
}

function changeScrollSpeed(delta) {
    currentLevel += delta;
    if (currentLevel < 1) currentLevel = 1;
    if (currentLevel > 20) currentLevel = 20;
    updateSpeedUI();
    if (autoscrollInterval) startScrolling();
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

// --- ADMIN & EDITOR (VRÁTENÉ ŠÍPKY A CERUZKA) ---
function unlockAdmin() { let p = prompt('Heslo:'); if (p === "qwer") { isAdmin = true; document.getElementById('admin-panel').style.display = 'block'; renderAllSongs(); loadPlaylistHeaders(); } }
function addToSelection(id) { if(!selectedSongIds.includes(id)) selectedSongIds.push(id); renderEditor(); }
function clearSelection() { selectedSongIds = []; document.getElementById('playlist-name').value = ""; renderEditor(); }
function removeFromSelection(idx) { selectedSongIds.splice(idx, 1); renderEditor(); }
function moveInSelection(idx, d) {
    const newIdx = idx + d;
    if (newIdx < 0 || newIdx >= selectedSongIds.length) return;
    [selectedSongIds[idx], selectedSongIds[newIdx]] = [selectedSongIds[newIdx], selectedSongIds[idx]];
    renderEditor();
}
function renderEditor() {
    const container = document.getElementById('selected-list-editor');
    if (selectedSongIds.length === 0) { container.innerHTML = '<div style="color: #666; text-align: center; padding: 10px;">Prázdny playlist</div>'; return; }
    container.innerHTML = selectedSongIds.map((id, index) => {
        const s = songs.find(x => x.id === id);
        return `<div style="display:flex; align-items:center; background:#1e1e1e; margin-bottom:4px; padding:8px; border-radius:8px; gap:8px; border:1px solid #333;">
            <span style="flex-grow:1; font-size:13px; color:white;">${s ? s.title : id}</span>
            <div style="display:flex; gap:4px;">
                <button onclick="moveInSelection(${index}, -1)" style="padding:5px; background:#333;"><i class="fas fa-chevron-up"></i></button>
                <button onclick="moveInSelection(${index}, 1)" style="padding:5px; background:#333;"><i class="fas fa-chevron-down"></i></button>
                <button onclick="removeFromSelection(${index})" style="padding:5px; background:#ff4444;"><i class="fas fa-times"></i></button>
            </div>
        </div>`;
    }).join('');
}

function savePlaylist() {
    const name = document.getElementById('playlist-name').value;
    if (!name || !selectedSongIds.length) return alert('Zadaj názov');
    window.open(`${SCRIPT_URL}?action=save&name=${encodeURIComponent(name)}&pwd=qwer&content=${selectedSongIds.join(',')}`, '_blank','width=300,height=200');
}

function editPlaylist(name) {
    const cached = localStorage.getItem('playlist_' + name);
    if (!cached) return;
    selectedSongIds = cached.split(',').filter(x => x);
    document.getElementById('playlist-name').value = name;
    document.getElementById('admin-panel').style.display = 'block';
    renderEditor();
    window.scrollTo(0,0);
}

function loadPlaylistHeaders() {
    fetch(`${SCRIPT_URL}?action=list`).then(r => r.json()).then(d => { localStorage.setItem('offline_playlists', JSON.stringify(d)); renderPlaylists(d); })
    .catch(() => { const saved = localStorage.getItem('offline_playlists'); if (saved) renderPlaylists(JSON.parse(saved)); });
}

function openPlaylist(name) {
    fetch(`${SCRIPT_URL}?action=get&name=${encodeURIComponent(name)}`).then(r => r.text()).then(t => { localStorage.setItem('playlist_' + name, t); processOpenPlaylist(name, t); });
}

function processOpenPlaylist(name, t) {
    const ids = t.split(',');
    currentModeList = ids.map(id => songs.find(s => s.id === id)).filter(x => x);
    document.getElementById('piesne-list').innerHTML = `<div style="text-align:center; padding:15px; border-bottom:2px solid #00bfff; margin-bottom:15px;"><h2 class="playlist-header-title" style="margin:0;">${name}</h2><button onclick="smartReset()" style="background:none; color:#ff4444; border:1px solid #ff4444; padding:6px 16px; border-radius:20px; cursor:pointer; margin-top:10px; font-weight:bold;">ZAVRIEŤ</button></div>` +
    currentModeList.map(s => `<div onclick="openSongById('${s.id}', 'playlist')" style="padding:15px; border-bottom: 1px solid #333;"><span style="color:#00bfff;font-weight:bold;">${s.displayId}.</span> ${s.title}</div>`).join('');
    window.scrollTo(0,0);
}

function renderPlaylists(d) {
    const sect = document.getElementById('playlists-section');
    if (!d || d.length === 0) { sect.innerHTML = ""; return; }
    sect.innerHTML = '<h2 class="playlist-header-title">Playlisty</h2>' + d.map(p => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:15px; border-bottom: 1px solid #333;" onclick="openPlaylist('${p.name}')">
            <span style="cursor:pointer; flex-grow:1;"><i class="fas fa-music" style="color:#00bfff; margin-right:12px;"></i>${p.name}</span>
            ${isAdmin ? `<div style="display:flex; gap:20px;"><i class="fas fa-edit" onclick="event.stopPropagation(); editPlaylist('${p.name}')" style="color:#00bfff;"></i><i class="fas fa-trash" onclick="event.stopPropagation(); deletePlaylist('${p.name}')" style="color:#ff4444;"></i></div>` : ''}
        </div>`).join('');
}

function deletePlaylist(n) { if (confirm(`Vymazať ${n}?`)) window.open(`${SCRIPT_URL}?action=delete&name=${encodeURIComponent(n)}&pwd=qwer`, '_blank','width=300,height=200'); }

document.addEventListener('DOMContentLoaded', parseXML);
