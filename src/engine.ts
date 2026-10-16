import { pipeline, RawImage, env } from '@huggingface/transformers';
import { db, type Item, type Orb, getSettings } from './db';

env.allowLocalModels = false;

// ───────────── Chargement des modèles ─────────────
type Progress = (msg: string) => void;
let extractor: any = null;
let cvReady: Promise<any> | null = null;

export async function loadModel(p?: Progress) {
  if (extractor) return;
  extractor = await pipeline('image-feature-extraction', 'Xenova/dinov2-small', {
    dtype: 'q8',
    progress_callback: (e: any) => {
      if (e.status === 'progress' && p) p(`Téléchargement de l'IA… ${Math.round(e.progress)} %`);
    },
  });
}

export function loadCV(): Promise<any> {
  if (cvReady) return cvReady;
  cvReady = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${import.meta.env.BASE_URL}opencv.js`;
    s.onerror = () => reject(new Error('opencv.js introuvable'));
    s.onload = () => {
      const w = window as any;
      const done = () => resolve(w.cv);
      // Selon la build, cv est un objet à callback ou une promesse.
      if (w.cv && w.cv.Mat) return done();
      if (w.cv && typeof w.cv.then === 'function') {
        w.cv.then((m: any) => { w.cv = m; done(); });
      } else if (w.cv) {
        w.cv.onRuntimeInitialized = done;
      } else reject(new Error('cv absent'));
    };
    document.head.appendChild(s);
  });
  return cvReady;
}

export async function warmUp(p?: Progress) {
  p?.("Chargement de l'IA…");
  await loadModel(p);
  p?.("Chargement d'OpenCV…");
  await loadCV();
}

// ───────────── Empreinte globale (DINOv2) ─────────────
function normalize(v: Float32Array) {
  let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  s = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= s;
  return v;
}

export async function embed(blob: Blob): Promise<Float32Array> {
  await loadModel();
  const img = await RawImage.fromBlob(blob);
  const out = await extractor(img);
  const dims: number[] = out.dims;
  const data = out.data as Float32Array;
  const d = dims[dims.length - 1];
  const tokens = dims.length === 3 ? dims[1] : 1;
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

function dot(a: Float32Array, b: Float32Array) {
  let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// ───────────── Points ORB (même illustration ?) ─────────────
export async function orbFeatures(blob: Blob): Promise<Omit<Orb, 'id'>> {
  const cv = await loadCV();
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const k = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const rgba = cv.matFromImageData(ctx.getImageData(0, 0, c.width, c.height));
  const gray = new cv.Mat();
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
  const orb = new cv.ORB(900);
  const kps = new cv.KeyPointVector();
  const desc = new cv.Mat();
  orb.detectAndCompute(gray, new cv.Mat(), kps, desc);
  const n = kps.size();
  const kp = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { const p = kps.get(i).pt; kp[2 * i] = p.x; kp[2 * i + 1] = p.y; }
  const out = { n, kp, desc: new Uint8Array(desc.data.slice(0, n * 32)) };
  rgba.delete(); gray.delete(); orb.delete(); kps.delete(); desc.delete();
  return out;
}

/** Nombre de points qui se superposent de façon cohérente (0 = rien en commun). */
export async function orbInliers(a: Omit<Orb, 'id'>, b: Omit<Orb, 'id'>): Promise<number> {
  if (a.n < 12 || b.n < 12) return 0;
  const cv = await loadCV();
  const dA = new cv.Mat(a.n, 32, cv.CV_8U); dA.data.set(a.desc);
  const dB = new cv.Mat(b.n, 32, cv.CV_8U); dB.data.set(b.desc);
  const bf = new cv.BFMatcher(cv.NORM_HAMMING, false);
  const matches = new cv.DMatchVectorVector();
  bf.knnMatch(dA, dB, matches, 2);
  const src: number[] = [], dst: number[] = [];
  for (let i = 0; i < matches.size(); i++) {
    const m = matches.get(i);
    if (m.size() < 2) continue;
    const m0 = m.get(0), m1 = m.get(1);
    if (m0.distance < 0.75 * m1.distance) {
      src.push(a.kp[2 * m0.queryIdx], a.kp[2 * m0.queryIdx + 1]);
      dst.push(b.kp[2 * m0.trainIdx], b.kp[2 * m0.trainIdx + 1]);
    }
  }
  let inliers = 0;
  const good = src.length / 2;
  if (good >= 8) {
    const S = cv.matFromArray(good, 1, cv.CV_32FC2, src);
    const D = cv.matFromArray(good, 1, cv.CV_32FC2, dst);
    const mask = new cv.Mat();
    const H = cv.findHomography(S, D, cv.RANSAC, 4.0, mask);
    if (H && !H.empty()) for (let i = 0; i < mask.rows; i++) inliers += mask.data[i] ? 1 : 0;
    H?.delete(); S.delete(); D.delete(); mask.delete();
  }
  dA.delete(); dB.delete(); bf.delete(); matches.delete();
  return inliers;
}

// ───────────── Recherche ─────────────
export interface Candidate { item: Item; cos: number; inliers: number }
export interface Verdict {
  kind: 'same' | 'similar' | 'new';
  best: Candidate[];            // meilleurs candidats, du plus probable au moins probable
  searched: number;             // nombre d'objets comparés
  all: Candidate[];             // tous les candidats examinés (pour l'écran de scores)
}

export interface Features { emb: Float32Array; orb: Omit<Orb, 'id'> }
export async function computeFeatures(blob: Blob): Promise<Features> {
  const emb = await embed(blob);
  const orb = await orbFeatures(blob);
  return { emb, orb };
}

export async function search(f: Features, category: string | null, excludeId?: number): Promise<Verdict> {
  const S = getSettings();
  let vecs = category ? await db.vecs.where('category').equals(category).toArray() : await db.vecs.toArray();
  if (excludeId != null) vecs = vecs.filter(v => v.id !== excludeId);
  const ranked = vecs.map(v => ({ id: v.id, cos: dot(f.emb, v.emb) })).sort((a, b) => b.cos - a.cos).slice(0, 10);

  const cands: Candidate[] = [];
  for (const r of ranked) {
    const [item, orb] = await Promise.all([db.items.get(r.id), db.orbs.get(r.id)]);
    if (!item) continue;
    const inliers = orb ? await orbInliers(f.orb, orb) : 0;
    cands.push({ item, cos: r.cos, inliers });
  }
  // Tri : d'abord les points ORB cohérents, ensuite la similarité globale.
  cands.sort((a, b) => b.inliers - a.inliers || b.cos - a.cos);
  const top = cands[0];
  let kind: Verdict['kind'] = 'new';
  if (top && top.inliers >= S.tSame) kind = 'same';
  else if (cands.some(c => c.inliers >= S.tNear || c.cos >= S.tCos)) kind = 'similar';
  const best = kind === 'same' ? cands.slice(0, 3)
    : kind === 'similar' ? cands.filter(c => c.inliers >= S.tNear || c.cos >= S.tCos).slice(0, 3)
    : [];
  return { kind, best, searched: vecs.length, all: cands };
}
