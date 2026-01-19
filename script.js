const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyyrD8pCxgQYiERsOsDFJ_XoBEbg6KYe1oM8Wj9IAzkq4yqzMSkfApgcc3aFeD0-Pxgww/exec';

let songs = [], filteredSongs = [], currentSong = null;
let currentModeList = []; 
let transposeStep = 0, fontSize = 17, chordsVisible = true, isAdmin = false, selectedSongIds = [], adminPassword = "";
const scale = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "B", "H"];

// Autoscroll premenné
let autoscrollInterval = null;
const SCROLL_SPEED_PX = 1;
const SCROLL_DELAY_MS = 80; // Zvýšené z 50 na 80 pre pomalší chod

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
        if (rawId.startsWith('M')) {
            displayId = "Mariánska " + rawId.substring(1).replace(/^0+/, '');
        } else if (/^\d+$/.test(rawId)) {
            displayId = rawId.replace(/^0+/, '');
        }
        
        return { 
            id: s.getElementsByTagName('ID')[0]?.textContent.trim(), 
            title: s.getElementsByTagName('title')[0]?.textContent.trim(), 
            originalId: rawId, 
            displayId: displayId, 
            origText: text 
        };
    });

    songs.sort((a, b) => {
        const isNumA = /^\d+$/.test(a.originalId), isNumB = /^\d+$/.test(b.originalId);
        const isMarA = a.originalId.startsWith('M'), isMarB = b.originalId.startsWith('M');
        if (isNumA && isNumB) return parseInt(a.originalId) - parseInt(b.originalId);
        if (isNumA && !isNumB) return -1;
        if (!isNumA && isNumB) return 1;
        if (isMarA && isMarB) return a.originalId.localeCompare(b.originalId);
        if (isMarA && !isMarB) return -1;
        if (!isMarA && isMarB) return 1;
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

function openPlaylist(name) {
    const cached = localStorage.getItem('playlist_' + name);
    if (cached) { processOpenPlaylist(name, cached); } 
    else {
        document.getElementById('piesne-list').innerHTML = '<div style="text-align:center; padding:20px; color:#00bfff;">Načítavam...</div>';
        fetch(`${SCRIPT_URL}?action=get&name=${encodeURIComponent(name)}`)
        .then(r => r.text()).then(t => { localStorage.setItem('playlist_' + name, t); processOpenPlaylist(name, t); });
    }
}

function processOpenPlaylist(name, t) {
    const ids = t.split(',');
    currentModeList = ids.map(id => songs.find(s => s.id === id)).filter(x => x);
    document.getElementById('piesne-list').innerHTML = `
    <div style="text-align:center; padding:15px; border-bottom:2px solid #00bfff; margin-bottom:15px;">
        <h2 class="playlist-header-title" style="font-size:1.3em; margin:0; -webkit-text-fill-color: #00bfff;">${name}</h2>
        <button onclick="smartReset()" style="background:none; color:#ff4444; border:1px solid #ff4444; padding:6px 16px; border-radius:20px; cursor:pointer; margin-top:10px; font-weight:bold;">ZAVRIEŤ</button>
    </div>` +
    currentModeList.map(s => `<div onclick="openSongById('${s.id}', 'playlist')" style="padding:15px; border-bottom: 1px solid #333;"><span style="color:#00bfff;font-weight:bold;">${s.displayId}.</span> ${s.title}</div>`).join('');
    window.scrollTo(0,0);
}

function openSongById(id, source) {
    const s = songs.find(x => x.id === id); if (!s) return;
    if (source === 'all') { currentModeList = [...songs]; }
    currentSong = JSON.parse(JSON.
