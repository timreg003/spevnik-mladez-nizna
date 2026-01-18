let songs = [];
let currentPlaylist = [];
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
        
        // Hľadanie pôvodnej tóniny z textu (tvoja pôvodná logika)
        const firstChordMatch = songText.match(/\[([A-H][#b]?[m]?)\]/);
        const originalKey = firstChordMatch ? firstChordMatch[1] : "Neznáma";

        return {
          id: getVal('ID'),
          title: getVal('title') || "Bez názvu",
          displayId: getVal('author') || "",
          text: songText,
          origText: songText,
          originalKey: originalKey
        };
      });

      renderAllSongs();
      loadPlaylistHeaders();
    });
}

function renderAllSongs() {
  currentPlaylist = [];
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
    // V Admin režime kliknutie pridáva do playlistu, inak otvára pieseň
    const clickAction = isAdmin ? `addToSelection('${s.id}')` : `openSongByIndex(${idx})`;
    return `
      <div onclick="${clickAction}" style="display:flex; justify-content:space-between; align-items:center; background:#1e1e1e; padding:14px; margin-bottom:8px; border-radius:10px; cursor:pointer; border: ${isAdmin && selectedSongIds.includes(s.id) ? '1px solid #00bfff' : 'none'};">
        <div style="flex-grow:1;">
          <span style="color: #00bfff; font-weight: bold; margin-right: 8px;">${s.displayId}.</span> ${s.title}
        </div>
        ${isAdmin ? `<i class="fas ${selectedSongIds.includes(s.id) ? 'fa-check-circle' : 'fa-plus-circle'}" style="color:#00bfff;"></i>` : ''}
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
  
  // Vrátenie názvu a tóniny do detailu
  let headerHtml = `
    <h2 style="margin-top:0; color:#00bfff; font-size:1.5em;">${currentSong.displayId}. ${currentSong.title}</h2>
    <p style="color:#888; font-size:0.9em; margin-bottom:20px;">Pôvodná tónina: <b>${currentSong.originalKey}</b></p>
  `;

  let text = currentSong.text;
  if (!chordsVisible) text = text.replace(/\[.*?\]/g, '');
  else text = text.replace(/\[(.*?)\]/g, '<span class="chord">$1</span>');

  const contentEl = document.getElementById('song-content');
  contentEl.innerHTML = headerHtml + text;
  contentEl.style.fontSize = fontSize + "px";
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
    const currentPos = currentPlaylist.findIndex(s => s.id === currentSong.id);
    const nextPos = currentPos + step;
    if (nextPos >= 0 && nextPos < currentPlaylist.length) {
      targetIdx = songs.findIndex(s => s.id === currentPlaylist[nextPos].id);
    }
  } else {
    targetIdx = currentSong.originalIndex + step;
  }
  if (targetIdx !== undefined && targetIdx >= 0 && targetIdx < songs.length) openSongByIndex(targetIdx);
}

function changeFontSize(step) { fontSize += step; renderSong(); }
function toggleChords() { chordsVisible = !chordsVisible; renderSong(); }

// --- ADMIN & PLAYLIST ---
function unlockAdmin() {
  const p = prompt("Heslo:");
  if (p) { adminPassword = p; isAdmin = true; document.getElementById('admin-panel').style.display = 'block'; renderAllSongs(); loadPlaylistHeaders(); }
}

function addToSelection(id) {
  const index = selectedSongIds.indexOf(id);
  if (index === -1) selectedSongIds.push(id);
  else selectedSongIds.splice(index, 1);
  renderSelected();
  renderAllSongs(); // Aktualizuje fajky v zozname
}

function moveInSelection(index, direction) {
  const newIndex = index + direction;
  if (newIndex >= 0 && newIndex < selectedSongIds.length) {
    const temp = selectedSongIds[index];
    selectedSongIds[index] = selectedSongIds[newIndex];
    selectedSongIds[newIndex] = temp;
    renderSelected();
  }
}

function renderSelected() {
  document.getElementById('selected-list').innerHTML = selectedSongIds.map((id, i) => {
    const s = songs.find(x => x.id === id);
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; background:#2a2a2a; margin-bottom:4px; border-radius:5px;">
        <span style="font-size:13px;">${s.title}</span>
        <div style="display:flex; gap:12px; align-items:center;">
          <i class="fas fa-arrow-up" onclick="event.stopPropagation(); moveInSelection(${i}, -1)" style="cursor:pointer; color:#00bfff;"></i>
          <i class="fas fa-arrow-down" onclick="event.stopPropagation(); moveInSelection(${i}, 1)" style="cursor:pointer; color:#00bfff;"></i>
          <i class="fas fa-times" onclick="event.stopPropagation(); selectedSongIds.splice(${i},1); renderSelected(); renderAllSongs();" style="color:red; cursor:pointer;"></i>
        </div>
      </div>`;
  }).join('');
}

