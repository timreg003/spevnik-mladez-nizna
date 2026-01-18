let songs = [];
let currentSong = null;
let transposeStep = 0;
let fontSize = 17;
let chordsVisible = true;
let isAdmin = false;
let selectedSongIds = [];
let adminPassword = "";

const SCRIPT_URL = 'TVOJA_URL_Z_GOOGLE_SCRIPTu'; // <--- SEM DAJ SVOJU URL!

// 1. NAČÍTANIE PIESNÍ A PLAYLISTOV
function init() {
    fetch(SCRIPT_URL)
        .then(res => res.text())
        .then(xmlText => {
            const parser = new DOMParser();
            const xml = parser.parseFromString(xmlText, 'application/xml');
            const songNodes = xml.getElementsByTagName('song');
            
            songs = Array.from(songNodes).map(song => {
                const getVal = (t) => song.getElementsByTagName(t)[0]?.textContent.trim() || "";
                const author = getVal('author');
                let sortPriority = 3;
                let sortNum = 0;
                let displayId = author;

                if (author.startsWith('M')) {
                    sortPriority = 2;
                    sortNum = parseInt(author.replace(/\D/g, '')) || 0;
                    displayId = "M " + sortNum;
                } else if (/^\d+$/.test(author)) {
                    sortPriority = 1;
                    sortNum = parseInt(author);
                    displayId = sortNum.toString();
                }

                return {
                    id: getVal('ID'),
                    displayId: displayId,
                    sortPriority: sortPriority,
                    sortNum: sortNum,
                    title: getVal('title'),
                    text: getVal('songtext')
                };
            });

            songs.sort((a, b) => {
                if (a.sortPriority !== b.sortPriority) return a.sortPriority - b.sortPriority;
                if (a.sortPriority < 3) return a.sortNum - b.sortNum;
                return a.title.localeCompare(b.title, 'sk');
            });

            renderList(songs);
            loadPlaylistHeaders();
        });
}

// 2. RENDEROVANIE ZOZNAMU
function renderList(list) {
    const container = document.getElementById('piesne-list');
    container.innerHTML = list.map((s, idx) => {
        // Vyhľadáme index v pôvodnom poli songs pre navigáciu
        const originalIdx = songs.findIndex(x => x.id === s.id);
        return `
        <div class="song-item">
            <div class="song-info" onclick="openSongByIndex(${originalIdx})">
                <span class="song-number">${s.displayId}.</span> ${s.title}
            </div>
            ${isAdmin ? `<button class="add-btn" onclick="addToSelection('${s.id}')">+</button>` : ''}
        </div>
    `}).join('');
}

// 3. ADMIN FUNKCIE A PLAYLISTY
function unlockAdmin() {
    const p = prompt("Zadaj heslo pre úpravy:");
    if (p) {
        adminPassword = p;
        isAdmin = true;
        document.getElementById('admin-panel').style.display = 'block';
        renderList(songs); // Refreshne zoznam s pluskami
    }
}

function addToSelection(id) {
    if (!selectedSongIds.includes(id)) {
        selectedSongIds.push(id);
        renderSelection();
    }
}

function renderSelection() {
    const container = document.getElementById('current-selection-list');
    container.innerHTML = selectedSongIds.map((id, idx) => {
        const s = songs.find(x => x.id === id);
        return `
            <div class="selection-item">
                ${s.title} 
                <button onclick="moveSelection(${idx}, -1)">↑</button>
                <button onclick="moveSelection(${idx}, 1)">↓</button>
                <button onclick="removeFromSelection(${idx})" style="color:red">X</button>
            </div>
        `;
    }).join('');
}

function moveSelection(idx, dir) {
    const target = idx + dir;
    if (target >= 0 && target < selectedSongIds.length) {
        const temp = selectedSongIds[idx];
        selectedSongIds[idx] = selectedSongIds[target];
        selectedSongIds[target] = temp;
        renderSelection();
    }
}

function removeFromSelection(idx) {
    selectedSongIds.splice(idx, 1);
    renderSelection();
}

