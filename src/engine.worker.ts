/// <reference lib="webworker" />
// Toute l'IA tourne ici, hors du fil de l'interface : la caméra et les animations restent fluides.
import { pipeline, RawImage, env } from '@huggingface/transformers';
import { db, type Emb, type OrbData } from './db';

declare const self: DedicatedWorkerGlobalScope;

let base = '';
let extractor: any = null;
let cv: any = null;
let embCache: Emb[] | null = null;

const post = (m: any) => self.postMessage(m);

// ───────────── Chargement ─────────────
async function loadModel() {
  env.allowLocalModels = false;
  // Le moteur ONNX est servi par l'app elle-même (et mis en cache) : indispensable hors ligne.
  (env.backends.onnx as any).wasm.wasmPaths = `${base}ort/`;
  const files: Record<string, { loaded: number; total: number }> = {};
  extractor = await pipeline('image-feature-extraction', 'Xenova/dinov2-small', {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (e: any) => {
      if (e.status !== 'progress' || !e.total) return;
      files[e.file] = { loaded: e.loaded, total: e.total };
      const all = Object.values(files);
      const pct = (100 * all.reduce((s, f) => s + f.loaded, 0)) / all.reduce((s, f) => s + f.total, 0);
      post({ type: 'status', msg: `Téléchargement de l'IA… ${Math.round(pct)} %`, pct });
    },
  });
}

async function loadCV() {
  const res = await fetch(`${base}opencv.js`);
  if (!res.ok) throw new Error('opencv.js introuvable');
  // opencv.js est un script « classique » : on l'évalue dans la portée globale du worker.
  (0, eval)(await res.text());
  const g = self as any;
  cv = await new Promise<any>(resolve => {
    const c = g.cv;
    if (c?.Mat) return resolve(c);
    // Le module est « thenable » : on l'emballe pour éviter que la promesse le déroule à l'infini.
    if (typeof c?.then === 'function') return c.then((m: any) => resolve(m.Mat ? m : g.cv));
    c.onRuntimeInitialized = () => resolve(g.cv);
  });
}

// ───────────── Images ─────────────
async function bitmapToImageData(bmp: ImageBitmap, max: number, square: boolean): Promise<ImageData> {
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  // En mode carré, l'objet entier est posé au centre (avec une marge) au lieu d'être rogné :
  // sinon les bords d'une pochette ou d'une carte postale sont coupés par le modèle.
  const side = Math.round(Math.max(w, h) * 1.15);
  const W = square ? side : w, H = square ? side : h;
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  if (square) { ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H); }
  ctx.drawImage(bmp, (W - w) / 2, (H - h) / 2, w, h);
  return ctx.getImageData(0, 0, W, H);
}

function normalize(v: Float32Array) {
  let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  s = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= s;
  return v;
}

async function embed(blob: Blob): Promise<Float32Array> {
  const bmp = await createImageBitmap(blob);
  const id = await bitmapToImageData(bmp, 448, true);
  bmp.close();
  const img = new RawImage(id.data, id.width, id.height, 4).rgb();
  const out = await extractor(img);
  const dims: number[] = out.dims;
  const data = out.data as Float32Array;
  const d = dims[dims.length - 1];
  const tokens = dims.length === 3 ? dims[1] : 1;
  // Empreinte = jeton global (CLS) + moyenne des morceaux d'image, chacun normalisé.
  const cls = normalize(Float32Array.from(data.subarray(0, d)));
  const mean = new Float32Array(d);
  if (tokens > 1) {
    for (let t = 1; t < tokens; t++) for (let i = 0; i < d; i++) mean[i] += data[t * d + i];
    normalize(mean);
  }
  const v = new Float32Array(2 * d);
  v.set(cls, 0); v.set(mean, d);
  return normalize(v);
}

async function orbFeatures(blob: Blob): Promise<OrbData> {
  const bmp = await createImageBitmap(blob);
  const id = await bitmapToImageData(bmp, 640, false);
  bmp.close();
  const rgba = cv.matFromImageData(id);
  const gray = new cv.Mat();
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
  const orb = new cv.ORB(900);
  const kps = new cv.KeyPointVector();
  const desc = new cv.Mat();
  const noMask = new cv.Mat();
  orb.detectAndCompute(gray, noMask, kps, desc);
  const n = kps.size();
  const kp = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { const p = kps.get(i).pt; kp[2 * i] = p.x; kp[2 * i + 1] = p.y; }
  const out = { n, kp, desc: new Uint8Array(desc.data.slice(0, n * 32)) };
  rgba.delete(); gray.delete(); orb.delete(); kps.delete(); desc.delete(); noMask.delete();
  return out;
}