function savePlaylist() {
  const name = document.getElementById('playlist-name').value;
  if (!name || !selectedSongIds.length) return alert("Zadaj názov!");
  
  const cleanUrl = SCRIPT_URL.split('?')[0];
  const params = new URLSearchParams({
    action: 'save',
    name: name,
    pwd: adminPassword,
    content: selectedSongIds.join(',')
  });

  fetch(`${cleanUrl}?${params.toString()}`)
    .then(r => r.text()).then(res => { 
        alert(res); 
        if(res.includes("Uložené")) { 
            selectedSongIds = []; 
            document.getElementById('playlist-name').value = "";
            isAdmin = false;
            document.getElementById('admin-panel').style.display = 'none';
            renderSelected(); 
            renderAllSongs();
            loadPlaylistHeaders(); 
        } 
    });
}

function loadPlaylistHeaders() {
  const cleanUrl = SCRIPT_URL.split('?')[0];
  fetch(`${cleanUrl}?action=list&t=${Date.now()}`)
    .then(r => r.json()).then(data => {
      const container = document.getElementById('playlists-section');
      if (!data || !data.length) { container.innerHTML = ""; return; }
      container.innerHTML = "<h2>Dnešný program</h2>" + data.map(p => `
        <div style="background:#1e1e1e; border: 1px solid #333; padding:14px; margin-bottom:8px; border-radius:10px; cursor:pointer; display:flex; justify-content:space-between;" onclick="openPlaylist('${p.name}')">
          <span><i class="fas fa-layer-group" style="margin-right:10px; color:#00bfff;"></i>${p.name}</span>
          ${isAdmin ? `<i class="fas fa-trash" onclick="event.stopPropagation(); deletePlaylist('${p.name}')" style="color:red; padding:0 5px;"></i>` : ''}
        </div>`).join('');
    });
}

function openPlaylist(name) {
  const cleanUrl = SCRIPT_URL.split('?')[0];
  fetch(`${cleanUrl}?action=get&name=${encodeURIComponent(name)}&t=${Date.now()}`)
    .then(r => r.text()).then(idsText => {
      const ids = idsText.split(',');
      currentPlaylist = ids.map(id => songs.find(s => s.id === id)).filter(x => x);
      document.getElementById('piesne-title').innerText = name;
      document.getElementById('piesne-list').innerHTML = `<button onclick="renderAllSongs(); document.getElementById('piesne-title').innerText='Piesne';" style="width:100%; padding:14px; margin-bottom:15px; background:#2a2a2a; color:#00bfff; border-radius:10px; border:1px solid #333; cursor:pointer; font-weight:bold;">⬅ Späť na všetky piesne</button>` + currentPlaylist.map(s => {
        const idx = songs.findIndex(x => x.id === s.id);
        return `<div onclick="openSongByIndex(${idx})" style="background:#1e1e1e; padding:14px; margin-bottom:8px; border-radius:10px; cursor:pointer;"><span style="color: #00bfff; font-weight: bold; margin-right: 8px;">${s.displayId}.</span> ${s.title}</div>`;
      }).join('');
      window.scrollTo(0, 0);
    });
}

function deletePlaylist(name) {
  if (confirm("Zmazať " + name + "?")) {
    const cleanUrl = SCRIPT_URL.split('?')[0];
    fetch(`${cleanUrl}?action=delete&name=${encodeURIComponent(name)}&pwd=${encodeURIComponent(adminPassword)}`)
      .then(() => loadPlaylistHeaders());
  }
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
