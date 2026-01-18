let songs = [];
let currentSong = null;
let transposeStep = 0;
let fontSize = 18;
let chordsVisible = true;

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxEfu4yOq0BE4gcr4hOaElvVCNzvmZOSgmbeyy4gOqfIxAhBjRgzDPixYNXbn9_UoXbsw/exec'; 

function init() {
    // 1. Skúsime pamäť tabletu
    const cached = localStorage.getItem('spevnik_data');
    if (cached) {
        songs = JSON.parse(cached);
        renderList(songs);
    }

    // 2. Načítame čerstvé dáta
    fetch(SCRIPT_URL + "?t=" + Date.now())
        .then(res => res.text())
        .then(xmlText => {
            const parser = new DOMParser();
            const xml = parser.parseFromString(xmlText, 'application/xml');
            const songNodes = xml.getElementsByTagName('song');
            
            const newSongs = Array.from(songNodes).map(song => {
                const getVal = (t) => song.getElementsByTagName(t)[0]?.textContent.trim() || "";
                const author = getVal('author');
                
                let sortPriority = 4; // Ostatné
                let sortNum = parseInt(author) || 0;

                if (author === "999") {
                    sortPriority = 1; // Liturgia
                } else if (/^\d+$/.test(author)) {
                    sortPriority = 2; // Piesne (čísla)
                } else if (author.startsWith('M')) {
                    sortPriority = 3; // Mariánske
                    sortNum = parseInt(author.replace(/\D/g, '')) || 0;
                }

                return {
                    id: getVal('ID'),
                    displayId: author,
                    sortPriority: sortPriority,
                    sortNum: sortNum,
                    title: getVal('title'),
                    text: getVal('songtext')
                };
            });

            newSongs.sort((a, b) => {
                if (a.sortPriority !== b.sortPriority) return a.sortPriority - b.sortPriority;
                return a.sortNum - b.sortNum || a.title.localeCompare(b.title, 'sk');
            });

            songs = newSongs;
            localStorage.setItem('spevnik_data', JSON.stringify(songs));
            renderList(songs);
        });
}

function renderList(list) {
    const container = document.getElementById('piesne-list');
    let html = "";

    const l = list.filter(s => s.sortPriority === 1);
    const p = list.filter(s => s.sortPriority === 2);
    const m = list.filter(s => s.sortPriority === 3);
    const o = list.filter(s => s.sortPriority === 4);

    if (l.length) html += `<div class="section-title">Liturgia</div>` + gen(l);
    if (p.length) html += `<div class="section-title">Piesne</div>` + gen(p);
    if (m.length) html += `<div class="section-title">Mariánske</div>` + gen(m);
    if (o.length) html += `<div class="section-title">Ostatné</div>` + gen(o);
    
    container.innerHTML = html;
}

function gen(items) {
    return items.map(s => {
        const idx = songs.findIndex(x => x.id === s.id);
        return `<div class="song-item" onclick="openSong(${idx})">
            <span class="song-number">${s.displayId}.</span> ${s.title}
        </div>`;
    }).join('');
}

function openSong(index) {
    const s = songs[index];
    if (!s) return;
    currentSong = { ...s, idx: index };
    transposeStep = 0;
    document.getElementById('song-list').style.display = 'none';
    document.getElementById('song-detail').style.display = 'block';
    document.getElementById('song-title').innerText = s.displayId + ". " + s.title;
    document.getElementById('transpose-val').innerText = "0";
    draw();
    window.scrollTo(0,0);
}

function draw() {
    let txt = currentSong.text.replace(/\[(.*?)\]/g, (m, c) => 
        chordsVisible ? `<span class="chord">${trans(c, transposeStep)}</span>` : '');
    const cont = document.getElementById('song-content');
    cont.innerHTML = txt;
    cont.style.fontSize = fontSize + 'px';
}

function trans(chord, step) {
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'B', 'H'];
    return chord.replace(/[A-H][#b]?/g, (match) => {
        let n = (match === 'Bb' || match === 'Hb') ? 'B' : match;
        let idx = notes.indexOf(n);
        if (idx === -1) return match;
        let newIdx = (idx + step) % 12;
        while (newIdx < 0) newIdx += 12;
        return notes[newIdx];
    });
}

function transpose(val) { transposeStep += val; document.getElementById('transpose-val').innerText = (transposeStep > 0 ? "+" : "") + transposeStep; draw(); }
function changeFont(val) { fontSize += val; draw(); }
function toggleChords() { chordsVisible = !chordsVisible; draw(); }
function closeSong() { document.getElementById('song-list').style.display = 'block'; document.getElementById('song-detail').style.display = 'none'; }
function nav(d) { openSong(currentSong.idx + d); }

document.addEventListener('DOMContentLoaded', () => {
    init();
    document.getElementById('search').addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        const filtered = songs.filter(s => s.title.toLowerCase().includes(q) || s.displayId.includes(q));
        renderList(filtered);
    });
});
