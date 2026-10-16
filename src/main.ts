import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { db, getSettings, saveSettings, SERIES, type Item } from './db';
import { shrink } from './image';
import { warmUp, computeFeatures, search, type Verdict, type Features } from './engine';

registerSW({ immediate: true });

// ───────────── petits utilitaires ─────────────
type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Record<string, any> = {}, ...kids: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c) el.append(c);
  return el;
}
const urls = new Set<string>();
function url(b: Blob) { const u = URL.createObjectURL(b); urls.add(u); return u; }
function freeUrls() { urls.forEach(u => URL.revokeObjectURL(u)); urls.clear(); }
const ls = {
  get: (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
function toast(msg: string) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
}
function pickFiles(multiple: boolean, camera: boolean): Promise<File[]> {
  return new Promise(res => {
    const i = h('input', { type: 'file', accept: 'image/*', multiple, capture: camera ? 'environment' : false });
    i.style.display = 'none';
    i.addEventListener('change', () => { res([...(i.files || [])]); i.remove(); });
    i.addEventListener('cancel', () => { res([]); i.remove(); });
    document.body.append(i);
    i.click();
  });
}
const plural = (n: number) => (n > 1 ? `${n} exemplaires` : '1 exemplaire');

// ───────────── moteur IA : état de chargement ─────────────
let engineMsg = "Chargement de l'IA… (première fois : Wi-Fi conseillé)";
let engineReady = false;
const engine = warmUp(m => { engineMsg = m; updateBanner(); })
  .then(() => { engineReady = true; updateBanner(); })
  .catch(e => { engineMsg = `IA indisponible : ${e.message}`; updateBanner(); });
function updateBanner() {
  const b = document.getElementById('banner');
  if (!b) return;
  b.textContent = engineMsg;
  b.hidden = engineReady;
}

// ───────────── ajout d'un objet ─────────────
interface Meta { category: string; series: string; characters: string[] }
interface AddResult { item: Item; merged: boolean }

async function prepare(file: Blob) {
  const photo = await shrink(file, 1024, 0.85);
  const thumb = await shrink(file, 260, 0.8);
  await engine;
  const features = await computeFeatures(photo);
  return { photo, thumb, features };
}

async function insertItem(p: { photo: Blob; thumb: Blob; features: Features }, meta: Meta, qty = 1): Promise<Item> {
  const item: Item = {
    category: meta.category, series: meta.series, characters: meta.characters,
    note: '', price: '', shop: '', qty, photo: p.photo, thumb: p.thumb, createdAt: Date.now(),
  };
  await db.transaction('rw', db.items, db.vecs, db.orbs, async () => {
    const id = await db.items.add(item);
    item.id = id;
    await db.vecs.put({ id, category: meta.category, emb: p.features.emb });
    await db.orbs.put({ id, ...p.features.orb });
  });
  return item;
}

/** Ajoute un objet ; s'il existe déjà à l'identique dans la catégorie, ajoute un exemplaire. */
async function addPhoto(file: Blob, meta: Meta): Promise<AddResult> {
  const p = await prepare(file);
  const v = await search(p.features, meta.category);
  if (v.kind === 'same') {
    const it = v.best[0].item;
    it.qty = (it.qty || 1) + 1;
    await db.items.update(it.id!, { qty: it.qty });
    return { item: it, merged: true };
  }
  return { item: await insertItem(p, meta), merged: false };
}

// ───────────── écran : Vérifier ─────────────
function viewCheck(root: HTMLElement) {
  let filter = ls.get('dv-check-cat', '');
  const S = getSettings();
  const out = h('div', { class: 'result' });
  const chips = h('div', { class: 'chips' });
  const drawChips = () => {
    chips.replaceChildren(
      ...['', ...S.categories].map(c =>
        h('button', { class: 'chip' + (filter === c ? ' on' : ''), onclick: () => { filter = c; ls.set('dv-check-cat', c); drawChips(); } }, c || 'Tout'))
    );
  };
  drawChips();

  const run = async (f: File | undefined) => {
    if (!f) return;
    out.replaceChildren(h('div', { class: 'card muted' }, 'Analyse en cours…'));
    try {
      const p = await prepare(f);
      const v = await search(p.features, filter || null);
      showVerdict(out, v, p, filter);
    } catch (e: any) {
      out.replaceChildren(h('div', { class: 'card bad' }, `Erreur : ${e.message || e}`));
    }
  };

  root.append(
    h('h1', {}, 'Je l’ai déjà ?'),
    h('p', { class: 'muted' }, 'Choisis la catégorie (plus précis et plus rapide), puis prends l’objet en photo.'),
    chips,
    h('div', { class: 'row big' },
      h('button', { class: 'btn primary xl', onclick: async () => run((await pickFiles(false, true))[0]) }, '📷 Photo'),
      h('button', { class: 'btn xl', onclick: async () => run((await pickFiles(false, false))[0]) }, '🖼️ Galerie')),
    out,
  );
}

function candCard(c: { item: Item; cos: number; inliers: number }, showScores: boolean) {
  return h('div', { class: 'cand' },
    h('img', { src: url(c.item.thumb), alt: '' }),
    h('div', {},
      h('b', {}, c.item.category),
      h('div', { class: 'muted' }, [c.item.characters.join(', '), c.item.series].filter(Boolean).join(' · ') || '—'),
      h('div', { class: 'qty' }, `×${c.item.qty || 1} · ${plural(c.item.qty || 1)}`),
      showScores && h('div', { class: 'scores' }, `points ${c.inliers} · ressemblance ${(c.cos * 100).toFixed(0)} %`)));
}

function showVerdict(out: HTMLElement, v: Verdict, p: { photo: Blob; thumb: Blob; features: Features }, filter: string) {
  const S = getSettings();
  const kids: Child[] = [];
  const photo = h('img', { class: 'shot', src: url(p.thumb), alt: '' });
  const debug = S.showScores && h('div', { class: 'scores' }, v.all.map(c => `#${c.item.id}: ${c.inliers} pts / ${(c.cos * 100).toFixed(0)} %`).join('  |  '));

  if (v.kind === 'same') {
    const top = v.best[0].item;
    const n = top.qty || 1;
    kids.push(
      h('div', { class: 'card good' },
        h('div', { class: 'big-title' }, '✅ Tu l’as déjà !'),
        h('div', { class: 'big-qty' }, `Tu en as ${plural(n)}`),
        h('div', { class: 'muted' }, `Catégorie : ${top.category}`)),
      photo, ...v.best.map(c => candCard(c, S.showScores)),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: async () => {
          const q = (top.qty || 1) + 1;
          await db.items.update(top.id!, { qty: q });
          toast(`+1 → ${plural(q)} ✓`);
          out.replaceChildren();
        } }, 'Je le rachète (+1)'),
        h('button', { class: 'btn', onclick: () => out.replaceChildren() }, 'OK')),
    );
  } else if (v.kind === 'similar') {
    kids.push(
      h('div', { class: 'card warn' },
        h('div', { class: 'big-title' }, '🟠 Tu as des produits similaires'),
        h('div', { class: 'muted' }, 'Compare avec ta photo : ce n’est sûrement pas exactement le même.')),
      photo, ...v.best.map(c => candCard(c, S.showScores)),
      addBlock(out, p, filter),
    );
  } else {
    kids.push(
      h('div', { class: 'card new' },
        h('div', { class: 'big-title' }, '🆕 Pas dans ta collection'),
        h('div', { class: 'muted' }, v.searched ? `Comparé à ${v.searched} objet(s).` : 'Ta collection est encore vide.')),
      photo, addBlock(out, p, filter),
    );
  }
  kids.push(debug);
  out.replaceChildren(...kids.filter(Boolean) as Node[]);
}

