let songs = [], filteredSongs = [], currentSong = null, currentModeList = [], selectedSongIds = [];
let transposeStep = 0, fontSize = 17, chordsVisible = true, isAdmin = false, adminPassword = "";

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwF5BmjnJsRJmHpCIo4aU0v55CPh4LjrVD8xpeJktRAf4eT5dZyZkd1bZCmMlpq5_bfmw/exec';
const FORMSPREE_URL = 'https://formspree.io/f/mvzzkwlw';

function formatSongId(id) { 
    if (/^\d+$/.test(id)) return parseInt(id).toString();
    if (id.startsWith('M')) return "Mariánska " + parseInt(id.substring(1));
    return id; 
}

async function parseXML() {
    try {
        const res = await fetch(SCRIPT_URL + "?t=" + Date.now());
        const xmlText = await res.text();
        const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
        songs = Array.from(xml.getElementsByTagName('song')).map(s => {
            const txt = s.getElementsByTagName('songtext')[0]?.textContent || "";
            const auth = s.getElementsByTagName('author')[0]?.textContent || "";
            return {
                id: s.getElementsByTagName('ID')[0]?.textContent || "",
                title: s.getElementsByTagName('title')[0]?.textContent || "Bez názvu",
                displayId: auth,
                origText: txt,
                originalKey: txt.match(/\[([A-H][#b]?[m]?)\]/)?.[1] || "?"
            };
        });

        // Radenie: Čísla -> Mariánska -> Text
        songs.sort((a, b) => {
            const idA = a.displayId; const idB = b.displayId;
            const isNumA = /^\d+$/.test(idA); const isNumB = /^\d+$/.test(idB);
            const isMarA = idA.startsWith('M'); const isMarB = idB.startsWith('M');
            if (isNumA && !isNumB) return -1;
            if (!isNumA && isNumB) return 1;
            if (isNumA && isNumB) return parseInt(idA) - parseInt(idB);
            if (isMarA && !isMarB) return -1;
            if (!isMarA && isMarB) return 1;
            return idA.localeCompare(idB);
        });

        filteredSongs = [...songs];
        renderAllSongs();
        loadPlaylistHeaders();
    } catch (e) { document.getElementById('piesne-list').innerText = "Chyba pripojenia."; }
}

function renderAllSongs() {
    currentModeList = filteredSongs;
    document.getElementById('piesne-list').innerHTML = filteredSongs.map(s => {
        const isSel = selectedSongIds.includes(s.id);
        return `<div onclick="${isAdmin ? `addToSelection('${s.id}')` : `openSongById('${s.id}', 'all')`}" style="display:flex; justify-content:space-between; align-items:center; ${isSel?'border-color:#00bfff; background:#1a2a33;':''}">
            <div><span style="color:#00bfff; font-weight:bold; margin-right:8px;">${formatSongId(s.displayId)}.</span> ${s.title}</div>
            ${isAdmin ? `<i class="fas ${isSel?'fa-check-circle':'fa-plus-circle'}" style="color:#00bfff; font-size:1.2em;"></i>` : ''}
        </div>`;
    }).join('');
}

function renderSelected() {
    const container = document.getElementById('selected-list');
    if (selectedSongIds.length === 0) { container.innerHTML = "<small style='color:#555;'>Kliknite na piesne v zozname...</small>"; return; }
    container.innerHTML = selectedSongIds.map((id, i) => {
        const s = songs.find(x => x.id === id);
        return `<div class="admin-item">
            <i class="fas fa-chevron-up admin-btn" onclick="moveItem(${i},-1)"></i>
            <div style="flex-grow:1; text-align:center; font-weight:bold;">${s.title}</div>
            <div style="display:flex; gap:20px; align-items:center;">
                <i class="fas fa-chevron-down admin-btn" onclick="moveItem(${i},1)"></i>
                <i class="fas fa-trash-alt" style="color:#ff4444; padding:10px; cursor:pointer;" onclick="addToSelection('${id}')"></i>
            </div>
        </div>`;
    }).join('');
}

function moveItem(i, dir) {
    const target = i + dir;
    if (target >= 0 && target < selectedSongIds.length) {
        [selectedSongIds[i], selectedSongIds[target]] = [selectedSongIds[target], selectedSongIds[i]];
        renderSelected(); renderAllSongs();
    }
}

function addToSelection(id) {
    const idx = selectedSongIds.indexOf(id);
    if (idx === -1) selectedSongIds.push(id); else selectedSongIds.splice(idx, 1);
    renderSelected(); renderAllSongs();
}

function openSongById(id, mode) {
    const s = songs.find(x => x.id === id);
    if (!s) return;
    currentSong = JSON.parse(JSON.stringify(s));
    transposeStep = 0;
    document.getElementById('song-list').style.display = 'none';
    document.getElementById('song-detail').style.display = 'block';
    document.getElementById('render-title').innerText = formatSongId(currentSong.displayId) + ". " + currentSong.title;
    document.getElementById('render-key').innerText = "Tónina: " + currentSong.originalKey;
    document.getElementById('error-msg').value = ""; document.getElementById('error-name').value = "";
    renderSong();
    window.scrollTo(0,0);
}

function renderSong() {
    const notes = ['C','C#','D','D#','E','F','F#','G','G#','A','B','H'];
    const trans = (c, st) => c.replace(/[A-H][#b]?/g, m => {
        let n = (m==='Bb'||m==='Hb') ? 'B' : m;
        let i = notes.indexOf(n);
        if (i===-1) return m;
        let ni = (i + st) % 12; while(ni<0) ni+=12;
        return notes[ni];
    });
    let txt = currentSong.origText;
    if (transposeStep !== 0) txt = txt.replace(/\[(.*?)\]/g, (m, c) => `[${trans(c, transposeStep)}]`);
    txt = chordsVisible ? txt.replace(/\[(.*?)\]/g, '<span class="chord">$1</span>') : txt.replace(/\[.*?\]/g, '');
    const el = document.getElementById('song-content');
    el.innerHTML = txt; el.style.fontSize = fontSize + "px";
    document.getElementById('transpose-val').innerText = (transposeStep > 0 ? "+" : "") + transposeStep;
}

async function loadPlaylistHeaders() {
    try {
        const res = await fetch(`${SCRIPT_URL}?action=list&t=${Date.now()}`);
        const data = await res.json();
        const container = document.getElementById('playlists-section');
        if (!data.length) { container.innerHTML = ""; return; }
        container.innerHTML = "<h2>PLAYLISTY</h2>" + data.map(p => `
            <div style="display:flex; justify-content:space-between; align-items:center;" onclick="openPlaylist('${p.name}')">
                <span>📄 ${p.name}</span>
                ${isAdmin ? `<i class="fas fa-trash-alt" style="color:#ff4444; padding:10px;" onclick="event.stopPropagation(); deletePlaylist('${p.name}')"></i>` : ''}
            </div>`).join('') + "<hr>";
    } catch(e) {}
}

async function savePlaylist() {
    const name = document.getElementById('playlist-name').value;
    if (!name || !selectedSongIds.length) return alert("Názov chýba!");
    const url = `${SCRIPT_URL}?action=save&name=${encodeURIComponent(name)}&pwd=${encodeURIComponent(adminPassword)}&content=${selectedSongIds.join(',')}`;
    try { await fetch(url); alert("Uložené!"); location.reload(); } catch(e) { alert("Chyba pri ukladaní."); }
}

async function deletePlaylist(name) {
    if(!confirm("Zmazať "+name+"?")) return;
    const url = `${SCRIPT_URL}?action=delete&name=${encodeURIComponent(name)}&pwd=${encodeURIComponent(adminPassword)}`;
    try { await fetch(url); loadPlaylistHeaders(); } catch(e) { alert("Zmazané."); }
}

async function openPlaylist(name) {
    const res = await fetch(`${SCRIPT_URL}?action=get&name=${encodeURIComponent(name)}&t=${Date.now()}`);
    const ids = (await res.text()).split(',');
    currentModeList = ids.map(id => songs.find(s => s.id === id)).filter(x => x);
    document.getElementById('piesne-list').innerHTML = `<button onclick="location.reload()" style="width:100%; margin-bottom:10px; background:#2a2a2a; color:#00bfff; padding:12px; border-radius:10px; font-weight:bold; border:1px solid #333;">⬅ SPÄŤ</button>` + 
        currentModeList.map(s => `<div onclick="openSongById('${s.id}','playlist')"><span style="color:#00bfff; font-weight:bold;">${formatSongId(s.displayId)}.</span> ${s.title}</div>`).join('');
    window.scrollTo(0,0);
}

function sendErrorReport() {
    const name = document.getElementById('error-name').value;
    const msg = document.getElementById('error-msg').value;
    if(!msg) return alert("Napíšte chybu.");
    const btn = document.getElementById('error-btn');
    btn.innerText = "ODOSIELAM..."; btn.disabled = true;
    fetch(FORMSPREE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pieseň: currentSong.title, meno: name, správa: msg })
    }).then(() => {
        alert("Nahlásené. Vďaka!");
        document.getElementById('error-msg').value = ""; document.getElementById('error-name').value = "";
    }).finally(() => {
        btn.innerText = "ODOSLAŤ"; btn.disabled = false;
    });
}

function filterSongs() {
    const term = document.getElementById('search').value.toLowerCase();
    filteredSongs = songs.filter(s => s.title.toLowerCase().includes(term) || formatSongId(s.displayId).toLowerCase().includes(term));
    renderAllSongs();
}
function navigateSong(step) {
    const idx = currentModeList.findIndex(s => s.id === currentSong.id);
    if (idx + step >= 0 && idx + step < currentModeList.length) openSongById(currentModeList[idx+step].id);
}
function transposeSong(s) { transposeStep += s; renderSong(); }
function resetTranspose() { transposeStep = 0; renderSong(); }
function toggleChords() { chordsVisible = !chordsVisible; renderSong(); }
function changeFontSize(s) { fontSize += s; renderSong(); }
function closeSong() { document.getElementById('song-list').style.display='block'; document.getElementById('song-detail').style.display='none'; }
function unlockAdmin() { const p = prompt("Heslo:"); if(p){ adminPassword=p; isAdmin=true; document.getElementById('admin-panel').style.display='block'; renderAllSongs(); loadPlaylistHeaders(); } }

document.addEventListener('DOMContentLoaded', parseXML);
