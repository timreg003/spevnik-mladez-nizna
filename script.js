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
      document.getElementById('playlist-creator').style.display = 'none';
      return;
    } else {
      localStorage.removeItem('playlist');
      localStorage.removeItem('playlistTime');
      localStorage.removeItem('playlistName');
    }
  }
  document.getElementById('public-playlist-section').style.display = 'none';
  document.getElementById('playlist-creator').style.display = 'block';
}

function renderPublicPlaylist() {
  const list = document.getElementById('public-playlist-list');
  list.innerHTML = '';
  const name = localStorage.getItem('playlistName') || 'Verejný playlist';
  document.getElementById('public-playlist-title').textContent = name;

  playlist.forEach(song => {
    const li = document.createElement('li');
    li.innerHTML = `<i class="fas fa-music"></i> ${song.title}`;
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
    document.getElementById('playlist-creator').style.display = 'block';
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
  const checkboxes = document.querySelectorAll('#song-list input[type="checkbox"]:checked');
  checkboxes.forEach(cb => {
    selected.push({ title: cb.value });
  });
  if (selected.length === 0) {
    alert('Vyber aspoň jednu pieseň');
    return;
  }

  playlist = selected;
  localStorage.setItem('playlist', JSON.stringify(playlist));
  localStorage.setItem('playlistName', name.trim());
  localStorage.setItem('playlistTime', Date.now().toString());

  renderPublicPlaylist();
  document.getElementById('playlist-creator').style.display = 'none';
  document.getElementById('public-playlist-section').style.display = 'block';
  alert('Playlist vytvorený!');
}

// === NAČÍTANIE PLAYLISTU Z XML ===
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
      document.getElementById('playlist-creator').style.display = 'none';
      return;
    } else {
      localStorage.removeItem('playlist');
      localStorage.removeItem('playlistTime');
      localStorage.removeItem('playlistName');
    }
  }
  document.getElementById('public-playlist-section').style.display = 'none';
  document.getElementById('playlist-creator').style.display = 'block';
}

// === HLAVNÉ FUNKCIE ===
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
    div.innerHTML = `<i class="fas fa-music"></i> ${song.title}`;
    div.onclick = () => showSong(song);
    listDiv.appendChild(div);
  });
}

function showSong(song) {
  currentSong = song;
  transposeStep = 0;
  document.getElementById('song-list').style.display = 'none';
  document.getElementById('song-display').style.display = 'block';
  document.getElementById('song-title').textContent = song.title;
  renderSong(song.text);
}

function renderSong(text) {
  const content = text.replace(/\[(.*?)\]/g, (match, chord) => {
    const transposed = transposeChord(chord, transposeStep);
    return `<span class="chord">${transposed}</span>`;
  });
  document.getElementById('song-content').innerHTML = content;
}

function transposeChord(chord, steps) {
  const chromatic = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const root = chord.match(/[A-G][#b]?/);
  if (!root) return chord;
  const rootOnly = root[0];
  const suffix = chord.replace(rootOnly, '');
  const index = chromatic.indexOf(rootOnly);
  if (index === -1) return chord;
  const newIndex = (index + steps + 12) % 12;
  return chromatic[newIndex] + suffix;
}

function transposeSong(direction) {
  transposeStep += direction;
  renderSong(currentSong.text);
}

function changeFontSize(delta) {
  fontSize = Math.max(12, Math.min(28, fontSize + delta));
  document.getElementById('song-content').style.fontSize = fontSize + 'px';
  localStorage.setItem('fontSize', fontSize);
}

window.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('fontSize');
  if (saved) {
    fontSize = parseInt(saved);
    document.getElementById('song-content').style.fontSize = fontSize + 'px';
  }
});

function backToList() {
  document.getElementById('song-list').style.display = 'block';
  document.getElementById('song-display').style.display = 'none';
}

document.getElementById('search').addEventListener('input', e => {
  const query = e.target.value.toLowerCase();
  const filtered = songs.filter(s => s.title.toLowerCase().includes(query));
  renderSongList(filtered);
});

parseXML();