function addBlock(out: HTMLElement, p: { photo: Blob; thumb: Blob; features: Features }, filter: string) {
  const S = getSettings();
  const sel = h('select', {}, ...S.categories.map(c => h('option', { value: c, selected: c === (filter || ls.get('dv-add-cat', S.categories[0])) }, c)));
  return h('div', { class: 'card' },
    h('div', { class: 'muted' }, 'Je l’achète : ajouter à ma collection'),
    h('div', { class: 'row' }, sel,
      h('button', { class: 'btn primary', onclick: async () => {
        await insertItem(p, { category: sel.value, series: ls.get('dv-add-series', SERIES[0]), characters: JSON.parse(ls.get('dv-add-chars', '[]')) });
        toast('Ajouté à ta collection ✓');
        out.replaceChildren();
      } }, 'Ajouter')));
}

// ───────────── écran : Ajouter (mode rafale) ─────────────
function viewAdd(root: HTMLElement) {
  const S = getSettings();
  let category = ls.get('dv-add-cat', S.categories[0]);
  let series = ls.get('dv-add-series', SERIES[0]);
  let chars: string[] = JSON.parse(ls.get('dv-add-chars', '[]'));
  const log = h('div', { class: 'log' });
  const status = h('div', { class: 'muted' });
  const catChips = h('div', { class: 'chips' });
  const charChips = h('div', { class: 'chips' });
  const serSel = h('select', { onchange: () => { series = serSel.value; ls.set('dv-add-series', series); } },
    ...SERIES.map(s => h('option', { value: s, selected: s === series }, s)));

  const drawCat = () => catChips.replaceChildren(...S.categories.map(c =>
    h('button', { class: 'chip' + (c === category ? ' on' : ''), onclick: () => { category = c; ls.set('dv-add-cat', c); drawCat(); } }, c)));
  const drawChars = () => charChips.replaceChildren(
    ...S.characters.map(c =>
      h('button', { class: 'chip' + (chars.includes(c) ? ' on' : ''), onclick: () => {
        chars = chars.includes(c) ? chars.filter(x => x !== c) : [...chars, c];
        ls.set('dv-add-chars', JSON.stringify(chars)); drawChars();
      } }, c)),
    h('button', { class: 'chip', onclick: () => {
      const n = prompt('Nom du personnage ?')?.trim();
      if (!n) return;
      const s2 = getSettings();
      if (!s2.characters.includes(n)) { s2.characters.push(n); saveSettings(s2); S.characters = s2.characters; }
      chars = [...chars, n]; ls.set('dv-add-chars', JSON.stringify(chars)); drawChars();
    } }, '+ autre'));
  drawCat(); drawChars();

  const handle = async (files: File[]) => {
    let i = 0;
    for (const f of files) {
      i++;
      status.textContent = `Analyse ${i}/${files.length}…`;
      try {
        const r = await addPhoto(f, { category, series, characters: chars });
        log.prepend(h('div', { class: 'cand', onclick: () => openDetail(r.item.id!) },
          h('img', { src: url(r.item.thumb), alt: '' }),
          h('div', {}, h('b', {}, r.merged ? `Déjà dans ta collection → +1 (${plural(r.item.qty)})` : 'Nouvel objet ajouté ✓'),
            h('div', { class: 'muted' }, r.item.category))));
      } catch (e: any) {
        log.prepend(h('div', { class: 'card bad' }, `Erreur : ${e.message || e}`));
      }
    }
    status.textContent = files.length ? `${files.length} photo(s) traitée(s).` : '';
  };

  root.append(
    h('h1', {}, 'Ajouter à ma collection'),
    h('p', { class: 'muted' }, 'Les réglages restent d’un objet à l’autre : enchaîne les photos. Si l’objet est déjà là, ça ajoute juste un exemplaire.'),
    h('h3', {}, 'Catégorie'), catChips,
    h('h3', {}, 'Série'), serSel,
    h('h3', {}, 'Personnage(s)'), charChips,
    h('div', { class: 'row big' },
      h('button', { class: 'btn primary xl', onclick: async () => handle(await pickFiles(false, true)) }, '📷 Photo'),
      h('button', { class: 'btn xl', onclick: async () => handle(await pickFiles(true, false)) }, '🖼️ Galerie (plusieurs)')),
    status, log,
  );
}

