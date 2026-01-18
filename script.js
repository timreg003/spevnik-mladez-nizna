const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyyrD8pCxgQYiERsOsDFJ_XoBEbg6KYe1oM8Wj9IAzkq4yqzMSkfApgcc3aFeD0-Pxgww/exec';

let songs = [], filteredSongs = [], currentSong = null, currentModeList = [], transposeStep = 0, fontSize = 17, chordsVisible = true, isAdmin = false, selectedSongIds = [], adminPassword = "";
const scale = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "B", "H"];

// Zjednodušený domček - len návrat na zoznam bez mazania a pýtania sa
function smartReset() {
    closeSong();      // Zavrie otvorenú pieseň
    filterSongs();    // Zruší vyhľadávanie a vráti zoznam na začiatok
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
        let displayId = rawId.startsWith('M') ? "Mariánska " + rawId.substring(1).replace(/^0+/, '') : rawId;
        return { id: s.getElementsByTagName('ID')[0]?.textContent.trim(), title: s.getElementsByTagName('title')[0]?.textContent.trim(), originalId: rawId, displayId: displayId, origText: text };
    });
    songs.sort((a, b) => {
        const isNumA = /^\d+$/.test(a.originalId), isNumB = /^\d+$/.test(b.originalId);
        if (isNumA && isNumB) return parseInt(a.originalId) - parseInt(b.originalId);
        return a.originalId.localeCompare(b.originalId);
    });
    filteredSongs = [...songs]; currentModeList = [...songs];
    renderAllSongs(); loadPlaylistHeaders();
}

function renderAllSongs() {
    document.getElementById('piesne-list').innerHTML = filteredSongs.map(s => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom: 1px solid #333;" onclick="openSongById('${s.id}')">
            <span><span style="color:#00bfff;font-weight:bold;">${s.displayId}.</span> ${s.title}</span>
            ${isAdmin ? `<button onclick="event.stopPropagation(); addToSelection('${s.id}')" style="background:#00bfff; color:black; border-radius:4px; font-weight:bold; width:30px; height:30px; border:none;">+</button>` : ''}
        </div>`).join('');
}

function loadPlaylistHeaders() {
    fetch(`${SCRIPT_URL}?action=list`)
    .then(r => r.json())
    .then(d => { localStorage.setItem('offline_playlists', JSON.stringify(d)); renderPlaylists(d); })
    .catch(() => { const saved = localStorage.getItem('offline_playlists'); if (saved) renderPlaylists(JSON.parse(saved)); });
}

function renderPlaylists(d) {
    const sect = document.getElementById('playlists-section');
    if (!d || d.length === 0) { sect.innerHTML = ""; return; }
    sect.innerHTML = '<h2 class="playlist-header-title">Playlisty</h2>' + d.map(p => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:15px; border-bottom: 1px solid #333;" onclick="openPlaylist('${p.name}')">
            <span style="cursor:pointer; flex-grow:1; display:flex; align-items:center;">
                <i class="fas fa-music" style="color:#00bfff; margin-right:12px; width:20px; text-align:center;"></i>
                ${p.name}
            </span>
            ${isAdmin ? `<div style="display:flex; gap:20px;"><i class="fas fa-trash" onclick="event.stopPropagation(); deletePlaylist('${p.name}')" style="color:#ff4444;"></i></div>` : ''}
        </div>`).join('');
}

function openPlaylist(name) {
    const cached = localStorage.getItem('playlist_' + name);
    if (cached) {
        processOpenPlaylist(name, cached);
        if (navigator.onLine) {
            setTimeout(() => {
                fetch(`${SCRIPT_URL}?action=get&name=${encodeURIComponent(name)}`)
                .then(r => r.text())
                .then(t => { if (t !== cached) { localStorage.setItem('playlist_' + name, t); processOpenPlaylist(name, t); } });
            }, 100);
        }
    } else {
        document.getElementById('piesne-list').innerHTML = '<div style="text-align:center; padding:20px; color:#00bfff;">Sťahujem...</div>';
        fetch(`${SCRIPT_URL}?action=get&name=${encodeURIComponent(name)}`)
        .then(r => r.text())
        .then(t => { localStorage.setItem('playlist_' + name, t); processOpenPlaylist(name, t); });
    }
}

