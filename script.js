// State
const state = {
    players: new Map(), // id -> YT.Player
    tiles: new Map(),   // id -> tile element
    mutedAll: false,
    draggingId: null,
};

// Utils
function extractVideoId(input) {
    if (!input) return null;
    const trimmed = String(input).trim();
    // If plain ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
    try {
        const url = new URL(trimmed);
        if (url.hostname.includes("youtube.com")) {
            if (url.pathname.startsWith("/watch")) {
                return url.searchParams.get("v");
            }
            if (url.pathname.startsWith("/live/")) {
                return url.pathname.split("/").pop();
            }
            if (url.pathname.startsWith("/shorts/")) {
                return url.pathname.split("/").pop();
            }
            if (url.pathname.startsWith("/embed/")) {
                return url.pathname.split("/").pop();
            }
        }
        if (url.hostname === "youtu.be") {
            return url.pathname.split("/").pop();
        }
    } catch (_) {
        // not a URL
    }
    return null;
}

function getColumnIds(side) {
    const grid = document.getElementById(side === 'right' ? "grid-right" : "grid-left");
    return Array.from(grid.children).map(el => el.dataset.videoId).filter(Boolean);
}

function saveLayout() {
    const left = getColumnIds('left');
    const right = getColumnIds('right');
    const muted = state.mutedAll;
    localStorage.setItem("yt_multi_stream_left_ids", JSON.stringify(left));
    localStorage.setItem("yt_multi_stream_right_ids", JSON.stringify(right));
    localStorage.setItem("yt_multi_stream_muted", String(muted));
}

function restoreLayout() {
    const leftStored = localStorage.getItem("yt_multi_stream_left_ids");
    const rightStored = localStorage.getItem("yt_multi_stream_right_ids");
    const legacy = localStorage.getItem("yt_multi_stream_ids");
    const muted = localStorage.getItem("yt_multi_stream_muted") === "true";
    state.mutedAll = muted;

    let left = [];
    let right = [];
    if (leftStored || rightStored) {
        try { left = JSON.parse(leftStored || "[]"); } catch(_) { left = []; }
        try { right = JSON.parse(rightStored || "[]"); } catch(_) { right = []; }
    } else if (legacy) {
        try {
            const ids = JSON.parse(legacy) || [];
            ids.forEach((id, idx) => { (idx % 2 === 0 ? left : right).push(id); });
        } catch(_) {}
    }

    left.slice(0, 3).forEach(id => addStreamById(id, 'left'));
    right.slice(0, 3).forEach(id => addStreamById(id, 'right'));
    if (muted) muteAll(true);
}

function applyGridCols() { /* legacy no-op */ }

function createTile(id, side) {
    const tpl = document.getElementById("tile-template");
    const node = tpl.content.firstElementChild.cloneNode(true);
    const playerHost = node.querySelector('[data-player]');
    const title = node.querySelector('[data-title]');
    title.textContent = id;
    node.dataset.videoId = id;
    node.setAttribute('draggable', 'true');
    // Attach actions
    node.querySelector('[data-action="move-left"]').addEventListener('click', () => moveUp(id));
    node.querySelector('[data-action\="move-right\"]').addEventListener('click', () => moveDown(id));
    const btnToLeft = node.querySelector('[data-action="to-left"]');
    const btnToRight = node.querySelector('[data-action="to-right"]');
    if (btnToLeft) btnToLeft.addEventListener('click', () => moveToSide(id, 'left'));
    if (btnToRight) btnToRight.addEventListener('click', () => moveToSide(id, 'right'));
    node.querySelector('[data-action="mute"]').addEventListener('click', () => toggleMute(id));
    node.querySelector('[data-action="play"]').addEventListener('click', () => playOne(id));
    node.querySelector('[data-action="pause"]').addEventListener('click', () => pauseOne(id));
    node.querySelector('[data-action="remove"]').addEventListener('click', () => removeStream(id));
    // Drag & drop
    node.addEventListener('dragstart', (e) => {
        state.draggingId = id;
        node.classList.add('dragging');
        try { e.dataTransfer.setData('text/plain', id); } catch(_) {}
        e.dataTransfer.effectAllowed = 'move';
    });
    node.addEventListener('dragend', () => {
        node.classList.remove('dragging');
        state.draggingId = null;
        document.querySelectorAll('.tile.drop-target').forEach(el => el.classList.remove('drop-target'));
        saveLayout();
    });
    node.addEventListener('dragover', (e) => {
        if (!state.draggingId || state.draggingId === id) return;
        e.preventDefault();
        const target = node;
        const dragged = state.tiles.get(state.draggingId);
        if (!dragged || dragged === target) return;
        target.classList.add('drop-target');
        // Decide insert position based on mouse Y
        const rect = target.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        const grid = target.parentElement;
        if (before) {
            grid.insertBefore(dragged, target);
        } else {
            if (target.nextSibling) grid.insertBefore(dragged, target.nextSibling); else grid.appendChild(dragged);
        }
    });
    node.addEventListener('dragleave', () => { node.classList.remove('drop-target'); });
    (side === 'right' ? document.getElementById("grid-right") : document.getElementById("grid-left")).appendChild(node);
    state.tiles.set(id, node);
    // Create player when API ready
    createPlayer(playerHost, id, title);
}

