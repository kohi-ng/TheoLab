/** Firestore rejects `undefined` field values; round-trip through JSON to drop them. */
export function toFirestoreData<T extends object>(data: T): T {
  return JSON.parse(JSON.stringify(data)) as T;
}