function processOpenPlaylist(name, t) {
    const ids = t.split(',');
    currentModeList = ids.map(id => songs.find(s => s.id === id)).filter(x => x);
    document.getElementById('piesne-list').innerHTML = `
    <div style="text-align:center; padding:15px; border-bottom:2px solid #00bfff; margin-bottom:15px;">
        <h2 class="playlist-header-title" style="font-size:1.3em; margin:0;">${name}</h2>
        <button onclick="smartReset()" style="background:none; color:#ff4444; border:1px solid #ff4444; padding:6px 16px; border-radius:20px; cursor:pointer; margin-top:10px; font-weight:bold;">ZAVRIEŤ</button>
    </div>` +
    currentModeList.map(s => `<div onclick="openSongById('${s.id}')" style="padding:15px; border-bottom: 1px solid #333;"><span style="color:#00bfff;font-weight:bold;">${s.displayId}.</span> ${s.title}</div>`).join('');
    window.scrollTo(0,0);
}

function openSongById(id) {
    const s = songs.find(x => x.id === id); if (!s) return;
    currentSong = JSON.parse(JSON.stringify(s)); transposeStep = 0;
    document.getElementById('transpose-val').innerText = "0";
    document.getElementById('form-subject').value = `Chyba v piesni: ${s.displayId}. ${s.title}`;
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

function filterSongs() {
    const t = document.getElementById('search').value.toLowerCase();
    filteredSongs = songs.filter(s => s.title.toLowerCase().includes(t) || s.displayId.toLowerCase().includes(t));
    renderAllSongs();
}

function navigateSong(d) {
    const idx = currentModeList.findIndex(s => s.id === currentSong.id);
    const n = currentModeList[idx + d]; if (n) openSongById(n.id);
}

function closeSong() { document.getElementById('song-list').style.display = 'block'; document.getElementById('song-detail').style.display = 'none'; }
function transposeSong(d) { transposeStep += d; document.getElementById('transpose-val').innerText = (transposeStep > 0 ? "+" : "") + transposeStep; renderSong(); }
function resetTranspose() { transposeStep = 0; document.getElementById('transpose-val').innerText = "0"; renderSong(); }
function toggleChords() { chordsVisible = !chordsVisible; renderSong(); }
function changeFontSize(d) { fontSize += d; renderSong(); }

function unlockAdmin() { let p = prompt('Heslo:'); if (p === "qwer") { adminPassword = p; isAdmin = true; document.getElementById('admin-panel').style.display = 'block'; renderAllSongs(); loadPlaylistHeaders(); } }
function addToSelection(id) { selectedSongIds.push(id); renderEditor(); }
function clearSelection() { selectedSongIds = []; document.getElementById('playlist-name').value = ""; renderEditor(); }
function removeFromSelection(idx) { selectedSongIds.splice(idx, 1); renderEditor(); }
function renderEditor() {
    const container = document.getElementById('selected-list-editor');
    if (selectedSongIds.length === 0) { container.innerHTML = '<div style="color: #666; text-align: center; padding: 10px;">Prázdny playlist</div>'; return; }
    container.innerHTML = selectedSongIds.map((id, index) => {
        const s = songs.find(x => x.id === id);
        return `<div style="display:flex; align-items:center; background:#1e1e1e; margin-bottom:2px; padding:5px; border-radius:4px; gap:5px; border-bottom:1px solid #333;"><span style="flex-grow:1; font-size:13px; color:white;">${s ? s.title : id}</span><button onclick="removeFromSelection(${index})" style="padding:4px; background:#ff4444;"><i class="fas fa-times"></i></button></div>`;
    }).join('');
}
function savePlaylist() {
    const name = document.getElementById('playlist-name').value;
    if (!name || !selectedSongIds.length) return alert('Zadaj názov');
    window.open(`${SCRIPT_URL}?action=save&name=${encodeURIComponent(name)}&pwd=${adminPassword}&content=${selectedSongIds.join(',')}`, '_blank','width=300,height=200');
}
function deletePlaylist(name) {
    if (!confirm(`Vymazať ${name}?`)) return;
    window.open(`${SCRIPT_URL}?action=delete&name=${encodeURIComponent(name)}&pwd=${adminPassword}`, '_blank','width=300,height=200');
}

// Odosielanie chyby
document.getElementById('error-form').addEventListener('submit', function(e) {
    e.preventDefault();
    const btn = document.getElementById('form-submit-btn');
    btn.innerText = "ODOSIELAM...";
    btn.disabled = true;

    fetch("https://formsubmit.co/ajax/3860436856002f5674749f57d69280f8", {
        method: "POST",
        body: new FormData(this)
    })
    .then(res => res.json())
    .then(data => {
        alert("Chyba bola nahlásená. Ďakujeme!");
        this.reset();
        btn.innerText = "ODOSLAŤ CHYBU";
        btn.disabled = false;
    })
    .catch(err => {
        alert("Chyba pri odosielaní.");
        btn.innerText = "ODOSLAŤ CHYBU";
        btn.disabled = false;
    });
});

document.addEventListener('DOMContentLoaded', parseXML);
