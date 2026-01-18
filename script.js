const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyyrD8pCxgQYiERsOsDF_XoBEbg6KYe1oM8Wj9IAzkq4yqzMSkfApgcc3aFeD0-Pxgww/exec';

let songs = [], filteredSongs = [], currentSong = null, currentModeList = [], transposeStep = 0, fontSize = 17, chordsVisible = true, isAdmin = false, selectedSongIds = [], adminPassword = "";
const scale = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "B", "H"];

// RESET FUNKCIA
async function smartReset() {
    if (!navigator.onLine) {
        closeSong();
        renderAllSongs();
        window.scrollTo(0,0);
        return;
    }
    localStorage.clear();
    if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map(n => caches.delete(n)));
    }
    window.location.reload(true);
}

// NAČÍTANIE PIESNÍ
async function loadSongs() {
    try {
        const response = await fetch(SCRIPT_URL);
        const xmlText = await response.text();
        if (xmlText.includes('<song>')) {
            localStorage.setItem('cached_xml', xmlText);
            parseXML(xmlText);
        } else {
            throw new Error("Invalid response");
        }
    } catch (e) {
        const cached = localStorage.getItem('cached_xml');
        if (cached) parseXML(cached);
        else document.getElementById('piesne-list').innerHTML = "Chyba pripojenia. Skontroluj internet.";
    }
}

function parseXML(xmlText) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, "text/xml");
    const nodes = xml.getElementsByTagName('song');
    
    songs = Array.from(nodes).map(node => {
        const rawId = node.getElementsByTagName('author')[0]?.textContent || "";
        let displayId = rawId.startsWith('M') ? "M " + rawId.substring(1).replace(/^0+/, '') : rawId;
        return {
            id: node.getElementsByTagName('ID')[0]?.textContent,
            title: node.getElementsByTagName('title')[0]?.textContent || "Bez názvu",
            originalId: rawId,
            displayId: displayId,
            text: node.getElementsByTagName('songtext')[0]?.textContent || ""
        };
    });

    songs.sort((a, b) => {
        const numA = parseInt(a.originalId.replace(/\D/g, '')) || 0;
        const numB = parseInt(b.originalId.replace(/\D/g, '')) || 0;
        return numA - numB;
    });

    filteredSongs = [...songs];
    currentModeList = [...songs];
    renderAllSongs();
    loadPlaylists();
}

function renderAllSongs() {
    const list = document.getElementById('piesne-list');
    list.innerHTML = filteredSongs.map(s => `
        <div class="list-item" onclick="openSong('${s.id}')">
            <span><span class="song-num">${s.displayId}</span> ${s.title}</span>
            ${isAdmin ? `<button onclick="event.stopPropagation(); toggleSelection('${s.id}')" style="background:#00bfff; color:black; border:none; border-radius:5px; padding:5px 10px; font-weight:bold;">+</button>` : ''}
        </div>
    `).join('');
}

// PLAYLISTY
async function loadPlaylists() {
    try {
        const res = await fetch(`${SCRIPT_URL}?action=list`);
        const data = await res.json();
        localStorage.setItem('cached_playlists', JSON.stringify(data));
        renderPlaylistHeaders(data);
    } catch (e) {
        const cached = localStorage.getItem('cached_playlists');
        if (cached) renderPlaylistHeaders(JSON.parse(cached));
    }
}

function renderPlaylistHeaders(data) {
    const div = document.getElementById('playlists-section');
    if (!data || data.length === 0) { div.innerHTML = ""; return; }
    div.innerHTML = '<h2 class="playlist-header-title">Playlisty</h2>' + data.map(p => `
        <div class="list-item" onclick="openPlaylist('${p.name}')">
            <span><i class="fas fa-music" style="color:#00bfff; margin-right:10px;"></i> ${p.name}</span>
            ${isAdmin ? `<i class="fas fa-trash" onclick="event.stopPropagation(); deletePlaylist('${p.name}')" style="color:red;"></i>` : ''}
        </div>
    `).join('');
}

function openPlaylist(name) {
    const cached = localStorage.getItem('playlist_data_' + name);
    if (cached) {
        displayPlaylistSongs(name, cached);
        // Na pozadí aktualizuj
        fetch(`${SCRIPT_URL}?action=get&name=${encodeURIComponent(name)}`)
            .then(r => r.text()).then(t => localStorage.setItem('playlist_data_' + name, t));
    } else {
        fetch(`${SCRIPT_URL}?action=get&name=${encodeURIComponent(name)}`)
            .then(r => r.text()).then(t => {
                localStorage.setItem('playlist_data_' + name, t);
                displayPlaylistSongs(name, t);
            });
    }
}

