// =============================================================================
// assets.mjs — design-time VISUAL ASSET store (Phase B).
//
// The model must stay small and portable, so it never embeds image bytes — an
// option references an asset as "asset:<id>" (or a plain http/https/data URL).
// The bytes live here, in IndexedDB as Blobs (localStorage's ~5MB cap can't hold
// real photos). This mirrors, at design time, what production does with R2:
// reference-by-key, store the object elsewhere. Pattern borrowed from the
// melody-kernel folder-store (Blob-in-IDB, downgrade-safe open, quota guard,
// object-URL export).
//
//   putImage(file)      -> id           store a File/Blob, returns its asset id
//   list()              -> [{id,name,type,size,addedAt}]
//   objectURL(id)       -> url|null      cached object URL for previews
//   resolve(ref)        -> url|null      "asset:<id>" | url | data: -> a usable src
//   remove(id)          -> void
//   downloadURL, quota()             helpers
//
// Everything is async and degrades to an in-memory store in private mode.
// =============================================================================

const DB = 'qc-assets';
const STORE = 'images';
const REF = 'asset:';

let dbp = null;
const urlCache = new Map(); // id -> object URL
const mem = new Map();      // fallback store (private mode): id -> record

function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB, 1); }
    catch (e) { return reject(e); }
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  }).catch((e) => { console.warn('assets: IndexedDB unavailable, using memory store', e); return null; });
  return dbp;
}

async function tx(mode, fn) {
  const db = await openDb();
  if (!db) return fn(null); // memory fallback
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let out;
    Promise.resolve(fn(store)).then((v) => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('tx aborted'));
  });
}

const newId = () => 'img_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);

export function isAssetRef(ref) { return typeof ref === 'string' && ref.startsWith(REF); }
export function refId(ref) { return isAssetRef(ref) ? ref.slice(REF.length) : null; }

// Store a File/Blob; returns the asset id (bare — callers form the ref as needed).
export async function putImage(file, name) {
  const rec = { id: newId(), name: name || file.name || 'image', type: file.type || 'image/*', size: file.size || 0, blob: file, addedAt: Date.now() };
  const db = await openDb();
  if (!db) { mem.set(rec.id, rec); return rec.id; }
  // refuse writes above ~90% quota rather than risk eviction of the whole store
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      if (quota && usage + rec.size > quota * 0.9) throw new Error('Storage is nearly full — free space or use a smaller image.');
    }
  } catch (e) { if (/nearly full/.test(e.message)) throw e; }
  await tx('readwrite', (store) => store.put(rec));
  return rec.id;
}

export async function list() {
  const db = await openDb();
  if (!db) return [...mem.values()].map(meta).sort(byNewest);
  const out = await tx('readonly', (store) => new Promise((res) => {
    const items = []; const c = store.openCursor();
    c.onsuccess = () => { const cur = c.result; if (cur) { items.push(meta(cur.value)); cur.continue(); } else res(items); };
    c.onerror = () => res(items);
  }));
  return (out || []).sort(byNewest);
}
const meta = (r) => ({ id: r.id, name: r.name, type: r.type, size: r.size, addedAt: r.addedAt });
const byNewest = (a, b) => b.addedAt - a.addedAt;

async function getRecord(id) {
  const db = await openDb();
  if (!db) return mem.get(id) || null;
  return tx('readonly', (store) => new Promise((res) => { const g = store.get(id); g.onsuccess = () => res(g.result || null); g.onerror = () => res(null); }));
}

// Cached object URL for an asset id (for <img> previews). null if missing.
export async function objectURL(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const rec = await getRecord(id);
  if (!rec || !rec.blob) return null;
  const url = URL.createObjectURL(rec.blob);
  urlCache.set(id, url);
  return url;
}

// Resolve any option.image reference to a usable <img src>.
export async function resolve(ref) {
  if (!ref || typeof ref !== 'string') return null;
  if (isAssetRef(ref)) return objectURL(refId(ref));
  if (/^(https?:|data:|blob:|\/)/.test(ref)) return ref; // external URL / data URI / absolute path
  return null;
}

export async function remove(id) {
  if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
  const db = await openDb();
  if (!db) { mem.delete(id); return; }
  await tx('readwrite', (store) => store.delete(id));
}

// Object-URL download (melody-kernel export pattern) — for "save this asset".
export async function downloadURL(id) {
  const rec = await getRecord(id);
  if (!rec) return;
  const url = URL.createObjectURL(rec.blob);
  const a = document.createElement('a'); a.href = url; a.download = rec.name || rec.id;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function quota() {
  try { if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate(); } catch { /* ignore */ }
  return { usage: 0, quota: 0 };
}