// ───────────── écran : Collection ─────────────
function viewCollection(root: HTMLElement) {
  const S = getSettings();
  let cat = '', who = '';
  const head = h('div', {});
  const chips = h('div', { class: 'chips' });
  const grid = h('div', { class: 'grid' });

  const draw = async () => {
    const all = await db.items.toArray();
    const total = all.reduce((s, i) => s + (i.qty || 1), 0);
    head.textContent = `${all.length} objet(s) différent(s) · ${total} exemplaire(s) au total`;
    chips.replaceChildren(...['', ...S.categories].map(c => {
      const n = all.filter(i => !c || i.category === c).length;
      return h('button', { class: 'chip' + (cat === c ? ' on' : ''), onclick: () => { cat = c; draw(); } }, `${c || 'Tout'} (${n})`);
    }));
    const people = [...new Set(all.flatMap(i => i.characters))].sort();
    whoSel.replaceChildren(h('option', { value: '' }, 'Tous les personnages'),
      ...people.map(p => h('option', { value: p, selected: p === who }, p)));
    const list = all.filter(i => (!cat || i.category === cat) && (!who || i.characters.includes(who)))
      .sort((a, b) => b.createdAt - a.createdAt);
    grid.replaceChildren(...list.map(i => h('button', { class: 'tile', onclick: () => openDetail(i.id!, draw) },
      h('img', { src: url(i.thumb), alt: '', loading: 'lazy' }),
      (i.qty || 1) > 1 && h('span', { class: 'badge' }, `×${i.qty}`))));
    if (!list.length) grid.replaceChildren(h('p', { class: 'muted' }, 'Rien ici pour l’instant.'));
  };
  const whoSel = h('select', { onchange: () => { who = whoSel.value; draw(); } });
  root.append(h('h1', {}, 'Ma collection'), head, chips, whoSel, grid);
  draw();
}

