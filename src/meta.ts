// Formulaire « catégorie / série / personnages » réutilisé partout.
import { catIcon, charactersOf, getSettings, saveSettings } from './db';
import type { Meta } from './store';
import { chips, h } from './ui';

export function metaEditor(initial: Meta, opts: { price?: boolean; onChange?: (m: Meta) => void } = {}) {
  const S = getSettings();
  const m: Meta = { ...initial, characters: [...initial.characters] };
  if (!S.categories.includes(m.category)) m.category = S.categories[0];
  if (!S.series.some(s => s.name === m.series)) m.series = S.series[0]?.name ?? 'Autre';
  const changed = () => opts.onChange?.({ ...m, characters: [...m.characters] });

  const catBox = chips({
    options: S.categories.map(c => ({ value: c, label: `${catIcon(c)} ${c}` })),
    selected: [m.category],
    onChange: sel => { m.category = sel[0]; changed(); },
  });

  const charSlot = h('div', {});
  let showAll = false;
  const drawChars = () => {
    const S2 = getSettings();
    const list = charactersOf(S2, m.series);
    // Personnages déjà choisis mais absents de la liste (ex. ajoutés à la main) : on les garde visibles.
    const extra = m.characters.filter(c => !list.includes(c));
    // Liste repliée : les 8 premiers (favoris d'abord) + ceux déjà choisis.
    const hidden = showAll ? [] : list.slice(8).filter(c => !m.characters.includes(c));
    const shown = [...extra, ...list.filter(c => !hidden.includes(c))];
    charSlot.replaceChildren(chips({
      options: shown.map(c => ({ value: c, label: c, star: S2.favorites.includes(c) })),
      selected: m.characters,
      multi: true,
      onChange: sel => { m.characters = sel; changed(); },
      extra: h('span', { class: 'chips-tail' },
        hidden.length > 0 && h('button', { type: 'button', class: 'chip more', onclick: () => { showAll = true; drawChars(); } }, `+ ${hidden.length} persos`),
        h('button', { type: 'button', class: 'chip add', onclick: () => {
        const n = prompt('Nom du personnage ?')?.trim();
        if (!n) return;
        const S3 = getSettings();
        const ser = S3.series.find(s => s.name === m.series);
        if (ser && !ser.characters.includes(n)) { ser.characters.push(n); saveSettings(S3); }
        if (!m.characters.includes(n)) m.characters.push(n);
        drawChars(); changed();
      } }, '＋ Autre')),
    }));
  };
  drawChars();

  const serBox = chips({
    options: S.series.map(s => ({ value: s.name, label: s.name })),
    selected: [m.series],
    onChange: sel => {
      m.series = sel[0];
      const list = charactersOf(getSettings(), m.series);
      m.characters = m.characters.filter(c => list.includes(c));
      drawChars(); changed();
    },
  });

  const price = opts.price ? h('input', {
    type: 'text', inputmode: 'numeric', placeholder: 'Prix payé (facultatif)', value: m.price ?? '',
    oninput: () => { m.price = price!.value.replace(/[^\d]/g, ''); changed(); },
  }) : null;

  const el = h('div', { class: 'meta' },
    h('div', { class: 'label' }, 'Catégorie'), catBox,
    h('div', { class: 'label' }, 'Série'), serBox,
    h('div', { class: 'label' }, 'Personnage(s)'), charSlot,
    price && h('div', { class: 'label' }, 'Prix'),
    price && h('div', { class: 'yen' }, h('span', {}, '¥'), price));
  return { el, get: (): Meta => ({ ...m, characters: [...m.characters] }) };
}

/** Le dernier réglage choisi dans « Ajouter » (catégorie, série, personnages). */
export function stickyMeta(): Meta {
  const S = getSettings();
  try {
    const m = JSON.parse(localStorage.getItem('dv-add-meta') || '');
    if (m?.category) return m;
  } catch { /* rien d'enregistré */ }
  return { category: S.categories[0], series: S.series[0]?.name ?? 'Autre', characters: S.favorites.slice(0, 1) };
}
export function saveSticky(m: Meta) {
  try { localStorage.setItem('dv-add-meta', JSON.stringify({ category: m.category, series: m.series, characters: m.characters })); } catch { /* ignore */ }
}
