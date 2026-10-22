// Caméra intégrée : cadre de visée, lampe, zoom et mode rafale.
// La photo est recadrée sur le cadre : pas d'étagère ni d'autres produits autour.
import type { FrameShape } from './db';
import { h, buzz, pickFiles, pushLayer, toast, url } from './ui';

export interface ShotResult { kind: 'ok' | 'merged' | 'error'; label: string; undo?: () => Promise<void> }
export interface CameraOptions {
  title: string;
  subtitle?: string;
  frame: FrameShape;
  /** rafale : la caméra reste ouverte et chaque photo est traitée à la suite */
  burst: boolean;
  onShot: (blob: Blob) => Promise<ShotResult | void> | ShotResult | void;
  onFrameChange?: (f: FrameShape) => void;
  onClose?: () => void;
}

const FRAMES: { id: FrameShape; label: string }[] = [
  { id: 'portrait', label: '▯' }, { id: 'square', label: '□' }, { id: 'landscape', label: '▭' },
];

export async function openCamera(o: CameraOptions) {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1920 } },
    });
  } catch {
    // Caméra refusée ou absente : on passe par l'appareil photo du téléphone.
    toast('Caméra intégrée indisponible : ouverture de l’appareil photo.');
    const f = (await pickFiles(false, true))[0];
    if (f) await o.onShot(f);
    o.onClose?.();
    return;
  }

  const track = stream.getVideoTracks()[0];
  const caps: any = track.getCapabilities?.() ?? {};
  let frame = o.frame;
  let torch = false;
  let zoom = caps.zoom ? Math.max(caps.zoom.min ?? 1, 1) : 1;
  let shots = 0;

  const video = h('video', { autoplay: true, playsinline: true, muted: true });
  video.srcObject = stream;
  const frameEl = h('div', { class: 'cam-frame' }, h('i'), h('i'), h('i'), h('i'));
  const flash = h('div', { class: 'cam-flash' });
  const strip = h('div', { class: 'cam-strip' });
  const result = h('div', { class: 'cam-result' });
  const counter = h('span', { class: 'cam-count' });

  const frameBtns = h('div', { class: 'cam-frames' });
  const drawFrameBtns = () => frameBtns.replaceChildren(...FRAMES.map(f =>
    h('button', { class: f.id === frame ? 'on' : '', 'aria-label': `Cadre ${f.id}`, onclick: () => { frame = f.id; o.onFrameChange?.(frame); layout(); drawFrameBtns(); } }, f.label)));
  drawFrameBtns();

  const torchBtn = caps.torch ? h('button', { class: 'cam-side', 'aria-label': 'Lampe', onclick: async () => {
    torch = !torch;
    try { await track.applyConstraints({ advanced: [{ torch } as any] }); } catch { /* non pris en charge */ }
    torchBtn!.classList.toggle('on', torch);
  } }, '🔦') : null;

  const zoomSteps = caps.zoom ? [1, 2, 3].filter(z => z >= (caps.zoom.min ?? 1) && z <= (caps.zoom.max ?? 1)) : [];
  const zoomBtn = zoomSteps.length > 1 ? h('button', { class: 'cam-side', 'aria-label': 'Zoom', onclick: async () => {
    zoom = zoomSteps[(zoomSteps.indexOf(zoom) + 1) % zoomSteps.length] ?? 1;
    try { await track.applyConstraints({ advanced: [{ zoom } as any] }); } catch { /* non pris en charge */ }
    zoomBtn!.textContent = `${zoom}×`;
  } }, '1×') : null;

  let picking = false;
  const galleryBtn = h('button', { class: 'cam-side', 'aria-label': 'Galerie', onclick: async () => {
    picking = true;
    const files = await pickFiles(o.burst, false);
    picking = false;
    if (!o.burst && files[0]) { close(); await o.onShot(files[0]); return; }
    for (const f of files) await handle(f);
  } }, '🖼️');

  const shutter = h('button', { class: 'cam-shutter', 'aria-label': 'Prendre la photo', onclick: () => shoot() });
  const overlay = h('div', { class: 'camera' },
    video, frameEl, flash,
    h('div', { class: 'cam-top' },
      h('button', { class: 'cam-close', 'aria-label': 'Fermer', onclick: () => close() }, '✕'),
      h('div', { class: 'cam-title' }, h('b', {}, o.title), o.subtitle && h('small', {}, o.subtitle)),
      frameBtns),
    h('div', { class: 'cam-hint' }, 'Place l’objet dans le cadre'),
    result,
    h('div', { class: 'cam-bottom' },
      o.burst && strip,
      h('div', { class: 'cam-controls' },
        galleryBtn,
        h('div', { class: 'cam-shutter-wrap' }, shutter, o.burst && counter),
        h('div', { class: 'cam-side-col' }, zoomBtn, torchBtn))));

  // ── Géométrie du cadre ──
  let rect = { x: 0, y: 0, w: 0, h: 0 };
  function layout() {
    const W = overlay.clientWidth, H = overlay.clientHeight;
    const maxH = H * 0.5, maxW = W * 0.86;
    let w: number, hh: number;
    if (frame === 'portrait') { hh = Math.min(maxH, maxW * 1.4); w = hh / 1.4; }
    else if (frame === 'landscape') { w = maxW; hh = w / 1.45; }
    else { w = Math.min(maxW, maxH); hh = w; }
    rect = { x: (W - w) / 2, y: (H - hh) / 2 - H * 0.07, w, h: hh };
    Object.assign(frameEl.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${w}px`, height: `${hh}px` });
  }
  const onResize = () => layout();
  window.addEventListener('resize', onResize);

  /** Recadre l'image vidéo sur le cadre affiché (la vidéo est en « cover »). */
  function grab(): Promise<Blob> {
    const W = overlay.clientWidth, H = overlay.clientHeight;
    const vw = video.videoWidth, vh = video.videoHeight;
    const s = Math.max(W / vw, H / vh);
    const ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
    // Un peu de marge autour du cadre : l'objet n'est jamais pile dedans.
    const m = 0.06;
    const sx = Math.max(0, (rect.x - rect.w * m - ox) / s), sy = Math.max(0, (rect.y - rect.h * m - oy) / s);
    const sw = Math.min(vw - sx, (rect.w * (1 + 2 * m)) / s), sh = Math.min(vh - sy, (rect.h * (1 + 2 * m)) / s);
    const k = Math.min(1, 1280 / Math.max(sw, sh));
    const c = h('canvas', { width: Math.round(sw * k), height: Math.round(sh * k) });
    c.getContext('2d')!.drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('photo'))), 'image/jpeg', 0.92));
  }

  async function shoot() {
    // Appui trop rapide après l'ouverture : on attend que l'image arrive (2 s max).
    if (!video.videoWidth) {
      await new Promise(res => { video.addEventListener('loadeddata', res, { once: true }); setTimeout(res, 2000); });
      if (!video.videoWidth) { toast('La caméra démarre… réessaie.'); return; }
    }
    buzz(15);
    flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
    const blob = await grab();
    if (!o.burst) { close(); await o.onShot(blob); return; }
    await handle(blob);
  }

  async function handle(blob: Blob) {
    shots++;
    counter.textContent = String(shots);
    const th = h('div', { class: 'cam-thumb busy' }, h('img', { src: url(blob), alt: '' }));
    strip.prepend(th);
    while (strip.children.length > 12) strip.lastChild!.remove();
    const r = await o.onShot(blob);
    th.classList.remove('busy');
    if (!r) return;
    th.classList.add(r.kind);
    th.dataset.mark = r.kind === 'merged' ? '+1' : r.kind === 'error' ? '!' : '✓';
    result.replaceChildren(h('div', { class: `cam-chip ${r.kind}` }, h('span', {}, r.label),
      r.undo && h('button', { onclick: async () => { await r.undo!(); th.remove(); result.replaceChildren(); shots--; counter.textContent = String(shots || ''); } }, 'Annuler')));
  }

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    release();
    stream.getTracks().forEach(t => t.stop());
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onHidden);
    overlay.remove();
    o.onClose?.();
  }
  const release = pushLayer(() => { closed || close(); });
  // Appli en arrière-plan : on libère la caméra.
  const onHidden = () => { if (document.hidden && !picking) close(); };
  document.addEventListener('visibilitychange', onHidden);

  document.body.append(overlay);
  requestAnimationFrame(layout);
  video.addEventListener('loadedmetadata', layout);
  return { close };
}
