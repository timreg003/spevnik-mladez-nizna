let songs = [];
let currentSong = null;
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
      
      let allSongs = Array.from(songNodes).map(song => ({
        title: song.querySelector('title')?.textContent.trim() || "Bez názvu",
        text: song.querySelector('songtext')?.textContent.trim() || ""
      }));

      const textSongs = allSongs.filter(s => !/^\d+(\.\d+)?$/.test(s.title));
      const numSongs  = allSongs.filter(s =>  /^\d+(\.\d+)?$/.test(s.title));
      textSongs.sort((a, b) => a.title.localeCompare(b.title, 'sk'));
      numSongs.sort((a, b) => parseFloat(a.title) - parseFloat(b.title));
      
      songs = [...textSongs, ...numSongs];
      displayPiesne(songs);
    })
    .catch(err => console.error("Chyba pri načítaní XML:", err));
}

function displayPiesne(list) {
  const listDiv = document.getElementById('piesne-list');
  if (!listDiv) return;
  listDiv.innerHTML = '';
  list.forEach(song => {
    const div = document.createElement('div');
    div.textContent = song.title;
    div.onclick = () => { currentGroup = 'piesne'; showSong(song); };
    listDiv.appendChild(div);
  });
}

function showSong(song) {
  currentSong = song;
  transposeStep = 0;

  // NASTAVENIE PREDMETU PRE FORMULÁR
  const subjectInput = document.getElementById('email-subject');
  if(subjectInput) subjectInput.value = "Oprava piesne: " + song.title;

  const firstChordMatch = song.text.match(/\[(.*?)\]/);
  baseKey = firstChordMatch ? firstChordMatch[1].match(/[A-H][#b]?/)?.[0] || 'C' : 'C';

  document.getElementById('song-list').style.display = 'none';
  document.getElementById('song-display').style.display = 'block';
  document.getElementById('song-title').textContent = song.title;
  
  chordsVisible = true;
  const btn = document.getElementById('chord-btn');
  if(btn) { btn.innerHTML = '<i class="fas fa-eye"></i>'; btn.style.color = '#fff'; }

  updateTransposeDisplay();
  renderSong(song.text);
  window.scrollTo(0, 0);
}

function renderSong(text) {
  const contentDiv = document.getElementById('song-content');
  if (!contentDiv) return;
  contentDiv.innerHTML = text.replace(/\[(.*?)\]/g, (match, chord) => {
    const transposed = transposeChord(chord, transposeStep);
    return chordsVisible ? `<span class="chord">${transposed}</span>` : '';
  });
}

function transposeChord(chord, steps) {
  if (steps === 0) return chord;
  const scale = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'H'];
  const rootMatch = chord.match(/^([A-H][#b]?)/);
  if (!rootMatch) return chord;
  const root = rootMatch[1];
  const suffix = chord.substring(root.length);
  const map = {'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'F':5,'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':10,'H':11,'Cb':11};
  let index = map[root];
  if (index === undefined) return chord;
  return scale[(index + steps + 120) % 12] + suffix;
}

function transposeSong(direction) {
  let next = transposeStep + direction;
  if (next >= -12 && next <= 12) {
    transposeStep = next;
    updateTransposeDisplay();
    renderSong(currentSong.text);
  }
}

function resetTranspose() {
  transposeStep = 0;
  updateTransposeDisplay();
  renderSong(currentSong.text);
}

function openLiturgieSong(title) {
  const s = songs.find(s => s.title.toLowerCase() === title.toLowerCase());
  if (s) { currentGroup = 'liturgia'; showSong(s); }
}

function navigateSong(direction) {
  const lit = ['Pane zmiluj sa', 'Aleluja', 'Svätý', 'Otče náš', 'Baránok'];
  let group = currentGroup === 'liturgia' 
    ? lit.map(t => songs.find(s => s.title.toLowerCase() === t.toLowerCase())).filter(Boolean)
    : songs.filter(s => !lit.map(p => p.toLowerCase()).includes(s.title.toLowerCase()));
  
  let idx = group.indexOf(currentSong);
  if (idx !== -1 && group[idx + direction]) showSong(group[idx + direction]);
}

function backToList() {
  document.getElementById('song-list').style.display = 'block';
  document.getElementById('song-display').style.display = 'none';
}

function toggleChords() {
  chordsVisible = !chordsVisible;
  const btn = document.getElementById('chord-btn');
  btn.innerHTML = chordsVisible ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>';
  btn.style.color = chordsVisible ? '#fff' : '#555';
  renderSong(currentSong.text);
}

function updateTransposeDisplay() {
  document.getElementById('base-key').textContent = baseKey;
  document.getElementById('transpose-offset').textContent = (transposeStep > 0 ? "+" : "") + transposeStep;
}

function changeFontSize(delta) {
  fontSize = Math.max(12, Math.min(35, fontSize + delta));
  document.getElementById('song-content').style.fontSize = fontSize + 'px';
}

document.addEventListener('DOMContentLoaded', () => {
  parseXML();
  const sInput = document.getElementById('search');
  if(sInput) {
    sInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      const filtered = songs.filter(s => s.title.toLowerCase().includes(query));
      displayPiesne(filtered);
    });
  }
});
