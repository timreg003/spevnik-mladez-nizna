const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyyrD8pCxgQYiERsOsDFJ_XoBEbg6KYe1oM8Wj9IAzkq4yqzMSkfApgcc3aFeD0-Pxgww/exec';

let songs = [], filteredSongs = [], currentSong = null;
let currentModeList = []; 
let transposeStep = 0, fontSize = 17, chordsVisible = true, isAdmin = false, selectedSongIds = [], adminPassword = "";
const scale = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "B", "H"];

// Autoscroll nastavenia
let autoscrollInterval = null;
let currentLevel = 1; // Začíname na rýchlosti 1

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

    // RADENIE: 1. Čísla, 2. Mariánske (M), 3. Textové ID
    songs.sort((a, b) => {
        const idA = a.originalId;
        const idB = b.originalId;
        const isNumA = /^\d+$/.test(idA), isNumB = /^\d+$/.test(idB);
        const isMarA = idA.startsWith('M'), isMarB = idB.startsWith('M');

        if (isNumA && !isNumB) return -1;
        if (!isNumA && isNumB) return 1;
        if (isNumA && isNumB) return parseInt(idA) - parseInt(idB);

        if (isMarA && !isMarB) return -1;
        if (!isMarA && isMarB) return 1;
        if (isMarA && isMarB) {
            const numA = parseInt(idA.substring(1)) || 0;
            const numB = parseInt(idB.substring(1)) || 0;
            return numA - numB;
        }

        return idA.localeCompare(idB);
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

// FORMULÁR BEZ PREKLIKU
async function submitErrorForm(e) {
    e.preventDefault();
    const btn = document.getElementById('submit-btn');
    const status = document.getElementById('form-status');
    const form = document.getElementById('error-form');
    
    btn.disabled = true;
    btn.innerText = "ODOSIELAM...";

    const formData = new FormData(form);
    
    try {
        const response = await fetch("https://formspree.io/f/mvzzkwlw", {
            method: "POST",
            body: formData,
            headers: { 'Accept': 'application/json' }
        });

        if (response.ok) {
            status.innerText = "Vďaka! Správa bola odoslaná.";
            status.style.display = "block";
            form.reset();
            setTimeout(() => { status.style.display = "none"; }, 4000);
        } else {
            alert("Chyba pri odosielaní.");
        }
    } catch (err) {
        alert("Chyba spojenia.");
    } finally {
        btn.disabled = false;
        btn.innerText = "ODOSLAŤ";
    }
}

function openSongById(id, source) {
    const s = songs.find(x => x.id === id); if (!s) return;
    if (source === 'all') currentModeList = [...songs];
    currentSong = JSON.parse(JSON.stringify(s));
    transposeStep = 0;
    
    // Reset rýchlosti na 1 pri každom otvorení novej piesne
    currentLevel = 1; 
    updateSpeedUI();
    stopAutoscroll();

    document.getElementById('song-list').style.display = 'none';
    document.getElementById('song-detail').style.display = 'block';
    const titleStr = s.displayId + '. ' + s.title;
    document.getElementById('render-title').innerText = titleStr;
    document.getElementById('form-subject').value = "Chyba v piesni: " + titleStr;
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
    stopAutoscroll();
    const idx = currentModeList.findIndex(s => s.id === currentSong.id);
    const n = currentModeList[idx + d]; 
    if (n) {
        openSongById(n.id, 'playlist');
    }
}

function toggleAutoscroll() {
    const btn = document.getElementById('scroll-btn');
    if (autoscrollInterval) {
        stopAutoscroll();
    } else {
        btn.innerHTML = '<i class="fas fa-pause"></i>';
        btn.classList.add('active');
        startScrolling();
    }
}

function startScrolling() {
    if (autoscrollInterval) clearInterval(autoscrollInterval);
    
    // Logika: Úroveň 1 = najpomalšia (delay 250ms), Úroveň 20 = najrýchlejšia (delay 10ms)
    let delay = 260 - (currentLevel * 12); 
    if (delay < 5) delay = 5;

    autoscrollInterval = setInterval(() => {
        window.scrollBy(0, 1);
        if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight) stopAutoscroll();
    }, delay);
}

function stopAutoscroll() {
    if (autoscrollInterval) { clearInterval(autoscrollInterval); autoscrollInterval = null; }
    const btn = document.getElementById('scroll-btn');
    if (btn) { btn.innerHTML = '<i class="fas fa-play"></i>'; btn.classList.remove('active'); }
}

function changeScrollSpeed(delta) {
    currentLevel += delta;
    if (currentLevel < 1) currentLevel = 1;
    if (currentLevel > 20) currentLevel = 20;
    
    updateSpeedUI();
    if (autoscrollInterval) startScrolling(); // Reštartuje interval s novým delayom
}

function updateSpeedUI() {
    const label = document.getElementById('speed-label');
    if(label) label.innerText = "Rýchlosť: " + currentLevel;
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

function unlockAdmin() { let p = prompt('Heslo:'); if (p === "qwer") { adminPassword = p; isAdmin = true; document.getElementById('admin-panel').style.display = 'block'; renderAllSongs(); loadPlaylistHeaders(); } }
function addToSelection(id) { if(!selectedSongIds.includes(id)) selectedSongIds.push(id); renderEditor(); }
function clearSelection() { selectedSongIds = []; document.getElementById('playlist-name').value = ""; renderEditor(); }
function removeFromSelection(idx) { selectedSongIds.splice(idx, 1); renderEditor(); }
function renderEditor() {
    const container = document.getElementById('selected-list-editor');
    if (selectedSongIds.length === 0) { container.innerHTML = '<div style="color: #666; text-align: center; padding: 10px;">Prázdny playlist</div>'; return; }
    container.innerHTML = selectedSongIds.map((id, index) => {
        const s = songs.find(x => x.id === id);
        return `<div style="display:flex; align-items:center; background:#1e1e1e; margin-bottom:2px; padding:5px; border-radius:4px; gap:5px; border-bottom:1px solid #333;"><span style="flex-grow:1; font-size:13px; color:white;">${s ? s.title : id}</span><button onclick="removeFromSelection(${index})" style="padding:4px; background:#ff4444; border:none; color:white;"><i class="fas fa-times"></i></button></div>`;
    }).join('');
}

function savePlaylist() {
    const name = document.getElementById('playlist-name').value;
    if (!name || !selectedSongIds.length) return alert('Zadaj názov');
    window.open(`${SCRIPT_URL}?action=save&name=${encodeURIComponent(name)}&pwd=${adminPassword}&content=${selectedSongIds.join(',')}`, '_blank','width=300,height=200');
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
    sect.innerHTML = '<h2 class="playlist-header-title">Playlisty</h2>' + d.map(p => `<div style="display:flex; justify-content:space-between; align-items:center; padding:15px; border-bottom: 1px solid #333;" onclick="openPlaylist('${p.name}')"><span style="cursor:pointer; flex-grow:1;"><i class="fas fa-music" style="color:#00bfff; margin-right:12px;"></i>${p.name}</span>${isAdmin ? `<i class="fas fa-trash" onclick="event.stopPropagation(); deletePlaylist('${p.name}')" style="color:#ff4444;"></i>` : ''}</div>`).join('');
}

function deletePlaylist(name) {
    if (!confirm(`Vymazať ${name}?`)) return;
    window.open(`${SCRIPT_URL}?action=delete&name=${encodeURIComponent(name)}&pwd=${adminPassword}`, '_blank','width=300,height=200');
}

document.addEventListener('DOMContentLoaded', parseXML);
