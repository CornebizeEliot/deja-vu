// Écran « Ajouter » : inventaire de la collection, en rafale.
import { catFrame, catIcon, type FrameShape } from '../db';
import { openCamera, type ShotResult } from '../camera';
import { search } from '../engine';
import { metaEditor, saveSticky, stickyMeta } from '../meta';
import { createItem, deleteItem, prepare, setQty, type Meta, type Prepared } from '../store';
import { buzz, copies, h, ls, pickFiles, toast, url } from '../ui';
import { openDetail } from './detail';

interface LogEntry {
  thumb: Blob;
  text: string;
  kind: 'ok' | 'merged' | 'error' | 'undone';
  itemId?: number;
  undo?: () => Promise<void>;
  /** pour un doublon détecté : « c'est un autre objet » */
  split?: () => Promise<void>;
}
// Journal de la séance (reste affiché si on change d'onglet).
const log: LogEntry[] = [];

/** Ajoute une photo ; si l'objet est déjà là (même catégorie), compte un exemplaire de plus. */
async function addOne(blob: Blob, meta: Meta): Promise<LogEntry> {
  let p: Prepared;
  try { p = await prepare(blob); }
  catch (e: any) { return { thumb: blob, text: `Erreur : ${e.message || e}`, kind: 'error' }; }
  const v = await search(p.f, meta.category);
  if (v.kind === 'same') {
    const it = v.best[0].item;
    const before = it.qty || 1;
    await setQty(it.id!, before + 1);
    const e: LogEntry = {
      thumb: p.thumb, kind: 'merged', itemId: it.id,
      text: `Déjà là → ${copies(before + 1)}`,
      undo: async () => { await setQty(it.id!, before); e.kind = 'undone'; e.text = 'Annulé'; },
      split: async () => {
        await setQty(it.id!, before);
        const n = await createItem(p, meta);
        e.kind = 'ok'; e.itemId = n.id; e.text = 'Ajouté séparément ✓';
        e.undo = async () => { await deleteItem(n.id!); e.kind = 'undone'; e.text = 'Annulé'; };
        e.split = undefined;
      },
    };
    return e;
  }
  const item = await createItem(p, meta);
  const e: LogEntry = {
    thumb: p.thumb, kind: 'ok', itemId: item.id, text: 'Ajouté ✓',
    undo: async () => { await deleteItem(item.id!); e.kind = 'undone'; e.text = 'Annulé'; },
  };
  return e;
}

export function viewAdd(root: HTMLElement) {
  let meta = stickyMeta();
  const ed = metaEditor(meta, { onChange: m => { meta = m; saveSticky(m); } });
  const logBox = h('div', { class: 'log' });
  const status = h('div', { class: 'muted' });

  const drawLog = () => {
    logBox.replaceChildren(...log.slice(0, 60).map(e => {
      const row = h('div', { class: `cand log-${e.kind}` },
        h('img', { src: url(e.thumb), alt: '', onclick: () => e.itemId && e.kind !== 'undone' && openDetail(e.itemId) }),
        h('div', { class: 'grow' }, h('b', {}, e.text),
          h('div', { class: 'row tight' },
            e.split && e.kind === 'merged' && h('button', { class: 'btn small', onclick: async () => { await e.split!(); drawLog(); } }, 'C’est un autre objet'),
            e.undo && e.kind !== 'undone' && h('button', { class: 'btn small ghost', onclick: async () => { await e.undo!(); drawLog(); } }, 'Annuler'))));
      return row;
    }));
    if (log.length) logBox.prepend(h('div', { class: 'label' }, `Cette séance : ${log.filter(e => e.kind !== 'undone' && e.kind !== 'error').length} photo(s)`));
  };

  const record = (e: LogEntry) => { log.unshift(e); drawLog(); };

  const frameFor = (): FrameShape => (ls.get(`dv-frame-${meta.category}`, '') as FrameShape) || catFrame(meta.category);

  const burst = () => openCamera({
    title: 'Rafale',
    subtitle: `${catIcon(meta.category)} ${meta.category}${meta.characters.length ? ` · ${meta.characters.join(', ')}` : ''}`,
    frame: frameFor(),
    burst: true,
    onFrameChange: f => ls.set(`dv-frame-${meta.category}`, f),
    onShot: async (blob): Promise<ShotResult> => {
      const e = await addOne(blob, meta);
      record(e);
      if (e.kind === 'merged') buzz([40, 40, 40]);
      return {
        kind: e.kind === 'undone' ? 'ok' : e.kind,
        label: e.text,
        undo: e.undo && (async () => { await e.undo!(); drawLog(); }),
      };
    },
  });

  const importGallery = async () => {
    const files = await pickFiles(true);
    let i = 0;
    for (const f of files) {
      status.textContent = `Analyse ${++i}/${files.length}…`;
      record(await addOne(f, meta));
    }
    status.textContent = '';
    if (files.length) toast(`${files.length} photo(s) traitée(s) ✓`);
  };

  drawLog();
  root.append(
    h('h1', {}, 'Ajouter mes goodies'),
    h('p', { class: 'muted' }, 'Choisis une fois la catégorie et le personnage, puis enchaîne les photos. Si un objet est déjà dans ta collection, l’app compte juste un exemplaire de plus.'),
    ed.el,
    h('div', { class: 'actionbar' },
      h('button', { class: 'btn primary xl grow', onclick: burst }, '📷 Mode rafale'),
      h('button', { class: 'btn xl', 'aria-label': 'Importer depuis la galerie', onclick: importGallery }, '🖼️')),
    h('p', { class: 'muted center' }, '🖼️ importe plusieurs photos de ta galerie d’un coup.'),
    h('details', { class: 'tips' }, h('summary', {}, '💡 Conseils pour des photos bien reconnues'),
      h('ul', {},
        h('li', {}, 'Fond uni (une table, un drap), objet bien dans le cadre.'),
        h('li', {}, 'Acryliques et cartes holo : incline un peu pour éviter les reflets.'),
        h('li', {}, 'Objet imprimé des deux côtés : ajoute le verso depuis sa fiche.'),
        h('li', {}, 'Pas besoin de sortir l’objet de sa pochette : l’IA s’en sort très bien.'))),
    status,
    logBox,
  );
}
