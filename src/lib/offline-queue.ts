export type QueuedAttendanceAction = {
  id: string;
  userId: string;
  action: string;
  payload: Record<string, unknown>;
  createdAt: number;
};

const DATABASE_NAME = "av-attendance-offline-v1";
const STORE_NAME = "pending-attendance";

function openDatabase() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Offline storage is not available in this browser."));
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open offline attendance storage."));
  });
}

export async function listQueuedAttendance(userId: string) {
  const database = await openDatabase();
  return new Promise<QueuedAttendanceAction[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as QueuedAttendanceAction[]).filter((item) => item.userId === userId).sort((a, b) => a.createdAt - b.createdAt));
    request.onerror = () => reject(request.error ?? new Error("Could not read pending attendance."));
    transaction.oncomplete = () => database.close();
  });
}

export async function queueAttendanceAction(userId: string, action: string, payload: Record<string, unknown>) {
  const database = await openDatabase();
  const mutation: QueuedAttendanceAction = { id: crypto.randomUUID(), userId, action, payload, createdAt: Date.now() };
  return new Promise<QueuedAttendanceAction>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(mutation);
    transaction.oncomplete = () => { database.close(); resolve(mutation); };
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error("Could not save this entry offline.")); };
  });
}

export async function removeQueuedAttendance(id: string) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error("Could not clear the synced entry.")); };
  });
}

export async function clearQueuedAttendance(userId: string) {
  const database = await openDatabase();
  const items = await new Promise<QueuedAttendanceAction[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as QueuedAttendanceAction[]).filter((item) => item.userId === userId));
    request.onerror = () => reject(request.error ?? new Error("Could not read offline entries for deletion."));
    transaction.oncomplete = () => database.close();
  });
  for (const item of items) await removeQueuedAttendance(item.id);
}
