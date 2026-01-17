let songs = [];
let currentSong = null;
let transposeStep = 0;
let fontSize = 17;

function parseXML() {
  fetch('export.zpk.xml')
    .then(res => res.text())
    .then(xmlText => {
      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlText, 'application/xml');
      const songNodes = xml.querySelectorAll('song');
      songs = Array.from(songNodes).map(song => ({
        title: song.querySelector('title').textContent.trim(),
        text: song.querySelector('songtext').textContent.trim()
      })).sort((a, b) => a.title.localeCompare(b.title, 'sk'));
      displayList(songs);
    });
}

function displayList(list) {
  const listDiv = document.getElementById('song-list');
  listDiv.innerHTML = '';
  list.forEach(song => {
    const div = document.createElement('div');
    const isNumber = /^\d+(\.\d+)?$/.test(song.title);
    div.innerHTML = `<i class="fas fa-music"></i> ${isNumber ? `♪ ${song.title}` : song.title}`;
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
  displayList(filtered);
});

parseXML();
