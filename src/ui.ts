// Petits outils d'interface partagés par tous les écrans.

export type Child = Node | string | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Record<string, any> = {}, ...kids: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') for (const [p, val] of Object.entries(v)) el.style.setProperty(p.startsWith('--') ? p : p.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`), String(val));
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, String(v));
  }
  for (const c of kids.flat()) if (c) el.append(c);
  return el;
}

/** replaceChildren qui ignore les valeurs vides (false, null…). */
export function fill(el: Element, ...kids: (Child | Child[])[]) {
  el.replaceChildren(...kids.flat().filter((k): k is Node | string => !!k));
}

// URLs d'images : libérées quand on change d'onglet.
const urls = new Set<string>();
export function url(b: Blob) { const u = URL.createObjectURL(b); urls.add(u); return u; }
export function freeUrls() { urls.forEach(u => URL.revokeObjectURL(u)); urls.clear(); }

export const ls = {
  get: (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  json: <T>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? '') as T; } catch { return d; } },
};

/** Message en bas de l'écran, avec un bouton facultatif (ex. « Annuler »). */
export function toast(msg: string, action?: { label: string; run: () => void }, ms = 3500) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = h('div', { class: 'toast', role: 'status' }, h('span', {}, msg),
    action && h('button', { onclick: () => { t.remove(); action.run(); } }, action.label));
  document.body.append(t);
  setTimeout(() => t.remove(), action ? ms + 2500 : ms);
}

export const buzz = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* ignore */ } };

export function pickFiles(multiple: boolean, camera = false): Promise<File[]> {
  return new Promise(res => {
    const i = h('input', { type: 'file', accept: 'image/*', multiple, capture: camera ? 'environment' : false });
    i.style.display = 'none';
    i.addEventListener('change', () => { res([...(i.files || [])]); i.remove(); });
    i.addEventListener('cancel', () => { res([]); i.remove(); });
    document.body.append(i);
    i.click();
  });
}

export const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
export const copies = (n: number) => plural(n, 'exemplaire', 'exemplaires');

/** Rangée de pastilles à choix unique ou multiple. */
export function chips(opts: {
  options: { value: string; label: string; star?: boolean }[];
  selected: string[];
  multi?: boolean;
  onChange: (sel: string[]) => void;
  extra?: HTMLElement;
}): HTMLElement {
  const box = h('div', { class: 'chips' });
  let sel = [...opts.selected];
  const draw = () => fill(box, 
    ...opts.options.map(o => h('button', {
      type: 'button',
      class: 'chip' + (sel.includes(o.value) ? ' on' : '') + (o.star ? ' star' : ''),
      'aria-pressed': sel.includes(o.value),
      onclick: () => {
        sel = opts.multi ? (sel.includes(o.value) ? sel.filter(x => x !== o.value) : [...sel, o.value]) : [o.value];
        draw(); opts.onChange(sel);
      },
    }, o.star ? `★ ${o.label}` : o.label)),
    opts.extra ?? null,
  );
  draw();
  return box;
}

// ───────────── Bouton « retour » d'Android ─────────────
// Chaque couche (caméra, fiche) ajoute une entrée d'historique : « retour » la ferme
// au lieu de quitter l'app.
const layers: (() => void)[] = [];
let skipPop = 0;
window.addEventListener('popstate', () => {
  if (skipPop) { skipPop--; return; }
  layers.pop()?.();
});
/** Enregistre une couche ; renvoie la fonction à appeler quand elle se ferme d'elle-même. */
export function pushLayer(close: () => void): () => void {
  history.pushState({ dvLayer: layers.length + 1 }, '');
  layers.push(close);
  return () => {
    const i = layers.lastIndexOf(close);
    if (i < 0) return;
    layers.splice(i, 1);
    skipPop++;
    history.back();
  };
}

/** Panneau qui monte du bas de l'écran. */
export function sheet(build: (close: () => void) => Child[], onClose?: () => void) {
  const dlg = h('dialog', { class: 'sheet' });
  const close = () => dlg.close();
  const release = pushLayer(close);
  dlg.append(h('div', { class: 'grab' }), ...build(close).filter(Boolean) as Node[]);
  dlg.addEventListener('close', () => { release(); dlg.remove(); onClose?.(); });
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
  document.body.append(dlg);
  dlg.showModal();
  return { dlg, close };
}

/** Le tampon japonais (hanko) des verdicts. */
export const hanko = (kanji: string, kind: string) => h('div', { class: `hanko ${kind}`, 'aria-hidden': 'true' }, kanji);

export function spinner(msg: string) {
  return h('div', { class: 'analyzing' }, h('div', { class: 'beads' }, ...Array.from({ length: 8 }, () => h('i'))), h('div', {}, msg));
}

export function fmtDate(t: number) {
  return new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}