function createPlayer(hostElem, id, titleElem) {
    const player = new YT.Player(hostElem, {
        videoId: id,
        playerVars: {
            autoplay: 0,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            enablejsapi: 1,
        },
        events: {
            onReady: (e) => {
                try {
                    titleElem.textContent = e.target.getVideoData().title || id;
                } catch (_) {
                    titleElem.textContent = id;
                }
                if (state.mutedAll) e.target.mute();
            },
            onError: () => {
                titleElem.textContent = `${id} (error)`;
            }
        }
    });
    state.players.set(id, player);
}

function getTotalCount() { return getColumnIds('left').length + getColumnIds('right').length; }

function addStreamById(id, sideHint) {
    if (!id || state.players.has(id)) return;
    if (getTotalCount() >= 6) { alert('Limitation: maximum 6 players.'); return; }
    let side = sideHint;
    if (!side) {
        const [lCount, rCount] = [getColumnIds('left').length, getColumnIds('right').length];
        if (!side) side = lCount <= rCount ? 'left' : 'right';
    }
    // enforce per-column cap 3
    if (side === 'left' && getColumnIds('left').length >= 3) side = 'right';
    if (side === 'right' && getColumnIds('right').length >= 3) side = 'left';
    if ((side === 'left' && getColumnIds('left').length >= 3) || (side === 'right' && getColumnIds('right').length >= 3)) {
        alert('Each column can contain up to 3 players.');
        return;
    }
    createTile(id, side);
    saveLayout();
}

function addStreamFromInput() {
    const input = document.getElementById("input-url");
    const id = extractVideoId(input.value);
    if (!id) {
        input.focus();
        input.select();
        return;
    }
    input.value = "";
    addStreamById(id);
}

function removeStream(id) {
    const player = state.players.get(id);
    if (player) {
        try { player.destroy(); } catch (_) {}
        state.players.delete(id);
    }
    const tile = state.tiles.get(id);
    if (tile && tile.parentElement) tile.parentElement.removeChild(tile);
    state.tiles.delete(id);
    saveLayout();
}

function clearAll() {
    Array.from(state.players.keys()).forEach(removeStream);
}

// Controls
function playAll() { state.players.forEach(p => { try { p.playVideo(); } catch(_){} }); }
function pauseAll() { state.players.forEach(p => { try { p.pauseVideo(); } catch(_){} }); }
function playOne(id) { const p = state.players.get(id); if (p) try { p.playVideo(); } catch(_){} }
function pauseOne(id) { const p = state.players.get(id); if (p) try { p.pauseVideo(); } catch(_){} }

function muteAll(force) {
    state.mutedAll = force !== undefined ? !!force : !state.mutedAll;
    state.players.forEach(p => { try { state.mutedAll ? p.mute() : p.unMute(); } catch(_){} });
    saveLayout();
}
function toggleMute(id) { const p = state.players.get(id); if (!p) return; try { p.isMuted() ? p.unMute() : p.mute(); } catch(_){} }

