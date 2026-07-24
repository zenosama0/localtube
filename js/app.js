(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const body = document.body;

  /* ================= DOM refs ================= */
  const menuBtn = $('menuBtn'), sidebar = $('sidebar');
  const openFolderBtn = $('openFolderBtn'), openFolderLabel = $('openFolderLabel');
  const emptyStateBtn = $('emptyStateBtn'), emptyStateFilesBtn = $('emptyStateFilesBtn');
  const emptyState = $('emptyState'), emptyStateText = $('emptyStateText');
  const fileInput = $('fileInput'), folderInputFallback = $('folderInputFallback');
  const scanToast = $('scanToast'), scanToastText = $('scanToastText');
  const shuffleBtn = $('shuffleBtn'), themeBtn = $('themeBtn');
  const mnavAdd = $('mnavAdd');
  const searchForm = $('searchForm'), searchInput = $('searchInput');
  const mobileSearchBtn = $('mobileSearchBtn'), mobileSearchBar = $('mobileSearchBar'),
        mobileSearchBack = $('mobileSearchBack'), mobileSearchInput = $('mobileSearchInput');
  const chipRow = $('chipRow'), videoGrid = $('videoGrid');
  const libraryGrid = $('libraryGrid'), historyGrid = $('historyGrid');
  const homeView = $('homeView'), libraryView = $('libraryView'), historyView = $('historyView');
  const watchView = $('watchView'), channelView = $('channelView'), foldersView = $('foldersView');
  const playlistView = $('playlistView'), settingsView = $('settingsView');
  const views = { home: homeView, library: libraryView, history: historyView, watch: watchView,
    channel: channelView, folders: foldersView, playlist: playlistView, settings: settingsView };

  /* ================= State ================= */
  let roots = [];                 // [{id,name,handle,kind,addedAt,needsReconnect}]
  let library = [];               // flat array of live entries
  const libraryById = new Map();
  let feedOrder = [];
  let activeFolder = 'all';
  let searchTerm = '';
  let currentEntry = null;
  let currentObjectUrl = null;
  let autoplayTimer = null;
  let isMobile = window.matchMedia('(max-width: 900px)').matches;
  let historyList = [];           // [{id,name,folder,thumb,duration,ts}]
  let playlists = { liked: { name: 'Liked videos', ids: [] }, watchlater: { name: 'Watch later', ids: [] }, custom: [] };
  let saveModalEntry = null;
  let miniActive = false;

  const gestureSettings = { volume: true, brightness: true, doubleTap: true };
  const AUTOPLAY_KEY = 'lt_autoplay', THEME_KEY = 'lt_theme', GESTURE_KEY = 'lt_gestures';
  let autoplayOn = localStorage.getItem(AUTOPLAY_KEY) !== 'off';
  try { Object.assign(gestureSettings, JSON.parse(localStorage.getItem(GESTURE_KEY) || '{}')); } catch (e) {}

  /* ================= Theme ================= */
  function applyTheme(t) {
    body.classList.remove('theme-dark', 'theme-light');
    body.classList.add(t === 'light' ? 'theme-light' : 'theme-dark');
    localStorage.setItem(THEME_KEY, t);
    const on = t !== 'light';
    $('settingThemeToggle') && $('settingThemeToggle').classList.toggle('on', on);
  }
  applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
  function toggleTheme() { applyTheme(body.classList.contains('theme-dark') ? 'light' : 'dark'); }
  themeBtn.addEventListener('click', toggleTheme);
  $('settingThemeToggle').addEventListener('click', toggleTheme);

  menuBtn.addEventListener('click', () => body.classList.toggle('sidebar-collapsed'));

  /* ================= Utilities ================= */
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); }
  function fakeViews(entry) {
    const n = (hashStr(entry.id) % 900000) + 100;
    if (n > 1000000) return (n / 1000000).toFixed(1) + 'M views';
    if (n > 1000) return (n / 1000).toFixed(1) + 'K views';
    return n + ' views';
  }
  function timeAgo(ts) {
    const diff = Math.max(Date.now() - (ts || Date.now()), 0), day = 86400000;
    const units = [[365, 'year'], [30, 'month'], [7, 'week'], [1, 'day']];
    let days = diff / day;
    for (const [amt, label] of units) if (days >= amt) { const v = Math.floor(days / amt); return `${v} ${label}${v > 1 ? 's' : ''} ago`; }
    const hours = Math.floor(diff / 3600000);
    if (hours >= 1) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    return 'just now';
  }
  function fmtDuration(s) {
    if (!s || !isFinite(s)) return '';
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const mm = h ? String(m).padStart(2, '0') : m;
    return (h ? `${h}:${mm}:` : `${mm}:`) + String(sec).padStart(2, '0');
  }
  function fmtBytes(b) { if (b > 1e9) return (b / 1e9).toFixed(2) + ' GB'; if (b > 1e6) return (b / 1e6).toFixed(1) + ' MB'; return Math.round(b / 1e3) + ' KB'; }
  function niceTitle(filename) { return (filename || '').replace(/\.[^.]+$/, '').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function avatarColor(seed) { const hues = [4, 24, 200, 260, 320, 150, 40]; return `hsl(${hues[hashStr(seed || 'x') % hues.length]} 70% 55%)`; }
  function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function channelHash(folder) { return `#/channel/${encodeURIComponent(folder || 'Device')}`; }

  /* ================= Thumbnail lazy loading ================= */
  const thumbObserver = new IntersectionObserver((entries) => {
    entries.forEach(async (obs) => {
      if (!obs.isIntersecting) return;
      const el = obs.target;
      const id = el.dataset.id;
      const entry = libraryById.get(id);
      if (!entry || entry._thumbLoading) return;
      thumbObserver.unobserve(el);
      if (entry.thumb) { paintThumb(el, entry); return; }
      entry._thumbLoading = true;
      try {
        const file = await LTScanner.getEntryFile(entry);
        const { thumb, duration, width, height } = await LTScanner.extractThumbAndDuration(file);
        entry.thumb = thumb; if (duration) entry.duration = duration;
        if (width) entry.width = width; if (height) entry.height = height;
      } catch (e) { /* unreadable */ }
      entry._thumbLoading = false;
      paintThumb(el, entry);
    });
  }, { rootMargin: '400px 0px' });

  function paintThumb(thumbWrapEl, entry) {
    const img = thumbWrapEl.querySelector('img');
    const dur = thumbWrapEl.querySelector('.thumb-duration');
    if (entry.thumb) { img.src = entry.thumb; thumbWrapEl.classList.add('has-thumb'); }
    if (dur) dur.textContent = fmtDuration(entry.duration);
  }

  /* ================= Card rendering ================= */
  function makeCard(entry, opts) {
    opts = opts || {};
    const card = document.createElement('div');
    card.className = 'video-card';
    card.dataset.id = entry.id;
    const letter = (entry.folder || entry.name || 'L').replace(/^\W+/, '')[0]?.toUpperCase() || 'L';
    const missing = entry.missing ? '<span class="missing-badge">Not found in current folders</span>' : '';
    card.innerHTML = `
      <div class="thumb-wrap${entry.thumb ? ' has-thumb' : ''}" data-id="${entry.id}">
        <img alt="" loading="lazy" src="${entry.thumb || ''}">
        <span class="thumb-duration">${fmtDuration(entry.duration)}</span>
      </div>
      <div class="card-body">
        <div class="card-avatar" data-folder="${escapeHtml(entry.folder || 'Device')}" style="background:${avatarColor(entry.folder || entry.name)}">${letter}</div>
        <div class="card-meta">
          <p class="card-title">${escapeHtml(niceTitle(entry.name))}</p>
          <div class="card-sub card-channel-link" data-folder="${escapeHtml(entry.folder || 'Device')}">${escapeHtml(entry.folder || 'Device')}</div>
          <div class="card-sub">${fakeViews(entry)} &middot; ${timeAgo(entry.lastModified)}</div>
          ${missing}
        </div>
      </div>`;
    card.querySelector('.card-avatar').addEventListener('click', (e) => { e.stopPropagation(); location.hash = channelHash(entry.folder); });
    card.querySelector('.card-channel-link').addEventListener('click', (e) => { e.stopPropagation(); location.hash = channelHash(entry.folder); });
    card.addEventListener('click', () => { location.hash = `#/watch/${encodeURIComponent(entry.id)}`; });
    if (!opts.noObserve && !entry.thumb) thumbObserver.observe(card.querySelector('.thumb-wrap'));
    return card;
  }

  function makeShortCard(entry) {
    const card = document.createElement('div');
    card.className = 'short-card';
    card.dataset.id = entry.id;
    card.innerHTML = `
      <div class="short-thumb-wrap${entry.thumb ? ' has-thumb' : ''}" data-id="${entry.id}">
        <img alt="" loading="lazy" src="${entry.thumb || ''}">
        <span class="short-views">${fakeViews(entry)}</span>
        <div class="short-title">${escapeHtml(niceTitle(entry.name))}</div>
      </div>`;
    card.addEventListener('click', () => { location.hash = `#/watch/${encodeURIComponent(entry.id)}`; });
    if (!entry.thumb) thumbObserver.observe(card.querySelector('.short-thumb-wrap'));
    return card;
  }

  function skeletonCard() {
    const card = document.createElement('div');
    card.className = 'video-card skeleton-card';
    card.innerHTML = `<div class="thumb-wrap skeleton-shape"></div><div class="card-body"><div class="card-avatar skeleton-shape"></div><div class="card-meta"><p class="card-title skeleton-shape"></p><div class="card-sub skeleton-shape"></div></div></div>`;
    return card;
  }
  function showSkeletons(container, n) {
    container.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) frag.appendChild(skeletonCard());
    container.appendChild(frag);
  }

  // Per-container cache of already-built card elements, keyed by entry id.
  // Re-rendering a grid reuses these nodes (and just repositions them via
  // appendChild) instead of destroying/recreating <img> elements — that's
  // what was causing thumbnails to flash blank and "reload" every time you
  // came back from the watch page.
  const gridCaches = new WeakMap();
  function getGridCache(container) {
    let c = gridCaches.get(container);
    if (!c) { c = new Map(); gridCaches.set(container, c); }
    return c;
  }
  function refreshCardInPlace(el, entry) {
    const wrap = el.querySelector('.thumb-wrap') || el.querySelector('.short-thumb-wrap');
    if (wrap && entry.thumb && !wrap.classList.contains('has-thumb')) {
      wrap.querySelector('img').src = entry.thumb;
      wrap.classList.add('has-thumb');
    }
    const dur = el.querySelector('.thumb-duration');
    if (dur) dur.textContent = fmtDuration(entry.duration);
  }

  function renderGrid(container, entries) {
    if (!entries.length) { gridCaches.delete(container); container.innerHTML = '<p class="empty-hint">Nothing here yet.</p>'; return; }
    const cache = getGridCache(container);
    const wanted = new Set(entries.map(e => e.id));
    for (const [id, el] of Array.from(cache)) { if (!wanted.has(id)) { el.remove(); cache.delete(id); } }
    const frag = document.createDocumentFragment();
    entries.forEach(entry => {
      let el = cache.get(entry.id);
      if (el) refreshCardInPlace(el, entry);
      else { el = makeCard(entry); cache.set(entry.id, el); }
      frag.appendChild(el);
    });
    container.textContent = '';
    container.appendChild(frag);
  }
  function renderShortsRow(container, entries) {
    if (!entries.length) { gridCaches.delete(container); container.innerHTML = ''; return; }
    const cache = getGridCache(container);
    const wanted = new Set(entries.map(e => e.id));
    for (const [id, el] of Array.from(cache)) { if (!wanted.has(id)) { el.remove(); cache.delete(id); } }
    const frag = document.createDocumentFragment();
    entries.forEach(entry => {
      let el = cache.get(entry.id);
      if (el) refreshCardInPlace(el, entry);
      else { el = makeShortCard(entry); cache.set(entry.id, el); }
      frag.appendChild(el);
    });
    container.textContent = '';
    container.appendChild(frag);
  }
  function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /* ================= Chips + Home feed ================= */
  function renderChips() {
    const folders = Array.from(new Set(library.map(e => e.folder || 'Device')));
    const hasShorts = library.some(e => e.isShort);
    chipRow.innerHTML = '';
    const mk = (label, key) => {
      const b = document.createElement('button');
      b.className = 'chip' + (activeFolder === key ? ' active' : '');
      b.textContent = label;
      b.addEventListener('click', () => { activeFolder = key; renderHome(); });
      return b;
    };
    chipRow.appendChild(mk('All', 'all'));
    if (hasShorts) chipRow.appendChild(mk('Shorts', 'shorts'));
    folders.forEach(f => chipRow.appendChild(mk(f, f)));
  }

  function renderHome() {
    if (!library.length) return;
    renderChips();
    const shortsShelf = $('shortsShelf'), shortsRow = $('shortsRow');
    let entries = feedOrder.map(id => libraryById.get(id)).filter(Boolean);
    if (searchTerm) entries = entries.filter(e => niceTitle(e.name).toLowerCase().includes(searchTerm));

    if (activeFolder === 'shorts') {
      shortsShelf.classList.add('hidden');
      videoGrid.classList.add('shorts-grid');
      renderShortsRow(videoGrid, entries.filter(e => e.isShort));
      return;
    }
    videoGrid.classList.remove('shorts-grid');

    let shorts = entries.filter(e => e.isShort);
    if (activeFolder !== 'all') {
      entries = entries.filter(e => (e.folder || 'Device') === activeFolder);
      shorts = shorts.filter(e => (e.folder || 'Device') === activeFolder);
    }
    const regular = entries.filter(e => !e.isShort);
    if (shorts.length) { shortsShelf.classList.remove('hidden'); renderShortsRow(shortsRow, shorts.slice(0, 12)); }
    else shortsShelf.classList.add('hidden');
    renderGrid(videoGrid, regular);
  }

  function renderLibrary() {
    let entries = library.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (searchTerm) entries = entries.filter(e => niceTitle(e.name).toLowerCase().includes(searchTerm));
    renderGrid(libraryGrid, entries);
  }

  /* ================= Channel page ================= */
  function renderChannel(folder) {
    const entries = library.filter(e => (e.folder || 'Device') === folder);
    $('channelName').textContent = folder;
    $('channelCount').textContent = `${entries.length} video${entries.length === 1 ? '' : 's'}`;
    $('channelAvatar').style.background = avatarColor(folder);
    renderGrid($('channelGrid'), entries);
  }

  /* ================= History ================= */
  async function loadHistory() { historyList = (await LTDB.getKV('history')) || []; }
  async function pushHistory(entry) {
    historyList = historyList.filter(h => h.id !== entry.id);
    historyList.push({ id: entry.id, name: entry.name, folder: entry.folder, thumb: entry.thumb || null, duration: entry.duration || 0, ts: Date.now() });
    historyList = historyList.slice(-300);
    await LTDB.setKV('history', historyList);
  }
  function renderHistory() {
    const rows = historyList.slice().reverse();
    const entries = rows.map(h => libraryById.get(h.id) || { ...h, missing: true });
    if (!entries.length) { historyGrid.innerHTML = '<p class="empty-hint">Videos you watch will show up here.</p>'; return; }
    renderGrid(historyGrid, entries);
  }

  /* ================= Playlists ================= */
  async function loadPlaylists() {
    const stored = await LTDB.getKV('playlists');
    if (stored) playlists = stored;
    renderSidePlaylists();
  }
  async function savePlaylists() { await LTDB.setKV('playlists', playlists); renderSidePlaylists(); }
  function snapshotOf(entry) { return { id: entry.id, name: entry.name, folder: entry.folder, thumb: entry.thumb || null, duration: entry.duration || 0, addedAt: Date.now() }; }
  function allPlaylistDefs() {
    return [{ key: 'liked', name: playlists.liked.name }, { key: 'watchlater', name: playlists.watchlater.name },
      ...playlists.custom.map(p => ({ key: p.id, name: p.name }))];
  }
  function getPlaylistByKey(key) {
    if (key === 'liked') return playlists.liked;
    if (key === 'watchlater') return playlists.watchlater;
    return playlists.custom.find(p => p.id === key);
  }
  function isInPlaylist(key, id) { const p = getPlaylistByKey(key); return !!(p && p.ids.some(x => x.id === id)); }
  async function togglePlaylist(key, entry) {
    const p = getPlaylistByKey(key); if (!p) return;
    const idx = p.ids.findIndex(x => x.id === entry.id);
    if (idx >= 0) p.ids.splice(idx, 1); else p.ids.push(snapshotOf(entry));
    await savePlaylists();
  }
  async function createCustomPlaylist(name) {
    const p = { id: LTDB.uuid(), name: name.trim() || 'New playlist', ids: [] };
    playlists.custom.push(p);
    await savePlaylists();
    return p;
  }
  async function deleteCustomPlaylist(id) {
    playlists.custom = playlists.custom.filter(p => p.id !== id);
    await savePlaylists();
  }
  function renderSidePlaylists() {
    const el = $('sideCustomPlaylists');
    el.innerHTML = '';
    playlists.custom.forEach(p => {
      const a = document.createElement('a');
      a.href = `#/playlist/${encodeURIComponent(p.id)}`;
      a.className = 'side-item';
      a.dataset.view = 'playlist-' + p.id;
      a.innerHTML = `<span class="side-playlist-dot" style="background:${avatarColor(p.name)};border-radius:6px;"></span><span>${escapeHtml(p.name)}</span>`;
      el.appendChild(a);
    });
  }
  function renderPlaylistPage(key) {
    const p = getPlaylistByKey(key);
    if (!p) { location.hash = '#/'; return; }
    $('playlistName').textContent = p.name;
    $('playlistDeleteBtn').classList.toggle('hidden', key === 'liked' || key === 'watchlater');
    $('playlistDeleteBtn').onclick = async () => {
      if (!confirm(`Delete "${p.name}"?`)) return;
      await deleteCustomPlaylist(key);
      location.hash = '#/';
    };
    const entries = p.ids.slice().reverse().map(snap => libraryById.get(snap.id) || { ...snap, missing: true });
    if (!entries.length) { $('playlistGrid').innerHTML = '<p class="empty-hint">No videos saved here yet.</p>'; return; }
    renderGrid($('playlistGrid'), entries);
  }

  /* ================= Save-to-playlist modal ================= */
  function openSaveModal(entry) {
    saveModalEntry = entry;
    const list = $('saveModalList');
    list.innerHTML = '';
    allPlaylistDefs().forEach(def => {
      const row = document.createElement('div');
      row.className = 'save-modal-row';
      const checked = isInPlaylist(def.key, entry.id);
      row.innerHTML = `<div class="save-modal-check${checked ? ' checked' : ''}">${checked ? '<svg viewBox="0 0 24 24"><path d="M5 13l4 4 10-10" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}</div><div class="save-modal-name">${escapeHtml(def.name)}</div>`;
      row.addEventListener('click', async () => {
        await togglePlaylist(def.key, saveModalEntry);
        if (def.key === 'liked') updateLikeButton();
        openSaveModal(saveModalEntry);
      });
      list.appendChild(row);
    });
    $('saveModalBackdrop').classList.remove('hidden');
  }
  function closeSaveModal() { $('saveModalBackdrop').classList.add('hidden'); saveModalEntry = null; $('newPlaylistInput').value = ''; }
  $('saveModalClose').addEventListener('click', closeSaveModal);
  $('saveModalBackdrop').addEventListener('click', (e) => { if (e.target === $('saveModalBackdrop')) closeSaveModal(); });
  $('newPlaylistBtn').addEventListener('click', async () => {
    const name = $('newPlaylistInput').value.trim();
    if (!name || !saveModalEntry) return;
    const p = await createCustomPlaylist(name);
    await togglePlaylist(p.id, saveModalEntry);
    $('newPlaylistInput').value = '';
    openSaveModal(saveModalEntry);
  });
  $('saveBtn').addEventListener('click', () => { if (currentEntry) openSaveModal(currentEntry); });
  function updateLikeButton() {
    $('likeBtn').classList.toggle('active', !!(currentEntry && isInPlaylist('liked', currentEntry.id)));
  }
  $('likeBtn').addEventListener('click', async () => {
    if (!currentEntry) return;
    await togglePlaylist('liked', currentEntry);
    updateLikeButton();
  });
  $('shareBtn').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); const s = $('shareBtn').querySelector('span'); s.textContent = 'Copied!'; setTimeout(() => { s.textContent = 'Share'; }, 1500); }
    catch (e) {}
  });

  /* ================= More sheet (mobile) ================= */
  $('moreBtn').addEventListener('click', () => { $('autoplayToggleSheet').classList.toggle('on', autoplayOn); $('moreSheetBackdrop').classList.remove('hidden'); });
  $('moreSheetBackdrop').addEventListener('click', (e) => { if (e.target === $('moreSheetBackdrop')) $('moreSheetBackdrop').classList.add('hidden'); });
  $('moreSheetSettingsLink').addEventListener('click', () => $('moreSheetBackdrop').classList.add('hidden'));
  $('autoplayToggleSheet').addEventListener('click', toggleAutoplay);

  /* ================= Player wiring ================= */
  const player = createLTPlayer({
    video: $('videoEl'), wrap: $('playerWrap'),
    progressBar: $('progressBar'), progressPlayed: $('progressPlayed'), progressBuffered: $('progressBuffered'), progressThumb: $('progressThumb'),
    playPauseBtn: $('playPauseBtn'), iconPlay: $('iconPlay'), iconPause: $('iconPause'),
    muteBtn: $('muteBtn'), iconVolHigh: $('iconVolHigh'), iconVolMute: $('iconVolMute'), volSlider: $('volSlider'),
    timeDisplay: $('timeDisplay'), fullscreenBtn: $('fullscreenBtn'), pipBtn: $('pipBtn'), nextBtn: $('nextBtn'),
    gestureLayer: $('gestureLayer'), seekRippleLeft: $('seekRippleLeft'), seekRippleLeftLabel: $('seekRippleLeftLabel'),
    seekRippleRight: $('seekRippleRight'), seekRippleRightLabel: $('seekRippleRightLabel'),
    gestureIndicator: $('gestureIndicator'), gestureIndicatorIcon: $('gestureIndicatorIcon'),
    gestureIndicatorFill: $('gestureIndicatorFill'), gestureIndicatorValue: $('gestureIndicatorValue'),
    brightnessOverlay: $('brightnessOverlay'), swipeUpHint: $('swipeUpHint'), recsSheet: $('recsSheet'),
    playerError: $('playerError'), playerErrorSub: $('playerErrorSub'), playerErrorBack: $('playerErrorBack'),
    gestureSettings
  });

  const autoplayOverlay = $('autoplayOverlay'), autoplayThumb = $('autoplayThumb'), autoplayTitle = $('autoplayTitle');
  const autoplayRing = $('autoplayRingProgress'), cancelAutoplayBtn = $('cancelAutoplay');
  const autoplayToggle = $('autoplayToggle'), autoplayToggleSide = $('autoplayToggleSide');

  function setAutoplayUI() { [autoplayToggle, autoplayToggleSide, $('autoplayToggleSheet'), $('settingAutoplayToggle')].forEach(b => b && b.classList.toggle('on', autoplayOn)); }
  function toggleAutoplay() { autoplayOn = !autoplayOn; localStorage.setItem(AUTOPLAY_KEY, autoplayOn ? 'on' : 'off'); setAutoplayUI(); }
  autoplayToggle.addEventListener('click', toggleAutoplay);
  autoplayToggleSide.addEventListener('click', toggleAutoplay);
  $('settingAutoplayToggle').addEventListener('click', toggleAutoplay);
  setAutoplayUI();

  let upNextEntries = [];
  function pickRandom(excludeId, count) { return shuffleArray(library.filter(e => e.id !== excludeId)).slice(0, count); }

  function renderUpNext() {
    const list = $('upNextList');
    list.innerHTML = '';
    upNextEntries.forEach(e => {
      const card = document.createElement('div');
      card.className = 'up-next-card'; card.dataset.id = e.id;
      card.innerHTML = `<div class="thumb-wrap${e.thumb ? ' has-thumb' : ''}" data-id="${e.id}"><img alt="" src="${e.thumb || ''}"><span class="thumb-duration">${fmtDuration(e.duration)}</span></div>
        <div><p class="up-title">${escapeHtml(niceTitle(e.name))}</p><div class="up-sub">${escapeHtml(e.folder || 'Device')}</div><div class="up-sub">${fakeViews(e)}</div></div>`;
      card.addEventListener('click', () => { location.hash = `#/watch/${encodeURIComponent(e.id)}`; });
      thumbObserver.observe(card.querySelector('.thumb-wrap'));
      list.appendChild(card);
    });
  }
  function renderRecsSheet() {
    const list = $('recsSheetList');
    list.innerHTML = '';
    pickRandom(currentEntry ? currentEntry.id : null, 10).forEach(e => {
      const card = document.createElement('div');
      card.className = 'up-next-card'; card.dataset.id = e.id;
      card.innerHTML = `<div class="thumb-wrap${e.thumb ? ' has-thumb' : ''}" data-id="${e.id}"><img alt="" src="${e.thumb || ''}"><span class="thumb-duration">${fmtDuration(e.duration)}</span></div>
        <div><p class="up-title">${escapeHtml(niceTitle(e.name))}</p><div class="up-sub">${escapeHtml(e.folder || 'Device')}</div><div class="up-sub">${fakeViews(e)}</div></div>`;
      card.addEventListener('click', () => { location.hash = `#/watch/${encodeURIComponent(e.id)}`; });
      thumbObserver.observe(card.querySelector('.thumb-wrap'));
      list.appendChild(card);
    });
  }
  player.onSwipeUpRecs = renderRecsSheet;

  /* ---- mini player ---- */
  const miniPlayerEl = $('miniPlayer'), miniPlayerSlot = $('miniPlayerSlot');
  const miniPlayPauseBtn = $('miniPlayPause'), miniIconPlay = $('miniIconPlay'), miniIconPause = $('miniIconPause');
  function updateMiniIcon() { const playing = !player.el.paused && !player.el.ended; miniIconPlay.classList.toggle('hidden', playing); miniIconPause.classList.toggle('hidden', !playing); }
  player.el.addEventListener('play', updateMiniIcon);
  player.el.addEventListener('pause', updateMiniIcon);
  function enterMiniPlayer() {
    if (!currentEntry || miniActive) return;
    if (!$('playerError').classList.contains('hidden')) return; // nothing to show
    miniActive = true;
    miniPlayerSlot.appendChild(player.el);
    $('miniPlayerTitle').textContent = niceTitle(currentEntry.name);
    $('miniPlayerChannel').textContent = currentEntry.folder || 'Device';
    miniPlayerEl.classList.remove('hidden');
    updateMiniIcon();
  }
  function exitMiniPlayerBackToWatch() {
    if (!miniActive) return;
    miniActive = false;
    $('playerWrap').insertBefore(player.el, $('playerWrap').firstChild);
    miniPlayerEl.classList.add('hidden');
  }
  function closeMiniPlayer() {
    if (miniActive) { player.pause(); }
    miniActive = false;
    miniPlayerEl.classList.add('hidden');
    $('playerWrap').insertBefore(player.el, $('playerWrap').firstChild);
    if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
    player.el.removeAttribute('src');
    currentEntry = null;
  }
  miniPlayerEl.addEventListener('click', (e) => {
    if (e.target.closest('#miniPlayPause') || e.target.closest('#miniClose')) return;
    location.hash = `#/watch/${encodeURIComponent(currentEntry.id)}`;
  });
  miniPlayPauseBtn.addEventListener('click', (e) => { e.stopPropagation(); if (player.el.paused) player.play(); else player.pause(); });
  $('miniClose').addEventListener('click', (e) => { e.stopPropagation(); closeMiniPlayer(); });

  function setAutoplayOverlay(show) { autoplayOverlay.classList.toggle('hidden', !show); }

  async function playEntry(entry) {
    if (miniActive && currentEntry && currentEntry.id === entry.id) { exitMiniPlayerBackToWatch(); return; }
    currentEntry = entry;
    clearTimeout(autoplayTimer);
    setAutoplayOverlay(false);
    player.hideError();
    if (miniActive) { miniActive = false; miniPlayerEl.classList.add('hidden'); $('playerWrap').insertBefore(player.el, $('playerWrap').firstChild); }
    if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
    $('playerWrap').classList.toggle('is-short', !!entry.isShort);

    $('watchTitle').textContent = niceTitle(entry.name);
    $('watchAvatar').style.background = avatarColor(entry.folder || entry.name);
    $('watchChannel').textContent = entry.folder || 'Device';
    $('watchChannelLink').href = channelHash(entry.folder);
    $('watchFileMeta').textContent = `${fakeViews(entry)} \u00b7 ${timeAgo(entry.lastModified)}`;
    $('descriptionText').innerHTML = entry.missing
      ? `<span class="muted">This video isn't in any of your currently added folders.</span>`
      : `<span class="muted">${fakeViews(entry)} \u00b7 Uploaded ${timeAgo(entry.lastModified)}</span>\n\nFile: ${escapeHtml(entry.name)}\nFolder: ${escapeHtml(entry.folder || 'Device')}\nSize: ${entry.size ? fmtBytes(entry.size) : '\u2014'}`;
    updateLikeButton();

    if (entry.missing || !entry.kind) {
      player.el.removeAttribute('src');
      player.showError("This video isn't in any of your currently added folders. Reconnect the original folder to play it.");
    } else {
      try {
        const file = await LTScanner.getEntryFile(entry);
        currentObjectUrl = URL.createObjectURL(file);
        player.load(currentObjectUrl);
      } catch (e) {
        player.el.removeAttribute('src');
        player.showError('This file could not be opened. It may have been moved, renamed, or deleted.');
      }
    }

    pushHistory(entry);
    upNextEntries = pickRandom(entry.id, isMobile ? 8 : 12);
    renderUpNext();
    document.querySelectorAll('.up-next-card').forEach(c => c.classList.toggle('playing', c.dataset.id === entry.id));
  }
  player.onErrorBack = () => history.back();

  player.onNext = () => playNext();
  player.onEnded = () => { if (autoplayOn && upNextEntries.length) startAutoplayCountdown(); };
  function playNext() { if (upNextEntries.length) location.hash = `#/watch/${encodeURIComponent(upNextEntries[0].id)}`; }
  function startAutoplayCountdown() {
    const next = upNextEntries[0]; if (!next) return;
    autoplayThumb.src = next.thumb || ''; autoplayTitle.textContent = niceTitle(next.name);
    setAutoplayOverlay(true);
    const total = 3200, circumference = 113, start = performance.now();
    function tick(now) {
      const pct = Math.min((now - start) / total, 1);
      autoplayRing.style.strokeDashoffset = String(circumference * pct);
      if (pct < 1 && !autoplayOverlay.classList.contains('hidden')) autoplayTimer = requestAnimationFrame(tick);
      else if (pct >= 1) playNext();
    }
    autoplayRing.style.strokeDashoffset = '0';
    autoplayTimer = requestAnimationFrame(tick);
  }
  cancelAutoplayBtn.addEventListener('click', () => { cancelAnimationFrame(autoplayTimer); setAutoplayOverlay(false); });

  /* ================= Routing ================= */
  function showView(name) {
    Object.entries(views).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
    emptyState.classList.add('hidden');
    document.querySelectorAll('.side-item, .mnav-item').forEach(el => el.classList.toggle('active', el.dataset.view === name));
  }

  function findEntryForWatch(id) {
    if (libraryById.has(id)) return libraryById.get(id);
    const h = historyList.find(x => x.id === id);
    if (h) return { ...h, missing: true };
    for (const def of allPlaylistDefs()) {
      const p = getPlaylistByKey(def.key);
      const snap = p && p.ids.find(x => x.id === id);
      if (snap) return { ...snap, missing: true };
    }
    return null;
  }

  async function router() {
    const hash = location.hash || '#/';
    if (!library.length && !hash.startsWith('#/settings') && !hash.startsWith('#/folders')) {
      Object.values(views).forEach(v => v.classList.add('hidden'));
      if (!roots.length) { emptyState.classList.remove('hidden'); return; }
    }
    if (hash.startsWith('#/watch/')) {
      const id = decodeURIComponent(hash.slice('#/watch/'.length));
      const entry = findEntryForWatch(id);
      if (!entry) { location.hash = '#/'; return; }
      showView('watch'); window.scrollTo(0, 0);
      await playEntry(entry);
    } else if (hash.startsWith('#/channel/')) {
      const folder = decodeURIComponent(hash.slice('#/channel/'.length));
      showView('channel'); renderChannel(folder);
    } else if (hash.startsWith('#/playlist/')) {
      const key = decodeURIComponent(hash.slice('#/playlist/'.length));
      showView('playlist'); renderPlaylistPage(key);
      document.querySelectorAll('.side-item').forEach(el => el.classList.toggle('active', el.dataset.view === 'playlist-' + key));
    } else if (hash.startsWith('#/folders')) {
      showView('folders'); renderFolders();
    } else if (hash.startsWith('#/settings')) {
      showView('settings');
    } else if (hash.startsWith('#/library')) {
      showView('library'); renderLibrary();
    } else if (hash.startsWith('#/history')) {
      showView('history'); renderHistory();
    } else {
      showView('home'); renderHome();
    }
    if (!hash.startsWith('#/watch/') && currentEntry && !miniActive && player.el.src) enterMiniPlayer();
  }
  window.addEventListener('hashchange', router);

  /* ================= Search ================= */
  function applySearch(term) {
    searchTerm = term.trim().toLowerCase();
    const hash = location.hash || '#/';
    if (hash.startsWith('#/library')) renderLibrary();
    else if (!hash.startsWith('#/watch')) { if (!hash.startsWith('#/')) location.hash = '#/'; else renderHome(); }
  }
  searchForm.addEventListener('submit', (e) => { e.preventDefault(); applySearch(searchInput.value); });
  searchInput.addEventListener('input', () => applySearch(searchInput.value));
  mobileSearchBtn.addEventListener('click', () => { mobileSearchBar.classList.remove('hidden'); mobileSearchInput.focus(); });
  mobileSearchBack.addEventListener('click', () => { mobileSearchBar.classList.add('hidden'); mobileSearchInput.value = ''; applySearch(''); });
  mobileSearchInput.addEventListener('input', () => applySearch(mobileSearchInput.value));

  shuffleBtn.addEventListener('click', () => { feedOrder = shuffleArray(library.map(e => e.id)); if (!location.hash.startsWith('#/watch')) renderHome(); });

  // Tapping "Home" (logo, sidebar item, or bottom-nav item) while already on
  // the home view doesn't change the hash, so hashchange never fires — treat
  // it as an explicit request to scramble the feed and jump to the top.
  document.querySelectorAll('a[href="#/"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const alreadyHome = (location.hash === '#/' || location.hash === '' || location.hash === '#') && !homeView.classList.contains('hidden');
      if (alreadyHome) {
        e.preventDefault();
        feedOrder = shuffleArray(library.map(e2 => e2.id));
        activeFolder = 'all';
        renderHome();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  });

  /* ================= Library management (multi-folder, cache-first) ================= */
  function mergeEntry(entry) {
    const existing = libraryById.get(entry.id);
    if (existing) Object.assign(existing, entry);
    else { library.push(entry); libraryById.set(entry.id, entry); }
  }
  function removeEntryById(id) {
    const idx = library.findIndex(e => e.id === id);
    if (idx >= 0) library.splice(idx, 1);
    libraryById.delete(id);
  }
  let renderScheduled = false;
  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      feedOrder = feedOrder.filter(id => libraryById.has(id));
      library.forEach(e => { if (!feedOrder.includes(e.id)) feedOrder.splice(Math.floor(Math.random() * (feedOrder.length + 1)), 0, e.id); });
      const hash = location.hash || '#/';
      emptyState.classList.add('hidden');
      if (hash.startsWith('#/watch') || hash.startsWith('#/settings') || hash.startsWith('#/folders')) return;
      router();
    });
  }

  function reifyCachedEntry(raw, rootId) {
    return {
      id: LTScanner.makeId(raw.folder, raw.name, raw.size, raw.lastModified),
      name: raw.name, folder: raw.folder, size: raw.size, lastModified: raw.lastModified,
      duration: raw.duration || 0, width: raw.width || 0, height: raw.height || 0, isShort: !!raw.isShort,
      thumb: raw.thumb || null, kind: raw.kind, fileHandle: raw.fileHandle, file: raw.file, rootId
    };
  }

  function showScanToast(text) { scanToastText.textContent = text; scanToast.classList.remove('hidden'); }
  function hideScanToast() { scanToast.classList.add('hidden'); }

  async function loadRoot(root) {
    if (root.kind === 'files') return; // ephemeral, entries already merged at creation

    const cached = await LTDB.getIndex(root.id);
    if (cached && cached.length) {
      cached.forEach(raw => mergeEntry(reifyCachedEntry(raw, root.id)));
      scheduleRender();
    } else {
      showSkeletons(videoGrid, 8);
    }

    showScanToast(cached && cached.length ? `Checking "${root.name}" for changes\u2026` : `Scanning "${root.name}"\u2026`);
    let listed = 0;
    let fresh;
    try {
      fresh = await LTScanner.listDirectoryHandle(root.handle, root.id, (count) => {
        listed = count;
        scanToastText.textContent = `Found ${count} video${count === 1 ? '' : 's'} in "${root.name}"\u2026`;
      });
    } catch (e) {
      hideScanToast();
      root.needsReconnect = true;
      return;
    }
    const diff = LTScanner.diffAgainstCache(fresh, cached || []);
    diff.removed.forEach(raw => removeEntryById(LTScanner.makeId(raw.folder, raw.name, raw.size, raw.lastModified)));
    diff.unchanged.forEach(e => mergeEntry(e));
    scheduleRender();

    if (diff.added.length) {
      showScanToast(`Analyzing 0/${diff.added.length} new video${diff.added.length === 1 ? '' : 's'}\u2026`);
      await LTScanner.probeEntries(diff.added, (entry) => { mergeEntry(entry); scheduleRender(); },
        (done, total) => { scanToastText.textContent = `Analyzing ${done}/${total} new video${total === 1 ? '' : 's'}\u2026`; });
    }
    hideScanToast();

    const rootEntries = library.filter(e => e.rootId === root.id);
    await LTDB.setIndex(root.id, rootEntries);
  }

  async function addFolderDesktop() {
    if (!LTScanner.supportsDirectoryPicker()) return addFolderFallback();
    try {
      const handle = await window.showDirectoryPicker();
      let root = await LTDB.findRootByHandle(handle);
      if (!root) root = await LTDB.addRoot({ name: handle.name, handle, kind: 'directory' });
      else root.handle = handle;
      if (!roots.find(r => r.id === root.id)) roots.push(root);
      await loadRoot(root);
    } catch (e) { if (e.name !== 'AbortError') console.warn('Folder pick failed', e); }
  }
  function addFolderFallback() { folderInputFallback.click(); }
  function addFiles() { fileInput.click(); }

  async function addFilesFromList(fileList, label) {
    if (!fileList || !fileList.length) return;
    const root = await LTDB.addRoot({ name: label || 'Picked videos', kind: 'files' });
    roots.push(root);
    showScanToast('Reading videos\u2026');
    const entries = LTScanner.scanFileList(fileList, root.id);
    if (!entries.length) { hideScanToast(); alert('No videos were found in what you selected.'); roots = roots.filter(r => r.id !== root.id); await LTDB.removeRoot(root.id); return; }
    entries.forEach(e => mergeEntry(e));
    scheduleRender();
    showScanToast(`Analyzing 0/${entries.length} videos\u2026`);
    await LTScanner.probeEntries(entries, (entry) => { mergeEntry(entry); scheduleRender(); },
      (done, total) => { scanToastText.textContent = `Analyzing ${done}/${total} videos\u2026`; });
    hideScanToast();
  }

  fileInput.addEventListener('change', () => { addFilesFromList(fileInput.files, 'Picked videos'); fileInput.value = ''; });
  folderInputFallback.addEventListener('change', () => {
    const first = folderInputFallback.files[0];
    const label = first && first.webkitRelativePath ? first.webkitRelativePath.split('/')[0] : 'Picked folder';
    addFilesFromList(folderInputFallback.files, label);
    folderInputFallback.value = '';
  });

  function pickFolderHandler() { return LTScanner.supportsDirectoryPicker() ? addFolderDesktop() : addFolderFallback(); }
  openFolderBtn.addEventListener('click', pickFolderHandler);
  emptyStateBtn.addEventListener('click', pickFolderHandler);
  emptyStateFilesBtn.addEventListener('click', addFiles);
  mnavAdd.addEventListener('click', pickFolderHandler);
  $('foldersAddBtn').addEventListener('click', pickFolderHandler);
  $('foldersAddFilesBtn').addEventListener('click', addFiles);

  if (!LTScanner.supportsDirectoryPicker()) {
    openFolderLabel.textContent = 'Add videos';
    emptyStateText.textContent = "Grab some videos from your photo library or files and LocalTube will turn them into a YouTube-style feed \u2014 nothing ever leaves your device. Your browser doesn't support folder access, so we'll use the file/photo picker instead.";
    $('emptyStateBtn').textContent = 'Choose videos';
    $('emptyStateFilesBtn').classList.add('hidden');
  }

  /* ================= Folders page ================= */
  function renderFolders() {
    const list = $('foldersList');
    list.innerHTML = '';
    if (!roots.length) { list.innerHTML = '<p class="empty-hint">No folders added yet.</p>'; return; }
    roots.forEach(root => {
      const count = library.filter(e => e.rootId === root.id).length;
      const row = document.createElement('div');
      row.className = 'folder-row';
      row.innerHTML = `
        <div class="folder-row-icon"><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/></svg></div>
        <div>
          <div class="folder-row-name">${escapeHtml(root.name)}</div>
          <div class="folder-row-sub">${root.kind === 'files' ? 'Picked videos (not re-scannable)' : (root.needsReconnect ? 'Needs reconnecting' : `${count} video${count === 1 ? '' : 's'}`)}</div>
        </div>
        ${root.needsReconnect ? '<button class="folder-row-remove reconnect">Reconnect</button>' : ''}
        <button class="folder-row-remove">Remove</button>`;
      if (root.needsReconnect) {
        row.querySelector('.reconnect').addEventListener('click', async () => {
          try {
            const p = await root.handle.requestPermission({ mode: 'read' });
            if (p === 'granted') { root.needsReconnect = false; await loadRoot(root); renderFolders(); }
          } catch (e) {}
        });
      }
      row.querySelector('.folder-row-remove:last-child').addEventListener('click', async () => {
        if (!confirm(`Remove "${root.name}" from your library?`)) return;
        await LTDB.removeRoot(root.id);
        roots = roots.filter(r => r.id !== root.id);
        library.filter(e => e.rootId === root.id).forEach(e => libraryById.delete(e.id));
        library = library.filter(e => e.rootId !== root.id);
        scheduleRender();
        renderFolders();
      });
      list.appendChild(row);
    });
  }

  /* ================= Settings page ================= */
  function saveGestureSettings() { localStorage.setItem(GESTURE_KEY, JSON.stringify(gestureSettings)); }
  function wireToggle(btn, get, set) {
    btn.classList.toggle('on', get());
    btn.addEventListener('click', () => { set(!get()); btn.classList.toggle('on', get()); });
  }
  wireToggle($('settingVolumeGesture'), () => gestureSettings.volume, (v) => { gestureSettings.volume = v; saveGestureSettings(); });
  wireToggle($('settingBrightnessGesture'), () => gestureSettings.brightness, (v) => { gestureSettings.brightness = v; saveGestureSettings(); });
  wireToggle($('settingDoubleTap'), () => gestureSettings.doubleTap, (v) => { gestureSettings.doubleTap = v; saveGestureSettings(); });
  $('settingClearHistory').addEventListener('click', async () => {
    if (!confirm('Clear your watch history?')) return;
    historyList = []; await LTDB.setKV('history', []);
    if (location.hash.startsWith('#/history')) renderHistory();
  });

  /* ================= Init ================= */
  async function init() {
    await loadHistory();
    await loadPlaylists();
    roots = await LTDB.listRoots();
    if (!roots.length) { emptyState.classList.remove('hidden'); return; }

    for (const root of roots) {
      if (root.kind === 'directory' && root.handle) {
        try {
          const perm = await root.handle.queryPermission({ mode: 'read' });
          if (perm === 'granted') { loadRoot(root); continue; }
        } catch (e) {}
        root.needsReconnect = true;
      }
    }
    router();
  }

  router();
  init();

  window.matchMedia('(max-width: 900px)').addEventListener('change', (e) => { isMobile = e.matches; });

  /* rotate-to-fullscreen on mobile watch page */
  const playerWrapEl = $('playerWrap');
  window.matchMedia('(orientation: landscape)').addEventListener('change', (e) => {
    if (!isMobile) return;
    const onWatch = !watchView.classList.contains('hidden');
    if (e.matches && onWatch && !document.fullscreenElement && playerWrapEl.requestFullscreen) playerWrapEl.requestFullscreen().catch(() => {});
    else if (!e.matches && document.fullscreenElement === playerWrapEl) document.exitFullscreen().catch(() => {});
  });

  /* ================= PWA ================= */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('service-worker.js').catch(() => {}); });
  }
})();