function displayPlaylistSongs(name, idsString) {
    const ids = idsString.split(',');
    currentModeList = ids.map(id => songs.find(s => s.id === id)).filter(x => x);
    document.getElementById('piesne-list').innerHTML = `
        <div style="text-align:center; padding-bottom:15px; border-bottom:1px solid #333; margin-bottom:15px;">
            <h2 style="color:#00bfff; margin:0;">${name}</h2>
            <button onclick="smartReset()" style="background:none; border:1px solid red; color:red; border-radius:20px; padding:5px 15px; margin-top:10px;">Zavrieť playlist</button>
        </div>
    ` + currentModeList.map(s => `
        <div class="list-item" onclick="openSong('${s.id}')">
            <span><span class="song-num">${s.displayId}</span> ${s.title}</span>
        </div>
    `).join('');
    window.scrollTo(0,0);
}

// PIESEŇ DETAIL
function openSong(id) {
    const s = songs.find(x => x.id === id);
    if (!s) return;
    currentSong = s;
    transposeStep = 0;
    document.getElementById('transpose-val').innerText = "0";
    document.getElementById('song-list').style.display = 'none';
    document.getElementById('song-detail').style.display = 'block';
    document.getElementById('render-title').innerText = s.displayId + ". " + s.title;
    renderText();
    window.scrollTo(0,0);
}

function renderText() {
    let text = currentSong.text;
    if (transposeStep !== 0) {
        text = text.replace(/\[(.*?)\]/g, (m, chord) => `[${transposeChord(chord, transposeStep)}]`);
    }
    if (!chordsVisible) {
        text = text.replace(/\[.*?\]/g, '');
    }
    const el = document.getElementById('song-content');
    el.innerHTML = text.replace(/\[(.*?)\]/g, '<span class="chord">$1</span>');
    el.style.fontSize = fontSize + 'px';
}

function transposeChord(chord, step) {
    return chord.replace(/[A-H][#b]?/g, (note) => {
        let n = note === 'B' ? 'B' : (note === 'H' ? 'H' : note);
        let idx = scale.indexOf(n);
        if (idx === -1) return note;
        let newIdx = (idx + step) % 12;
        while (newIdx < 0) newIdx += 12;
        return scale[newIdx];
    });
}

// OVLÁDANIE
function closeSong() { document.getElementById('song-list').style.display = 'block'; document.getElementById('song-detail').style.display = 'none'; }
function navigateSong(dir) {
    const idx = currentModeList.findIndex(s => s.id === currentSong.id);
    const next = currentModeList[idx + dir];
    if (next) openSong(next.id);
}
function transposeSong(dir) { transposeStep += dir; document.getElementById('transpose-val').innerText = transposeStep; renderText(); }
function resetTranspose() { transposeStep = 0; document.getElementById('transpose-val').innerText = "0"; renderText(); }
function toggleChords() { chordsVisible = !chordsVisible; renderText(); }
function changeFontSize(dir) { fontSize += dir; renderText(); }
function filterSongs() {
    const q = document.getElementById('search').value.toLowerCase();
    filteredSongs = songs.filter(s => s.title.toLowerCase().includes(q) || s.displayId.toLowerCase().includes(q));
    renderAllSongs();
}

// ADMIN
function unlockAdmin() { let p = prompt("Heslo:"); if (p === "qwer") { isAdmin = true; adminPassword = p; document.getElementById('admin-panel').style.display = "block"; renderAllSongs(); } }
function toggleSelection(id) { if (!selectedSongIds.includes(id)) selectedSongIds.push(id); renderEditor(); }
function renderEditor() {
    const div = document.getElementById('selected-list-editor');
    div.innerHTML = selectedSongIds.map(id => {
        const s = songs.find(x => x.id === id);
        return `<div style="font-size:12px; margin-bottom:5px;">${s ? s.title : id}</div>`;
    }).join('');
}
function clearSelection() { selectedSongIds = []; renderEditor(); }
function savePlaylist() {
    const name = document.getElementById('playlist-name').value;
    if (!name) return alert("Zadaj názov");
    window.open(`${SCRIPT_URL}?action=save&name=${encodeURIComponent(name)}&pwd=${adminPassword}&content=${selectedSongIds.join(',')}`, '_blank');
}

// ŠTART
document.addEventListener('DOMContentLoaded', loadSongs);
