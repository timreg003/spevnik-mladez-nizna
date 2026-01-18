let songs = [];
let currentSong = null;
let currentIndex = 0;
let transposeStep = 0;
let fontSize = 17;
let chordsVisible = true;
let currentGroup = 'piesne';
let baseKey = 'C';

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
      displayPiesne(songs);
    });
}

function displayPiesne(list) {
  const listDiv = document.getElementById('piesne-list');
  listDiv.innerHTML = '';
  list.forEach((song, index) => {
    const div = document.createElement('div');
    div.textContent = song.title;
    div.onclick = () => {
      currentGroup = 'piesne';
      showSong(song, index);
    };
    listDiv.appendChild(div);
  });
}

function showSong(song, index) {
  currentSong = song;
  currentIndex = index;
  transposeStep = 0;

  const firstChord = song.text.match(/\[(.*?)\]/);
  baseKey = firstChord ? firstChord[1].match(/[A-G][#b]?/)?.[0] || 'C' : 'C';

  document.getElementById('song-list').style.display = 'none';
  document.getElementById('song-display').style.display = 'block';
  document.getElementById('song-title').textContent = song.title;
  updateTransposeDisplay();
  renderSong(song.text);
}

function openLiturgieSong(title) {
  const matches = songs.filter(s => s.title.toLowerCase() === title.toLowerCase());
  if (matches.length === 0) return;

  currentGroup = 'liturgia';
  const song = matches[0];
  const globalIndex = songs.indexOf(song);
  showSong(song, globalIndex);
}

function renderSong(text) {
  let content = text.replace(/\[(.*?)\]/g, (match, chord) => {
    const transposed = transposeChord(chord, transposeStep);
    return chordsVisible ? `<span class="chord">${transposed}</span>` : '';
  });
  document.getElementById('song-content').innerHTML = content;
}

function transposeChord(chord, steps) {
  const chromaticH = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'H'];
  const chromaticB = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

  // H → B (pre transpozíciu)
  let normalized = chord.replace(/H/g, 'B').replace(/Bb/g, 'A#');

  const root = normalized.match(/[A-G][#b]?/);
  if (!root) return chord;

  const rootOnly = root[0];
  const suffix = normalized.replace(rootOnly, '');

  const index = chromaticB.indexOf(rootOnly);
  if (index === -1) return chord;

  const newIndex = (index + steps + 12) % 12;
  const newRootB = chromaticB[newIndex];

  // B → H (pre výstup)
  const finalRoot = newRootB === 'B' ? 'H' : newRootB;

  return finalRoot + suffix;
}

function transposeSong(direction) {
  transposeStep += direction;
  updateTransposeDisplay();
  renderSong(currentSong.text);
}

function updateTransposeDisplay() {
  document.getElementById('base-key').textContent = baseKey;
  document.getElementById('transpose-offset').textContent = transposeStep > 0 ? `+${transposeStep}` : transposeStep;
}

function changeFontSize(delta) {
  fontSize = Math.max(12, Math.min(28, fontSize + delta));
  document.getElementById('song-content').style.fontSize = fontSize + 'px';
  localStorage.setItem('fontSize', fontSize);
}

function toggleChords() {
  chordsVisible = !chordsVisible;
  document.getElementById('chord-toggle-text').textContent = chordsVisible ? 'Skryť akordy' : 'Zobraziť akordy';
  renderSong(currentSong.text);
}

function getCurrentGroupSongs() {
  const poradie = ['Pane zmiluj sa', 'Aleluja', 'Svätý', 'Otče náš', 'Baránok'];
  if (currentGroup === 'liturgia') {
    return poradie
      .map(title => songs.find(s => s.title.toLowerCase() === title.toLowerCase()))
      .filter(Boolean);
  }
  const liturgiaTitles = ['Pane zmiluj sa', 'Aleluja', 'Svätý', 'Otče náš', 'Baránok'];
  return songs.filter(s => !liturgiaTitles.includes(s.title));
}

function navigateSong(direction) {
  const group = getCurrentGroupSongs();
  const indexInGroup = group.indexOf(currentSong);
  const newIndex = indexInGroup + direction;
  if (newIndex >= 0 && newIndex < group.length) {
    const newSong = group[newIndex];
    const globalIndex = songs.indexOf(newSong);
    showSong(newSong, globalIndex);
  }
}

function backToList() {
  document.getElementById('song-list').style.display = 'block';
  document.getElementById('song-display').style.display = 'none';
  parseXML();
}

document.getElementById('search').addEventListener('input', e => {
  const query = e.target.value.toLowerCase();
  const filtered = songs.filter(s => s.title.toLowerCase().includes(query));
  displayPiesne(filtered);
});

window.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('fontSize');
  if (saved) {
    fontSize = parseInt(saved);
    document.getElementById('song-content').style.fontSize = fontSize + 'px';
  }
  parseXML();
});
