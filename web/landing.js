// =============================================================================
// landing.js — the ROWBLAA LUXURY landing. Reads the model catalogue and renders
// one card per collection (Vehicles, Art & Antiques, … tours, experiences later),
// each opening its own configurator at configure.html?m=<id>. Purely data-driven:
// adding a model to models/catalog.json adds a card here, no code change.
// =============================================================================
import { loadCatalog } from './store.mjs';
import { resolve as resolveImage } from './assets.mjs';
import { el, placeholderSVG } from './ui.mjs';
import { count as basketCount, onChange as basketOnChange, openBasketModal } from './basket.mjs';

(async function boot() {
  const root = document.getElementById('landing');
  let cat;
  try { cat = await loadCatalog(); }
  catch (e) { root.innerHTML = `<div class="sh-fatal"><p>Could not load the catalogue: ${e.message}</p></div>`; return; }

  const brand = cat.brand || { mark: 'ROWBLAA', rest: 'LUXURY' };
  const wrap = el('div', 'lp');
  const hd = el('header', 'lp-hd');
  const brandEl = el('div', 'brand', { html: `<b>${brand.mark}</b> ${brand.rest || ''}` });
  const right = el('div', 'lp-hd-right');
  const basketBtn = el('button', 'basket-btn', { type: 'button', 'aria-haspopup': 'dialog' });
  const syncBasket = () => { const n = basketCount(); basketBtn.innerHTML = `<span aria-hidden="true">◈</span> Basket${n ? `<span class="basket-count">${n}</span>` : ''}`; basketBtn.setAttribute('aria-label', `Basket, ${n} item${n === 1 ? '' : 's'}`); };
  syncBasket(); basketOnChange(syncBasket);
  basketBtn.addEventListener('click', () => openBasketModal(document.body, { resolveImage, inert: root }));
  right.append(basketBtn, el('div', 'tag', { text: 'Haarlem' }));
  hd.append(brandEl, right);
  const hero = el('div', 'lp-hero');
  hero.innerHTML = `<div class="lp-eyebrow">The Collections</div>
    <h1 class="lp-title">Curated luxury, configured to you.</h1>
    <p class="lp-lede">Choose a collection to begin. Each opens a private configurator — specify every detail, compare, and request your build.</p>`;
  const grid = el('div', 'lp-grid');

  for (const m of (cat.models || [])) {
    const a = el('a', 'lp-card'); a.href = `configure.html?m=${encodeURIComponent(m.id)}`;
    const media = el('div', 'lp-media');
    media.innerHTML = placeholderSVG(m.title);          // neutral until the hero resolves
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
