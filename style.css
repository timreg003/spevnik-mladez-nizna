let songs = [];
let currentSong = null;
let transposeStep = 0;
let fontSize = 17;
let playlist = [];
let currentPlaylistIndex = -1;

const PLAYLIST_DURATION = 144 * 60 * 60 * 1000; // 144 hodín

// === NAČÍTANIE A AKTUALIZÁCIA PLAYLISTU ===
function loadPlaylist() {
  const saved = localStorage.getItem('playlist');
  const savedTime = localStorage.getItem('playlistTime');
  const savedName = localStorage.getItem('playlistName');
  const now = Date.now();

  if (saved && savedTime) {
    const age = now - parseInt(savedTime);
    if (age < PLAYLIST_DURATION) {
      playlist = JSON.parse(saved);
      renderPublicPlaylist();
      document.getElementById('public-playlist-section').style.display = 'block';
      return;
    } else {
      localStorage.removeItem('playlist');
      localStorage.removeItem('playlistTime');
      localStorage.removeItem('playlistName');
    }
  }
  document.getElementById('public-playlist-section').style.display = 'none';
}

function renderPublicPlaylist() {
  const list = document.getElementById('public-playlist-list');
  list.innerHTML = '';
  const name = localStorage.getItem('playlistName') || 'Verejný playlist';
  document.getElementById('public-playlist-title').textContent = name;

  playlist.forEach(song => {
    const li = document.createElement('li');
    li.innerHTML = `${song.title}`;
    li.style.cursor = 'pointer';
    li.onclick = () => openPublicPlaylist();
    list.appendChild(li);
  });
}

function removePublicPlaylist() {
  if (confirm('Odstrániť verejný playlist?')) {
    localStorage.removeItem('playlist');
    localStorage.removeItem('playlistTime');
    localStorage.removeItem('playlistName');
    document.getElementById('public-playlist-section').style.display = 'none';
  }
}

function openPublicPlaylist() {
  if (playlist.length === 0) return;
  currentPlaylistIndex = 0;
  showSongFromPlaylist(0);
}

function showSongFromPlaylist(index) {
  if (index < 0 || index >= playlist.length) return;
  const song = songs.find(s => s.title === playlist[index].title);
  if (!song) return;
  currentPlaylistIndex = index;
  showSong(song);
}

function prevSong() {
  const currentIndex = songs.findIndex(s => s.title === currentSong.title);
  if (currentIndex > 0) {
    showSong(songs[currentIndex - 1]);
  }
}

function nextSong() {
  const currentIndex = songs.findIndex(s => s.title === currentSong.title);
  if (currentIndex < songs.length - 1) {
    showSong(songs[currentIndex + 1]);
  }
}

function prevInPlaylist() {
  if (currentPlaylistIndex > 0) {
    currentPlaylistIndex--;
    showSongFromPlaylist(currentPlaylistIndex);
  }
}

function nextInPlaylist() {
  if (currentPlaylistIndex < playlist.length - 1) {
    currentPlaylistIndex++;
    showSongFromPlaylist(currentPlaylistIndex);
  }
}

// === VYTVORENIE NOVÉHO PLAYLISTU ===
function startNewPlaylist() {
  const name = prompt('Názov nového playlistu (napr. nedeľa-29-6):');
  if (!name || !name.trim()) return;

  const selected = [];
  let more = true;
  while (more) {
    const title = prompt('Zadaj názov piesne (alebo nechaj prázdne pre ukončenie):');
    if (!title || !title.trim()) { more = false; break; }
    const found = songs.find(s => s.title.toLowerCase() === title.toLowerCase().trim());
    if (found) {
      selected.push({ title: found.title });
    } else {
      alert('Pieseň nebola nájdená – skús znova.');
    }
  }

  if (selected.length === 0) { alert('Neboli vybrané žiadne piesne'); return; }

  playlist = selected;
  localStorage.setItem('playlist', JSON.stringify(playlist));
  localStorage.setItem('playlistName', name.trim());
  localStorage.setItem('playlistTime', Date.now().toString());

  renderPublicPlaylist();
  document.getElementById('public-playlist-section').style.display = 'block';
  alert('Playlist vytvorený!');
}

function addToExistingPlaylist() {
  if (playlist.length === 0) { alert('Nie je žiadny existujúci playlist'); return; }
  const more = true;
  while (more) {
    const title = prompt('Zadaj názov piesne (alebo nechaj prázdne pre ukončenie):');
    if (!title || !title.trim()) { break; }
    const found = songs.find(s => s.title.toLowerCase() === title.toLowerCase().trim());
    if (found) {
      playlist.push({ title: found.title });
    } else {
      alert('Pieseň nebola nájdená – skús znova.');
    }
  }
  localStorage.setItem('playlist', JSON.stringify(playlist));
  localStorage.setItem('playlistTime', Date.now().toString());
  renderPublicPlaylist();
  alert('Pieseň pridaná!');
}

// === NAČÍTANIE PLAYLISTU Z XML ===
function parseXML() {
  fetch('export.zpk.xml')
    .then(res => res.text())
    .then(xmlText => {
      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlText, 'application/xml');
      const songNodes = xml.querySelectorAll('song');
      const all = Array.from(songNodes).map(song => ({
        title: song.querySelector('title').textContent.trim(),
        text: song.querySelector('songtext').textContent.trim()
      }));

      const text = all.filter(s => !/^\d+(\.\d+)?$/.test(s.title));
      const num  = all.filter(s =>  /^\d+(\.\d+)?$/.test(s.title));
      text.sort((a, b) => a.title.localeCompare(b.title, 'sk'));
      num.sort((a, b) => parseFloat(a.title) - parseFloat(b.title));
      songs = [...text, ...num];

      renderSongList(songs);
      loadPlaylist();
      renderPublicPlaylist();
    });
}

function renderSongList(list) {
  const listDiv = document.getElementById('song-list');
  listDiv.innerHTML = '';
  list.forEach(song => {
    const div = document.createElement('div');
    div.innerHTML = `${song.title}`;
    div.style.cursor = 'pointer';
    div.onclick = () => showSong(song);
    div.style.fontSize = '19px';
    div.style.lineHeight = '1.9';
    div.style.padding = '14px';
    div.style.borderBottom = '1px solid #2a2a2a';
    div.style.borderRadius = '8px';
    div.style.marginBottom = '10px';
    div.style.background = '#1e1e1e';
    div.style.transition = 'background 0.2s';
    div.onmouseenter = () => div.style.background = '#2a2a2a';
    div.onmouseleave = () => div.style.background = '#1e1e1e';
    listDiv.appendChild(div);
  });
}

parseXML();
