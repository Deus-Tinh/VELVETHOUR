import { apiClient } from '../services/apiClient.js';
import { authService } from '../services/authService.js';
import { esc } from '../core/utils.js';

let libraryTracks = [];
let playlistIds = [];
let revision = 0;
let root;

function formatSize(bytes) {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) return '';
  return `${(Number(bytes) / (1024 * 1024)).toFixed(1)} MB`;
}

function setStatus(message, isError = false) {
  const status = root?.querySelector('#musicManagerStatus');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

function renderLists() {
  if (!root) return;
  const tracksById = new Map(libraryTracks.map((track) => [track.id, track]));
  const activeIds = new Set(playlistIds);
  const playlist = root.querySelector('#musicPlaylist');
  const available = root.querySelector('#musicLibrary');

  playlist.innerHTML = playlistIds.length ? playlistIds.map((id, index) => {
    const track = tracksById.get(id);
    if (!track) return '';
    return `<li class="music-playlist-item" data-track-id="${esc(track.id)}">
      <span class="music-track-index">${String(index + 1).padStart(2, '0')}</span>
      <span class="music-track-copy"><strong>${esc(track.title)}</strong><small>${track.source === 'uploaded' ? 'Tệp đã nhập' : 'Có sẵn trong thư mục mp3'}${track.sizeBytes ? ` · ${formatSize(track.sizeBytes)}` : ''}</small></span>
      <span class="music-track-actions">
        <button type="button" class="btn-outline btn-sm" data-music-action="up" aria-label="Đưa ${esc(track.title)} lên trước" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="btn-outline btn-sm" data-music-action="down" aria-label="Đưa ${esc(track.title)} xuống sau" ${index === playlistIds.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="btn-outline btn-sm" data-music-action="remove">Bỏ khỏi danh sách</button>
      </span>
    </li>`;
  }).join('') : '<li class="music-empty">Danh sách đang trống. Thêm bài từ thư viện bên dưới.</li>';

  const unused = libraryTracks.filter((track) => !activeIds.has(track.id));
  available.innerHTML = unused.length ? unused.map((track) => `<li class="music-library-item">
    <span class="music-track-copy"><strong>${esc(track.title)}</strong><small>${track.source === 'uploaded' ? 'Tệp đã nhập' : 'Có sẵn trong thư mục mp3'}${track.sizeBytes ? ` · ${formatSize(track.sizeBytes)}` : ''}</small></span>
    <button type="button" class="btn-outline btn-sm" data-music-action="add" data-track-id="${esc(track.id)}">Thêm vào danh sách</button>
  </li>`).join('') : '<li class="music-empty">Tất cả bài trong thư viện đã nằm trong danh sách phát.</li>';

  root.querySelector('#musicPlaylistCount').textContent = `${playlistIds.length} bài trong danh sách phát`;
  root.querySelector('#musicLibraryCount').textContent = `${libraryTracks.length} bài trong thư viện`;
  root.querySelector('#saveMusicPlaylist').disabled = false;
}

async function loadLibrary() {
  setStatus('Đang tải thư viện nhạc…');
  const importButton = root?.querySelector('#importMusicButton');
  const fileInput = root?.querySelector('#musicFileInput');
  const saveButton = root?.querySelector('#saveMusicPlaylist');
  if (importButton) importButton.disabled = true;
  if (fileInput) fileInput.disabled = true;
  if (saveButton) saveButton.disabled = true;
  try {
    const result = await apiClient.getMusicLibrary();
    libraryTracks = Array.isArray(result.tracks) ? result.tracks : [];
    playlistIds = Array.isArray(result.playlistIds) ? result.playlistIds.slice() : [];
    revision = Number(result.revision) || 0;
    renderLists();
    if (importButton) importButton.disabled = false;
    if (fileInput) fileInput.disabled = false;
    setStatus('Danh sách đã đồng bộ với máy chủ.');
  } catch (error) {
    setStatus(error.message || 'Không tải được thư viện nhạc.', true);
  }
}

async function importFiles(files) {
  const selected = [...files];
  if (!selected.length) return;
  const invalid = selected.find((file) => !/\.mp3$/i.test(file.name));
  if (invalid) {
    setStatus(`“${invalid.name}” không phải tệp .mp3.`, true);
    return;
  }
  const input = root.querySelector('#musicFileInput');
  const importButton = root.querySelector('#importMusicButton');
  importButton.disabled = true;
  input.disabled = true;
  const added = [];
  try {
    for (let index = 0; index < selected.length; index += 1) {
      const file = selected[index];
      if (file.size > 25 * 1024 * 1024) throw new Error(`“${file.name}” vượt giới hạn 25 MB.`);
      setStatus(`Đang nhập ${index + 1}/${selected.length}: ${file.name}`);
      const result = await apiClient.uploadMusicFile(file);
      if (result.track) added.push(result.track);
    }
    libraryTracks = [...libraryTracks, ...added];
    const active = new Set(playlistIds);
    playlistIds = [...playlistIds, ...added.map((track) => track.id).filter((id) => !active.has(id))];
    renderLists();
    setStatus(`Đã nhập ${added.length} bài và thêm vào danh sách nháp. Nhấn “Lưu danh sách” để áp dụng cho khách.`);
  } catch (error) {
    if (added.length) {
      libraryTracks = [...libraryTracks, ...added];
      const active = new Set(playlistIds);
      playlistIds = [...playlistIds, ...added.map((track) => track.id).filter((id) => !active.has(id))];
      renderLists();
    }
    setStatus(`${error.message || 'Không nhập được tệp nhạc.'}${added.length ? ` Đã nhập xong ${added.length} bài trước đó; nhấn Lưu danh sách để áp dụng.` : ''}`, true);
  } finally {
    input.value = '';
    input.disabled = false;
    importButton.disabled = false;
  }
}

export function renderMusicManagerPage() {
  root = document.getElementById('appRoot');
  const user = authService.getCurrentUser();
  if (!user || !['staff', 'admin'].includes(user.role)) {
    root.innerHTML = `<section class="section-container music-manager-denied"><h1>Quản lý nhạc nền</h1><p>Chỉ tài khoản nhân viên và quản lí mới có thể chỉnh sửa danh sách phát.</p><a class="btn-primary" href="#/login">Đăng nhập tài khoản nhân viên</a></section>`;
    return;
  }

  root.innerHTML = `
    <section class="section-container music-manager-page">
      <a class="music-manager-back" href="${user.role === 'admin' ? '#/admin' : '#/staff'}">← Quay lại trang ${user.role === 'admin' ? 'quản trị' : 'nhân viên'}</a>
      <header class="music-manager-heading"><span>ÂM THANH KHÔNG GIAN</span><h1>Quản lý nhạc nền</h1><p>Danh sách phát được chia sẻ cho khách truy cập. Khi hết một bài, web tự chuyển sang bài kế tiếp.</p></header>
      <section class="music-import-card" aria-labelledby="musicImportTitle">
        <div><h2 id="musicImportTitle">Nhập thêm nhạc</h2><p>Chọn một hoặc nhiều tệp MP3, tối đa 25 MB mỗi tệp.</p></div>
        <div class="music-import-actions"><label class="music-file-picker" for="musicFileInput">Chọn tệp MP3</label><input id="musicFileInput" type="file" accept="audio/mpeg,.mp3" multiple disabled /><button type="button" class="btn-primary" id="importMusicButton" disabled>Nhập vào thư viện</button></div>
      </section>
      <p id="musicManagerStatus" class="music-manager-status" role="status" aria-live="polite">Đang tải thư viện nhạc…</p>
      <section class="music-list-card" aria-labelledby="musicPlaylistTitle">
        <div class="music-list-heading"><div><span class="music-section-kicker">ĐANG PHÁT CHO KHÁCH</span><h2 id="musicPlaylistTitle">Danh sách phát</h2></div><span class="music-count" id="musicPlaylistCount">0 bài</span></div>
        <ol id="musicPlaylist" class="music-playlist"></ol>
        <div class="music-save-row"><small>Thứ tự mới chỉ áp dụng sau khi lưu.</small><button type="button" class="btn-primary" id="saveMusicPlaylist" disabled>Lưu danh sách</button></div>
      </section>
      <section class="music-list-card music-library-card" aria-labelledby="musicLibraryTitle">
        <div class="music-list-heading"><div><span class="music-section-kicker">TẤT CẢ TỆP</span><h2 id="musicLibraryTitle">Thư viện nhạc</h2></div><span class="music-count" id="musicLibraryCount">0 bài</span></div>
        <ul id="musicLibrary" class="music-library"></ul>
      </section>
    </section>`;

  root.querySelector('#musicFileInput').addEventListener('change', (event) => importFiles(event.target.files));
  root.querySelector('#importMusicButton').addEventListener('click', () => root.querySelector('#musicFileInput').click());
  root.querySelector('#saveMusicPlaylist').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    setStatus('Đang lưu danh sách phát…');
    try {
      const result = await apiClient.saveMusicPlaylist(playlistIds, revision);
      playlistIds = result.playlistIds;
      revision = Number(result.revision) || revision + 1;
      renderLists();
      setStatus('Đã lưu. Danh sách mới sẽ được dùng khi khách tải trang và đồng bộ trong vòng 30 giây với trang đang mở.');
    } catch (error) {
      if (error.code === 'MUSIC_PLAYLIST_CONFLICT') {
        await loadLibrary();
        setStatus('Một nhân viên khác vừa cập nhật danh sách. Mình đã tải bản mới nhất; hãy chỉnh lại rồi lưu.', true);
      } else {
        setStatus(error.message || 'Không lưu được danh sách phát.', true);
      }
    } finally {
      button.disabled = false;
    }
  });
  root.onclick = (event) => {
    const button = event.target.closest('[data-music-action]');
    if (!button || !root.contains(button)) return;
    const action = button.dataset.musicAction;
    const item = button.closest('[data-track-id]');
    const id = button.dataset.trackId || item?.dataset.trackId;
    if (action === 'add' && id && !playlistIds.includes(id)) playlistIds.push(id);
    if (action === 'remove' && id) playlistIds = playlistIds.filter((trackId) => trackId !== id);
    if ((action === 'up' || action === 'down') && id) {
      const index = playlistIds.indexOf(id);
      const next = action === 'up' ? index - 1 : index + 1;
      if (index >= 0 && next >= 0 && next < playlistIds.length) {
        [playlistIds[index], playlistIds[next]] = [playlistIds[next], playlistIds[index]];
      }
    }
    renderLists();
  };
  loadLibrary();
}
