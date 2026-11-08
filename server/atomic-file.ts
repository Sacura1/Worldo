import {randomUUID} from 'node:crypto';
import {open, rename, unlink} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

const RETRY_DELAYS_MS = [25, 50, 100, 200, 350, 500, 750] as const;
const TRANSIENT_RENAME_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY']);
interface AtomicWriteOptions {
  mode?: number;
  /** Injection points keep failure/recovery tests independent of OS timing. */
  renameFile?: (source: string, destination: string) => Promise<void>;
  pause?: (milliseconds: number) => Promise<void>;
}

/** Replace one file atomically. Windows scanners can briefly hold the existing
 * destination open, so retry that same rename for at most 1,975ms of backoff.
 * Never unlink the destination: readers must see either the old or new file.
 * A failed write cleans up only the unique temporary file created here. */
export async function writeAtomicFile(
  destination: string,
  contents: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const temporary = `${destination}.${randomUUID()}.tmp`;
  const move = options.renameFile ?? rename,
    pause = options.pause ?? ((milliseconds: number) => delay(milliseconds));
  let ownsTemporary = false;
  try {
    const handle = await open(temporary, 'wx', options.mode ?? 0o600);
    ownsTemporary = true;
    try {
      await handle.writeFile(contents, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await move(temporary, destination);
        ownsTemporary = false;
        return;
      } catch (error) {
        if (
          !TRANSIENT_RENAME_ERRORS.has((error as NodeJS.ErrnoException).code ?? '') ||
          attempt >= RETRY_DELAYS_MS.length
        )
          throw error;
        await pause(RETRY_DELAYS_MS[attempt]);
      }
    }
  } finally {
    if (ownsTemporary)
      await unlink(temporary).catch(() => {
        /* Preserve the original error if Windows still holds the temporary file. */
      });
  }
}
