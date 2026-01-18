const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyyrD8pCxgQYiERsOsDFJ_XoBEbg6KYe1oM8Wj9IAzkq4yqzMSkfApgcc3aFeD0-Pxgww/exec';

let songs = [];
let filteredSongs = [];
let currentSong = null;
let currentModeList = [];
let transposeStep = 0;
let fontSize = 17;
let chordsVisible = true;
let isAdmin = false;
let selectedSongIds = [];
let adminPassword = "";

/* ================== XML ================== */
async function parseXML() {
  try {
    const res = await fetch(SCRIPT_URL + '?t=' + Date.now());
    const xmlText = await res.text();
    const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
    const nodes = xml.getElementsByTagName('song');

    songs = [...nodes].map(s => ({
      id: s.getElementsByTagName('ID')[0]?.textContent.trim(),
      title: s.getElementsByTagName('title')[0]?.textContent.trim(),
      displayId: s.getElementsByTagName('author')[0]?.textContent.trim(),
      text: s.getElementsByTagName('songtext')[0]?.textContent.trim(),
      origText: s.getElementsByTagName('songtext')[0]?.textContent.trim(),
      originalKey: (s.getElementsByTagName('songtext')[0]?.textContent.match(/\[([A-H][#b]?[m]?)\]/)||[])[1] || '?'
    }));

    filteredSongs = [...songs];
    renderAllSongs();
    loadPlaylistHeaders();
  } catch {
    document.getElementById('piesne-list').innerHTML = 'Chyba: Failed to fetch';
  }
}

/* ================== RENDER ================== */
function renderAllSongs() {
  const el = document.getElementById('piesne-list');
  currentModeList = filteredSongs;
  el.innerHTML = filteredSongs.map(s =>
    `<div onclick="${isAdmin ? `addToSelection('${s.id}')` : `openSongById('${s.id}')`}">
      <span style="color:#00bfff;font-weight:bold;">${s.displayId}.</span> ${s.title}
    </div>`
  ).join('');
}

function filterSongs() {
  const t = search.value.toLowerCase();
  filteredSongs = songs.filter(s => s.title.toLowerCase().includes(t) || s.displayId.includes(t));
  renderAllSongs();
}

/* ================== SONG ================== */
function openSongById(id) {
  currentSong = JSON.parse(JSON.stringify(songs.find(s => s.id === id)));
  transposeStep = 0;
  song_list.style.display = 'none';
  song_detail.style.display = 'block';
  render_title.innerText = currentSong.displayId + '. ' + currentSong.title;
  render_key.innerText = 'Tónina: ' + currentSong.originalKey;
  renderSong();
}

function renderSong() {
  let text = currentSong.origText;
  if (!chordsVisible) text = text.replace(/\[.*?\]/g, '');
  song_content.innerHTML = text.replace(/\[(.*?)\]/g, '<span class="chord">$1</span>');
  song_content.style.fontSize = fontSize + 'px';
}

/* ================== ADMIN ================== */
function unlockAdmin() {
  const p = prompt('Heslo:');
  if (p) {
    adminPassword = p;
    isAdmin = true;
    admin_panel.style.display = 'block';
    renderAllSongs();
  }
}

function savePlaylist() {
  const name = playlist_name.value;
  if (!name || !selectedSongIds.length) return alert('Chýba názov alebo piesne');
  window.open(`${SCRIPT_URL}?action=save&name=${encodeURIComponent(name)}&pwd=${adminPassword}&content=${selectedSongIds.join(',')}`,
    '_blank','width=1,height=1');
  setTimeout(loadPlaylistHeaders, 2000);
}

function loadPlaylistHeaders() {
  fetch(`${SCRIPT_URL}?action=list&t=${Date.now()}`)
    .then(r => r.json())
    .then(d => playlists_section.innerHTML =
      '<h2>PLAYLIST</h2>' + d.map(p =>
        `<div onclick="openPlaylist('${p.name}')">📄 ${p.name}</div>`
      ).join('')
    );
}

function openPlaylist(name) {
  fetch(`${SCRIPT_URL}?action=get&name=${encodeURIComponent(name)}`)
    .then(r => r.text())
    .then(t => {
      currentModeList = t.split(',').map(id => songs.find(s => s.id === id));
      piesne_list.innerHTML = currentModeList.map(s =>
        `<div onclick="openSongById('${s.id}')">${s.displayId}. ${s.title}</div>`
      ).join('');
    });
}

document.addEventListener('DOMContentLoaded', parseXML);
