// =============================================================================
// landing.js — the site landing, driven ENTIRELY by the top-level domain model
// (web/domain.json): brand, label vocabulary, feature flags, the HQDM taxonomy,
// and the catalogue of models + journeys. Models are GROUPED by their inferred
// category (climbing the domain taxonomy via hqdm.isA — no domain words in code),
// journeys are reachable, and the Journey Studio is linked. Swap domain.json (+ its
// model dirs) and this becomes an admissions / case-file portal with no code change.
// =============================================================================
import { loadDomain, loadCatalogue, mergedModelCatalog, mergedJourneyCatalog, getLocalModelCatalog, saveDataFor, savePresFor, saveLocalModelEntry, CAT_ID } from './store.mjs';
import { resolve as resolveImage } from './assets.mjs';
import { el, placeholderSVG, ICONS } from './ui.mjs';
import { modelsUnder, childrenOf, glyphOf, pathTo, nodeOf } from './catalogue.mjs';
import { uniqueModelId, newModelData, newModelPres } from './model-create-core.mjs';
import { count as basketCount, onChange as basketOnChange, openBasketModal } from './basket.mjs';
import { count as savedCount, onChange as savedOnChange, openSavedModal } from './saved.mjs';

(async function boot() {
  const root = document.getElementById('landing');
  let cat, domain, reg;
  try { [cat, domain, reg] = await Promise.all([mergedModelCatalog(), loadDomain(), loadCatalogue()]); }
  catch (e) { root.innerHTML = `<div class="sh-fatal"><p>Could not load the catalogue: ${e.message}</p></div>`; return; }
  domain = domain || {};
  const L = (k, d) => (domain.labels && domain.labels[k]) || d;
  const brand = domain.brand || cat.brand || { mark: 'ROWBLAA', rest: '' };
  const features = domain.features || { basket: true, saved: true, studio: true, journeys: true };
  const catModels = cat.models || [];
  const modelById = Object.fromEntries(catModels.map((m) => [m.id, m]));

  document.title = domain.title || `${brand.mark} ${brand.rest || ''}`.trim();

  const wrap = el('div', 'lp');

  // ---- header: brand + (feature-gated) saved / basket ----
  const hd = el('header', 'lp-hd');
  const brandEl = el('div', 'brandlock', { html: `<span class="brandmark"><b>${brand.mark || ''}</b> ${brand.rest || ''}</span>${brand.sub ? `<span class="brandsub">${brand.sub}</span>` : ''}` });
  const right = el('div', 'hd-actions');
  if (features.saved) {
    const savedBtn = el('button', 'hdx', { type: 'button', 'aria-haspopup': 'dialog' });
    const syncSaved = () => { const n = savedCount(); savedBtn.innerHTML = ICONS.save + (n ? `<span class="hdx-n">${n}</span>` : ''); savedBtn.setAttribute('aria-label', `${L('savedLabel', 'Saved')}, ${n}`); savedBtn.title = `${L('savedLabel', 'Saved')} (${n})`; };
    syncSaved(); savedOnChange(syncSaved);
    savedBtn.addEventListener('click', () => openSavedModal(document.body, { resolveImage, inert: root }));
    right.appendChild(savedBtn);
  }
  if (features.basket) {
    const basketBtn = el('button', 'hdx', { type: 'button', 'aria-haspopup': 'dialog' });
    const syncBasket = () => { const n = basketCount(); basketBtn.innerHTML = ICONS.bag + (n ? `<span class="hdx-n">${n}</span>` : ''); basketBtn.setAttribute('aria-label', `${L('cartLabel', 'Basket')}, ${n}`); basketBtn.title = `${L('cartLabel', 'Basket')} (${n})`; };
    syncBasket(); basketOnChange(syncBasket);
    basketBtn.addEventListener('click', () => openBasketModal(document.body, { resolveImage, inert: root }));
    right.appendChild(basketBtn);
  }
  if (features.studio) {
    const add = el('button', 'hd-studio', { type: 'button', text: L('newModelLabel', '＋ New configurator') });
    add.addEventListener('click', () => openCreateModel(catModels));
    right.appendChild(add);
    const studio = el('a', 'hd-studio', { href: 'journey-create.html', text: L('studioLabel', 'Studio') });
    right.appendChild(studio);
  }
  hd.append(brandEl, right);

  // ---- create a new configurator: mint an id, seed a minimal-valid model, drill in ----
  function openCreateModel(existing) {
    const back = el('div', 'lp-modal-back');
    const box = el('div', 'lp-modal');
    box.appendChild(el('h2', 'lp-modal-h', { text: 'New configurator' }));
    box.appendChild(el('div', 'lab', { text: 'Name' }));
    const title = el('input', 'f'); title.placeholder = 'e.g. Yacht charters'; box.appendChild(title);
    const err = el('div', 'vmsg'); box.appendChild(err);
    const row = el('div', 'lp-modal-row');
    const cancel = el('button', 'jbtn', { type: 'button', text: 'Cancel' });
    const create = el('button', 'jbtn primary', { type: 'button', text: 'Create & edit ▸' });
    row.append(cancel, create); box.appendChild(row);
    back.appendChild(box); document.body.appendChild(back);
    const close = () => back.remove();
    cancel.addEventListener('click', close);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    title.focus();
    create.addEventListener('click', () => {
      const t = title.value.trim();
      if (!t) { err.className = 'vmsg bad'; err.textContent = 'A name is required.'; return; }
      const existingIds = new Set([...(existing || []).map((m) => m.id), ...getLocalModelCatalog().models.map((m) => m.id)]);
      const id = uniqueModelId(t, existingIds);
      saveDataFor(id, newModelData(id, {}));
      savePresFor(id, newModelPres(id, { title: t }));
      saveLocalModelEntry({ id, title: t, blurb: '', hero: '' });
      location.href = `data-editor.html?m=${encodeURIComponent(id)}`;
    });
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') create.click(); if (e.key === 'Escape') close(); });
  }

  // ---- hero ----
  const hero = el('div', 'lp-hero');
  hero.innerHTML = `<div class="lp-eyebrow">${L('eyebrow', 'The Collections')}</div>
    <h1 class="lp-title">${L('heroTitle', 'Choose to begin.')}</h1>
    <p class="lp-lede">${L('heroLede', 'Choose one to begin.')}</p>`;

  // ---- breadcrumb when browsing INTO a sub-catalogue (?c=) ----
  const here = reg && (CAT_ID || (domain.rootCatalogue) || reg.root);
  if (reg && CAT_ID && nodeOf(reg, CAT_ID)) {
    const crumbs = pathTo(reg, CAT_ID);
    const bc = el('nav', 'lp-breadcrumb');
    bc.appendChild(el('a', 'lp-crumb', { href: 'index.html', text: L('eyebrow', 'Home') }));
    crumbs.forEach((id, i) => {
      bc.appendChild(el('span', 'lp-crumb-sep', { text: '›' }));
      const label = (nodeOf(reg, id) || {}).title || id;
      if (i === crumbs.length - 1) bc.appendChild(el('span', 'lp-crumb cur', { text: label }));
      else bc.appendChild(el('a', 'lp-crumb', { href: `index.html?c=${encodeURIComponent(id)}`, text: label }));
    });
    wrap.append(hd, bc, hero);
  } else { wrap.append(hd, hero); }

  // ---- a card for a leaf model (hero image resolves async → neutral placeholder) ----
  const modelCard = (row) => {
    const m = modelById[row.model] || { id: row.model, title: row.title };
    const a = el('a', 'lp-card'); a.href = `configure.html?m=${encodeURIComponent(row.model)}`;
    const media = el('div', 'lp-media'); media.innerHTML = placeholderSVG(m.title || m.id);
    const body = el('div', 'lp-cardbody');
    body.innerHTML = `<div class="lp-cardtitle">${m.title || m.id}</div><div class="lp-blurb">${m.blurb || ''}</div><div class="lp-enter">${L('cardCta', 'Enter')} <span aria-hidden="true">→</span></div>`;
    a.append(media, body);
    if (m.hero) resolveImage(m.hero).then((u) => { if (!u) return; const im = new Image(); im.onload = () => { media.innerHTML = `<img src="${u}" alt="">`; }; im.src = u; }).catch(() => {});
    return a;
  };
  // a section header; when the sub-tree has real depth, its title links deeper (?c=).
  const sectionOf = (title, glyph, browseHref) => {
    const s = el('section', 'lp-section');
    const h = el('div', 'lp-section-h', { html: `${glyph ? `<span class="lp-section-g">${glyph}</span>` : ''}<h2 class="lp-section-t">${title}</h2>` });
    if (browseHref) h.appendChild(el('a', 'lp-browse', { href: browseHref, html: `Browse all <span aria-hidden="true">→</span>` }));
    s.appendChild(h);
    const g = el('div', 'lp-grid'); s.appendChild(g);
    return { section: s, grid: g };
  };

  // ---- registry-driven catalogue: grouped one-click sections, drillable to any depth ----
  if (reg) {
    const sections = childrenOf(reg, here);           // each direct child of `here` = one group
    const placed = new Set();
    if (sections.length) {
      for (const secId of sections) {
        const models = modelsUnder(reg, secId).filter((r) => !placed.has(r.model));   // leaves, flattened
        if (!models.length) continue;
        // offer a drill link only where the group actually has intermediate sub-catalogues
        const hasDepth = childrenOf(reg, secId).some((k) => !((nodeOf(reg, k) || {}).model) && childrenOf(reg, k).length);
        const { section, grid } = sectionOf((nodeOf(reg, secId) || {}).title || secId, glyphOf(reg, secId), hasDepth ? `index.html?c=${encodeURIComponent(secId)}` : null);
        for (const r of models) { placed.add(r.model); grid.appendChild(modelCard(r)); }
        wrap.appendChild(section);
      }
    } else {
      // `here` is itself a leaf-bearing catalogue → one flat grid of its models
      const grid = el('div', 'lp-grid');
      for (const r of modelsUnder(reg, here)) grid.appendChild(modelCard(r));
      wrap.appendChild(grid);
    }
  } else {
    // no registry → degrade to a flat grid of every catalogued model (nothing lost)
    const grid = el('div', 'lp-grid');
    for (const m of catModels) grid.appendChild(modelCard({ model: m.id, title: m.title }));
    wrap.appendChild(grid);
  }

  // ---- composed journeys (reachable + feature-gated) ----
  if (features.journeys) {
    try {
      const jc = await mergedJourneyCatalog();
      const wanted = domain.catalog && domain.catalog.journeys ? new Set(domain.catalog.journeys.map((j) => j.id)) : null;
      const journeys = (jc.journeys || []).filter((j) => !wanted || wanted.has(j.id));
      if (journeys.length) {
        const { section, grid } = sectionOf(L('journeysTitle', 'Journeys'), '⇄');
        for (const j of journeys) {
          const a = el('a', 'lp-card lp-card--journey'); a.href = `configure.html?j=${encodeURIComponent(j.id)}`;
          a.appendChild(el('div', 'lp-cardbody', { html: `<div class="lp-cardtitle">${j.title || j.id}</div><div class="lp-blurb">${j.blurb || ''}</div><div class="lp-enter">${L('cardCta', 'Begin')} <span aria-hidden="true">→</span></div>` }));
          grid.appendChild(a);
        }
        wrap.appendChild(section);
      }
    } catch (_) { /* no journeys */ }
  }

  const foot = el('footer', 'lp-foot');
  foot.innerHTML = `<span>${L('footerName', '')}</span><span>${L('footerNote', '')}</span>`;
  wrap.appendChild(foot);
  root.innerHTML = ''; root.appendChild(wrap);
})();
