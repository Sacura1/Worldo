const locks = new Map<string, Promise<unknown>>();
/** Local serialization complements durable compare-and-swap; it is not a distributed lock. */
export async function serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  locks.set(key, current);
  try {
    return await current;
  } finally {
    if (locks.get(key) === current) locks.delete(key);
  }
}
