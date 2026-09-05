// =============================================================================
// ui.mjs — shared, framework-free UI primitives for the public pages
// (showroom-view.mjs, landing.js). Small, composable, domain-agnostic.
//
//   atoms      el(), placeholderSVG(), money()
//   molecule   openModal()  — an accessible dialog shell (overlay + inert
//              background + Escape + backdrop-close + focus-in/restore) that
//              callers fill (and may re-fill in place, e.g. the compare picker).
// =============================================================================

// ---- atom: element factory ----
// el('div', 'cls', { text, html, on:{click:fn}, aria-label:'…', … })
export const el = (tag, cls, props) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (props) for (const k in props) {
    const v = props[k];
    if (v == null) continue;
    if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'on') for (const ev in v) e.addEventListener(ev, v[ev]);
    else if (k in e && typeof e[k] !== 'object') e[k] = v;   // dom prop (type, tabIndex, disabled…)
    else e.setAttribute(k, v);
  }
  return e;
};

// ---- atom: currency formatter ----
export const money = (v, currency = 'GBP', decimals = 0) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(v);

// ---- atom: neutral placeholder (a framed monogram of a label) ----
// Domain-agnostic stand-in until a real image is attached — works for a car, a
// painting, a chandelier, anything. Returns an <svg> string.
export const placeholderSVG = (label, { w = 400, h = 250 } = {}) => {
  const initials = String(label || '').split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase() || '◆';
  const gid = 'ph' + Math.random().toString(36).slice(2, 7);
  const fx = w / 2, top = Math.round(h * 0.21), fh = Math.round(h * 0.58), fw = Math.round(fh * 0.71);
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" preserveAspectRatio="xMidYMid meet">`
    + `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#232830"/><stop offset="1" stop-color="#12141a"/></linearGradient></defs>`
    + `<rect width="${w}" height="${h}" fill="url(#${gid})"/>`
    + `<rect x="${fx - fw / 2}" y="${top}" width="${fw}" height="${fh}" rx="4" fill="none" stroke="rgba(216,162,74,.45)" stroke-width="2"/>`
    + `<text x="${fx}" y="${Math.round(h * 0.57)}" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-weight="600" font-size="${Math.round(h * 0.19)}" fill="rgba(244,239,231,.9)">${initials}</text></svg>`;
};

// ---- molecule: accessible modal shell ----
// openModal({ root, inert, overlayClass, modalClass, label, onClose }) → { overlay, modal, close }
// Handles: overlay + background inert (focus/AT contained), Escape, click-outside,
// focus into the dialog, and focus restore to the opener on close. The caller
// builds the content into `modal` (and may clear+rebuild it in place).
export function openModal({ root, inert, overlayClass, modalClass, label, onClose } = {}) {
  const opener = document.activeElement;
  if (inert) try { inert.inert = true; } catch (_) { /* older browsers */ }
  const overlay = el('div', overlayClass);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const modal = el('div', modalClass, { role: 'dialog', 'aria-modal': 'true', tabIndex: -1 });
  if (label) modal.setAttribute('aria-label', label);
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  let closed = false;
  function close() {
    if (closed) return; closed = true;
    if (inert) try { inert.inert = false; } catch (_) { /* ignore */ }
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    if (opener && opener.focus) opener.focus({ preventScroll: true });
    if (onClose) onClose();
  }
  document.addEventListener('keydown', onKey);
  overlay.appendChild(modal);
  root.appendChild(overlay);
  return { overlay, modal, close };
}
