// =============================================================================
// asset-picker.mjs — an image ASSET PICKER modal (Phase B).
//
// pickImage({ current }) -> Promise<ref | null>
//   Opens a focus-trapped dialog: a grid of previously-added images (thumbnails),
//   an Upload tile (file input + drag-and-drop), and a "paste a URL" field.
//   Returns the chosen reference ("asset:<id>" for stored blobs, or the URL) or
//   null if cancelled. Like the melody-kernel picker, it ONLY selects — it never
//   touches the model; the caller decides what to do with the returned ref.
//
// Pairs with assets.mjs (the IndexedDB blob store). Styling: .ap-* in qc-base.css.
// =============================================================================
import { el } from './editor-ui.mjs';
import { putImage, list, objectURL, resolve } from './assets.mjs';

export function pickImage({ current } = {}) {
  return new Promise((resolvePick) => {
    let chosen = current || null;
    const prevFocus = document.activeElement;

    const scrim = el('div', 'ap-scrim');
    const panel = el('div', 'ap-panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Choose an image'); panel.tabIndex = -1;

    const head = el('div', 'ap-head');
    const h = el('h2'); h.textContent = 'Choose an image'; head.appendChild(h);
    const x = el('button', 'ap-x'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.textContent = '✕';
    x.addEventListener('click', () => done(null)); head.appendChild(x);

    const body = el('div', 'ap-body');
    const grid = el('div', 'ap-grid');
    body.appendChild(grid);

    const urlRow = el('div', 'ap-url');
    const urlIn = el('input', 'qc-input'); urlIn.type = 'url'; urlIn.placeholder = 'or paste an image URL…'; urlIn.setAttribute('aria-label', 'Image URL');
    const urlBtn = el('button', 'ap-urlbtn'); urlBtn.type = 'button'; urlBtn.textContent = 'Use URL';
    urlBtn.addEventListener('click', () => { const v = urlIn.value.trim(); if (/^https?:\/\//.test(v)) { chosen = v; done(v); } });
    urlIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); urlBtn.click(); } });
    urlRow.append(urlIn, urlBtn);
    body.appendChild(urlRow);

    const foot = el('div', 'ap-foot');
    const hint = el('span', 'ap-hint'); hint.textContent = 'PNG/JPG/SVG · drag & drop onto the grid to upload';
    const cancel = el('button', 'ap-btn'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', () => done(null));
    const choose = el('button', 'ap-btn ap-btn--go'); choose.type = 'button'; choose.textContent = 'Choose'; choose.disabled = !chosen;
    choose.addEventListener('click', () => done(chosen));
    foot.append(hint, cancel, choose);

    const fileIn = el('input'); fileIn.type = 'file'; fileIn.accept = 'image/*'; fileIn.multiple = true; fileIn.hidden = true;
    fileIn.addEventListener('change', () => upload([...fileIn.files]));

    panel.append(head, body, foot, fileIn);
    scrim.appendChild(panel);
    document.body.appendChild(scrim);

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
      const up = el('button', 'ap-tile ap-up'); up.type = 'button';
      up.innerHTML = '<span class="ap-up__plus">+</span><span class="ap-up__t">Upload</span>';
      up.addEventListener('click', () => fileIn.click());
      grid.appendChild(up);
      const assets = await list();
      for (const a of assets) {
        const t = el('button', 'ap-tile'); t.type = 'button'; t.dataset.ref = 'asset:' + a.id;
        t.setAttribute('aria-pressed', String(chosen === 'asset:' + a.id)); t.title = a.name;
        const img = el('img'); img.loading = 'lazy'; img.alt = a.name; objectURL(a.id).then((u) => { if (u) img.src = u; });
        const cap = el('span', 'ap-tile__cap'); cap.textContent = a.name;
        t.append(img, cap);
        t.addEventListener('click', () => select(t.dataset.ref));
        t.addEventListener('dblclick', () => done(t.dataset.ref));
        grid.appendChild(t);
      }
      if (assets.length === 0) { const e = el('span', 'ap-empty'); e.textContent = 'No images yet — upload one, or paste a URL below.'; grid.appendChild(e); }
    }

    // drag & drop upload
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter', 'dragover'].forEach((ev) => panel.addEventListener(ev, (e) => { stop(e); panel.classList.add('is-drop'); }));
    ['dragleave', 'drop'].forEach((ev) => panel.addEventListener(ev, (e) => { stop(e); if (ev === 'drop') upload([...(e.dataTransfer?.files || [])]); panel.classList.remove('is-drop'); }));

    // focus trap + escape + scrim-close
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(null); return; }
      if (e.key !== 'Tab') return;
      const f = panel.querySelectorAll('button, [href], input, select, [tabindex]:not([tabindex="-1"])');
      const list2 = [...f].filter((n) => !n.disabled && n.offsetParent !== null);
      if (!list2.length) return;
      const first = list2[0], last = list2[list2.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) done(null); });
    panel.addEventListener('keydown', onKey);

    function done(ref) {
      panel.removeEventListener('keydown', onKey);
      scrim.remove();
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolvePick(ref || null);
    }

    renderGrid().then(() => panel.focus());
  });
}
