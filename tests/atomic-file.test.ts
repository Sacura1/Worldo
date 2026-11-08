import {afterEach, describe, expect, it, vi} from 'vitest';
import {mkdtemp, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {writeAtomicFile} from '../server/atomic-file';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, {recursive: true, force: true});
});
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'worldo-atomic-'));
  directories.push(directory);
  const destination = path.join(directory, 'world.json');
  await writeFile(destination, 'old committed world');
  return {directory, destination};
}
const failure = (code: string) => Object.assign(new Error('Injected filesystem failure'), {code});

describe('atomic file replacement on Windows', () => {
  it('retries a transient busy destination without exposing a missing or partial committed file', async () => {
    const {directory, destination} = await fixture(),
      pause = vi.fn(async (_milliseconds: number) => {});
    let attempts = 0;
    const sources: string[] = [];
    await writeAtomicFile(destination, 'new committed world', {
      pause,
      renameFile: async (source, target) => {
        attempts++;
        sources.push(source);
        expect(await readFile(destination, 'utf8')).toBe('old committed world');
        if (attempts < 3) throw failure(attempts === 1 ? 'EPERM' : 'EBUSY');
        await rename(source, target);
      },
    });
    expect(attempts).toBe(3);
    expect(new Set(sources).size).toBe(1);
    expect(pause).toHaveBeenCalledTimes(2);
    expect(await readFile(destination, 'utf8')).toBe('new committed world');
    expect(await readdir(directory)).toEqual(['world.json']);
  });
  it('bounds access-denied retries and preserves the old file when every rename fails', async () => {
    const {directory, destination} = await fixture(),
      pause = vi.fn(async (_milliseconds: number) => {}),
      move = vi.fn(async () => {
        throw failure('EACCES');
      });
    await expect(
      writeAtomicFile(destination, 'uncommitted candidate', {pause, renameFile: move}),
    ).rejects.toMatchObject({code: 'EACCES'});
    expect(move.mock.calls.length).toBeGreaterThan(1);
    expect(move.mock.calls.length).toBeLessThanOrEqual(10);
    expect(pause.mock.calls.reduce((total, [milliseconds]) => total + milliseconds, 0)).toBeLessThanOrEqual(3000);
    expect(await readFile(destination, 'utf8')).toBe('old committed world');
    expect(await readdir(directory)).toEqual(['world.json']);
  });
  it('does not retry non-transient errors or leave an uncommitted temporary file behind', async () => {
    const {directory, destination} = await fixture(),
      pause = vi.fn(async (_milliseconds: number) => {}),
      move = vi.fn(async () => {
        throw failure('EIO');
      });
    await expect(
      writeAtomicFile(destination, 'uncommitted candidate', {pause, renameFile: move}),
    ).rejects.toMatchObject({code: 'EIO'});
    expect(move).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
    expect(await readFile(destination, 'utf8')).toBe('old committed world');
    expect(await readdir(directory)).toEqual(['world.json']);
  });
});
