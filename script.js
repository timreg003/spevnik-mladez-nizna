let songs = [];
let currentSong = null;
let transposeStep = 0;
let fontSize = 17;
let chordsVisible = true;
let scrollInterval = null;

// KONFIGURÁCIA GOOGLE DISKU S PROXY (aby nehlásilo chybu pripojenia)
const FILE_ID = '1AyQnmtBzJhTWTPkHzXiqUKYyhRTUA0ZY'; 
const URL = `https://corsproxy.io/?https://docs.google.com/uc?export=download&id=${FILE_ID}`;

// 1. NAČÍTANIE A PARSOVANIE XML
function parseXML() {
  fetch(URL)
    .then(res => res.text())
    .then(xmlText => {
      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlText, 'application/xml');
      const songNodes = xml.querySelectorAll('song');
      
      songs = Array.from(songNodes).map(song => {
        const authorTag = song.querySelector('author')?.textContent || "999";
        const songNumber = parseInt(authorTag.replace(/\D/g, '')) || 999;
        
        return {
          id: songNumber,
          title: song.getAttribute('title') || "Bez názvu", // Opravené načítanie názvu
          text: song.querySelector('songtext')?.textContent.trim() || ""
        };
      });

      // Zoradenie podľa čísla (1, 2, 3...)
      songs.sort((a, b) => a.id - b.id);
      displayPiesne(songs);
    })
    .catch(err => {
      console.error("Chyba:", err);
      document.getElementById('piesne-list').innerText = "Chyba pripojenia. Skús obnoviť stránku.";
    });
}

function displayPiesne(list) {
  const listDiv = document.getElementById('piesne-list');
  if(!listDiv) return;
  listDiv.innerHTML = list.map(s => `
    <div onclick='openSong(${s.id})'>
      <span style="color: #00bfff; font-weight: bold; margin-right: 8px;">${s.id}.</span> ${s.title}
    </div>
  `).join('');
}

// 2. OVLÁDANIE DETAILU PIESNE
function openSong(id) {
  const s = songs.find(x => x.id === id);
  if(!s) return;
  currentSong = s;
  transposeStep = 0;
  
  document.getElementById('song-list').style.display = 'none';
  document.getElementById('song-detail').style.display = 'block';
  document.getElementById('song-title').textContent = s.id + ". " + s.title;
  document.getElementById('email-subject').value = "Chyba v piesni: " + s.title;

  renderSong();
  window.scrollTo(0,0);
}

function renderSong() {
  if(!currentSong) return;
  
  // Čistenie textu a zarovnanie (riešené cez CSS v style.css)
  let txt = currentSong.text.replace(/\n\s*\n\s*\n/g, '\n\n');

  // Formátovanie akordov
  txt = txt.replace(/\[(.*?)\]/g, (match, chord) => {
    if(!chordsVisible) return '';
    const transposed = transposeChord(chord, transposeStep);
    return `<span class="chord">${transposed}</span>`;
  });

  const contentDiv = document.getElementById('song-content');
  contentDiv.innerHTML = txt;
  contentDiv.style.fontSize = fontSize + 'px';
}

// NAVIGÁCIA MEDZI PIESŇAMI (Nasledujúca / Predchádzajúca)
function navigateSong(direction) {
  const currentIndex = songs.findIndex(s => s.id === currentSong.id);
  const nextIndex = currentIndex + direction;
  if (nextIndex >= 0 && nextIndex < songs.length) {
    openSong(songs[nextIndex].id);
  }
}

function closeSong() {
  document.getElementById('song-list').style.display = 'block';
  document.getElementById('song-detail').style.display = 'none';
  stopScroll();
}

// 3. POMOCNÉ FUNKCIE
function transposeChord(chord, step) {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'B', 'H'];
  return chord.replace(/[A-H][#b]?/g, (match) => {
    let n = match;
    if(n === 'Bb') n = 'B';
    if(n === 'Hb') n = 'B';
    let idx = notes.indexOf(n);
    if(idx === -1) return match;
    let newIdx = (idx + step) % 12;
    while(newIdx < 0) newIdx += 12;
    return notes[newIdx];
  });
}

function startScroll(speed) {
  stopScroll();
  if(speed === 0) return;
  const interval = 120 - (speed * 30);
  scrollInterval = setInterval(() => { window.scrollBy(0, 1); }, interval);
}
function stopScroll() { clearInterval(scrollInterval); }

function transposeSong(step) { transposeStep += step; renderSong(); }
function changeFontSize(step) { fontSize += step; renderSong(); }
function toggleChords() { chordsVisible = !chordsVisible; renderSong(); }

function openLiturgieSong(title) {
  const s = songs.find(x => x.title.toLowerCase().includes(title.toLowerCase()));
  if(s) openSong(s.id);
}

// 4. INICIALIZÁCIA
document.addEventListener('DOMContentLoaded', () => {
  parseXML();
  const sInp = document.getElementById('search');
  if(sInp) {
    sInp.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      displayPiesne(songs.filter(s => s.title.toLowerCase().includes(q) || s.id.toString().includes(q)));
    });
  }
});
