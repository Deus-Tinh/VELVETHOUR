import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

function readPreviousManifest(directory) {
  try {
    const value = JSON.parse(readFileSync(path.join(directory, 'playlist.json'), 'utf8').replace(/^\uFEFF/, ''));
    return Array.isArray(value.tracks) ? value.tracks : [];
  } catch {
    return [];
  }
}

/** Build the bundled catalog from the MP3 files that actually exist. */
export function buildMusicManifest(directory) {
  const files = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.mp3$/i.test(entry.name))
    .map((entry) => entry.name);
  const existing = new Set(files);
  const previous = readPreviousManifest(directory);
  const previousByName = new Map(previous
    .filter((track) => track && typeof track.filename === 'string')
    .map((track) => [track.filename, track]));
  const ordered = [];

  for (const track of previous) {
    if (existing.has(track?.filename) && !ordered.includes(track.filename)) ordered.push(track.filename);
  }
  for (const filename of files.sort((left, right) => left.localeCompare(right, 'vi'))) {
    if (!ordered.includes(filename)) ordered.push(filename);
  }

  const ids = new Set();
  return {
    tracks: ordered.map((filename) => {
      const old = previousByName.get(filename);
      let id = typeof old?.id === 'string' && !ids.has(old.id)
        ? old.id
        : `file-${createHash('sha256').update(filename).digest('hex').slice(0, 16)}`;
      if (ids.has(id)) id = `file-${createHash('sha256').update(filename).digest('hex').slice(0, 24)}`;
      ids.add(id);
      return {
        id,
        title: typeof old?.title === 'string' && old.title.trim()
          ? old.title.trim()
          : path.basename(filename, path.extname(filename)),
        filename,
      };
    }),
  };
}
