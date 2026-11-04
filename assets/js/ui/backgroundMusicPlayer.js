import { apiClient } from '../services/apiClient.js';

const PREFERENCES_KEY = 'serenity:background-music:v1';
const DEFAULT_VOLUME = 0.2;
const PLAYLIST_REFRESH_MS = 30000;

let initialized = false;
let audio;
let tracks = [];
let playlistIds = [];
let currentIndex = 0;
let selectedTrackId = null;
let playbackEnabled = true;
let shuffleEnabled = false;
let shuffleBag = [];
let repeatMode = 'all';
let status = 'loading';
let preferences = {};
let pendingSeekRestore = null;
let refreshInFlight = null;
let playAttemptId = 0;
let playInFlight = null;
let activationListeners = [];
let history = [];
let historyPosition = -1;
let lastPositionSaveAt = 0;

function currentTrack() {
  return tracks[currentIndex] || null;
}

function readPreferences() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) || '{}');
    const volume = Number(stored.volume);
    return {
      enabled: typeof stored.enabled === 'boolean' ? stored.enabled : true,
      trackId: typeof stored.trackId === 'string' ? stored.trackId : null,
      volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : DEFAULT_VOLUME,
      currentTime: Number.isFinite(stored.currentTime) && stored.currentTime >= 0 ? stored.currentTime : null,
      shuffle: stored.shuffle === true,
      repeat: ['all', 'one', 'off'].includes(stored.repeat) ? stored.repeat : 'all',
    };
  } catch {
    return { enabled: true, trackId: null, volume: DEFAULT_VOLUME, currentTime: null, shuffle: false, repeat: 'all' };
  }
}

function canSeek() {
  try {
    return Boolean(audio?.seekable?.length && Number.isFinite(audio.currentTime));
  } catch {
    return false;
  }
}

function persistPreferences({ savePosition = false } = {}) {
  preferences = {
    ...preferences,
    enabled: playbackEnabled,
    trackId: selectedTrackId || preferences.trackId || null,
    volume: audio?.volume ?? preferences.volume ?? DEFAULT_VOLUME,
    shuffle: shuffleEnabled,
    repeat: repeatMode,
  };
  if (savePosition) {
    if (canSeek()) preferences.currentTime = audio.currentTime;
    else delete preferences.currentTime;
  }
  if (!Number.isFinite(preferences.currentTime)) delete preferences.currentTime;
  try {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Keep audio usable when browser storage is unavailable or full.
  }
}

function isPlaying() {
  return Boolean(audio && !audio.paused && status === 'playing');
}

function renderPlayer() {
  const playing = isPlaying();
  const headerToggle = document.getElementById('headerMusicToggle');
  if (!headerToggle) return;

  headerToggle.disabled = !currentTrack();
  headerToggle.setAttribute('aria-pressed', String(playing));
  headerToggle.setAttribute('aria-label', playing ? 'Tắt nhạc nền' : 'Bật nhạc nền');
  headerToggle.title = status === 'blocked' && playbackEnabled
    ? 'Chạm hoặc nhấp bất kỳ đâu để bắt đầu nhạc.'
    : status === 'error' ? 'Không tải được nhạc nền.'
      : playing ? 'Tắt nhạc nền' : 'Bật nhạc nền';
  const label = headerToggle.querySelector('.header-music-toggle-label');
  if (label) label.textContent = playing ? 'Tắt nhạc' : 'Bật nhạc';
}

function clearActivationListeners() {
  for (const { type, handler } of activationListeners) document.removeEventListener(type, handler, true);
  activationListeners = [];
}

