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

// ---- atoms: small line icons (currentColor stroke) ----
export const ICONS = {
  save: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v16l-5-3.5L7 20V4z"/></svg>',
  bag: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7h12l-1 13H7L6 7z"/><path d="M9 7V5.5a3 3 0 0 1 6 0V7"/></svg>',
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

// ---- molecule: coverflow carousel (a single-row "deck") ----
// A domain-agnostic single-select carousel: the current item sits centred and
// "face-up", neighbours fan away in 3D, and it loops when there are enough items
// to hide the wrap off-stage (>=7; fewer clamp at the ends). Handles nav arrows,
// Arrow/Home/End keys, roving tabindex and radiogroup a11y. The caller supplies
// the card content (renderCard) and reacts to selection (onSelect); update()
// repositions to the current id. Requires the .deck/.deck-track/.deck-card/
// .deck-nav CSS to be present. Returns { deck, update, cardEl }.
export function mountCarousel(host, { items, getCurrent, onSelect, renderCard, refreshCard, label = 'Choose', prevLabel = 'Previous', nextLabel = 'Next' }) {
  const deck = el('div', 'deck');
  const track = el('div', 'deck-track', { role: 'radiogroup', 'aria-label': label });
  const navPrev = el('button', 'deck-nav prev', { type: 'button', 'aria-label': prevLabel, html: '<span aria-hidden="true">‹</span>' });
  const navNext = el('button', 'deck-nav next', { type: 'button', 'aria-label': nextLabel, html: '<span aria-hidden="true">›</span>' });
  const cards = {};
  const idx = () => Math.max(0, items.findIndex((o) => o.id === getCurrent()));
  const select = (id) => { onSelect(id); const c = cards[id]; if (c) c.focus({ preventScroll: true }); };
  const step = (dir) => { const n = items.length, i = idx(); const j = n >= 7 ? ((i + dir) % n + n) % n : Math.max(0, Math.min(n - 1, i + dir)); select(items[j].id); };
  navPrev.addEventListener('click', () => step(-1));
  navNext.addEventListener('click', () => step(1));
  track.addEventListener('keydown', (e) => {
    const k = e.key, n = items.length;
    if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (k === 'Home') { e.preventDefault(); select(items[0].id); }
    else if (k === 'End') { e.preventDefault(); select(items[n - 1].id); }
  });
  for (const o of items) {
    const b = el('button', 'deck-card', { type: 'button', role: 'radio' });
    b.dataset.id = o.id;
    b.innerHTML = renderCard(o);
    b.addEventListener('click', () => select(o.id));
    track.appendChild(b); cards[o.id] = b;
  }
  deck.append(track, navPrev, navNext);
  host.appendChild(deck);

  function update() {
    const n = items.length, centerIdx = idx();
    items.forEach((o, i) => {
      const card = cards[o.id]; if (!card) return;
      if (refreshCard) refreshCard(o, card);
      let off = ((i - centerIdx) % n + n) % n; if (off > n / 2) off -= n;
      const a = Math.abs(off), dir = Math.sign(off), hidden = a >= 3;
      card.classList.toggle('is-center', off === 0);
      card.style.opacity = hidden ? '0' : a === 2 ? '.46' : a === 1 ? '.9' : '1';
      card.style.pointerEvents = hidden ? 'none' : 'auto';     // hidden cards stay in the a11y tree
      card.setAttribute('aria-checked', String(off === 0));
      card.tabIndex = off === 0 ? 0 : -1;                       // roving tabindex
      card.style.zIndex = String(40 - a * 8);
      card.style.transitionProperty = a >= 4 ? 'opacity' : 'transform, opacity';  // antipode snaps (no streak)
      const x = off === 0 ? 0 : dir * (128 + (a - 1) * 82);
      const rot = off === 0 ? 0 : -dir * Math.min(46, 30 + (a - 1) * 8);
      const sc = off === 0 ? 1 : a === 1 ? 0.84 : a === 2 ? 0.66 : 0.56;
      const lift = off === 0 ? -6 : 0;
      card.style.transform = `translate(-50%, calc(-50% + ${lift}px)) translateX(${x}px) rotateY(${rot}deg) scale(${sc})`;
    });
  }
  return { deck, update, cardEl: (id) => cards[id] };
}

// ---- organism: itemised summary (line items + total + CTA) ----
// Renders an itemised money summary into a modal (or any host). Domain-agnostic:
// the caller passes normalised lines; the organism handles formatting + styling.
//   lines: [{ label, amount, kind }]  kind ∈ 'base'|'add'|'save'|'fee' (default 'add')
//   base is shown unsigned; add/save/fee show a signed ±. cta: { label, onClick(btn) }.
// Reused by the per-item build summary and the cross-collection basket.
export function renderSummary(host, { mark, title, lines, totalLabel, total, currency = 'GBP', cta, onClose, focus = true }) {
  host.innerHTML = '';
  const hd = el('div', 'bd-hd', { html: `<div class="bd-title">${mark ? `<span class="bd-eyebrow">${mark}</span>` : ''}${title || ''}</div>` });
  if (onClose) hd.appendChild(el('button', 'bd-x', { type: 'button', text: '✕', 'aria-label': 'Close', on: { click: () => onClose() } }));
  host.appendChild(hd);
  const body = el('div', 'bd-body');
  for (const ln of lines) {
    const cls = 'bd-row' + (ln.kind === 'base' ? ' bd-base' : ln.kind === 'save' ? ' bd-save' : ln.kind === 'fee' ? ' bd-fees' : '');
    const amt = ln.kind === 'base' ? money(ln.amount, currency) : (ln.amount < 0 ? '−' : '+') + money(Math.abs(ln.amount), currency);
    body.appendChild(el('div', cls, { html: `<span class="bd-l">${ln.label}</span><span class="bd-a num">${amt}</span>` }));
  }
  host.appendChild(body);
  const foot = el('div', 'bd-foot');
  foot.appendChild(el('div', 'bd-total', { html: `<span>${totalLabel || 'Total'}</span><span class="num">${money(total, currency)}</span>` }));
  if (cta) { const b = el('button', 'bd-cta', { type: 'button', text: cta.label }); b.addEventListener('click', () => cta.onClick(b)); foot.appendChild(b); }
  host.appendChild(foot);
  if (focus && host.focus) host.focus();
  return { body, foot };
}
