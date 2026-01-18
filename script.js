let songs = [];
let currentSong = null;
let transposeStep = 0;
let fontSize = 20;
let chordsVisible = true;

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxEfu4yOq0BE4gcr4hOaElvVCNzvmZOSgmbeyy4gOqfIxAhBjRgzDPixYNXbn9_UoXbsw/exec'; 

function init() {
    const cached = localStorage.getItem('spevnik_data');
    if (cached) {
        songs = JSON.parse(cached);
        renderList(songs);
    }

    fetch(SCRIPT_URL + "?t=" + Date.now())
        .then(res => res.text())
        .then(xmlText => {
            const parser = new DOMParser();
            const xml = parser.parseFromString(xmlText, 'application/xml');
            const songNodes = xml.getElementsByTagName('song');
            
            const newSongs = Array.from(songNodes).map(song => {
                const getVal = (t) => song.getElementsByTagName(t)[0]?.textContent.trim() || "";
                const author = getVal('author');
                const title = getVal('title').toLowerCase();
                
                let sortPriority = 4;
                let litOrder = 99;

                // FIXNÉ PORADIE LITURGIE
                if (title.includes("zmiluj sa")) { sortPriority = 1; litOrder = 1; }
                else if (title.includes("aleluja")) { sortPriority = 1; litOrder = 2; }
                else if (title.includes("svätý")) { sortPriority = 1; litOrder = 3; }
                else if (title.includes("otče náš")) { sortPriority = 1; litOrder = 4; }
                else if (title.includes("baránok") || title.includes("baranok")) { sortPriority = 1; litOrder = 5; }
                else if (/^\d+$/.test(author)) { sortPriority = 2; }
                else if (author.startsWith('M')) { sortPriority = 3; }

                return {
                    id: getVal('ID'),
                    displayId: author,
                    sortPriority: sortPriority,
                    litOrder: litOrder,
                    sortNum: parseInt(author.replace(/\D/g, '')) || 0,
                    title: getVal('title'),
                    text: getVal('songtext')
                };
            });

            newSongs.sort((a, b) => {
                if (a.sortPriority !== b.sortPriority) return a.sortPriority - b.sortPriority;
                if (a.sortPriority === 1) return a.litOrder - b.litOrder;
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
    const sections = [
        { name: "Liturgia", p: 1, showNum: false },
        { name: "Piesne", p: 2, showNum: true },
        { name: "Mariánske", p: 3, showNum: true },
        { name: "Ostatné", p: 4, showNum: true }
    ];

    sections.forEach(sec => {
        const filtered = list.filter(s => s.sortPriority === sec.p);
        if (filtered.length) {
            html += `<div class="section-title">${sec.name}</div>`;
            html += filtered.map(s => {
                const idx = songs.findIndex(x => x.id === s.id);
                return `<div class="song-item" onclick="openSong(${idx})">
                    ${sec.showNum ? `<span class="song-number">${s.displayId}.</span>` : ''} 
                    <span class="song-title-text">${s.title}</span>
                </div>`;
            }).join('');
        }
    });
    container.innerHTML = html;
}

function openSong(index) {
    const s = songs[index];
    if (!s) return;
    currentSong = { ...s, idx: index };
    transposeStep = 0;
    document.getElementById('song-list').style.display = 'none';
    document.getElementById('song-detail').style.display = 'block';
    document.getElementById('song-title').innerText = s.title;
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

document.addEventListener('DOMContentLoaded', init);
