// Écran « Je l'ai déjà ? » : on scanne un objet en magasin.
import { catFrame, catIcon, db, getSettings, type FrameShape } from '../db';
import { openCamera } from '../camera';
import { search, type Candidate, type Verdict } from '../engine';
import { metaEditor, stickyMeta } from '../meta';
import { createItem, learnFrom, prepare, setQty, type Prepared } from '../store';
import { ANALYZING } from '../theme';
import { buzz, chips, copies, fill, h, hanko, ls, pickFiles, spinner, toast, url } from '../ui';
import { openDetail } from './detail';

export function viewCheck(root: HTMLElement, go: (tab: string) => void) {
  const S = getSettings();
  let filter = ls.get('dv-check-cat', '');
  if (filter && !S.categories.includes(filter)) filter = '';
  const out = h('div', { class: 'result', 'aria-live': 'polite' });
  const empty = h('div', {});

  const frameFor = (): FrameShape => (ls.get(`dv-frame-${filter}`, '') as FrameShape) || (filter ? catFrame(filter) : 'square');

  const scan = () => openCamera({
    title: 'Je l’ai déjà ?',
    subtitle: filter ? `${catIcon(filter)} ${filter}` : 'Toutes catégories',
    frame: frameFor(),
    burst: false,
    onFrameChange: f => ls.set(`dv-frame-${filter}`, f),
    onShot: blob => { void analyze(blob); },
  });

  async function analyze(blob: Blob) {
    let i = 0;
    const sp = spinner(ANALYZING[0]);
    const timer = setInterval(() => { sp.lastChild!.textContent = ANALYZING[++i % ANALYZING.length]; }, 1600);
    fill(out, h('div', { class: 'card' }, h('img', { class: 'shot', src: url(blob), alt: '' }), sp));
    // Le résultat prend tout l'écran : en magasin, on veut la réponse sans faire défiler.
    home.hidden = true;
    window.scrollTo(0, 0);
    try {
      const p = await prepare(blob);
      const v = await search(p.f, filter || null);
      clearInterval(timer);
      renderVerdict(v, p);
    } catch (e: any) {
      clearInterval(timer);
      fill(out, h('div', { class: 'card bad' }, `Oups : ${e.message || e}`), againBtn());
    }
  }

  const againBtn = () => h('div', { class: 'again' },
    h('button', { class: 'btn primary block xl', onclick: scan }, '📷 Scanner un autre objet'),
    h('button', { class: 'linkbtn', onclick: () => { out.replaceChildren(); home.hidden = false; window.scrollTo(0, 0); } },
      filter ? `Changer de catégorie (${filter})` : 'Choisir une catégorie'));

  function compare(p: Prepared, c: Candidate) {
    return h('div', { class: 'compare' },
      h('figure', {}, h('img', { src: url(p.thumb), alt: '' }), h('figcaption', {}, 'Ta photo')),
      h('figure', { onclick: () => openDetail(c.item.id!) }, h('img', { src: url(c.item.thumb), alt: '' }),
        h('figcaption', {}, 'Ta collection')));
  }

  function itemLine(c: Candidate) {
    const it = c.item;
    return h('div', { class: 'muted' }, `${catIcon(it.category)} ${it.category}`,
      it.characters.length ? ` · ${it.characters.join(', ')}` : '');
  }

  function scores(v: Verdict) {
    if (!getSettings().showScores) return null;
    return h('div', { class: 'scores' }, v.all.map(c => `#${c.item.id} ${c.item.category} : ${c.inliers} pts (${c.raw} bruts, ${c.spread}/16 zones) · ${(c.cos * 100).toFixed(0)} %`).join('\n') || 'aucun candidat');
  }

  /** Bloc « je l'achète → ajouter », pré-rempli au plus juste. */
  function addBlock(p: Prepared, guess?: Candidate, label?: string) {
    const st = stickyMeta();
    const ed = metaEditor({
      category: filter || guess?.item.category || st.category,
      series: guess?.item.series || st.series,
      characters: guess?.item.characters ?? st.characters,
      price: '',
    }, { price: true });
    return h('details', { class: 'card add-block', open: !guess },
      h('summary', {}, label ?? (guess ? 'Non, c’est un nouvel objet → l’ajouter' : '🛍️ Je l’achète → l’ajouter à ma collection')),
      ed.el,
      h('button', { class: 'btn primary block', onclick: async (e: Event) => {
        (e.currentTarget as HTMLButtonElement).disabled = true;
        const item = await createItem(p, ed.get());
        buzz(30);
        toast('Ajouté à ta collection ✓', { label: 'Voir', run: () => openDetail(item.id!) });
        fill(out, h('div', { class: 'card good' }, hanko('新', 'new'),
          h('div', { class: 'big-title' }, 'Bienvenue dans ta collection !'), itemLine({ item, cos: 1, inliers: 0 })), againBtn());
      } }, 'Ajouter à ma collection'));
  }

  function renderVerdict(v: Verdict, p: Prepared) {
    if (v.kind === 'same') {
      buzz([80, 60, 80]);
      const top = v.best[0];
      const qtyEl = h('div', { class: 'big-qty' });
      const showQty = () => { qtyEl.textContent = (top.item.qty || 1) > 1 ? `Tu en as ${copies(top.item.qty)}` : 'Tu l’as en 1 exemplaire'; };
      showQty();
      fill(out, 
        h('div', { class: 'card verdict good' }, hanko('済', 'good'),
          h('div', { class: 'big-title' }, 'Tu l’as déjà !'), qtyEl, itemLine(top)),
        compare(p, top),
        v.best.length > 1 && h('div', { class: 'card' }, h('b', {}, 'Tu as aussi cette illustration en :'),
          ...v.best.slice(1).map(c => h('div', { class: 'cand', onclick: () => openDetail(c.item.id!) },
            h('img', { src: url(c.item.thumb), alt: '' }),
            h('div', {}, h('b', {}, `${catIcon(c.item.category)} ${c.item.category}`), h('div', { class: 'qty' }, `×${c.item.qty || 1}`))))),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: async () => {
            const before = top.item.qty || 1;
            await setQty(top.item.id!, before + 1);
            await learnFrom(top.item.id!, p, top.inliers);
            top.item.qty = before + 1; showQty();
            toast(`Un de plus : ${copies(before + 1)} ✓`, { label: 'Annuler', run: async () => { await setQty(top.item.id!, before); top.item.qty = before; showQty(); } });
          } }, '➕ Je le rachète'),
          h('button', { class: 'btn', onclick: () => openDetail(top.item.id!) }, 'Voir la fiche')),
        againBtn(),
        addBlock(p, top, 'Ce n’est pas le même ? → l’ajouter séparément'),
        scores(v));
      return;
    }

    if (v.kind === 'similar') {
      buzz([40, 60, 40]);
      fill(out, 
        h('div', { class: 'card verdict warn' }, hanko('似', 'warn'),
          h('div', { class: 'big-title' }, 'Ça ressemble à…'),
          h('div', { class: 'muted' }, 'Pas exactement pareil d’après l’IA. Compare bien les détails :')),
        ...v.best.map(c => {
          const box = h('div', { class: 'card sim' });
          box.append(compare(p, c), itemLine(c), h('div', { class: 'qty' }, `Tu en as ×${c.item.qty || 1}`),
            h('button', { class: 'btn block', onclick: async () => {
              // Elle confirme : c'est le même. L'app retient cette photo pour la prochaine fois.
              await learnFrom(c.item.id!, p, 0);
              buzz([80, 60, 80]);
              fill(out, 
                h('div', { class: 'card verdict good' }, hanko('済', 'good'),
                  h('div', { class: 'big-title' }, 'Tu l’as déjà !'),
                  h('div', { class: 'big-qty' }, `Tu en as ${copies(c.item.qty || 1)}`),
                  h('div', { class: 'muted' }, 'Merci ! Je le reconnaîtrai mieux la prochaine fois.')),
                compare(p, c),
                h('div', { class: 'row' }, h('button', { class: 'btn', onclick: async (e: Event) => {
                  await setQty(c.item.id!, (c.item.qty || 1) + 1);
                  (e.currentTarget as HTMLButtonElement).disabled = true;
                  toast(`Un de plus : ${copies((c.item.qty || 1) + 1)} ✓`);
                } }, '➕ Je le rachète')),
                againBtn());
            } }, '✓ C’est celui-là, je l’ai'));
          return box;
        }),
        addBlock(p, v.best[0]),
        againBtn(),
        scores(v));
      return;
    }

    buzz(40);
    fill(out, 
      h('div', { class: 'card verdict new' }, hanko('新', 'new'),
        h('div', { class: 'big-title' }, 'Pas dans ta collection'),
        h('div', { class: 'muted' }, v.searched
          ? `Comparé à ${v.searched} objet${v.searched > 1 ? 's' : ''}${filter ? ` (${filter})` : ''}.`
          : filter ? `Tu n’as encore rien dans « ${filter} ».` : 'Ta collection est encore vide.')),
      h('img', { class: 'shot big', src: url(p.thumb), alt: '' }),
      addBlock(p),
      againBtn(),
      scores(v));
  }

  db.items.count().then(n => {
    if (n) return;
    empty.replaceChildren(h('div', { class: 'card hint' },
      h('b', {}, 'Commence par ta collection'),
      h('p', { class: 'muted' }, 'Pour savoir si tu as déjà un objet, l’app doit d’abord connaître ce que tu possèdes. Prends tes goodies en photo dans « Ajouter » : le mode rafale va très vite.'),
      h('button', { class: 'btn primary', onclick: () => go('add') }, 'Ajouter mes goodies')));
  });

  const home = h('div', {},
    h('h1', {}, 'Je l’ai déjà ?'),
    empty,
    h('div', { class: 'label' }, 'Catégorie (plus rapide et plus précis)'),
    chips({
      options: [{ value: '', label: 'Tout' }, ...S.categories.map(c => ({ value: c, label: `${catIcon(c)} ${c}` }))],
      selected: [filter],
      onChange: sel => { filter = sel[0]; ls.set('dv-check-cat', filter); },
    }),
    h('button', { class: 'scan', onclick: scan, 'aria-label': 'Scanner un objet' },
      h('span', { class: 'scan-ring' }), h('span', { class: 'scan-ic' }, '📷'), h('span', { class: 'scan-txt' }, 'Scanner')),
    h('button', { class: 'linkbtn', onclick: async () => { const f = (await pickFiles(false))[0]; if (f) void analyze(f); } }, 'ou choisir une photo de la galerie'));
  root.append(home, out);
}
