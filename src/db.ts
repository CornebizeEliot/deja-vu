import Dexie, { type Table } from 'dexie';

export interface Item {
  id?: number;
  category: string;
  characters: string[];
  series: string;
  note: string;
  /** prix payé, en yens (texte libre pour rester tolérant) */
  price: string;
  shop: string;
  /** nombre d'exemplaires possédés (1, 2, 15…) */
  qty: number;
  photo: Blob;
  thumb: Blob;
  createdAt: number;
}

/** Points ORB d'une photo de référence. */
export interface OrbData { n: number; kp: Float32Array; desc: Uint8Array }

/**
 * Photo de référence d'un objet. La photo principale (main) réutilise item.photo ;
 * les photos en plus (verso, autre angle, photo prise en magasin) gardent la leur.
 */
export interface Ref extends OrbData {
  id?: number;
  itemId: number;
  main: boolean;
  photo?: Blob;
  thumb?: Blob;
  createdAt: number;
}

/** Empreinte globale (DINOv2) d'une référence, table légère chargée en entier pour la recherche. */
export interface Emb { id: number; itemId: number; category: string; emb: Float32Array; v: number }

/** Version du calcul d'empreinte : si elle change, les empreintes sont recalculées au démarrage. */
export const EMB_VERSION = 2;

class DejaVuDB extends Dexie {
  items!: Table<Item, number>;
  refs!: Table<Ref, number>;
  embs!: Table<Emb, number>;
  constructor() {
    super('deja-vu');
    this.version(1).stores({
      items: '++id, category, series, createdAt',
      vecs: 'id, category',
      orbs: 'id',
    });
    // v2 : plusieurs photos par objet → les empreintes vivent dans refs / embs.
    this.version(2).stores({
      refs: '++id, itemId',
      embs: 'id, itemId, category',
    }).upgrade(async tx => {
      const vecs = await tx.table('vecs').toArray();
      for (const v of vecs) {
        const o = await tx.table('orbs').get(v.id);
        const refId = await tx.table('refs').add({
          itemId: v.id, main: true, createdAt: Date.now(),
          n: o?.n ?? 0, kp: o?.kp ?? new Float32Array(), desc: o?.desc ?? new Uint8Array(),
        });
        await tx.table('embs').put({ id: refId, itemId: v.id, category: v.category, emb: v.emb, v: 1 });
      }
      await tx.table('items').toCollection().modify((it: any) => {
        if (it.series === 'Vocaloid') it.series = 'Hatsune Miku';
        if (!it.qty) it.qty = 1;
      });
    });
    this.version(3).stores({ vecs: null, orbs: null });
  }
}
export const db = new DejaVuDB();

// ───────────── Listes par défaut ─────────────
export const DEFAULT_CATEGORIES = [
  'Stickers', 'Cartes', 'Cartes postales', 'Pochettes plastiques', 'Acryliques',
  'Porte-clés', 'Pins / badges', 'Shikishi', 'Peluches', 'Figurines', 'Autre',
];
export interface Series { name: string; characters: string[] }
export const DEFAULT_SERIES: Series[] = [
  {
    name: 'Demon Slayer',
    characters: [
      'Gyomei', 'Tanjiro', 'Nezuko', 'Zenitsu', 'Inosuke', 'Kanao', 'Genya',
      'Giyu', 'Shinobu', 'Rengoku', 'Tengen', 'Mitsuri', 'Muichiro', 'Obanai', 'Sanemi',
      'Urokodaki', 'Tamayo', 'Yushiro', 'Muzan', 'Akaza', 'Douma', 'Kokushibo',
    ],
  },
  { name: 'Hatsune Miku', characters: ['Hatsune Miku', 'Kagamine Rin', 'Kagamine Len', 'Megurine Luka', 'KAITO', 'MEIKO'] },
  { name: 'Autre', characters: [] },
];

const CATEGORY_ICONS: Record<string, string> = {
  'Stickers': '🏷️', 'Cartes': '🃏', 'Cartes postales': '💌', 'Pochettes plastiques': '📁',
  'Acryliques': '💎', 'Porte-clés': '🔑', 'Pins / badges': '🔘', 'Shikishi': '🖼️',
  'Peluches': '🧸', 'Figurines': '🗿', 'Autre': '✨',
};
export const catIcon = (c: string) => CATEGORY_ICONS[c] ?? '✨';

/** Forme du cadre photo conseillée selon la catégorie. */
export type FrameShape = 'portrait' | 'square' | 'landscape';
const CATEGORY_FRAME: Record<string, FrameShape> = {
  'Cartes': 'portrait', 'Cartes postales': 'portrait', 'Pochettes plastiques': 'portrait',
  'Shikishi': 'portrait', 'Acryliques': 'portrait', 'Figurines': 'portrait',
};
export const catFrame = (c: string): FrameShape => CATEGORY_FRAME[c] ?? 'square';

// ───────────── Réglages (stockés dans le navigateur) ─────────────
export interface Settings {
  v: number;
  categories: string[];
  series: Series[];
  /** personnages favoris : affichés en premier et mis en avant */
  favorites: string[];
  theme: string;
  /** nombre de points ORB cohérents pour dire « identique » */
  tSame: number;
  /** nombre de points cohérents pour dire « ressemble » */
  tNear: number;
  /** similarité globale minimale pour proposer un produit « similaire » */
  tCos: number;
  showScores: boolean;
  lastExport: number;
}
const DEFAULTS: Settings = {
  v: 2,
  categories: DEFAULT_CATEGORIES, series: DEFAULT_SERIES, favorites: ['Gyomei'], theme: 'gyomei',
  tSame: 30, tNear: 14, tCos: 0.72, showScores: false, lastExport: 0,
};

export function getSettings(): Settings {
  let raw: any = {};
  try { raw = JSON.parse(localStorage.getItem('dv-settings') || '{}'); } catch { /* réglages illisibles : défauts */ }
  const s: Settings = { ...structuredClone(DEFAULTS), ...raw };
  if ((raw.v ?? 1) < 2) {
    // Anciennes versions : une seule liste de personnages et pas de nouvelles catégories.
    for (const c of DEFAULT_CATEGORIES) if (!s.categories.includes(c)) s.categories.splice(s.categories.length - 1, 0, c);
    const known = new Set(DEFAULT_SERIES.flatMap(x => x.characters));
    const custom: string[] = (raw.characters ?? []).filter((c: string) => !known.has(c));
    s.series = structuredClone(DEFAULT_SERIES);
    s.series[s.series.length - 1].characters.push(...custom);
    delete (s as any).characters;
    s.v = 2;
  }
  return s;
}
export function saveSettings(s: Settings) {
  try { localStorage.setItem('dv-settings', JSON.stringify(s)); } catch { /* stockage plein ou bloqué */ }
}

/** Personnages d'une série, favoris en premier. */
export function charactersOf(s: Settings, series: string): string[] {
  const list = s.series.find(x => x.name === series)?.characters ?? [];
  return [...list.filter(c => s.favorites.includes(c)), ...list.filter(c => !s.favorites.includes(c))];
}