function setAllVolume(v) { state.players.forEach(p => { try { p.setVolume(v); } catch(_){} }); }

// Reordering helpers
function moveUp(id) {
    const tile = state.tiles.get(id);
    if (!tile) return;
    const prev = tile.previousElementSibling;
    if (!prev) return;
    tile.parentElement.insertBefore(tile, prev);
    saveLayout();
}
function moveDown(id) {
    const tile = state.tiles.get(id);
    if (!tile) return;
    const next = tile.nextElementSibling;
    if (!next) return;
    const afterNext = next.nextElementSibling;
    if (afterNext) tile.parentElement.insertBefore(tile, afterNext); else tile.parentElement.appendChild(tile);
    saveLayout();
}

function moveToSide(id, side) {
    const tile = state.tiles.get(id);
    if (!tile) return;
    const targetCol = document.getElementById(side === 'right' ? 'grid-right' : 'grid-left');
    if (tile.parentElement === targetCol) return;
    // block if target column is full
    const targetCount = getColumnIds(side).length;
    if (targetCount >= 3) { alert('Target column already has 3 players.'); return; }
    targetCol.appendChild(tile);
    saveLayout();
}

// Events wiring
function wireUi() {
    const addBtn = document.getElementById("btn-add");
    const input = document.getElementById("input-url");
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addStreamFromInput();
    });
    addBtn.addEventListener('click', addStreamFromInput);

    document.getElementById("btn-play").addEventListener('click', playAll);
    document.getElementById("btn-pause").addEventListener('click', pauseAll);
    document.getElementById("btn-mute").addEventListener('click', () => muteAll());
    document.getElementById("btn-clear").addEventListener('click', clearAll);
    const presetSel = document.getElementById("preset");
    if (presetSel) {
        presetSel.addEventListener('change', () => {
            const val = presetSel.value;
            if (!val || val === 'auto') { saveLayout(); return; }
            const parts = val.split('-');
            const lMax = Number(parts[0]);
            const rMax = Number(parts[1]);
            const all = [...getColumnIds('left'), ...getColumnIds('right')].slice(0, 6);
            const leftCol = document.getElementById('grid-left');
            const rightCol = document.getElementById('grid-right');
            all.forEach(id => {
                const tile = state.tiles.get(id);
                if (tile && tile.parentElement) tile.parentElement.removeChild(tile);
            });
            const leftIds = all.slice(0, lMax);
            const rightIds = all.slice(lMax, lMax + rMax);
            leftIds.forEach(id => { const tile = state.tiles.get(id); if (tile) leftCol.appendChild(tile); });
            rightIds.forEach(id => { const tile = state.tiles.get(id); if (tile) rightCol.appendChild(tile); });
            saveLayout();
        });
    }
    document.getElementById("volume").addEventListener('input', (e) => {
        const v = Number(e.target.value);
        setAllVolume(v);
        saveLayout();
    });

    document.getElementById("btn-help").addEventListener('click', showHelp);

    // Allow dropping into empty columns
    [document.getElementById('grid-left'), document.getElementById('grid-right')].forEach(col => {
        col.addEventListener('dragover', (e) => {
            if (!state.draggingId) return;
            e.preventDefault();
            const dragged = state.tiles.get(state.draggingId);
            // block if column full
            if (getColumnIds(col.id === 'grid-right' ? 'right' : 'left').length >= 3) return;
            if (dragged && dragged.parentElement !== col) {
                col.appendChild(dragged);
            }
        });
        col.addEventListener('drop', () => { saveLayout(); });
    });
}

function showHelp() {
    alert(
`Shortcuts:\n
Enter (in input): Add video\n
P: Play/Pause all\nM: Mute/Unmute all`
    );
}

function wireShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        if (e.key.toLowerCase() === 'p') { const any = Array.from(state.players.values())[0]; if (any) { try { any.getPlayerState() === 1 ? pauseAll() : playAll(); } catch(_){} } }
        if (e.key.toLowerCase() === 'm') muteAll();
        // volume control removed
    });
}

// YouTube API ready
window.onYouTubeIframeAPIReady = function() {
    wireUi();
    wireShortcuts();
    restoreLayout();
};


