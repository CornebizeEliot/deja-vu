import Dexie, { type Table } from 'dexie';

export interface Item {
  id?: number;
  category: string;
  characters: string[];
  series: string;
  note: string;
  price: string;
  shop: string;
  /** nombre d'exemplaires possédés (1, 2, 15…) */
  qty: number;
  photo: Blob;
  thumb: Blob;
  createdAt: number;
}
/** Empreinte globale (DINOv2), table à part pour pouvoir tout charger vite. */
export interface Vec { id: number; category: string; emb: Float32Array }
/** Points ORB (vérification à l'identique), lus seulement pour les candidats. */
export interface Orb { id: number; n: number; kp: Float32Array; desc: Uint8Array }

class DejaVuDB extends Dexie {
  items!: Table<Item, number>;
  vecs!: Table<Vec, number>;
  orbs!: Table<Orb, number>;
  constructor() {
    super('deja-vu');
    this.version(1).stores({
      items: '++id, category, series, createdAt',
      vecs: 'id, category',
      orbs: 'id',
    });
  }
}
export const db = new DejaVuDB();

export const DEFAULT_CATEGORIES = [
  'Stickers', 'Cartes', 'Cartes postales', 'Pochettes plastiques',
  'Acryliques', 'Porte-clés', 'Pins / badges', 'Autre',
];
export const SERIES = ['Demon Slayer', 'Vocaloid', 'Autre'];
export const DEFAULT_CHARACTERS = [
  'Gyomei', 'Tanjiro', 'Nezuko', 'Zenitsu', 'Inosuke', 'Giyu', 'Shinobu', 'Rengoku', 'Tengen', 'Mitsuri',
  'Hatsune Miku',
];

export interface Settings {
  categories: string[];
  characters: string[];
  /** nombre de points ORB cohérents pour dire « identique » */
  tSame: number;
  /** nombre de points cohérents pour dire « ressemble » */
  tNear: number;
  /** similarité globale minimale pour proposer un produit « similaire » */
  tCos: number;
  showScores: boolean;
}
const DEFAULTS: Settings = {
  categories: DEFAULT_CATEGORIES, characters: DEFAULT_CHARACTERS,
  tSame: 30, tNear: 14, tCos: 0.72, showScores: false,
};
export function getSettings(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('dv-settings') || '{}') }; }
  catch { return { ...DEFAULTS }; }
}
export function saveSettings(s: Settings) { localStorage.setItem('dv-settings', JSON.stringify(s)); }
