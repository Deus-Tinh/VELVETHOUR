import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMusicManifest } from '../server/musicLibrary.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('bundled manifest lists the MP3 files actually present in the project', () => {
  const manifest = buildMusicManifest(path.join(ROOT, 'mp3'));
  assert.equal(manifest.tracks.length, 15);
  assert.equal(new Set(manifest.tracks.map((track) => track.id)).size, manifest.tracks.length);
  for (const track of manifest.tracks) {
    assert.ok(track.filename.toLowerCase().endsWith('.mp3'));
    assert.ok(track.title);
  }
});

test('manifest omits missing files and creates stable entries for newly added MP3s', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'serenity-music-'));
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'Old Song.mp3'), 'old');
    await writeFile(path.join(directory, 'playlist.json'), JSON.stringify({ tracks: [
      { id: 'track-old', title: 'Old Song', filename: 'Old Song.mp3' },
      { id: 'track-gone', title: 'Gone', filename: 'Gone.mp3' },
    ] }));
    await writeFile(path.join(directory, 'New Song.mp3'), 'new');
    const first = buildMusicManifest(directory);
    const second = buildMusicManifest(directory);
    assert.deepEqual(first.tracks.map((track) => track.filename), ['Old Song.mp3', 'New Song.mp3']);
    assert.equal(first.tracks[0].id, 'track-old');
    assert.equal(first.tracks[1].title, 'New Song');
    assert.equal(first.tracks[1].id, second.tracks[1].id);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
