export default function readStorageSnapshot(storage: Storage): Record<string, unknown> {
  const snapshot: Record<string, unknown> = Object.create(null);
  const length = storage.length;
  for (let index = 0; index < length; index++) {
    const key = storage.key(index);
    if (key === null) continue;
    const value = storage.getItem(key);
    if (value === null) continue;
    try {
      snapshot[key] = JSON.parse(value);
    } catch {
      snapshot[key] = value;
    }
  }
  return snapshot;
}