async function openDetail(id: number, after?: () => void) {
  const it = await db.items.get(id);
  if (!it) return;
  const S = getSettings();
  let qty = it.qty || 1;
  const qv = h('span', { class: 'qv' }, String(qty));
  const cat = h('select', {}, ...S.categories.map(c => h('option', { value: c, selected: c === it.category }, c)));
  const ser = h('select', {}, ...SERIES.map(c => h('option', { value: c, selected: c === it.series }, c)));
  const chars = h('input', { type: 'text', value: it.characters.join(', '), placeholder: 'Personnages, séparés par des virgules' });
  const note = h('input', { type: 'text', value: it.note, placeholder: 'Note' });
  const price = h('input', { type: 'text', value: it.price, placeholder: 'Prix' });
  const shop = h('input', { type: 'text', value: it.shop, placeholder: 'Magasin' });
  const dlg = h('dialog', { class: 'detail' },
    h('img', { class: 'full', src: url(it.photo), alt: '' }),
    h('div', { class: 'qtyrow' }, h('span', {}, 'Exemplaires'),
      h('button', { class: 'btn', onclick: () => { qty = Math.max(1, qty - 1); qv.textContent = String(qty); } }, '−'),
      qv,
      h('button', { class: 'btn', onclick: () => { qty++; qv.textContent = String(qty); } }, '+')),
    cat, ser, chars, note, price, shop,
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: async () => {
        await db.transaction('rw', db.items, db.vecs, async () => {
          await db.items.update(id, {
            qty, category: cat.value, series: ser.value, note: note.value, price: price.value, shop: shop.value,
            characters: chars.value.split(',').map(s => s.trim()).filter(Boolean),
          });
          await db.vecs.update(id, { category: cat.value });
        });
        dlg.close(); after?.();
      } }, 'Enregistrer'),
      h('button', { class: 'btn', onclick: () => dlg.close() }, 'Fermer'),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!confirm('Supprimer cet objet de la collection ?')) return;
        await db.transaction('rw', db.items, db.vecs, db.orbs, async () => {
          await db.items.delete(id); await db.vecs.delete(id); await db.orbs.delete(id);
        });
        dlg.close(); after?.();
      } }, 'Supprimer')));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

// ───────────── écran : Réglages ─────────────
function viewSettings(root: HTMLElement) {
  const S = getSettings();
  const num = (label: string, key: 'tSame' | 'tNear' | 'tCos', step: number, help: string) => {
    const i = h('input', { type: 'number', step, value: S[key], onchange: () => { S[key] = Number(i.value); saveSettings(S); } });
    return h('label', { class: 'field' }, h('span', {}, label), i, h('small', { class: 'muted' }, help));
  };
  const cats = h('textarea', { rows: 8 }, S.categories.join('\n'));
  const chs = h('textarea', { rows: 8 }, S.characters.join('\n'));
  const scores = h('input', { type: 'checkbox', checked: S.showScores, onchange: () => { S.showScores = scores.checked; saveSettings(S); } });
  const info = h('p', { class: 'muted' });
  navigator.storage?.estimate?.().then(e => { info.textContent = `Stockage utilisé : ${((e.usage || 0) / 1048576).toFixed(0)} Mo`; });

  root.append(
    h('h1', {}, 'Réglages'),
    h('h3', {}, 'Sauvegarde'),
    h('p', { class: 'muted' }, 'Si le navigateur est vidé, la collection disparaît : fais une sauvegarde de temps en temps et mets-la sur Google Drive.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: exportAll }, '💾 Exporter'),
      h('button', { class: 'btn', onclick: importAll }, '📥 Importer')),
    h('button', { class: 'btn', onclick: async () => toast((await navigator.storage?.persist?.()) ? 'Stockage protégé ✓' : 'Le navigateur a refusé') }, '🔒 Protéger le stockage'),
    info,
    h('h3', {}, 'Catégories (une par ligne)'), cats,
    h('h3', {}, 'Personnages (un par ligne)'), chs,
    h('button', { class: 'btn', onclick: () => {
      S.categories = cats.value.split('\n').map(s => s.trim()).filter(Boolean);
      S.characters = chs.value.split('\n').map(s => s.trim()).filter(Boolean);
      saveSettings(S); toast('Listes enregistrées ✓');
    } }, 'Enregistrer les listes'),
    h('h3', {}, 'Réglages de l’IA'),
    num('Identique à partir de', 'tSame', 1, 'Nombre de détails communs. Baisse si l’app rate des objets que tu as ; monte si elle dit « identique » à tort.'),
    num('Ressemble à partir de', 'tNear', 1, 'Détails communs pour proposer « similaire ».'),
    num('Ressemblance globale', 'tCos', 0.01, 'Entre 0 et 1.'),
    h('label', { class: 'field inline' }, scores, h('span', {}, 'Afficher les scores (pour régler)')),
  );
}

