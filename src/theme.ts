// Thèmes « Piliers » : couleurs + motif traditionnel japonais de chaque personnage.

export interface Theme {
  id: string; name: string; sub: string;
  bg: string; panel: string; line: string; text: string; muted: string;
  primary: string; onPrimary: string; accent: string;
  pattern: string;
}

const svg = (w: number, h: number, body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`)}")`;

/** Damier ichimatsu (haori de Tanjiro). */
const ichimatsu = (a: string, b: string) => svg(16, 16, `<rect width='16' height='16' fill='${b}'/><rect width='8' height='8' fill='${a}'/><rect x='8' y='8' width='8' height='8' fill='${a}'/>`);

/** Asanoha, la feuille de chanvre (kimono de Nezuko). */
function asanoha(line: string, bg: string) {
  const W = 40, H = 40 * Math.sqrt(3);
  const hh = H / 2;
  const segs: string[] = [];
  const P = (x: number, y: number) => `${x.toFixed(2)} ${y.toFixed(2)}`;
  for (let r = -1; r <= 2; r++) {
    for (let i = -1; i <= 2; i++) {
      const off = r % 2 ? 20 : 0;
      const A = [i * 40 + off, r * hh], B = [A[0] + 40, A[1]], C = [A[0] + 20, A[1] + hh], D = [A[0] - 20, A[1] + hh];
      for (const tri of [[A, B, C], [A, C, D]]) {
        const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
        segs.push(`M${P(tri[0][0], tri[0][1])}L${P(tri[1][0], tri[1][1])}L${P(tri[2][0], tri[2][1])}Z`);
        for (const v of tri) segs.push(`M${P(v[0], v[1])}L${P(cx, cy)}`);
      }
    }
  }
  return svg(W, H, `<rect width='${W}' height='${H.toFixed(2)}' fill='${bg}'/><path d='${segs.join('')}' stroke='${line}' stroke-width='1.2' fill='none'/>`);
}

/** Écailles uroko (haori de Zenitsu). */
const uroko = (a: string, b: string) => svg(24, 40, `<rect width='24' height='40' fill='${b}'/><path d='M0 20L12 0L24 20Z M-12 40L0 20L12 40Z M12 40L24 20L36 40Z' fill='${a}'/>`);

/** Carapace de tortue kikkō (haori de Giyu). */
const kikko = (line: string, bg: string) => svg(30, 52, `<rect width='30' height='52' fill='${bg}'/><path d='M15 0L30 8.66V25.98L15 34.64L0 25.98V8.66Z M15 34.64V52 M0 25.98L-15 34.64 M30 25.98L45 34.64' stroke='${line}' stroke-width='2' fill='none'/>`);

/** Perles du chapelet (juzu) de Gyomei. */
const juzu = (bead: string, bg: string) => svg(22, 22, `<rect width='22' height='22' fill='${bg}'/><circle cx='11' cy='11' r='7.5' fill='${bead}'/><circle cx='8.5' cy='8.5' r='2.2' fill='#ffffff' fill-opacity='.25'/><rect x='0' y='10.4' width='3.5' height='1.2' fill='${bead}'/><rect x='18.5' y='10.4' width='3.5' height='1.2' fill='${bead}'/>`);

/** Flammes (Rengoku). */
const flames = (a: string, b: string) => svg(28, 28, `<rect width='28' height='28' fill='${b}'/><path d='M0 28C4 18 10 20 7 8C14 14 14 22 14 28Z M14 28C18 18 24 20 21 8C28 14 28 22 28 28Z' fill='${a}'/>`);

/** Papillons (Shinobu). */
const butterflies = (a: string, b: string) => svg(36, 36, `<rect width='36' height='36' fill='${b}'/><path d='M18 18C12 8 4 10 6 16C7 20 12 20 18 18C13 22 10 28 15 28C18 28 18 22 18 18C18 22 18 28 21 28C26 28 23 22 18 18C24 20 29 20 30 16C32 10 24 8 18 18Z' fill='${a}'/>`);

/** Rayures « notes de musique » (Miku). */
const stripes = (a: string, b: string) => svg(20, 20, `<rect width='20' height='20' fill='${b}'/><path d='M-5 5L5 -5M0 20L20 0M15 25L25 15' stroke='${a}' stroke-width='5'/>`);

export const THEMES: Theme[] = [
  {
    id: 'gyomei', name: 'Gyomei', sub: 'Pilier de la Pierre',
    bg: '#15130f', panel: '#211e18', line: '#3a342a', text: '#f1ece2', muted: '#a89f8e',
    primary: '#c9a46a', onPrimary: '#1d150a', accent: '#8a9a5b', pattern: juzu('#6d6253', '#2a261f'),
  },
  {
    id: 'tanjiro', name: 'Tanjiro', sub: 'Souffle du Soleil',
    bg: '#0f1513', panel: '#18211e', line: '#2a3833', text: '#eef5f1', muted: '#9fb3aa',
    primary: '#2fae7c', onPrimary: '#04170f', accent: '#d9483b', pattern: ichimatsu('#1d7a55', '#101412'),
  },
  {
    id: 'nezuko', name: 'Nezuko', sub: 'Art du sang démoniaque',
    bg: '#1a1216', panel: '#261a20', line: '#3d2a33', text: '#fbeef3', muted: '#c4a5b2',
    primary: '#f28cb1', onPrimary: '#2a0b17', accent: '#7fbf6a', pattern: asanoha('#f28cb1', '#3a1f2b'),
  },
  {
    id: 'zenitsu', name: 'Zenitsu', sub: 'Souffle de la Foudre',
    bg: '#16140c', panel: '#221f12', line: '#3b351c', text: '#fbf6e2', muted: '#bfb48a',
    primary: '#f5c518', onPrimary: '#221a00', accent: '#f28c28', pattern: uroko('#f5c518', '#e07b16'),
  },
  {
    id: 'giyu', name: 'Giyu', sub: 'Pilier de l’Eau',
    bg: '#0e1219', panel: '#161c27', line: '#26304a', text: '#eaf0fb', muted: '#9aa8c4',
    primary: '#4b86d6', onPrimary: '#04122a', accent: '#8c2b3a', pattern: kikko('#c9b037', '#2f6b3d'),
  },
  {
    id: 'shinobu', name: 'Shinobu', sub: 'Pilier de l’Insecte',
    bg: '#14111a', panel: '#1f1a28', line: '#352c45', text: '#f3eefb', muted: '#b2a6c8',
    primary: '#b48be0', onPrimary: '#1b0b2e', accent: '#4fc3b0', pattern: butterflies('#b48be0', '#2b2140'),
  },
  {
    id: 'rengoku', name: 'Rengoku', sub: 'Pilier de la Flamme',
    bg: '#170f0b', panel: '#241812', line: '#3e281c', text: '#fbefe6', muted: '#c8a894',
    primary: '#ff7a2f', onPrimary: '#2a0e00', accent: '#f5c518', pattern: flames('#d9381e', '#3a1a0c'),
  },
  {
    id: 'miku', name: 'Miku', sub: 'Hatsune Miku',
    bg: '#0e1516', panel: '#162122', line: '#253839', text: '#eafbfa', muted: '#99c1bf',
    primary: '#39c5bb', onPrimary: '#032321', accent: '#e12885', pattern: stripes('#1f8f88', '#123334'),
  },
];

export function applyTheme(id: string) {
  const t = THEMES.find(x => x.id === id) ?? THEMES[0];
  const r = document.documentElement.style;
  for (const k of ['bg', 'panel', 'line', 'text', 'muted', 'primary', 'accent'] as const) r.setProperty(`--${k}`, t[k]);
  r.setProperty('--on-primary', t.onPrimary);
  r.setProperty('--pattern', t.pattern);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t.bg);
  return t;
}

/** Petites phrases pendant l'analyse. */
export const ANALYZING = [
  '全集中… Concentration totale',
  'Gyomei compte ses perles…',
  'Respiration de la Pierre…',
  'Comparaison des moindres détails…',
  '南無阿弥陀仏…',
];
