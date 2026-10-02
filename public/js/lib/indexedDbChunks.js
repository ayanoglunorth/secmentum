const DB_NAME = "secmentum-recording-db";
const DB_VERSION = 1;
const STORE_NAME = "videoChunks";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("sessionId", "sessionId", { unique: false });
        store.createIndex("sessionChunk", ["sessionId", "chunkIndex"], {
          unique: true,
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
  });
}

function withStore(mode, callback) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        callback(store, resolve, reject);

        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

export function saveChunk({ sessionId, chunkIndex, blob, createdAt }) {
  return withStore("readwrite", (store, resolve, reject) => {
    const request = store.put({
      sessionId,
      chunkIndex,
      blob,
      createdAt,
    });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export function getSessionChunks(sessionId) {
  return withStore("readonly", (store, resolve, reject) => {
    const index = store.index("sessionId");
    const request = index.getAll(IDBKeyRange.only(sessionId));

    request.onsuccess = () => {
      const sorted = request.result.sort((a, b) => a.chunkIndex - b.chunkIndex);
      resolve(sorted);
    };

    request.onerror = () => reject(request.error);
  });
}

export function clearSessionChunks(sessionId) {
  return withStore("readwrite", (store, resolve, reject) => {
    const index = store.index("sessionId");
    const request = index.openCursor(IDBKeyRange.only(sessionId));

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) {
        resolve();
        return;
      }

      cursor.delete();
      cursor.continue();
    };

    request.onerror = () => reject(request.error);
  });
}