function savePlaylist() {
    const name = document.getElementById('playlist-name').value;
    if (!name || selectedSongIds.length === 0) return alert("Zadaj názov a vyber piesne!");
    
    const btn = document.getElementById('save-btn');
    btn.disabled = true;
    btn.textContent = "Ukladám...";

    const url = `${SCRIPT_URL}?action=save&name=${encodeURIComponent(name)}&pwd=${adminPassword}&content=${selectedSongIds.join(',')}`;

    fetch(url).then(r => r.text()).then(res => {
        alert(res);
        btn.disabled = false;
        btn.textContent = "Uložiť pre všetkých";
        if (res === "Uložené") {
            selectedSongIds = [];
            renderSelection();
            loadPlaylistHeaders();
        }
    });
}

function loadPlaylistHeaders() {
    fetch(`${SCRIPT_URL}?action=list`)
        .then(r => r.json())
        .then(data => {
            const container = document.getElementById('playlists-container');
            if (data.length === 0) {
                container.innerHTML = "Žiadne uložené playlisty.";
                return;
            }
            container.innerHTML = data.map(p => `
                <div class="playlist-row">
                    <button onclick="openPlaylist('${p.name}')">📄 ${p.name}</button>
                    ${isAdmin ? `<button onclick="deletePlaylist('${p.name}')" style="color:red">🗑️</button>` : ''}
                </div>
            `).join('');
        });
}

function openPlaylist(name) {
    fetch(`${SCRIPT_URL}?action=get&name=${encodeURIComponent(name)}`)
        .then(r => r.text())
        .then(idsText => {
            const ids = idsText.split(',');
            // Vytvoríme dočasné pole piesní v poradí z playlistu
            const playlistSongs = ids.map(id => songs.find(s => s.id === id)).filter(x => x);
            renderList(playlistSongs);
            alert("Playlist načítaný. Kliknutím na pieseň ju otvoríš.");
        });
}

function deletePlaylist(name) {
    if (confirm(`Naozaj zmazať ${name}?`)) {
        fetch(`${SCRIPT_URL}?action=delete&name=${encodeURIComponent(name)}&pwd=${adminPassword}`)
            .then(() => loadPlaylistHeaders());
    }
}

function clearSelection() {
    selectedSongIds = [];
    renderSelection();
}

// LOGIKA ZOBRAZOVANIA (PÔVODNÁ)
function openSongByIndex(index) {
    const s = songs[index];
    if(!s) return;
    currentSong = { ...s, currentIndex: index };
    transposeStep = 0;
    document.getElementById('song-list').style.display = 'none';
    document.getElementById('song-detail').style.display = 'block';
    document.getElementById('song-title').textContent = s.displayId + ". " + s.title;
    renderSong();
    window.scrollTo(0,0);
}

function renderSong() {
    if(!currentSong) return;
    let txt = currentSong.text.replace(/\[(.*?)\]/g, (m, c) => {
        return chordsVisible ? `<span class="chord">${transposeChord(c, transposeStep)}</span>` : '';
    });
    document.getElementById('song-content').innerHTML = txt;
    document.getElementById('song-content').style.fontSize = fontSize + 'px';
}

function transposeChord(chord, step) {
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'B', 'H'];
    return chord.replace(/[A-H][#b]?/g, (match) => {
        let n = (match === 'Bb' || match === 'Hb') ? 'B' : match;
        let idx = notes.indexOf(n);
        if(idx === -1) return match;
        let newIdx = (idx + step) % 12;
        while(newIdx < 0) newIdx += 12;
        return notes[newIdx];
    });
}

function transposeSong(s) { 
    if (transposeStep + s >= -12 && transposeStep + s <= 12) {
        transposeStep += s; 
        document.getElementById('transpose-val').textContent = (transposeStep > 0 ? "+" : "") + transposeStep;
        renderSong(); 
    }
}
function resetTranspose() { transposeStep = 0; document.getElementById('transpose-val').textContent = "0"; renderSong(); }
function closeSong() { document.getElementById('song-list').style.display = 'block'; document.getElementById('song-detail').style.display = 'none'; }
function changeFontSize(s) { fontSize += s; renderSong(); }
function toggleChords() { chordsVisible = !chordsVisible; renderSong(); }
function navigateSong(d) { openSongByIndex(currentSong.currentIndex + d); }

document.addEventListener('DOMContentLoaded', () => {
    init();
    document.getElementById('search').addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        const filtered = songs.filter(s => s.title.toLowerCase().includes(q) || s.displayId.toLowerCase().includes(q));
        renderList(filtered);
    });
});
