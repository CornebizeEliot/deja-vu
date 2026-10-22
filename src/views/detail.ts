// Fiche d'un objet : photos, exemplaires, infos. Tout est enregistré au fil de l'eau.
import { catFrame, db } from '../db';
import { openCamera } from '../camera';
import { metaEditor } from '../meta';
import { addRef, deleteItem, deleteRef, prepare, refsOf, setQty, updateItem } from '../store';
import { copies, fmtDate, h, sheet, toast, url } from '../ui';

export async function openDetail(id: number, onChange?: () => void) {
  const it = await db.items.get(id);
  if (!it) return;
  let dirty = false;
  const changed = () => { dirty = true; };

  sheet(close => {
    const photos = h('div', { class: 'photos' });
    const drawPhotos = async () => {
      const extra = (await refsOf(id)).filter(r => !r.main && r.photo);
      photos.replaceChildren(
        h('figure', {}, h('img', { src: url(it.photo), alt: '' }), h('figcaption', {}, 'Photo principale')),
        ...extra.map(r => h('figure', {},
          h('img', { src: url(r.photo!), alt: '' }),
          h('button', { class: 'del', 'aria-label': 'Retirer cette photo', onclick: async () => {
            if (!confirm('Retirer cette photo ?')) return;
            await deleteRef(r.id!); void drawPhotos();
          } }, '✕'),
          h('figcaption', {}, 'Autre photo'))),
        h('button', { class: 'photo-add', onclick: () => openCamera({
          title: 'Autre photo', subtitle: 'Verso, autre angle…', frame: catFrame(it.category), burst: false,
          onShot: async blob => {
            toast('Ajout de la photo…');
            await addRef(id, await prepare(blob));
            toast('Photo ajoutée ✓ La reconnaissance sera plus sûre.');
            void drawPhotos();
          },
        }) }, h('span', {}, '＋'), h('small', {}, 'Verso ou autre angle')));
    };
    void drawPhotos();

    // ── Exemplaires ──
    const qv = h('span', { class: 'qv' }, String(it.qty || 1));
    const qLabel = h('span', {}, copies(it.qty || 1));
    const step = async (d: number) => {
      it.qty = Math.max(1, (it.qty || 1) + d);
      qv.textContent = String(it.qty); qLabel.textContent = copies(it.qty);
      await setQty(id, it.qty); changed();
    };

    // ── Infos ──
    const ed = metaEditor({ category: it.category, series: it.series, characters: it.characters, price: it.price }, {
      price: true,
      onChange: async m => { Object.assign(it, m); await updateItem(id, { category: m.category, series: m.series, characters: m.characters, price: m.price ?? '' }); changed(); },
    });
    let t: number | undefined;
    const text = (key: 'shop' | 'note', placeholder: string) => {
      const i = h('input', { type: 'text', value: it[key] ?? '', placeholder, oninput: () => {
        clearTimeout(t);
        t = window.setTimeout(async () => { await updateItem(id, { [key]: i.value }); changed(); }, 400);
      } });
      return i;
    };

    return [
      photos,
      h('div', { class: 'qtyrow' },
        h('div', {}, h('b', {}, 'Exemplaires'), h('div', { class: 'muted' }, qLabel)),
        h('button', { class: 'round', 'aria-label': 'Un de moins', onclick: () => step(-1) }, '−'),
        qv,
        h('button', { class: 'round', 'aria-label': 'Un de plus', onclick: () => step(1) }, '+')),
      ed.el,
      h('div', { class: 'label' }, 'Magasin'), text('shop', 'Book Off Akihabara, Animate…'),
      h('div', { class: 'label' }, 'Note'), text('note', 'Édition limitée, cadeau…'),
      h('p', { class: 'muted' }, `Ajouté le ${fmtDate(it.createdAt)}`),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary grow', onclick: close }, 'Fermer'),
        h('button', { class: 'btn danger', onclick: async () => {
          if (!confirm('Supprimer cet objet de ta collection ?')) return;
          await deleteItem(id); changed(); close(); toast('Objet supprimé');
        } }, 'Supprimer')),
    ];
  }, () => { if (dirty) onChange?.(); });
}
