/**
 * Plan persistence. Plans embed uploaded images as data URLs, which quickly
 * outgrow localStorage's ~5 MB, so documents live in IndexedDB; localStorage
 * only remembers which plan was open last per event.
 */
import type { PlanDoc, PlanMeta } from './types';

const DB_NAME = 'gpx-action-plans';
const STORE = 'plans';
type Row = PlanDoc & { thumb?: string };

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('slug', 'slug');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function listPlans(slug: string): Promise<PlanMeta[]> {
  const rows = await run<Row[]>('readonly', (s) => s.index('slug').getAll(slug));
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      width: r.width,
      height: r.height,
      pageCount: r.pages.length,
      updatedAt: r.updatedAt,
      thumb: r.thumb,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadPlan(id: string): Promise<PlanDoc | null> {
  const row = await run<Row | undefined>('readonly', (s) => s.get(id));
  if (!row) return null;
  const { thumb: _thumb, ...doc } = row;
  void _thumb;
  return doc;
}

export async function savePlan(doc: PlanDoc, thumb?: string): Promise<void> {
  let keepThumb = thumb;
  if (!keepThumb) {
    const prev = await run<Row | undefined>('readonly', (s) => s.get(doc.id));
    keepThumb = prev?.thumb;
  }
  await run('readwrite', (s) => s.put({ ...doc, thumb: keepThumb }));
}

export async function deletePlan(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
}

const lastKey = (slug: string) => `plan:last:${slug}`;

export function getLastPlanId(slug: string): string | null {
  try {
    return localStorage.getItem(lastKey(slug));
  } catch {
    return null;
  }
}

export function setLastPlanId(slug: string, id: string | null) {
  try {
    if (id) localStorage.setItem(lastKey(slug), id);
    else localStorage.removeItem(lastKey(slug));
  } catch {
    /* storage blocked */
  }
}

export function getStoredTheme(): 'light' | 'dark' | null {
  try {
    const t = localStorage.getItem('plan:theme');
    return t === 'light' || t === 'dark' ? t : null;
  } catch {
    return null;
  }
}

export function storeTheme(t: 'light' | 'dark') {
  try {
    localStorage.setItem('plan:theme', t);
  } catch {
    /* storage blocked */
  }
}