async function exportAll() {
  toast('Préparation de la sauvegarde…');
  const items = await db.items.toArray();
  const parts: BlobPart[] = [];
  const header: any[] = [];
  for (const it of items) {
    const v = await db.vecs.get(it.id!), o = await db.orbs.get(it.id!);
    if (!v || !o) continue;
    const bins: Blob[] = [it.photo, it.thumb, new Blob([v.emb as BlobPart]), new Blob([o.kp as BlobPart]), new Blob([o.desc as BlobPart])];
    const { photo, thumb, ...meta } = it; void photo; void thumb;
    header.push({ meta, n: o.n, sizes: bins.map(b => b.size) });
    parts.push(...bins);
  }
  const head = new TextEncoder().encode(JSON.stringify(header));
  const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, head.length);
  const blob = new Blob([new TextEncoder().encode('DEJAVU1\n'), len, head, ...parts]);
  const a = h('a', { href: URL.createObjectURL(blob), download: `deja-vu-${new Date().toISOString().slice(0, 10)}.dejavu` });
  document.body.append(a); a.click(); a.remove();
}

async function importAll() {
  const f = (await pickFiles(false, false))[0];
  if (!f || !confirm('Remplacer toute la collection actuelle par cette sauvegarde ?')) return;
  const dv = new DataView(await f.slice(8, 12).arrayBuffer());
  const hl = dv.getUint32(0);
  const header = JSON.parse(await f.slice(12, 12 + hl).text());
  let pos = 12 + hl;
  await db.items.clear(); await db.vecs.clear(); await db.orbs.clear();
  for (const e of header) {
    const [photo, thumb, emb, kp, desc] = e.sizes.map((s: number) => { const b = f.slice(pos, pos + s); pos += s; return b; });
    const item: Item = { ...e.meta, id: undefined, photo: photo.slice(0, photo.size, 'image/jpeg'), thumb: thumb.slice(0, thumb.size, 'image/jpeg') };
    const id = await db.items.add(item);
    await db.vecs.put({ id, category: item.category, emb: new Float32Array(await emb.arrayBuffer()) });
    await db.orbs.put({ id, n: e.n, kp: new Float32Array(await kp.arrayBuffer()), desc: new Uint8Array(await desc.arrayBuffer()) });
  }
  toast(`${header.length} objet(s) importé(s) ✓`);
  go('collection');
}

// ───────────── navigation ─────────────
const TABS = [
  { id: 'check', label: 'Vérifier', icon: '🔍', view: viewCheck },
  { id: 'add', label: 'Ajouter', icon: '➕', view: viewAdd },
  { id: 'collection', label: 'Collection', icon: '🗂️', view: viewCollection },
  { id: 'settings', label: 'Réglages', icon: '⚙️', view: viewSettings },
] as const;

const app = document.getElementById('app')!;
const main = h('main', {});
const nav = h('nav', {});
app.append(h('div', { id: 'banner', class: 'banner' }, engineMsg), main, nav);

function go(id: string) {
  ls.set('dv-tab', id);
  freeUrls();
  main.replaceChildren();
  const tab = TABS.find(t => t.id === id) || TABS[0];
  tab.view(main);
  nav.replaceChildren(...TABS.map(t => h('button', { class: t.id === tab.id ? 'on' : '', onclick: () => go(t.id) },
    h('span', { class: 'ic' }, t.icon), t.label)));
  window.scrollTo(0, 0);
}
go(ls.get('dv-tab', 'check'));
navigator.storage?.persist?.();
(window as any).__dv = { addPhoto, prepare, search, db };
