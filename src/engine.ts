// Côté interface : parle au worker de l'IA et transforme ses scores en verdict.
import { db, getSettings, EMB_VERSION, type Item, type OrbData } from './db';

const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
let seq = 0;
const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
const statusListeners = new Set<(s: EngineStatus) => void>();

export interface EngineStatus { state: 'loading' | 'ready' | 'error' | 'reindex'; msg: string; pct?: number }
export let status: EngineStatus = { state: 'loading', msg: "Préparation de l'IA…" };
function setStatus(s: EngineStatus) { status = s; statusListeners.forEach(f => f(s)); }
export function onStatus(f: (s: EngineStatus) => void) { statusListeners.add(f); f(status); return () => statusListeners.delete(f); }

worker.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'status') { setStatus({ state: 'loading', msg: m.msg, pct: m.pct }); return; }
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  m.ok ? p.res(m.result) : p.rej(new Error(m.error));
};
function call<T>(op: string, args: any = {}): Promise<T> {
  return new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    worker.postMessage({ id, op, args });
  });
}

export const ready: Promise<void> = call<boolean>('init', { base: new URL('./', location.href).href })
  .then(() => { setStatus({ state: 'ready', msg: 'Prête' }); void reindex(); })
  .catch(err => {
    const offline = !navigator.onLine;
    setStatus({
      state: 'error',
      msg: offline
        ? 'Pas de réseau : connecte-toi au Wi-Fi une première fois pour télécharger l’IA.'
        : `L'IA n'a pas pu démarrer (${err.message}). Recharge l'app.`,
    });
    throw err;
  });

export interface Features { emb: Float32Array; orb: OrbData }
export async function features(blob: Blob): Promise<Features> {
  await ready;
  return call('features', { blob });
}
export function invalidate() { return call('invalidate'); }
export function diag() { return call<string[]>('diag'); }

// ───────────── Verdict ─────────────
export interface Candidate { item: Item; cos: number; inliers: number; raw?: number; spread?: number }
export interface Verdict {
  kind: 'same' | 'similar' | 'new';
  /** candidats à montrer, du plus probable au moins probable */
  best: Candidate[];
  /** tous les candidats examinés (pour l'écran des scores) */
  all: Candidate[];
  /** nombre d'objets comparés */
  searched: number;
}

export async function search(f: Features, category: string | null, excludeItem: number | null = null): Promise<Verdict> {
  await ready;
  const S = getSettings();
  const r = await call<{ cands: { itemId: number; cos: number; inliers: number; raw: number; spread: number }[]; searched: number }>(
    'search', { emb: f.emb, orb: f.orb, category, excludeItem });
  const all: Candidate[] = [];
  for (const c of r.cands) {
    const item = await db.items.get(c.itemId);
    if (item) all.push({ item, cos: c.cos, inliers: c.inliers, raw: c.raw, spread: c.spread });
  }
  // D'abord les détails qui se superposent, ensuite la ressemblance globale.
  all.sort((a, b) => b.inliers - a.inliers || b.cos - a.cos);
  const near = (c: Candidate) => c.inliers >= S.tNear || c.cos >= S.tCos;
  if (all[0] && all[0].inliers >= S.tSame) {
    return { kind: 'same', best: all.filter(c => c.inliers >= S.tSame).slice(0, 3), all, searched: r.searched };
  }
  const sim = all.filter(near).slice(0, 4);
  return { kind: sim.length ? 'similar' : 'new', best: sim, all, searched: r.searched };
}

// ───────────── Mise à jour des empreintes ─────────────
/** Recalcule les empreintes faites avec une ancienne version (au démarrage, en tâche de fond). */
async function reindex() {
  const old = await db.embs.filter(e => e.v !== EMB_VERSION).toArray();
  if (!old.length) return;
  let done = 0;
  for (const e of old) {
    setStatus({ state: 'reindex', msg: `Amélioration de la reconnaissance… ${done}/${old.length}`, pct: (100 * done) / old.length });
    const ref = await db.refs.get(e.id);
    const photo = ref?.photo ?? (await db.items.get(e.itemId))?.photo;
    if (photo) {
      const emb = await call<Float32Array>('embed', { blob: photo });
      await db.embs.update(e.id, { emb, v: EMB_VERSION });
    }
    done++;
  }
  await invalidate();
  setStatus({ state: 'ready', msg: 'Prête' });
}
