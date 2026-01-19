const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyyrD8pCxgQYiERsOsDFJ_XoBEbg6KYe1oM8Wj9IAzkq4yqzMSkfApgcc3aFeD0-Pxgww/exec';

let songs = [], filteredSongs = [], currentSong = null;
let currentModeList = []; 
let transposeStep = 0, fontSize = 17, chordsVisible = true, isAdmin = false, selectedSongIds = [];
const scale = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "B", "H"];
let autoscrollInterval = null;
let currentLevel = 1;

// Obnova po kliknutí na domček
function smartReset() {
    stopAutoscroll(); logoutAdmin();
    document.getElementById('song-detail').style.display = 'none';
    document.getElementById('song-list').style.display = 'block';
    document.getElementById('search').value = "";
    currentModeList = [...songs]; filterSongs(); window.scrollTo(0,0);
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
        else document.getElementById('piesne-list').innerText = "Chyba spojenia.";
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

    // Triedenie podľa tvojho kódu
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
    renderAllSongs(); loadPlaylistHeaders();
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
    const firstChordMatch = s.origText.match(/\[(.*?)\]/);
    document.getElementById('original-key-label').innerText = "Pôvodná tónina: " + (firstChordMatch ? firstChordMatch[1] : "-");
    renderSong(); window.scrollTo(0,0);
}

// Ostatné funkcie (renderSong, navigateSong, autoscroll...) zostávajú presne tak, ako sú v tvojom súbore script.js
// ...
document.addEventListener('DOMContentLoaded', parseXML);
