let songs = [];
let currentSong = null;
let transposeStep = 0;
let fontSize = 17;
let chordsVisible = true;
let currentGroup = 'piesne';
let baseKey = 'C';

// 1. NAČÍTANIE XML (Základná funkcia)
function parseXML() {
  fetch('export.zpk.xml')
    .then(res => res.text())
    .then(xmlText => {
      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlText, 'application/xml');
      const songNodes = xml.querySelectorAll('song');
      
      let all = Array.from(songNodes).map(song => ({
        title: song.querySelector('title')?.textContent.trim() || "Bez názvu",
        text: song.querySelector('songtext')?.textContent.trim() || ""
      }));

      const textS = all.filter(s => !/^\d+(\.\d+)?$/.test(s.title));
      const numS  = all.filter(s =>  /^\d+(\.\d+)?$/.test(s.title));
      textS.sort((a, b) => a.title.localeCompare(b.title, 'sk'));
      numS.sort((a, b) => parseFloat(a.title) - parseFloat(b.title));
      
      songs = [...textS, ...numS];
      displayPiesne(songs);
    })
    .catch(err => console.error("Chyba načítania:", err));
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

// 2. OVLÁDANIE PIESNE
function showSong(song) {
  currentSong = song;
  transposeStep = 0;

  const subj = document.getElementById('email-subject');
  if(subj) subj.value = "Oprava: " + song.title;

  const firstChordMatch = song.text.match(/\[(.*?)\]/);
  baseKey = firstChordMatch ? firstChordMatch[1].match(/[A-H][#b]?/)?.[0] || 'C' : 'C';

  document.getElementById('song-list').style.display = 'none';
  document.getElementById('song-display').style.display = 'block';
  document.getElementById('song-title').textContent = song.title;
  document.getElementById('form-status').textContent = "";
  
  chordsVisible = true;
  updateTransposeDisplay();
  renderSong(song.text);
  window.scrollTo(0, 0);
}

function renderSong(text) {
  const content = document.getElementById('song-content');
  if (!content) return;
  content.innerHTML = text.replace(/\[(.*?)\]/g, (match, chord) => {
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

function transposeSong(dir) {
  transposeStep = Math.max(-12, Math.min(12, transposeStep + dir));
  updateTransposeDisplay();
  renderSong(currentSong.text);
}

function resetTranspose() {
  transposeStep = 0;
  updateTransposeDisplay();
  renderSong(currentSong.text);
}

function navigateSong(dir) {
  const litTitles = ['Pane zmiluj sa', 'Aleluja', 'Svätý', 'Otče náš', 'Baránok'];
  let group = currentGroup === 'liturgia' 
    ? litTitles.map(t => songs.find(s => s.title.toLowerCase() === t.toLowerCase())).filter(Boolean)
    : songs.filter(s => !litTitles.map(p => p.toLowerCase()).includes(s.title.toLowerCase()));
  
  let idx = group.indexOf(currentSong);
  if (idx !== -1 && group[idx + dir]) showSong(group[idx + dir]);
}

function backToList() {
  document.getElementById('song-list').style.display = 'block';
  document.getElementById('song-display').style.display = 'none';
}

function toggleChords() {
  chordsVisible = !chordsVisible;
  const btn = document.getElementById('chord-btn');
  btn.innerHTML = chordsVisible ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>';
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

function openLiturgieSong(title) {
  const s = songs.find(s => s.title.toLowerCase() === title.toLowerCase());
  if (s) { currentGroup = 'liturgia'; showSong(s); }
}

// 3. INICIALIZÁCIA A FORMULÁR
document.addEventListener('DOMContentLoaded', () => {
  parseXML();

  // Vyhľadávanie
  const sInp = document.getElementById('search');
  if(sInp) {
    sInp.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      displayPiesne(songs.filter(s => s.title.toLowerCase().includes(q)));
    });
  }

  // Odosielanie formulára (AJAX)
  const f = document.getElementById("my-form");
  if (f) {
    f.addEventListener("submit", function(e) {
      e.preventDefault();
      const status = document.getElementById("form-status");
      const btn = document.getElementById("submit-btn");
      const data = new FormData(f);

      btn.disabled = true;
      btn.textContent = "Odosielam...";

      fetch("https://formspree.io/f/mvzzkwlw", {
        method: "POST",
        body: data,
        headers: { 'Accept': 'application/json' }
      }).then(res => {
        if (res.ok) {
          status.style.color = "#00ff00";
          status.textContent = "✓ Odoslané!";
          f.reset();
        } else {
          status.style.color = "#ff4444";
          status.textContent = "Chyba pri odosielaní.";
        }
        btn.disabled = false;
        btn.textContent = "Odoslať opravu";
      }).catch(() => {
        status.style.color = "#ff4444";
        status.textContent = "Problém so spojením.";
        btn.disabled = false;
        btn.textContent = "Odoslať opravu";
      });
    });
  }
});
