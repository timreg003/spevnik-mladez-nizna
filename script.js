let songs = [];
let currentSong = null;
let transposeStep = 0;
let fontSize = 17;
let chordsVisible = true;

const FILE_ID = '1AyQnmtBzJhTWTPkHzXiqUKYyhRTUA0ZY'; 
const URL = `https://corsproxy.io/?https://docs.google.com/uc?export=download&id=${FILE_ID}`;

function parseXML() {
  fetch(URL)
    .then(res => res.text())
    .then(xmlText => {
      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlText, 'application/xml');
      const songNodes = xml.querySelectorAll('song');
      
      songs = Array.from(songNodes).map(song => {
        const authorVal = song.querySelector('author')?.textContent.trim() || "";
        const titleVal = song.querySelector('title')?.textContent.trim() || "Bez názvu";
        const songText = song.querySelector('songtext')?.textContent.trim() || "";

        const firstChordMatch = songText.match(/\[(.*?)\]/);
        const deducedKey = firstChordMatch ? firstChordMatch[1] : "";

        let displayId = authorVal;
        let sortPriority = 1; 
        let internalSortNum = 0;

        if (authorVal.toUpperCase().startsWith('M')) {
          const num = parseInt(authorVal.replace(/\D/g, '')) || 0;
          displayId = "Mariánska " + num;
          sortPriority = 2;
          internalSortNum = num; // Na radenie mariánskych 1, 2, 3...
        } else if (authorVal !== "" && /^\d+$/.test(authorVal)) {
          sortPriority = 1;
          internalSortNum = parseInt(authorVal);
        } else {
          sortPriority = 3;
          displayId = authorVal || "---";
        }

        return {
          authorRaw: authorVal,
          displayId: displayId,
          sortPriority: sortPriority,
          sortNum: internalSortNum,
          title: titleVal,
          baseKey: deducedKey,
          text: songText
        };
      });

      // LOGIKA RADENIA
      songs.sort((a, b) => {
        if (a.sortPriority !== b.sortPriority) return a.sortPriority - b.sortPriority;
        if (a.sortPriority === 1 || a.sortPriority === 2) return a.sortNum - b.sortNum;
        return a.displayId.localeCompare(b.displayId, 'sk');
      });

      displayPiesne(songs);
    })
    .catch(err => {
      document.getElementById('piesne-list').innerText = "Chyba pripojenia. Skús obnoviť stránku.";
    });
}

function displayPiesne(list) {
  const listDiv = document.getElementById('piesne-list');
  if(!listDiv) return;
  listDiv.innerHTML = list.map((s, index) => `
    <div onclick='openSongByIndex(${index})'>
      <span style="color: #00bfff; font-weight: bold; margin-right: 8px;">${s.displayId}.</span> ${s.title}
    </div>
  `).join('');
}

function openSongByIndex(index) {
  const s = songs[index];
  if(!s) return;
  currentSong = { ...s, currentIndex: index };
  transposeStep = 0;
  
  document.getElementById('song-list').style.display = 'none';
  document.getElementById('song-detail').style.display = 'block';
  document.getElementById('song-title').textContent = s.displayId + ". " + s.title;
  document.getElementById('email-subject').value = "Chyba v piesni: " + s.title;
  
  document.getElementById('base-key-display').textContent = s.baseKey ? "Pôvodná tónina: " + s.baseKey : "Pôvodná tónina: Nezistená";
  
  renderSong();
  updateTransposeLabel();
  window.scrollTo(0,0);
}

function renderSong() {
  if(!currentSong) return;
  let txt = currentSong.text.replace(/\n\s*\n\s*\n/g, '\n\n');
  txt = txt.replace(/\[(.*?)\]/g, (match, chord) => {
    if(!chordsVisible) return '';
    return `<span class="chord">${transposeChord(chord, transposeStep)}</span>`;
  });
  document.getElementById('song-content').innerHTML = txt;
  document.getElementById('song-content').style.fontSize = fontSize + 'px';
}

function navigateSong(direction) {
  const nextIdx = currentSong.currentIndex + direction;
  if (nextIdx >= 0 && nextIdx < songs.length) {
    openSongByIndex(nextIdx);
  }
}

function resetTranspose() { transposeStep = 0; updateTransposeLabel(); renderSong(); }
function transposeSong(step) { transposeStep += step; updateTransposeLabel(); renderSong(); }
function updateTransposeLabel() {
  const el = document.getElementById('transpose-val');
  if(el) el.textContent = (transposeStep > 0 ? "+" : "") + transposeStep;
}

function transposeChord(chord, step) {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'B', 'H'];
  return chord.replace(/[A-H][#b]?/g, (match) => {
    let n = (match === 'Bb' || match === 'Hb') ? 'B' : match;
    let idx = notes.indexOf(n);
    if(idx === -1) return match;
    let newIdx = (idx + step) % 12;
    while(newIdx < 0) newIdx += 12;
    return notes[newIdx];
  });
}

function openLiturgieSong(name) {
  const idx = songs.findIndex(x => x.title.toLowerCase().includes(name.toLowerCase()));
  if(idx !== -1) openSongByIndex(idx);
}

function closeSong() {
  document.getElementById('song-list').style.display = 'block';
  document.getElementById('song-detail').style.display = 'none';
}

function changeFontSize(step) { fontSize += step; renderSong(); }
function toggleChords() { chordsVisible = !chordsVisible; renderSong(); }

// FORMULÁR A VYHĽADÁVANIE
document.addEventListener('DOMContentLoaded', () => {
  parseXML();
  document.getElementById('search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = songs.map((s, i) => ({...s, originalIndex: i}))
                          .filter(s => s.title.toLowerCase().includes(q) || s.displayId.toLowerCase().includes(q));
    
    document.getElementById('piesne-list').innerHTML = filtered.map(s => `
      <div onclick='openSongByIndex(${s.originalIndex})'>
        <span style="color: #00bfff; font-weight: bold; margin-right: 8px;">${s.displayId}.</span> ${s.title}
      </div>
    `).join('');
  });

  const f = document.getElementById("my-form");
  if (f) {
    f.addEventListener("submit", function(e) {
      e.preventDefault();
      const status = document.getElementById("form-status");
      const btn = document.getElementById("submit-btn");
      btn.disabled = true;
      btn.textContent = "Odosielam...";

      fetch("https://formspree.io/f/mvzzkwlw", {
        method: "POST",
        body: new FormData(f),
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
      });
    });
  }
});
