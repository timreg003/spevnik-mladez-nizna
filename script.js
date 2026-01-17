let songs = [];
let currentSong = null;
let transposeStep = 0;
let fontSize = 17;
let playlist = [];

const PLAYLIST_DURATION = 144 * 60 * 60 * 1000; // 144 hodín v ms

// === NAČÍTANIE A AKTUALIZÁCIA PLAYLISTU ===
function loadPlaylist() {
  const saved = localStorage.getItem('playlist');
  const savedTime = localStorage.getItem('playlistTime');
  const now = Date.now();

  if (saved && savedTime) {
    const age = now - parseInt(savedTime);
    if (age < PLAYLIST_DURATION) {
      playlist = JSON.parse(saved);
      renderPlaylist();
      document.getElementById('playlist-section').style.display = 'block';
      return;
    } else {
      // vypršalo – vymažeme
      localStorage.removeItem('playlist');
      localStorage.removeItem('playlistTime');
    }
  }
  document.getElementById('playlist-section').style.display = 'none';
}

function savePlaylist() {
  localStorage.setItem('playlist', JSON.stringify(playlist));
  localStorage.setItem('playlistTime', Date.now().toString());
}

function renderPlaylist() {
  const list = document.getElementById('playlist-list');
  list.innerHTML = '';
  playlist.forEach((item, index) => {
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.index = index;

    li.innerHTML = `
      <i class="fas fa-grip-vertical drag-handle"></i>
      <span>${item.title}</span>
      <button class="remove-song" onclick="removeSongFromPlaylist(${index})"><i class="fas fa-times"></i></button>
    `;

    li.addEventListener('dragstart', handleDragStart);
    li.addEventListener('dragover', handleDragOver);
    li.addEventListener('drop', handleDrop);
    list.appendChild(li);
  });
}

function removeSongFromPlaylist(index) {
  playlist.splice(index, 1);
  savePlaylist();
  renderPlaylist();
  if (playlist.length === 0) {
    document.getElementById('playlist-section').style.display = 'none';
  }
}

function removePlaylist() {
  if (confirm('Odstrániť celý playlist?')) {
    playlist = [];
    localStorage.removeItem('playlist');
    localStorage.removeItem('playlistTime');
    document.getElementById('playlist-section').style.display = 'none';
  }
}

// === DRAG & DROP PRE ZMENENIE PORADIA ===
let draggedIndex = null;

function handleDragStart(e) {
  draggedIndex = parseInt(e.target.dataset.index);
}

function handleDragOver(e) {
  e.preventDefault();
}

function handleDrop(e) {
  e.preventDefault();
  const dropIndex = parseInt(e.target.closest('li').dataset.index);
  if (draggedIndex === dropIndex) return;
  const draggedItem = playlist[draggedIndex];
  playlist.splice(draggedIndex, 1);
  playlist.splice(dropIndex, 0, draggedItem);
  savePlaylist();
  renderPlaylist();
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
      renderPlaylist();
      addPlaylistCreator();
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