function intentionalKey(event) {
  return !['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)
    && !(event.ctrlKey || event.altKey || event.metaKey);
}

function waitForActivation() {
  clearActivationListeners();
  if (!playbackEnabled || !currentTrack()) return;
  for (const type of ['pointerdown', 'touchend', 'keydown']) {
    const handler = (event) => {
      if (!event.isTrusted || (type === 'keydown' && !intentionalKey(event))) {
        document.addEventListener(type, handler, { once: true, capture: true });
        return;
      }
      if (event.target?.closest?.('#headerMusicToggle')) return;
      clearActivationListeners();
      attemptPlayback();
    };
    activationListeners.push({ type, handler });
    document.addEventListener(type, handler, { once: true, capture: true });
  }
}

function playFailed(error, attemptId) {
  if (attemptId !== playAttemptId) return false;
  if (error?.name === 'NotAllowedError') {
    status = 'blocked';
    waitForActivation();
  } else if (error?.name === 'AbortError') {
    status = audio?.paused ? 'paused' : 'loading';
  } else {
    status = 'error';
    clearActivationListeners();
  }
  renderPlayer();
  return false;
}

function attemptPlayback() {
  if (!audio || !currentTrack() || !playbackEnabled) return Promise.resolve(false);
  if (isPlaying()) return Promise.resolve(true);
  if (playInFlight) return playInFlight;
  const attemptId = ++playAttemptId;
  status = 'loading';
  renderPlayer();
  let result;
  try {
    // Invoke play synchronously so a real input event can grant user activation.
    result = audio.play();
  } catch (error) {
    return Promise.resolve(playFailed(error, attemptId));
  }
  playInFlight = Promise.resolve(result).then(() => {
    if (attemptId !== playAttemptId) return false;
    status = audio.paused ? 'paused' : 'playing';
    clearActivationListeners();
    persistPreferences();
    renderPlayer();
    return status === 'playing';
  }).catch((error) => playFailed(error, attemptId)).finally(() => {
    if (attemptId === playAttemptId) playInFlight = null;
  });
  return playInFlight;
}

function restorePosition() {
  if (pendingSeekRestore == null || selectedTrackId !== preferences.trackId || !canSeek()) return;
  const maximum = Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 1) : pendingSeekRestore;
  try {
    audio.currentTime = Math.min(pendingSeekRestore, maximum);
    pendingSeekRestore = null;
  } catch {
    // Keep the saved position until the media exposes a seekable range.
  }
}

function rememberTrack(id) {
  if (!id || history[historyPosition] === id) return;
  history = history.slice(0, historyPosition + 1);
  history.push(id);
  historyPosition = history.length - 1;
}

function refillShuffleBag() {
  shuffleBag = tracks.map((_, index) => index).filter((index) => index !== currentIndex);
  for (let index = shuffleBag.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffleBag[index], shuffleBag[swapIndex]] = [shuffleBag[swapIndex], shuffleBag[index]];
  }
}

function setCurrentTrack(index, shouldPlay = false, { remember = true } = {}) {
  if (!tracks.length) {
    currentIndex = 0;
    selectedTrackId = null;
    pendingSeekRestore = null;
    playAttemptId += 1;
    playInFlight = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    status = 'empty';
    clearActivationListeners();
    persistPreferences();
    renderPlayer();
    return;
  }

  currentIndex = (index + tracks.length) % tracks.length;
  const track = currentTrack();
  const changedTrack = selectedTrackId !== track.id;
  const nextUrl = new URL(track.url, window.location.origin).href;
  if (audio.src !== nextUrl) {
    playAttemptId += 1;
    playInFlight = null;
    pendingSeekRestore = changedTrack && preferences.trackId === track.id ? preferences.currentTime : null;
    audio.pause();
    audio.src = nextUrl;
    audio.load();
  }
  selectedTrackId = track.id;
  if (changedTrack && remember) rememberTrack(track.id);
  if (changedTrack && preferences.trackId !== track.id) preferences.currentTime = null;
  persistPreferences();
  if (shuffleEnabled && changedTrack) refillShuffleBag();
  if (shouldPlay && playbackEnabled) attemptPlayback();
  else if (!isPlaying() && status !== 'blocked') status = 'paused';
  renderPlayer();
}

function nextIndex({ ended = false } = {}) {
  if (!tracks.length) return null;
  if (!shuffleEnabled) {
    if (ended && repeatMode === 'off' && currentIndex === tracks.length - 1) return null;
    return (currentIndex + 1) % tracks.length;
  }
  if (!shuffleBag.length) {
    if (ended && repeatMode === 'off') return null;
    refillShuffleBag();
  }
  return shuffleBag.length ? shuffleBag.shift() : currentIndex;
}

function nextTrack({ ended = false } = {}) {
  if (ended && (repeatMode === 'one' || (repeatMode === 'all' && tracks.length === 1))) {
    audio.currentTime = 0;
    if (playbackEnabled) attemptPlayback();
    return;
  }
  const index = nextIndex({ ended });
  if (index == null) {
    status = 'paused';
    renderPlayer();
    persistPreferences({ savePosition: true });
    return;
  }
  setCurrentTrack(index, playbackEnabled);
}

function previousTrack() {
  if (tracks.length < 2) return;
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  if (historyPosition > 0) {
    historyPosition -= 1;
    const previousIndex = tracks.findIndex((track) => track.id === history[historyPosition]);
    if (previousIndex >= 0) {
      setCurrentTrack(previousIndex, playbackEnabled, { remember: false });
      return;
    }
  }
  setCurrentTrack((currentIndex - 1 + tracks.length) % tracks.length, playbackEnabled);
}