/** Nombre de détails qui se superposent de façon cohérente (0 = rien en commun). */
function orbInliers(a: OrbData, b: OrbData): { score: number; raw: number; spread: number } {
  if (a.n < 12 || b.n < 12) return { score: 0, raw: 0, spread: 0 };
  const dA = new cv.Mat(a.n, 32, cv.CV_8U); dA.data.set(a.desc);
  const dB = new cv.Mat(b.n, 32, cv.CV_8U); dB.data.set(b.desc);
  const bf = new cv.BFMatcher(cv.NORM_HAMMING, false);
  const matches = new cv.DMatchVectorVector();
  bf.knnMatch(dA, dB, matches, 2);
  const src: number[] = [], dst: number[] = [];
  for (let i = 0; i < matches.size(); i++) {
    const m = matches.get(i);
    if (m.size() >= 2) {
      const m0 = m.get(0), m1 = m.get(1);
      if (m0.distance < 0.75 * m1.distance) {
        src.push(a.kp[2 * m0.queryIdx], a.kp[2 * m0.queryIdx + 1]);
        dst.push(b.kp[2 * m0.trainIdx], b.kp[2 * m0.trainIdx + 1]);
      }
    }
    m.delete();
  }
  let inliers = 0;
  const pts: number[] = [];
  const good = src.length / 2;
  if (good >= 8) {
    const S = cv.matFromArray(good, 1, cv.CV_32FC2, src);
    const D = cv.matFromArray(good, 1, cv.CV_32FC2, dst);
    const mask = new cv.Mat();
    const H = cv.findHomography(S, D, cv.RANSAC, 4.0, mask);
    if (H && !H.empty()) {
      for (let i = 0; i < mask.rows; i++) if (mask.data[i]) { inliers++; pts.push(src[2 * i], src[2 * i + 1]); }
    }
    H?.delete(); S.delete(); D.delete(); mask.delete();
  }
  dA.delete(); dB.delete(); bf.delete(); matches.delete();
  if (!inliers) return { score: 0, raw: 0, spread: 0 };
  // Les points communs doivent être répartis sur l'objet : un même logo
  // (« 鬼滅の刃 » sur toutes les pochettes) ne doit pas suffire à dire « identique ».
  // On découpe l'objet en 4×4 cases et on compte les cases qui ont au moins 2 points communs.
  const bx = kpBox(a);
  const cw = Math.max(1, (bx.x1 - bx.x0) / 4), ch = Math.max(1, (bx.y1 - bx.y0) / 4);
  const cells = new Uint8Array(16);
  for (let i = 0; i < pts.length; i += 2) {
    const cx = Math.min(3, Math.max(0, Math.floor((pts[i] - bx.x0) / cw)));
    const cy = Math.min(3, Math.max(0, Math.floor((pts[i + 1] - bx.y0) / ch)));
    cells[cy * 4 + cx]++;
  }
  const spread = cells.reduce((s, c) => s + (c >= 2 ? 1 : 0), 0);
  // 6 zones ou plus : score plein ; en dessous, il chute très vite (2 zones ≈ 4 %).
  const k = Math.min(1, spread / 6) ** 3;
  return { score: Math.round(inliers * k), raw: inliers, spread };
}

/** Rectangle occupé par les points détectés (≈ l'objet sur la photo). */
function kpBox(o: OrbData) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < o.n; i++) {
    const x = o.kp[2 * i], y = o.kp[2 * i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

// ───────────── Recherche ─────────────
function dot(a: Float32Array, b: Float32Array) {
  let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

async function search(emb: Float32Array, orb: OrbData, category: string | null, excludeItem: number | null) {
  embCache ??= await db.embs.toArray();
  // Meilleure ressemblance globale par objet (un objet peut avoir plusieurs photos).
  const bestCos = new Map<number, number>();
  const searched = new Set<number>();
  for (const e of embCache) {
    if (category && e.category !== category) continue;
    if (e.itemId === excludeItem) continue;
    searched.add(e.itemId);
    const c = dot(emb, e.emb);
    if (c > (bestCos.get(e.itemId) ?? -1)) bestCos.set(e.itemId, c);
  }
  const top = [...bestCos].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const cands = [];
  for (const [itemId, cos] of top) {
    const refs = await db.refs.where('itemId').equals(itemId).toArray();
    let best = { score: 0, raw: 0, spread: 0 };
    for (const r of refs) {
      const m = orbInliers(orb, r);
      if (m.score > best.score) best = m;
    }
    cands.push({ itemId, cos, inliers: best.score, raw: best.raw, spread: best.spread });
  }
  return { cands, searched: searched.size };
}

// ───────────── Messages ─────────────
const ops: Record<string, (a: any) => Promise<any>> = {
  async init(a) {
    base = a.base;
    post({ type: 'status', msg: "Chargement de l'IA…" });
    await loadModel();
    post({ type: 'status', msg: 'Chargement de la vision…' });
    await loadCV();
    return true;
  },
  async features(a) {
    const emb = await embed(a.blob);
    const orb = await orbFeatures(a.blob);
    return { emb, orb };
  },
  async embed(a) { return embed(a.blob); },
  async search(a) { return search(a.emb, a.orb, a.category, a.excludeItem); },
  async invalidate() { embCache = null; return true; },
  /** Dépannage : fichiers chargés par le worker. */
  async diag() { return performance.getEntriesByType('resource').map(e => e.name); },
};

// Une opération à la fois : le moteur ONNX n'aime pas les exécutions simultanées.
let queue: Promise<unknown> = Promise.resolve();
self.onmessage = (e: MessageEvent) => {
  const { id, op, args } = e.data;
  queue = queue.then(async () => {
    try {
      post({ id, ok: true, result: await ops[op](args) });
    } catch (err: any) {
      post({ id, ok: false, error: String(err?.message ?? err) });
    }
  });
};
