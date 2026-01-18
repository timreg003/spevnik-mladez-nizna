let songs = [];
let currentPlaylist = []; // Tu držíme poradie práve otvoreného playlistu
let currentSong = null;
let transposeStep = 0;
let fontSize = 17;
let chordsVisible = true;
let isAdmin = false;
let selectedSongIds = [];
let adminPassword = "";

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxEfu4yOq0BE4gcr4hOaElvVCNzvmZOSgmbeyy4gOqfIxAhBjRgzDPixYNXbn9_UoXbsw/exec';

function parseXML() {
  fetch(SCRIPT_URL + (SCRIPT_URL.includes('?') ? '&' : '?') + "t=" + new Date().getTime())
    .then(res => res.text())
    .then(xmlText => {
      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlText, 'application/xml');
      const songNodes = xml.getElementsByTagName('song');
      
      songs = Array.from(songNodes).map(song => {
        const getVal = (tagName) => song.getElementsByTagName(tagName)[0]?.textContent.trim() || "";
        const songText = getVal('songtext') || "";
        return {
          id: getVal('ID'),
          title: getVal('title') || "Bez názvu",
          displayId: getVal('author') || "",
          text: songText,
          origText: songText
        };
      });

      renderAllSongs();
      loadPlaylistHeaders();
    });
}

