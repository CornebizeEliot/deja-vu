// Écran « Collection » : tout ce qu'elle possède, avec filtres et petites statistiques.
import { catIcon, db, getSettings, type Item } from '../db';
import { chips, copies, fill, h, ls, url } from '../ui';
import { openDetail } from './detail';
import { backupNow } from './settings';

export function viewCollection(root: HTMLElement) {
  const S = getSettings();
  let cat = ls.get('dv-col-cat', '');
  let who = ls.get('dv-col-who', '');
  let sort = ls.get('dv-col-sort', 'new');
  let q = '';
  let all: Item[] = [];

  const stats = h('div', { class: 'stats' });
  const reminder = h('div', {});
  const catSlot = h('div', {});
  const whoSel = h('select', { 'aria-label': 'Personnage', onchange: () => { who = whoSel.value; ls.set('dv-col-who', who); drawGrid(); } });
  const sortSel = h('select', { 'aria-label': 'Tri', onchange: () => { sort = sortSel.value; ls.set('dv-col-sort', sort); drawGrid(); } },
    ...[['new', 'Plus récents'], ['old', 'Plus anciens'], ['qty', 'Plus d’exemplaires']].map(([v, l]) => h('option', { value: v, selected: v === sort }, l)));
  const search = h('input', { type: 'search', placeholder: '🔍 Chercher (perso, magasin, note…)', oninput: () => { q = search.value.trim().toLowerCase(); drawGrid(); } });
  const grid = h('div', { class: 'grid' });
  const count = h('div', { class: 'muted' });

  async function load() {
    all = await db.items.toArray();
    const total = all.reduce((s, i) => s + (i.qty || 1), 0);
    const spent = all.reduce((s, i) => s + (parseInt(i.price, 10) || 0) * (i.qty || 1), 0);
    const favs = S.favorites.map(f => ({ f, n: all.filter(i => i.characters.includes(f)).reduce((s, i) => s + (i.qty || 1), 0) }));
    fill(stats, 
      h('div', { class: 'stat' }, h('b', {}, String(all.length)), h('span', {}, 'objets')),
      h('div', { class: 'stat' }, h('b', {}, String(total)), h('span', {}, 'exemplaires')),
      spent > 0 && h('div', { class: 'stat' }, h('b', {}, `¥${spent.toLocaleString('fr-FR')}`), h('span', {}, 'dépensés')),
      ...favs.map(({ f, n }) => h('div', { class: 'stat fav' }, h('b', {}, String(n)), h('span', {}, `★ ${f}`))));

    const days = (Date.now() - S.lastExport) / 864e5;
    reminder.replaceChildren(all.length >= 5 && days > 14 ? h('div', { class: 'card hint' },
      h('b', {}, '💾 Pense à faire une sauvegarde'),
      h('p', { class: 'muted' }, S.lastExport ? `Dernière sauvegarde il y a ${Math.floor(days)} jours.` : 'Tu n’as encore jamais sauvegardé ta collection.'),
      h('button', { class: 'btn', onclick: async () => { await backupNow(); void load(); } }, 'Sauvegarder maintenant')) : '');

    if (cat && !all.some(i => i.category === cat) && !S.categories.includes(cat)) cat = '';
    catSlot.replaceChildren(chips({
      options: [{ value: '', label: `Tout (${all.length})` },
        ...S.categories.map(c => ({ value: c, n: all.filter(i => i.category === c).length, c }))
          .filter(x => x.n > 0 || x.c === cat)
          .map(x => ({ value: x.c, label: `${catIcon(x.c)} ${x.c} (${x.n})` }))],
      selected: [cat],
      onChange: sel => { cat = sel[0]; ls.set('dv-col-cat', cat); drawGrid(); },
    }));

    const people = [...new Set(all.flatMap(i => i.characters))]
      .sort((a, b) => Number(S.favorites.includes(b)) - Number(S.favorites.includes(a)) || a.localeCompare(b));
    if (who && !people.includes(who)) who = '';
    whoSel.replaceChildren(h('option', { value: '' }, 'Tous les persos'),
      ...people.map(p => h('option', { value: p, selected: p === who }, S.favorites.includes(p) ? `★ ${p}` : p)));
    drawGrid();
  }

  function drawGrid() {
    const list = all.filter(i =>
      (!cat || i.category === cat) &&
      (!who || i.characters.includes(who)) &&
      (!q || [i.category, i.series, i.note, i.shop, ...i.characters].join(' ').toLowerCase().includes(q)));
    list.sort(sort === 'old' ? (a, b) => a.createdAt - b.createdAt
      : sort === 'qty' ? (a, b) => (b.qty || 1) - (a.qty || 1) || b.createdAt - a.createdAt
      : (a, b) => b.createdAt - a.createdAt);
    const n = list.reduce((s, i) => s + (i.qty || 1), 0);
    count.textContent = list.length === all.length ? '' : `${list.length} objet(s) · ${copies(n)}`;
    grid.replaceChildren(...list.map(i => h('button', { class: 'tile', 'aria-label': `${i.category} ${i.characters.join(' ')}`, onclick: () => openDetail(i.id!, load) },
      h('img', { src: url(i.thumb), alt: '', loading: 'lazy' }),
      (i.qty || 1) > 1 && h('span', { class: 'badge' }, `×${i.qty}`),
      i.characters.some(c => S.favorites.includes(c)) && h('span', { class: 'fav-dot' }, '★'))));
    if (!list.length) {
      grid.replaceChildren(h('div', { class: 'empty' },
        h('div', { class: 'empty-k' }, '空'),
        h('p', {}, all.length ? 'Rien ne correspond à ces filtres.' : 'Ta collection est vide pour l’instant. Va dans « Ajouter » pour photographier tes goodies.')));
    }
  }

  root.append(h('h1', {}, 'Ma collection'), stats, reminder, search, catSlot, h('div', { class: 'row tight' }, whoSel, sortSel), count, grid);
  void load();
}
