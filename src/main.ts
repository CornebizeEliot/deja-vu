import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { getSettings } from './db';
import { onStatus, ready } from './engine';
import { applyTheme } from './theme';
import { freeUrls, h, ls, toast } from './ui';
import { viewAdd } from './views/add';
import { viewCheck } from './views/check';
import { viewCollection } from './views/collection';
import { viewSettings } from './views/settings';

registerSW({
  immediate: true,
  onOfflineReady: () => toast('L’app fonctionne maintenant sans réseau ✓'),
});
applyTheme(getSettings().theme);
ready.catch(() => { /* affiché dans la barre d'état */ });
navigator.storage?.persist?.();

const TABS = [
  { id: 'check', label: 'Vérifier', icon: '🔍', view: viewCheck },
  { id: 'add', label: 'Ajouter', icon: '📷', view: viewAdd },
  { id: 'collection', label: 'Collection', icon: '🗂️', view: viewCollection },
  { id: 'settings', label: 'Réglages', icon: '⚙️', view: viewSettings },
] as const;

const app = document.getElementById('app')!;
const bar = h('div', { class: 'progress' }, h('i'));
const statusEl = h('div', { class: 'status' });
const main = h('main', {});
const nav = h('nav', {});
app.append(
  h('header', {}, h('div', { class: 'band' }),
    h('div', { class: 'brand' }, h('span', { class: 'logo' }, '済'), h('b', {}, 'Déjà Vu'), statusEl), bar),
  main, nav);

onStatus(s => {
  statusEl.textContent = s.state === 'ready' ? '' : s.msg;
  statusEl.className = `status ${s.state}`;
  bar.hidden = s.state === 'ready' || s.state === 'error' || s.pct == null;
  (bar.firstChild as HTMLElement).style.width = `${s.pct ?? 0}%`;
});

function go(id: string) {
  ls.set('dv-tab', id);
  freeUrls();
  main.replaceChildren();
  const tab = TABS.find(t => t.id === id) ?? TABS[0];
  tab.view(main, go);
  nav.replaceChildren(...TABS.map(t => h('button', {
    class: t.id === tab.id ? 'on' : '', 'aria-current': t.id === tab.id ? 'page' : false, onclick: () => go(t.id),
  }, h('span', { class: 'ic' }, t.icon), t.label)));
  window.scrollTo(0, 0);
}
go(ls.get('dv-tab', 'check'));

// Accès de dépannage depuis la console du navigateur.
import('./store').then(store => import('./engine').then(engine => { (window as any).__dv = { store, engine }; }));
