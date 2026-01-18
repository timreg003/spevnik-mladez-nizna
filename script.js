let songs = [];
let currentSong = null;
let currentMode = "all"; 
let currentModeList = [];
let transposeStep = 0;
let fontSize = 17;
let chordsVisible = true;
let isAdmin = false;
let selectedSongIds = [];
let adminPassword = "";

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxEfu4yOq0BE4gcr4hOaElvVCNzvmZOSgmbeyy4gOqfIxAhBjRgzDPixYNXbn9_UoXbsw/exec';

async function parseXML() {
  const res = await fetch(SCRIPT_URL + "?t=" + new Date().getTime());
  const xmlText = await res.text();
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, 'application/xml');
  const songNodes = xml.getElementsByTagName('song');
  
  songs = Array.from(songNodes).map(song => {
    const getVal = (t) => song.getElementsByTagName(t)[0]?.textContent.trim() || "";
    const st = getVal('songtext');
    const firstChord = st.match(/\[([A-H][#b]?[m]?)\]/);
    return {
      id: getVal('ID'),
      title: getVal('title') || "Bez názvu",
      displayId: getVal('author') || "",
      text: st,
      origText: st,
      originalKey: firstChord ? firstChord[1] : "?"
    };
  });
  renderAllSongs();
  loadPlaylistHeaders();
}

function renderAllSongs() {
  const container = document.getElementById('piesne-list');
  
  // Radenie: Čísla -> M... -> Text
  const sorted = [...songs].sort((a, b) => {
    const idA = a.displayId;
    const idB = b.displayId;
    const isNumA = /^\d+$/.test(idA);
    const isNumB = /^\d+$/.test(idB);
    const isMA = idA.startsWith('M');
    const isMB = idB.startsWith('M');

    if (isNumA && !isNumB) return -1;
    if (!isNumA && isNumB) return 1;
    if (isNumA && isNumB) return parseInt(idA) - parseInt(idB);
    
    if (isMA && !isMB) return -1;
    if (!isMA && isMB) return 1;
    if (isMA && isMB) return parseInt(idA.substring(1)) - parseInt(idB.substring(1));
    
    return idA.localeCompare(idB);
  });
  
  currentModeList = sorted; 

  container.innerHTML = sorted.map(s => {
    const isSel = selectedSongIds.includes(s.id);
    const action = isAdmin ? `addToSelection('${s.id}')` : `openSongById('${s.id}', 'all')`;
    return `
      <div onclick="${action}" style="display:flex; justify-content:space-between; align-items:center; padding:12px; margin-bottom:6px; background:#1e1e1e; border-radius:10px; cursor:pointer; ${isSel ? 'border: 1px solid #00bfff;' : ''}">
        <div><span style="color: #00bfff; font-weight: bold; margin-right: 8px;">${s.displayId}.</span> ${s.title}</div>
        ${isAdmin ? `<i class="fas ${isSel ? 'fa-check-circle' : 'fa-plus-circle'}" style="color:#00bfff"></i>` : ''}
      </div>`;
  }).join('');
}

function openSongById(id, mode) {
    if (mode === "all") currentMode = "all";
    const s = songs.find(x => x.id === id);
    if (!s) return;
    currentSong = JSON.parse(JSON.stringify(s));
    transposeStep = 0;
    document.getElementById('song-list').style.display = 'none';
    document.getElementById('song-detail').style.display = 'block';
    document.getElementById('render-title').innerText = (currentSong.displayId ? currentSong.displayId + '. ' : '') + currentSong.title;
    document.getElementById('render-key').innerText = "Pôvodná tónina: " + currentSong.originalKey;
    renderSong();
    window.scrollTo(0,0);
}

function renderSong() {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'B', 'H'];
  const trans = (c, step) => c.replace(/[A-H][#b]?/g, m => {
    let n = (m==='Bb'||m==='Hb') ? 'B' : m;
    let i = notes.indexOf(n);
    if (i===-1) return m;
    let ni = (i + step) % 12; while(ni<0) ni+=12;
    return notes[ni];
  });

  // Vždy transponujeme z ORIGINÁLNEHO textu o celkový počet krokov
  let text = currentSong.origText;
  if (transposeStep !== 0) {
    text = text.replace(/\[(.*?)\]/g, (m, c) => `[${trans(c, transposeStep)}]`);
  }

  if (!chordsVisible) text = text.replace(/\[.*?\]/g, '');
  else text = text.replace(/\[(.*?)\]/g, '<span class="chord">$1</span>');

  const contentEl = document.getElementById('song-content');
  contentEl.innerHTML = text;
  contentEl.style.fontSize = fontSize + "px";
  document.getElementById('transpose-val').innerText = (transposeStep > 0 ? "+" : "") + transposeStep;
}

function transposeSong(step) {
  const newStep = transposeStep + step;
  if (newStep >= -12 && newStep <= 12) {
    transposeStep = newStep;
    renderSong();
  }
}

function resetTranspose() { transposeStep = 0; renderSong(); }
function closeSong() { document.getElementById('song-list').style.display = 'block'; document.getElementById('song-detail').style.display = 'none'; }
function changeFontSize(s) { fontSize += s; renderSong(); }
function toggleChords() { chordsVisible = !chordsVisible; renderSong(); }

function unlockAdmin() {
  const p = prompt("Heslo:");
  if (p) { adminPassword = p; isAdmin = true; document.getElementById('admin-panel').style.display = 'block'; renderAllSongs(); loadPlaylistHeaders(); }
}

function addToSelection(id) {
    const index = selectedSongIds.indexOf(id);
    if (index === -1) selectedSongIds.push(id);
    else selectedSongIds.splice(index, 1);
    renderSelected();
    renderAllSongs();
}

function renderSelected() {
  document.getElementById('selected-list').innerHTML = selectedSongIds.map((id, i) => {
    const s = songs.find(x => x.id === id);
    return `<div style="display:flex; justify-content:space-between; background:#2a2a2a; padding:8px; margin-bottom:4px; border-radius:5px; font-size:13px;">${s.title}<div><i class="fas fa-arrow-up" onclick="event.stopPropagation(); moveInSelection(${i},-1)" style="margin-right:10px; color:#00bfff"></i><i class="fas fa-arrow-down" onclick="event.stopPropagation(); moveInSelection(${i},1)" style="margin-right:10px; color:#00bfff"></i><i class="fas fa-times" onclick="event.stopPropagation(); addToSelection('${id}')" style="color:red"></i></div></div>`;
  }).join('');
}

function moveInSelection(i, d) {
  const ni = i + d;
  if (ni >= 0 && ni < selectedSongIds.length) {
    [selectedSongIds[i], selectedSongIds[ni]] = [selectedSongIds[ni], selectedSongIds[i]];
    renderSelected();
  }
}

function savePlaylist() {
  const name = document.getElementById('playlist-name').value;
  if (!name || !selectedSongIds.length) return alert("Zadaj názov!");
  const url = `${SCRIPT_URL}?action=save&name=${encodeURIComponent(name)}&pwd=${encodeURIComponent(adminPassword)}&content=${selectedSongIds.join(',')}`;
  
  const win = window.open(url, '_blank', 'width=1,height=1');
  setTimeout(() => { 
    if(win) win.close();
    alert("Uložené!"); 
    selectedSongIds = []; isAdmin = false; 
    document.getElementById('admin-panel').style.display = 'none';
    // Načítame znova po uložení
    setTimeout(loadPlaylistHeaders, 1000); 
    renderAllSongs();
  }, 2000);
}

async function loadPlaylistHeaders() {
  const res = await fetch(`${SCRIPT_URL}?action=list&t=${Date.now()}`);
  const data = await res.json();
  const container = document.getElementById('playlists-section');
  if (!data.length) { container.innerHTML = ""; return; }
  container.innerHTML = "<h2>Dnešný program</h2>" + data.map(p => `
    <div style="background:#1e1e1e; border:1px solid #333; padding:12px; margin-bottom:8px; border-radius:10px; cursor:pointer; display:flex; justify-content:space-between;" onclick="openPlaylist('${p.name}')">
      <span>📄 ${p.name}</span>
      ${isAdmin ? `<i class="fas fa-trash" onclick="event.stopPropagation(); deletePlaylist('${p.name}')" style="color:red"></i>` : ''}
    </div>`).join('');
}

async function openPlaylist(name) {
  const res = await fetch(`${SCRIPT_URL}?action=get&name=${encodeURIComponent(name)}&t=${Date.now()}`);
  const idsText = await res.text();
  const ids = idsText.split(',');
  currentPlaylist = ids.map(id => songs.find(s => s.id === id)).filter(x => x);
  currentModeList = currentPlaylist;
  currentMode = "playlist";
  document.getElementById('piesne-list').innerHTML = `<button onclick="renderAllSongs();" style="width:100%; padding:12px; margin-bottom:10px; background:#2a2a2a; color:#00bfff; border-radius:10px; border:1px solid #333; font-weight:bold;">⬅ Späť na všetky piesne</button>` + 
  currentPlaylist.map(s => `<div onclick="openSongById('${s.id}', 'playlist')" style="background:#1e1e1e; padding:12px; margin-bottom:6px; border-radius:10px;"><span style="color:#00bfff; font-weight:bold;">${s.displayId}.</span> ${s.title}</div>`).join('');
}

function navigateSong(step) {
    const list = currentModeList;
    const currIdx = list.findIndex(s => s.id === currentSong.id);
    const nextIdx = currIdx + step;
    if (nextIdx >= 0 && nextIdx < list.length) openSongById(list[nextIdx].id);
}

function deletePlaylist(name) {
  if(confirm("Zmazať?")) fetch(`${SCRIPT_URL}?action=delete&name=${encodeURIComponent(name)}&pwd=${encodeURIComponent(adminPassword)}`).then(() => setTimeout(loadPlaylistHeaders, 1000));
}

document.addEventListener('DOMContentLoaded', parseXML);
