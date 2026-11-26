// WebOS — IndexedDB storage for installed apps and their files.
// NOTE: sw.js opens the same database. If you change the schema, change it there too.
const DB_NAME = 'webos';
const DB_VERSION = 1;
let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('apps')) db.createObjectStore('apps', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    r.onerror = () => {
      dbPromise = null;
      reject(r.error);
    };
  });
  return dbPromise;
}

const req = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
const done = (tx) =>
  new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('Transaction aborted'));
  });
const range = (id) => IDBKeyRange.bound(id + '/', id + '/￿');

export async function listApps() {
  const db = await openDB();
  return req(db.transaction('apps').objectStore('apps').getAll());
}
export async function getApp(id) {
  const db = await openDB();
  return req(db.transaction('apps').objectStore('apps').get(id));
}
export async function putApp(app) {
  const db = await openDB();
  const tx = db.transaction('apps', 'readwrite');
  tx.objectStore('apps').put(app);
  return done(tx);
}
/** Atomically replaces every file of an app and writes its record. */
export async function saveAppWithFiles(app, files) {
  const db = await openDB();
  const tx = db.transaction(['apps', 'files'], 'readwrite');
  const fs = tx.objectStore('files');
  fs.delete(range(app.id));
  for (const f of files) fs.put({ key: app.id + '/' + f.path, appId: app.id, path: f.path, size: f.size, blob: f.blob });
  tx.objectStore('apps').put(app);
  return done(tx);
}
export async function deleteApp(id) {
  const db = await openDB();
  const tx = db.transaction(['apps', 'files'], 'readwrite');
  tx.objectStore('files').delete(range(id));
  tx.objectStore('apps').delete(id);
  return done(tx);
}
export async function getAppFiles(id) {
  const db = await openDB();
  return req(db.transaction('files').objectStore('files').getAll(range(id)));
}
export async function getFile(id, path) {
  const db = await openDB();
  return req(db.transaction('files').objectStore('files').get(id + '/' + path));
}

export async function kvGet(key) {
  const db = await openDB();
  return req(db.transaction('kv').objectStore('kv').get(key));
}
export async function kvSet(key, value) {
  const db = await openDB();
  const tx = db.transaction('kv', 'readwrite');
  tx.objectStore('kv').put(value, key);
  return done(tx);
}
export async function kvDel(key) {
  const db = await openDB();
  const tx = db.transaction('kv', 'readwrite');
  tx.objectStore('kv').delete(key);
  return done(tx);
}

/** Closes the connection and deletes the whole database. */
export async function wipeDatabase() {
  try {
    (await openDB()).close();
  } catch {}
  dbPromise = null;
  await new Promise((res) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = r.onerror = r.onblocked = () => res();
  });
}
