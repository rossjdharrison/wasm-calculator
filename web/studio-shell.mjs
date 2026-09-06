// =============================================================================
// studio-shell.mjs — the Studio's shared chrome. One source of truth for the
// ROWBLAA brand lockup + the cross-page nav + each page's title/blurb, mirroring
// how landing.js builds the public header in JS. Each editor replaces its static
// <header> with an empty <header id="studio-head"> placeholder and mounts this
// synchronously at the top of boot() (before the awaits) so the chrome paints
// early. Adding a Studio route is now a one-array edit here.
// =============================================================================
import { el } from './ui.mjs';
import { loadDomain } from './store.mjs';

// The canvas routes for a model — the SINGLE source of truth for cross-page studio
// nav, consumed by the shell here, by the Configurator's Studio menu (app.js), and by
// the Loom's own top bar (loom.mjs), so the lists can never drift. The Loom is included
// so the live canvas is reachable in one click from every other canvas. Each href is a
// static filename + the model-id variable — never a domain literal (ratchet-safe).
export const studioRoutes = (modelId) => {
  const q = modelId ? `?m=${encodeURIComponent(modelId)}` : '';
  return [
    { key: 'cfg', label: 'Configurator', href: 'configure.html' + q },
    { key: 'data', label: 'Data model', href: 'data-editor.html' + q },
    { key: 'pres', label: 'Presentation', href: 'presentation-editor.html' + q },
    { key: 'loom', label: 'Loom', href: 'loom.html' + q },
    { key: 'json', label: 'JSON', href: 'editor.html' + q },
  ];
};

export function mountStudioShell(host, { active, title, blurb, modelId } = {}) {
  if (!host) return;
  host.innerHTML = '';

  // brand lockup — links home; the mark is DOMAIN-DRIVEN (domain.brand) so a swapped
  // domain re-skins the studio too, not just the landing. Painted with a generic
  // fallback synchronously (the shell mounts before awaits), then updated when
  // domain.json resolves — no per-editor wiring needed.
  const brand = el('a', 'studio-brand', { href: 'index.html' });
  const paintBrand = (b) => {
    const mark = (b && b.mark) ? `<b>${b.mark}</b>${b.rest ? ` ${b.rest}` : ''}` : '<b>Studio</b>';
    const name = (b && [b.mark, b.rest].filter(Boolean).join(' ')) || 'Studio';
    brand.innerHTML = `<span class="studio-brand__mark">${mark}</span><span class="studio-brand__sub">Studio</span>`;
    brand.setAttribute('aria-label', `${name} — home`);
    if (title) document.title = `${title} · ${name}`;
  };
  paintBrand(null);
  loadDomain().then((d) => { if (d && d.brand) paintBrand(d.brand); }).catch(() => {});

  const nav = el('nav', 'qc-nav', { 'aria-label': 'Pages' });
  for (const n of studioRoutes(modelId)) {
    const a = el('a', n.key === active ? 'is-active' : null, { href: n.href, text: n.label });
    if (n.key === active) a.setAttribute('aria-current', 'page');
    nav.appendChild(a);
  }

  const top = el('div', 'studio-top');
  top.append(brand, nav);
  host.appendChild(top);
  if (title) host.appendChild(el('h1', null, { text: title }));
  if (blurb) host.appendChild(el('p', null, { html: blurb }));
  // document.title is set by paintBrand (domain-driven) above.
}
