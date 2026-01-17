let songs = [];
let currentSong = null;
let transposeStep = 0;

const chordRegex = /\b[A-G][#b]?(m|maj|min|sus|dim|aug)?[0-9]*/g;

function parseXML() {
  fetch('export.zpk.xml')
    .then(res => res.text())
    .then(xmlText => {
      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlText, 'application/xml');
      const songNodes = xml.querySelectorAll('song');
      songs = Array.from(songNodes).map(song => ({
        id: song.querySelector('ID').textContent.trim(),
        title: song.querySelector('title').textContent.trim(),
        text: song.querySelector('songtext').textContent.trim()
      }));
      displayList(songs);
    });
}

function displayList(list) {
  const listDiv = document.getElementById('song-list');
  listDiv.innerHTML = '';
  list.forEach(song => {
    const div = document.createElement('div');
    div.textContent = `${song.id}. ${song.title}`;
    div.onclick = () => showSong(song);
    listDiv.appendChild(div);
  });
}

function showSong(song) {
  currentSong = song;
  transposeStep = 0;
  document.getElementById('song-list').style.display = 'none';
  document.getElementById('song-display').style.display = 'block';
  document.getElementById('song-title').textContent = `${song.id}. ${song.title}`;
  renderSong(song.text);
}

function renderSong(text) {
  const cleaned = text.replace(/\[|\]/g, ''); // odstráni hranaté zátvorky
  const content = cleaned.replace(chordRegex, match => {
    const transposed = transposeChord(match, transposeStep);
    return `<span class="chord">${transposed}</span>`;
  });
  document.getElementById('song-content').innerHTML = content;
}

function transposeChord(chord, steps) {
  const chromatic = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const root = chord.match(/[A-G][#b]?/)[0];
  const suffix = chord.replace(root, '');
  const index = chromatic.indexOf(root);
  const newIndex = (index + steps + 12) % 12;
  return chromatic[newIndex] + suffix;
}

function transposeSong(direction) {
  transposeStep += direction;
  renderSong(currentSong.text);
}

function backToList() {
  document.getElementById('song-list').style.display = 'block';
  document.getElementById('song-display').style.display = 'none';
}

document.getElementById('search').addEventListener('input', e => {
  const query = e.target.value.toLowerCase();
  const filtered = songs.filter(s =>
    `${s.id}. ${s.title}`.toLowerCase().includes(query)
  );
  displayList(filtered);
});

parseXML();
