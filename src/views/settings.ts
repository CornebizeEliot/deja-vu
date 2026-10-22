// Écran « Réglages » : thème, sauvegarde, listes, réglages fins de l'IA.
import { getSettings, saveSettings } from '../db';
import { exportBlob, importBlob } from '../store';
import { applyTheme, THEMES } from '../theme';
import { chips, fmtDate, h, pickFiles, toast } from '../ui';

/** Sauvegarde : partage direct (Google Drive…) si possible, sinon téléchargement. */
export async function backupNow() {
  toast('Préparation de la sauvegarde…');
  const blob = await exportBlob();
  const name = `deja-vu-${new Date().toISOString().slice(0, 10)}.dejavu`;
  const file = new File([blob], name, { type: 'application/octet-stream' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Sauvegarde Déjà Vu' });
      return;
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') return;
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  toast('Sauvegarde téléchargée ✓ Mets-la sur Google Drive.');
}

export function viewSettings(root: HTMLElement, go: (tab: string) => void) {
  const S = getSettings();

  // ── Thème ──
  const themes = h('div', { class: 'themes' });
  const drawThemes = () => themes.replaceChildren(...THEMES.map(t => h('button', {
    class: 'theme' + (S.theme === t.id ? ' on' : ''),
    style: { '--sw-bg': t.bg, '--sw-primary': t.primary, '--sw-pattern': t.pattern } as any,
    onclick: () => { S.theme = t.id; saveSettings(S); applyTheme(t.id); drawThemes(); },
  }, h('span', { class: 'sw' }), h('b', {}, t.name), h('small', {}, t.sub))));
  drawThemes();

  // ── Favoris ──
  const allChars = [...new Set(S.series.flatMap(s => s.characters))];
  const favs = chips({
    options: allChars.map(c => ({ value: c, label: c, star: S.favorites.includes(c) })),
    selected: S.favorites, multi: true,
    onChange: sel => { S.favorites = sel; saveSettings(S); },
  });

  // ── Listes ──
  const cats = h('textarea', { rows: 6 }, S.categories.join('\n'));
  const seriesBox = h('div', {});
  const drawSeries = () => seriesBox.replaceChildren(...S.series.map((s, i) => h('div', { class: 'series-edit' },
    h('input', { type: 'text', value: s.name, 'data-i': i, class: 'ser-name' }),
    h('textarea', { rows: 4, 'data-i': i, class: 'ser-chars' }, s.characters.join('\n')))));
  drawSeries();
  const saveLists = () => {
    S.categories = cats.value.split('\n').map(x => x.trim()).filter(Boolean);
    const names = [...seriesBox.querySelectorAll<HTMLInputElement>('.ser-name')].map(x => x.value.trim());
    const chars = [...seriesBox.querySelectorAll<HTMLTextAreaElement>('.ser-chars')].map(x => x.value.split('\n').map(c => c.trim()).filter(Boolean));
    S.series = names.map((name, i) => ({ name, characters: chars[i] })).filter(s => s.name);
    if (!S.categories.length || !S.series.length) { toast('Il faut au moins une catégorie et une série.'); return; }
    saveSettings(S); toast('Listes enregistrées ✓');
  };

  // ── IA ──
  const num = (label: string, key: 'tSame' | 'tNear' | 'tCos', step: number, help: string) => {
    const i = h('input', { type: 'number', step, value: S[key], inputmode: 'decimal', onchange: () => { S[key] = Number(i.value); saveSettings(S); } });
    return h('label', { class: 'field' }, h('span', {}, label), i, h('small', { class: 'muted' }, help));
  };
  const scores = h('input', { type: 'checkbox', checked: S.showScores, onchange: () => { S.showScores = scores.checked; saveSettings(S); } });

  const storage = h('p', { class: 'muted' });
  navigator.storage?.estimate?.().then(async e => {
    const persisted = await navigator.storage.persisted?.();
    storage.textContent = `Espace utilisé : ${((e.usage || 0) / 1048576).toFixed(0)} Mo${persisted ? ' · protégé ✓' : ' · installe l’app sur l’écran d’accueil pour protéger ta collection'}`;
  });

  root.append(
    h('h1', {}, 'Réglages'),

    h('h2', {}, 'Thème'),
    themes,

    h('h2', {}, 'Sauvegarde'),
    h('p', { class: 'muted' }, 'Ta collection vit seulement dans ce téléphone. Fais une sauvegarde de temps en temps et range-la sur Google Drive.'),
    h('p', { class: 'muted' }, S.lastExport ? `Dernière sauvegarde : ${fmtDate(S.lastExport)}` : 'Aucune sauvegarde pour l’instant.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: backupNow }, '💾 Sauvegarder'),
      h('button', { class: 'btn', onclick: async () => {
        const f = (await pickFiles(false))[0];
        if (!f || !confirm('Remplacer toute la collection actuelle par cette sauvegarde ?')) return;
        try { toast(`${await importBlob(f)} objet(s) restauré(s) ✓`); go('collection'); }
        catch (e: any) { toast(e.message || 'Fichier illisible'); }
      } }, '📥 Restaurer')),
    storage,

    h('h2', {}, 'Persos favoris'),
    h('p', { class: 'muted' }, 'Affichés en premier partout et comptés dans ta collection.'),
    favs,

    h('details', { class: 'card' }, h('summary', {}, 'Catégories, séries et personnages'),
      h('div', { class: 'label' }, 'Catégories (une par ligne)'), cats,
      h('div', { class: 'label' }, 'Séries et leurs personnages (un par ligne)'), seriesBox,
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => { S.series.push({ name: 'Nouvelle série', characters: [] }); drawSeries(); } }, '＋ Série'),
        h('button', { class: 'btn primary', onclick: saveLists }, 'Enregistrer'))),

    h('details', { class: 'card' }, h('summary', {}, 'Réglages fins de l’IA'),
      h('p', { class: 'muted' }, 'Active les scores, scanne des objets que tu as et que tu n’as pas, puis ajuste.'),
      h('label', { class: 'field inline' }, scores, h('span', {}, 'Afficher les scores après un scan')),
      num('« Identique » à partir de', 'tSame', 1, 'Détails communs. Baisse si l’app rate des objets que tu as ; monte si elle dit « identique » à tort.'),
      num('« Ressemble » à partir de', 'tNear', 1, 'Détails communs pour proposer « ça ressemble ».'),
      num('Ressemblance globale', 'tCos', 0.01, 'Entre 0 et 1. Plus bas = plus de propositions.'),
      h('button', { class: 'btn', onclick: () => { Object.assign(S, { tSame: 30, tNear: 14, tCos: 0.72 }); saveSettings(S); go('settings'); toast('Réglages de l’IA par défaut ✓'); } }, 'Valeurs par défaut')),

    h('p', { class: 'about' }, 'Déjà Vu · fait avec ♥ pour Elif', h('br'), '全集中・常中'),
  );
}
