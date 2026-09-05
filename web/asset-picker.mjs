// =============================================================================
// asset-picker.mjs — an image ASSET PICKER modal (Phase B).
//
// pickImage({ current }) -> Promise<ref | null>
//   Opens a dialog: a grid of previously-added images (thumbnails), an Upload
//   tile (file input + drag-and-drop), and a "paste a URL" field. Returns the
//   chosen reference ("asset:<id>" for stored blobs, or the URL) or null if
//   cancelled. It ONLY selects — it never touches the model; the caller decides
//   what to do with the returned ref.
//
// The dialog shell (overlay, background inert, Escape, backdrop-close, focus
// restore) is the shared ui.mjs openModal molecule — the same one the public
// pages use — so the Studio no longer hand-rolls a second modal. Pairs with
// assets.mjs (the IndexedDB blob store). Styling: .ap-* in qc-base.css.
// =============================================================================
import { el, openModal } from './ui.mjs';
import { putImage, list, objectURL } from './assets.mjs';

export function pickImage({ current } = {}) {
  return new Promise((resolvePick) => {
    let chosen = current || null;
    let settled = false;
    const finish = (ref) => { if (settled) return; settled = true; resolvePick(ref || null); };

    // Shared modal shell: it owns the overlay, background inert, Escape,
    // backdrop-close and focus restore. onClose fires on every close path
    // (Escape / backdrop / our own close), resolving null unless a pick already
    // settled the promise.
    const m = openModal({
      root: document.body, inert: document.querySelector('.qc-app'),
      overlayClass: 'ap-scrim', modalClass: 'ap-panel', label: 'Choose an image',
      onClose: () => finish(null),
    });
    const panel = m.modal;
    const done = (ref) => { finish(ref); m.close(); };

    const head = el('div', 'ap-head');
    head.appendChild(el('h2', null, { text: 'Choose an image' }));
    head.appendChild(el('button', 'ap-x', { type: 'button', 'aria-label': 'Close', text: '✕', on: { click: () => done(null) } }));

    const body = el('div', 'ap-body');
    const grid = el('div', 'ap-grid');
    body.appendChild(grid);

    const urlRow = el('div', 'ap-url');
    const urlIn = el('input', 'qc-input', { type: 'url', placeholder: 'or paste an image URL…', 'aria-label': 'Image URL' });
    const urlBtn = el('button', 'ap-urlbtn', { type: 'button', text: 'Use URL' });
    urlBtn.addEventListener('click', () => { const v = urlIn.value.trim(); if (/^https?:\/\//.test(v)) { chosen = v; done(v); } });
    urlIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); urlBtn.click(); } });
    urlRow.append(urlIn, urlBtn);
    body.appendChild(urlRow);

    const foot = el('div', 'ap-foot');
    const hint = el('span', 'ap-hint', { text: 'PNG/JPG/SVG · drag & drop onto the grid to upload' });
    const cancel = el('button', 'ap-btn', { type: 'button', text: 'Cancel', on: { click: () => done(null) } });
    const choose = el('button', 'ap-btn ap-btn--go', { type: 'button', text: 'Choose' }); choose.disabled = !chosen;
    choose.addEventListener('click', () => done(chosen));
    foot.append(hint, cancel, choose);

    const fileIn = el('input', null, { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    fileIn.addEventListener('change', () => upload([...fileIn.files]));

    panel.append(head, body, foot, fileIn);

    async function upload(files) {
      const imgs = files.filter((f) => f.type.startsWith('image/'));
      if (!imgs.length) return;
      let lastId = null;
      for (const f of imgs) { try { lastId = await putImage(f); } catch (e) { alert(e.message); } }
      await renderGrid();
      if (lastId) select('asset:' + lastId);
    }

    function select(ref) {
      chosen = ref;
      grid.querySelectorAll('.ap-tile').forEach((t) => t.setAttribute('aria-pressed', String(t.dataset.ref === ref)));
      choose.disabled = !chosen;
    }

    async function renderGrid() {
      grid.innerHTML = '';
      // upload tile first
      const up = el('button', 'ap-tile ap-up', { type: 'button', html: '<span class="ap-up__plus">+</span><span class="ap-up__t">Upload</span>', on: { click: () => fileIn.click() } });
      grid.appendChild(up);
      const assets = await list();
      for (const a of assets) {
        const t = el('button', 'ap-tile', { type: 'button', title: a.name });
        t.dataset.ref = 'asset:' + a.id;
        t.setAttribute('aria-pressed', String(chosen === 'asset:' + a.id));
        const img = el('img', null, { loading: 'lazy', alt: a.name }); objectURL(a.id).then((u) => { if (u) img.src = u; });
        t.append(img, el('span', 'ap-tile__cap', { text: a.name }));
        t.addEventListener('click', () => select(t.dataset.ref));
        t.addEventListener('dblclick', () => done(t.dataset.ref));
        grid.appendChild(t);
      }
      if (assets.length === 0) grid.appendChild(el('span', 'ap-empty', { text: 'No images yet — upload one, or paste a URL below.' }));
    }

    // drag & drop upload
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter', 'dragover'].forEach((ev) => panel.addEventListener(ev, (e) => { stop(e); panel.classList.add('is-drop'); }));
    ['dragleave', 'drop'].forEach((ev) => panel.addEventListener(ev, (e) => { stop(e); if (ev === 'drop') upload([...(e.dataTransfer?.files || [])]); panel.classList.remove('is-drop'); }));

    renderGrid().then(() => panel.focus());
  });
}
