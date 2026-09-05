// =============================================================================
// landing.js — the ROWBLAA LUXURY landing. Reads the model catalogue and renders
// one card per collection (Vehicles, Art & Antiques, … tours, experiences later),
// each opening its own configurator at configure.html?m=<id>. Purely data-driven:
// adding a model to models/catalog.json adds a card here, no code change.
// =============================================================================
import { loadCatalog } from './store.mjs';
import { resolve as resolveImage } from './assets.mjs';

const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

// a neutral, domain-agnostic placeholder for a collection with no hero image yet
const placeholder = (label) => {
  const gid = 'lp' + Math.random().toString(36).slice(2, 7);
  const initials = (label || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return `<svg viewBox="0 0 400 260" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#20242c"/><stop offset="1" stop-color="#12141a"/></linearGradient></defs>
    <rect width="400" height="260" fill="url(#${gid})"/>
    <rect x="150" y="70" width="100" height="120" rx="4" fill="none" stroke="rgba(216,162,74,.5)" stroke-width="2"/>
    <text x="200" y="145" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-size="42" fill="rgba(244,239,231,.85)">${initials}</text>
  </svg>`;
};

(async function boot() {
  const root = document.getElementById('landing');
  let cat;
  try { cat = await loadCatalog(); }
  catch (e) { root.innerHTML = `<div class="sh-fatal"><p>Could not load the catalogue: ${e.message}</p></div>`; return; }

  const brand = cat.brand || { mark: 'ROWBLAA', rest: 'LUXURY' };
  const wrap = el('div', 'lp');
  const hd = el('header', 'lp-hd');
  hd.innerHTML = `<div class="brand"><b>${brand.mark}</b> ${brand.rest || ''}</div><div class="tag">Haarlem</div>`;
  const hero = el('div', 'lp-hero');
  hero.innerHTML = `<div class="lp-eyebrow">The Collections</div>
    <h1 class="lp-title">Curated luxury, configured to you.</h1>
    <p class="lp-lede">Choose a collection to begin. Each opens a private configurator — specify every detail, compare, and request your build.</p>`;
  const grid = el('div', 'lp-grid');

  for (const m of (cat.models || [])) {
    const a = el('a', 'lp-card'); a.href = `configure.html?m=${encodeURIComponent(m.id)}`;
    const media = el('div', 'lp-media');
    media.innerHTML = placeholder(m.title);            // neutral until the hero resolves
    const body = el('div', 'lp-cardbody');
    body.innerHTML = `<div class="lp-cardtitle">${m.title}</div><div class="lp-blurb">${m.blurb || ''}</div><div class="lp-enter">Enter <span aria-hidden="true">→</span></div>`;
    a.append(media, body); grid.appendChild(a);
    if (m.hero) resolveImage(m.hero).then((u) => {
      if (!u) return; const im = new Image();
      im.onload = () => { media.innerHTML = `<img src="${u}" alt="">`; }; im.src = u;
    }).catch(() => {});
  }

  const foot = el('footer', 'lp-foot');
  foot.innerHTML = `<span>Rowblaa Motors Haarlem</span><span>© Rowblaa Luxury</span>`;
  wrap.append(hd, hero, grid, foot);
  root.innerHTML = ''; root.appendChild(wrap);
})();
