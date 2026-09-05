// =============================================================================
// studio-shell.mjs — the Studio's shared chrome. One source of truth for the
// ROWBLAA brand lockup + the cross-page nav + each page's title/blurb, mirroring
// how landing.js builds the public header in JS. Each editor replaces its static
// <header> with an empty <header id="studio-head"> placeholder and mounts this
// synchronously at the top of boot() (before the awaits) so the chrome paints
// early. Adding a Studio route is now a one-array edit here.
// =============================================================================
import { el } from './ui.mjs';

const NAV = [
  { href: './', label: 'Configurator' },
  { href: 'data-editor.html', label: 'Data model', key: 'data' },
  { href: 'presentation-editor.html', label: 'Presentation', key: 'pres' },
  { href: 'editor.html', label: 'JSON', key: 'json' },
];

export function mountStudioShell(host, { active, title, blurb } = {}) {
  if (!host) return;
  host.innerHTML = '';

  // brand lockup — the same ROWBLAA mark the public pages carry, linking home
  const brand = el('a', 'studio-brand', {
    href: 'index.html', 'aria-label': 'ROWBLAA LUXURY — collections',
    html: '<span class="studio-brand__mark"><b>ROWBLAA</b> LUXURY</span><span class="studio-brand__sub">Studio</span>',
  });

  const nav = el('nav', 'qc-nav', { 'aria-label': 'Pages' });
  for (const n of NAV) {
    const a = el('a', n.key === active ? 'is-active' : null, { href: n.href, text: n.label });
    if (n.key === active) a.setAttribute('aria-current', 'page');
    nav.appendChild(a);
  }

  const top = el('div', 'studio-top');
  top.append(brand, nav);
  host.appendChild(top);
  if (title) host.appendChild(el('h1', null, { text: title }));
  if (blurb) host.appendChild(el('p', null, { html: blurb }));
  if (title) document.title = `${title} · ROWBLAA LUXURY`;
}