async function fallbackLibrary() {
  const response = await fetch('/mp3/playlist.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error('Không tải được danh sách MP3.');
  const manifest = await response.json();
  const libraryTracks = (Array.isArray(manifest.tracks) ? manifest.tracks : [])
    .filter((track) => track && typeof track.id === 'string' && typeof track.filename === 'string')
    .map((track) => ({
      id: track.id,
      title: typeof track.title === 'string' ? track.title : track.filename.replace(/\.mp3$/i, ''),
      url: `/mp3/${encodeURIComponent(track.filename)}`,
    }));
  return { tracks: libraryTracks, playlistIds: libraryTracks.map((track) => track.id) };
}

function applyLibrary(library, { initial = false } = {}) {
  const allTracks = Array.isArray(library?.tracks)
    ? library.tracks.filter((track) => track && typeof track.id === 'string' && typeof track.url === 'string')
    : [];
  const byId = new Map(allTracks.map((track) => [track.id, track]));
  const nextTracks = (Array.isArray(library?.playlistIds) ? library.playlistIds : [])
    .map((id) => byId.get(id)).filter(Boolean);
  const previousTrackId = selectedTrackId;
  const previousTrack = currentTrack();
  const wasPlaying = isPlaying();
  const wasEmpty = tracks.length === 0;
  tracks = nextTracks;
  playlistIds = nextTracks.map((track) => track.id);
  if (!tracks.length) {
    setCurrentTrack(0);
    return;
  }
  let index = tracks.findIndex((track) => track.id === previousTrackId);
  if (index < 0) index = tracks.findIndex((track) => track.id === preferences.trackId);
  if (index < 0) index = 0;
  const shouldPlay = playbackEnabled && (initial || wasPlaying || wasEmpty);
  setCurrentTrack(index, shouldPlay);
  if (!playbackEnabled) status = 'paused';
  if (previousTrack && !tracks.some((track) => track.id === previousTrack.id) && playbackEnabled && wasPlaying) {
    attemptPlayback();
  }
  renderPlayer();
}

function refreshPlaylist({ initial = false } = {}) {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const library = await apiClient.getMusicLibrary();
      if (!library || !Array.isArray(library.tracks) || !Array.isArray(library.playlistIds)) {
        throw new Error('Danh sách phát không hợp lệ.');
      }
      applyLibrary(library, { initial });
    } catch {
      if (tracks.length) return;
      try {
        applyLibrary(await fallbackLibrary(), { initial });
      } catch {
        status = 'error';
        renderPlayer();
      }
    }
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

function stopPlaybackByChoice() {
  playbackEnabled = false;
  clearActivationListeners();
  playAttemptId += 1;
  playInFlight = null;
  audio.pause();
  status = 'paused';
  persistPreferences({ savePosition: true });
  renderPlayer();
}

function togglePlayback() {
  if (isPlaying()) {
    stopPlaybackByChoice();
  } else {
    playbackEnabled = true;
    persistPreferences();
    attemptPlayback();
  }
}

export function initBackgroundMusicPlayer() {
  if (initialized || typeof window === 'undefined' || !document.body) return;
  initialized = true;
  preferences = readPreferences();
  playbackEnabled = preferences.enabled;
  shuffleEnabled = preferences.shuffle;
  repeatMode = preferences.repeat;

  audio = new Audio();
  audio.preload = 'auto';
  audio.volume = preferences.volume;
  audio.addEventListener('playing', () => {
    status = 'playing';
    clearActivationListeners();
    persistPreferences();
    renderPlayer();
  });
  audio.addEventListener('pause', () => {
    if (!['blocked', 'error', 'empty'].includes(status) && status !== 'loading') status = 'paused';
    renderPlayer();
  });
  audio.addEventListener('loadedmetadata', restorePosition);
  audio.addEventListener('canplay', restorePosition);
  audio.addEventListener('timeupdate', () => {
    if (Date.now() - lastPositionSaveAt < 5000) return;
    lastPositionSaveAt = Date.now();
    persistPreferences({ savePosition: true });
  });
  audio.addEventListener('volumechange', () => persistPreferences());
  audio.addEventListener('ended', () => nextTrack({ ended: true }));
  audio.addEventListener('error', () => {
    status = 'error';
    clearActivationListeners();
    renderPlayer();
  });

  document.getElementById('headerMusicToggle')?.addEventListener('click', togglePlayback);

  window.addEventListener('pagehide', () => persistPreferences({ savePosition: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistPreferences({ savePosition: true });
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted && playbackEnabled && status === 'paused' && currentTrack()) attemptPlayback();
  });
  renderPlayer();

  // Start with the local MP3 manifest so the first play attempt does not wait for the API.
  fallbackLibrary().then((library) => {
    applyLibrary(library, { initial: true });
    return refreshPlaylist();
  }).catch(() => refreshPlaylist({ initial: true }));
  window.setInterval(() => {
    if (document.visibilityState === 'visible') refreshPlaylist();
  }, PLAYLIST_REFRESH_MS);
}
