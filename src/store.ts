// Toutes les écritures dans la collection passent par ici (et préviennent le moteur de recherche).
import { db, EMB_VERSION, getSettings, saveSettings, type Item, type Ref } from './db';
import { features, invalidate, type Features } from './engine';
import { shrink } from './image';

export interface Prepared { photo: Blob; thumb: Blob; f: Features }
export interface Meta { category: string; series: string; characters: string[]; price?: string; shop?: string }

/** Réduit la photo et calcule ses empreintes. */
export async function prepare(file: Blob): Promise<Prepared> {
  const photo = await shrink(file, 1024, 0.85);
  const thumb = await shrink(photo, 320, 0.8);
  return { photo, thumb, f: await features(photo) };
}

export async function createItem(p: Prepared, meta: Meta, qty = 1): Promise<Item> {
  const item: Item = {
    category: meta.category, series: meta.series, characters: meta.characters,
    note: '', price: meta.price ?? '', shop: meta.shop ?? '', qty,
    photo: p.photo, thumb: p.thumb, createdAt: Date.now(),
  };
  await db.transaction('rw', db.items, db.refs, db.embs, async () => {
    item.id = await db.items.add(item);
    const refId = await db.refs.add({ itemId: item.id, main: true, createdAt: Date.now(), ...p.f.orb });
    await db.embs.put({ id: refId, itemId: item.id, category: item.category, emb: p.f.emb, v: EMB_VERSION });
  });
  await invalidate();
  return item;
}

/** Ajoute une photo de référence à un objet (verso, autre angle, photo prise en magasin). */
export async function addRef(itemId: number, p: Prepared): Promise<void> {
  const item = await db.items.get(itemId);
  if (!item) return;
  await db.transaction('rw', db.refs, db.embs, async () => {
    const refId = await db.refs.add({ itemId, main: false, photo: p.photo, thumb: p.thumb, createdAt: Date.now(), ...p.f.orb });
    await db.embs.put({ id: refId, itemId, category: item.category, emb: p.f.emb, v: EMB_VERSION });
  });
  await invalidate();
}

/** Apprend d'une photo prise en magasin, sans trop alourdir la collection. */
export async function learnFrom(itemId: number, p: Prepared, inliers: number) {
  const n = await db.refs.where('itemId').equals(itemId).count();
  if (n < 5 && inliers < 2 * getSettings().tSame) await addRef(itemId, p);
}

export async function deleteRef(refId: number) {
  await db.transaction('rw', db.refs, db.embs, async () => {
    await db.refs.delete(refId);
    await db.embs.delete(refId);
  });
  await invalidate();
}

export async function setQty(id: number, qty: number) {
  await db.items.update(id, { qty: Math.max(1, qty) });
}

export async function updateItem(id: number, patch: Partial<Item>) {
  await db.transaction('rw', db.items, db.embs, async () => {
    await db.items.update(id, patch);
    if (patch.category) await db.embs.where('itemId').equals(id).modify({ category: patch.category });
  });
  await invalidate();
}

export async function deleteItem(id: number) {
  await db.transaction('rw', db.items, db.refs, db.embs, async () => {
    await db.items.delete(id);
    await db.refs.where('itemId').equals(id).delete();
    await db.embs.where('itemId').equals(id).delete();
  });
  await invalidate();
}

export async function refsOf(itemId: number): Promise<Ref[]> {
  return db.refs.where('itemId').equals(itemId).toArray();
}

// ───────────── Sauvegarde ─────────────
// Format : "DEJAVU2\n" + longueur de l'en-tête (4 octets) + en-tête JSON + morceaux binaires à la suite.
const MAGIC2 = 'DEJAVU2\n';

export async function exportBlob(): Promise<Blob> {
  const items = await db.items.toArray();
  const parts: Blob[] = [];
  const header: any = { version: 2, items: [] as any[] };
  for (const it of items) {
    const { photo, thumb, id, ...meta } = it;
    const refs = await db.refs.where('itemId').equals(id!).toArray();
    const entry: any = { meta, sizes: [photo.size, thumb.size], refs: [] };
    parts.push(photo, thumb);
    for (const r of refs) {
      const e = await db.embs.get(r.id!);
      if (!e) continue;
      const bins = [
        new Blob([e.emb as BlobPart]), new Blob([r.kp as BlobPart]), new Blob([r.desc as BlobPart]),
        r.photo ?? new Blob(), r.thumb ?? new Blob(),
      ];
      entry.refs.push({ main: r.main, n: r.n, v: e.v, createdAt: r.createdAt, sizes: bins.map(b => b.size) });
      parts.push(...bins);
    }
    header.items.push(entry);
  }
  const head = new TextEncoder().encode(JSON.stringify(header));
  const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, head.length);
  const s = getSettings(); s.lastExport = Date.now(); saveSettings(s);
  return new Blob([MAGIC2, len, head, ...parts], { type: 'application/octet-stream' });
}

export async function importBlob(f: Blob): Promise<number> {
  const magic = await f.slice(0, 8).text();
  const hl = new DataView(await f.slice(8, 12).arrayBuffer()).getUint32(0);
  const header = JSON.parse(await f.slice(12, 12 + hl).text());
  let pos = 12 + hl;
  const take = (size: number, type = '') => { const b = f.slice(pos, pos + size, type); pos += size; return b; };
  const f32 = async (b: Blob) => new Float32Array(await b.arrayBuffer());
  const u8 = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

  await db.transaction('rw', db.items, db.refs, db.embs, async () => {
    await db.items.clear(); await db.refs.clear(); await db.embs.clear();
  });
  if (magic === 'DEJAVU1\n') {
    // Première version : une seule photo par objet.
    for (const e of header) {
      const [photo, thumb, emb, kp, desc] = e.sizes.map((s: number, i: number) => take(s, i < 2 ? 'image/jpeg' : ''));
      const itemId = await db.items.add({ ...e.meta, id: undefined, qty: e.meta.qty || 1, photo, thumb });
      const refId = await db.refs.add({ itemId, main: true, n: e.n, kp: await f32(kp), desc: await u8(desc), createdAt: Date.now() });
      await db.embs.put({ id: refId, itemId, category: e.meta.category, emb: await f32(emb), v: 1 });
    }
    await invalidate();
    return header.length;
  }
  if (magic !== MAGIC2) throw new Error('Ce fichier n’est pas une sauvegarde Déjà Vu.');
  for (const e of header.items) {
    const photo = take(e.sizes[0], 'image/jpeg'), thumb = take(e.sizes[1], 'image/jpeg');
    const itemId = await db.items.add({ ...e.meta, id: undefined, photo, thumb });
    for (const r of e.refs) {
      const [emb, kp, desc, rphoto, rthumb] = r.sizes.map((s: number, i: number) => take(s, i >= 3 ? 'image/jpeg' : ''));
      const refId = await db.refs.add({
        itemId, main: r.main, n: r.n, kp: await f32(kp), desc: await u8(desc), createdAt: r.createdAt,
        ...(rphoto.size ? { photo: rphoto, thumb: rthumb } : {}),
      });
      await db.embs.put({ id: refId, itemId, category: e.meta.category, emb: await f32(emb), v: r.v });
    }
  }
  await invalidate();
  return header.items.length;
}