function renderAllSongs() {
  currentPlaylist = []; // Keď sme v režime "všetky", zmažeme playlistovú navigáciu
  const container = document.getElementById('piesne-list');
  
  const numericSongs = songs.filter(s => /^\d+$/.test(s.displayId)).sort((a, b) => parseInt(a.displayId) - parseInt(b.displayId));
  const mSongs = songs.filter(s => s.displayId.startsWith('M')).sort((a, b) => {
      const numA = parseInt(a.displayId.replace(/\D/g, '')) || 0;
      const numB = parseInt(b.displayId.replace(/\D/g, '')) || 0;
      return numA - numB;
  });
  const others = songs.filter(s => !/^\d+$/.test(s.displayId) && !s.displayId.startsWith('M'));

  const sorted = [...numericSongs, ...mSongs, ...others];
  
  container.innerHTML = sorted.map(s => {
    const idx = songs.findIndex(x => x.id === s.id);
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; background:#1e1e1e; padding:14px; margin-bottom:8px; border-radius:10px; cursor:pointer;">
        <div onclick="openSongByIndex(${idx})" style="flex-grow:1;">
          <span style="color: #00bfff; font-weight: bold; margin-right: 8px;">${s.displayId}.</span> ${s.title}
        </div>
        ${isAdmin ? `<button onclick="addToSelection('${s.id}')" style="background:#00bfff; color:black; border:none; border-radius:50%; width:30px; height:30px; font-weight:bold; cursor:pointer;">+</button>` : ''}
      </div>
    `;
  }).join('');
}

function openLiturgieSong(name) {
  const songIdx = songs.findIndex(s => s.title.toLowerCase().includes(name.toLowerCase()));
  if (songIdx !== -1) openSongByIndex(songIdx);
}

function openSongByIndex(index) {
  currentSong = { ...songs[index], originalIndex: index };
  transposeStep = 0;
  document.getElementById('song-list').style.display = 'none';
  document.getElementById('song-detail').style.display = 'block';
  renderSong();
  window.scrollTo(0, 0);
}

function renderSong() {
  if (!currentSong) return;
  let text = currentSong.text;
  if (!chordsVisible) text = text.replace(/\[.*?\]/g, '');
  else text = text.replace(/\[(.*?)\]/g, '<span class="chord">$1</span>');
  document.getElementById('song-content').innerHTML = text;
  document.getElementById('song-content').style.fontSize = fontSize + "px";
  document.getElementById('transpose-val').innerText = (transposeStep > 0 ? "+" : "") + transposeStep;
}

function transposeSong(step) {
  transposeStep += step;
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'B', 'H'];
  const transposeChord = (chord) => {
    return chord.replace(/[A-H][#b]?/g, (match) => {
      let n = match === 'Bb' || match === 'Hb' ? 'B' : match;
      let idx = notes.indexOf(n);
      if (idx === -1) return match;
      let newIdx = (idx + step) % 12;
      while (newIdx < 0) newIdx += 12;
      return notes[newIdx];
    });
  };
  currentSong.text = currentSong.origText.replace(/\[(.*?)\]/g, (m, c) => `[${transposeChord(c)}]`);
  renderSong();
}

function resetTranspose() { transposeStep = 0; currentSong.text = currentSong.origText; renderSong(); }
function closeSong() { document.getElementById('song-list').style.display = 'block'; document.getElementById('song-detail').style.display = 'none'; }

function navigateSong(step) {
  let targetIdx;
  if (currentPlaylist.length > 0) {
    // Ak hráme z playlistu, ideme podľa poradia v playliste
    const currentPos = currentPlaylist.findIndex(s => s.id === currentSong.id);
    const nextPos = currentPos + step;
    if (nextPos >= 0 && nextPos < currentPlaylist.length) {
      targetIdx = songs.findIndex(s => s.id === currentPlaylist[nextPos].id);
    }
  } else {
    // Inak ideme klasicky podľa zoznamu
    targetIdx = currentSong.originalIndex + step;
  }
  if (targetIdx !== undefined && targetIdx >= 0 && targetIdx < songs.length) openSongByIndex(targetIdx);
}

function changeFontSize(step) { fontSize += step; renderSong(); }
function toggleChords() { chordsVisible = !chordsVisible; renderSong(); }

// --- ADMIN & PLAYLIST LOGIKA ---
function unlockAdmin() {
  const p = prompt("Heslo:");
  if (p) { adminPassword = p; isAdmin = true; document.getElementById('admin-panel').style.display = 'block'; renderAllSongs(); loadPlaylistHeaders(); }
}

function addToSelection(id) {
  if (!selectedSongIds.includes(id)) { selectedSongIds.push(id); renderSelected(); }
}

function renderSelected() {
  document.getElementById('selected-list').innerHTML = selectedSongIds.map((id, i) => {
    const s = songs.find(x => x.id === id);
    return `<div style="display:flex; justify-content:space-between; padding:5px; background:#2a2a2a; margin-bottom:2px; border-radius:5px;"><span>${s.title}</span><span onclick="selectedSongIds.splice(${i},1);renderSelected();" style="color:red; cursor:pointer;">✕</span></div>`;
  }).join('');
}

function savePlaylist() {
  const name = document.getElementById('playlist-name').value;
  if (!name || !selectedSongIds.length) return alert("Zadaj názov!");
  fetch(`${SCRIPT_URL.split('?')[0]}?action=save&name=${encodeURIComponent(name)}&pwd=${encodeURIComponent(adminPassword)}&content=${selectedSongIds.join(',')}`)
    .then(r => r.text()).then(res => { alert(res); if(res === "Uložené") { selectedSongIds = []; renderSelected(); loadPlaylistHeaders(); } });
}

function loadPlaylistHeaders() {
  fetch(`${SCRIPT_URL.split('?')[0]}?action=list&t=${Date.now()}`)
    .then(r => r.json()).then(data => {
      const container = document.getElementById('playlists-section');
      if (!data.length) { container.innerHTML = ""; return; }
      container.innerHTML = "<h2>Playlisty</h2>" + data.map(p => `
        <div style="background:#1e1e1e; padding:14px; margin-bottom:8px; border-radius:10px; cursor:pointer; display:flex; justify-content:space-between;" onclick="openPlaylist('${p.name}')">
          <span>📄 ${p.name}</span>
          ${isAdmin ? `<span onclick="event.stopPropagation();deletePlaylist('${p.name}')" style="color:red;">🗑️</span>` : ''}
        </div>`).join('');
    });
}

function openPlaylist(name) {
  fetch(`${SCRIPT_URL.split('?')[0]}?action=get&name=${encodeURIComponent(name)}&t=${Date.now()}`)
    .then(r => r.text()).then(idsText => {
      const ids = idsText.split(',');
      currentPlaylist = ids.map(id => songs.find(s => s.id === id)).filter(x => x);
      document.getElementById('piesne-title').innerText = "Playlist: " + name;
      document.getElementById('piesne-list').innerHTML = `<button onclick="renderAllSongs(); document.getElementById('piesne-title').innerText='Piesne';" style="width:100%; padding:12px; margin-bottom:12px; background:#333; color:white; border-radius:10px; border:none; cursor:pointer;">⬅ Späť na všetky piesne</button>` + currentPlaylist.map(s => {
        const idx = songs.findIndex(x => x.id === s.id);
        return `<div onclick="openSongByIndex(${idx})" style="background:#1e1e1e; padding:14px; margin-bottom:8px; border-radius:10px; cursor:pointer;"><span style="color: #00bfff; font-weight: bold; margin-right: 8px;">${s.displayId}.</span> ${s.title}</div>`;
      }).join('');
    });
}

function deletePlaylist(name) {
  if (confirm("Zmazať playlist?")) fetch(`${SCRIPT_URL.split('?')[0]}?action=delete&name=${encodeURIComponent(name)}&pwd=${encodeURIComponent(adminPassword)}`).then(() => loadPlaylistHeaders());
}

document.addEventListener('DOMContentLoaded', () => {
  parseXML();
  document.getElementById('search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = songs.filter(s => s.title.toLowerCase().includes(q) || s.displayId.toLowerCase().includes(q));
    document.getElementById('piesne-list').innerHTML = filtered.map(s => {
       const idx = songs.findIndex(x => x.id === s.id);
       return `<div onclick="openSongByIndex(${idx})" style="background:#1e1e1e; padding:14px; margin-bottom:8px; border-radius:10px; cursor:pointer;"><span style="color: #00bfff; font-weight: bold; margin-right: 8px;">${s.displayId}.</span> ${s.title}</div>`;
    }).join('');
  });
});
