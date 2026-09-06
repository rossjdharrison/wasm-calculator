// =============================================================================
// landing.js — the site landing, driven ENTIRELY by the top-level domain model
// (web/domain.json): brand, label vocabulary, feature flags, the HQDM taxonomy,
// and the catalogue of models + journeys. Models are GROUPED by their inferred
// category (climbing the domain taxonomy via hqdm.isA — no domain words in code),
// journeys are reachable, and the Journey Studio is linked. Swap domain.json (+ its
// model dirs) and this becomes an admissions / case-file portal with no code change.
// =============================================================================
import { loadDomain, loadCatalogue, mergedModelCatalog, mergedJourneyCatalog, getLocalModelCatalog, saveDataFor, savePresFor, saveLocalModelEntry, loadModelFiles, CAT_ID } from './store.mjs';
import { resolve as resolveImage } from './assets.mjs';
import { el, placeholderSVG, ICONS } from './ui.mjs';
import { modelsUnder, childrenOf, glyphOf, pathTo, nodeOf } from './catalogue.mjs';
import { authorCategoryChoices } from './hqdm.mjs';
import { uniqueModelId, newModelData, newModelPres, forkModelData, forkModelPres } from './model-create-core.mjs';
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

  // ---- create a new configurator: choose WHAT IT IS in plain language (or fork an
  //      existing one), seed a born-typed minimal-valid model, drill into the studio ----
  function openCreateModel(existing, forkId) {
    const back = el('div', 'lp-modal-back');
    const box = el('div', 'lp-modal lp-modal--create');
    box.appendChild(el('h2', 'lp-modal-h', { text: 'New configurator' }));

    // two paths: start new (pick a type) or duplicate an existing one (fork)
    const tabs = el('div', 'lp-tabs');
    const tabNew = el('button', 'lp-tab is-active', { type: 'button', text: 'Start new' });
    const tabFork = el('button', 'lp-tab', { type: 'button', text: 'From existing' });
    tabs.append(tabNew, tabFork); box.appendChild(tabs);

    // ===== Start-new pane: Name + a plain-language "What is it?" type picker =====
    const paneNew = el('div', 'lp-pane');
    paneNew.appendChild(el('div', 'lab', { text: 'Name' }));
    const title = el('input', 'f'); title.placeholder = 'e.g. Yacht charters'; paneNew.appendChild(title);
    paneNew.appendChild(el('div', 'lab', { text: 'What is it?' }));
    const cards = el('div', 'lp-typecards');
    const choices = authorCategoryChoices();
    let chosenCat = (choices[0] || {}).id;
    const cardEls = [];
    for (const c of choices) {
      const cd = el('button', 'lp-typecard' + (c.id === chosenCat ? ' is-active' : ''), { type: 'button', title: c.hint || '' });
      cd.innerHTML = `<span class="lp-typecard-g" aria-hidden="true">${c.glyph}</span><span class="lp-typecard-l">${c.label}</span>${c.hint ? `<span class="lp-typecard-h">${c.hint}</span>` : ''}`;
      cd.addEventListener('click', () => { chosenCat = c.id; cardEls.forEach((x) => x.classList.toggle('is-active', x === cd)); updatePlacement(); });
      cardEls.push(cd); cards.appendChild(cd);
    }
    paneNew.appendChild(cards);
    const placement = el('div', 'lp-placement');
    const updatePlacement = () => { const c = choices.find((x) => x.id === chosenCat) || {}; placement.innerHTML = `Appears under <span class="lp-placement-g" aria-hidden="true">${c.glyph || ''}</span> <b>${c.label || chosenCat || ''}</b>`; };
    updatePlacement(); paneNew.appendChild(placement);

    // ===== From-existing pane: pick a source to duplicate, then name the copy =====
    const paneFork = el('div', 'lp-pane'); paneFork.hidden = true;
    paneFork.appendChild(el('p', 'lp-pane-note', { text: 'Duplicate an existing configurator, then change it. The copy keeps the original’s fields and layout, and its own type.' }));
    const forkList = el('div', 'lp-forklist');
    const sources = (existing || []).slice();
    let forkSrc = null;
    const forkRowEls = [];
    for (const m of sources) {
      const rr = el('button', 'lp-forkrow', { type: 'button' });
      rr.innerHTML = `<span class="lp-forkrow-t">${m.title || m.id}</span>${m.blurb ? `<span class="lp-forkrow-b">${m.blurb}</span>` : ''}`;
      rr.addEventListener('click', () => { forkSrc = m; forkRowEls.forEach((x) => x.classList.toggle('is-active', x === rr)); if (!forkName.value.trim()) forkName.value = `${m.title || m.id} (copy)`; });
      forkRowEls.push(rr); forkList.appendChild(rr);
    }
    paneFork.appendChild(forkList);
    paneFork.appendChild(el('div', 'lab', { text: 'Name the copy' }));
    const forkName = el('input', 'f'); forkName.placeholder = 'e.g. Yacht charters (deluxe)'; paneFork.appendChild(forkName);

    box.append(paneNew, paneFork);

    const err = el('div', 'vmsg'); box.appendChild(err);
    const row = el('div', 'lp-modal-row');
    const cancel = el('button', 'jbtn', { type: 'button', text: 'Cancel' });
    const create = el('button', 'jbtn primary', { type: 'button', text: 'Create & edit ▸' });
    row.append(cancel, create); box.appendChild(row);
    back.appendChild(box); document.body.appendChild(back);

    let mode = 'new';
    const setMode = (m) => { mode = m; tabNew.classList.toggle('is-active', m === 'new'); tabFork.classList.toggle('is-active', m === 'fork'); paneNew.hidden = m !== 'new'; paneFork.hidden = m !== 'fork'; err.textContent = ''; (m === 'new' ? title : forkName).focus(); };
    tabNew.addEventListener('click', () => setMode('new'));
    tabFork.addEventListener('click', () => setMode('fork'));

    const close = () => back.remove();
    cancel.addEventListener('click', close);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });

    const takenIds = () => new Set([...(existing || []).map((m) => m.id), ...getLocalModelCatalog().models.map((m) => m.id)]);

    function doCreateNew() {
      const t = title.value.trim();
      if (!t) { err.className = 'vmsg bad'; err.textContent = 'A name is required.'; return; }
      const id = uniqueModelId(t, takenIds());
      saveDataFor(id, newModelData(id, { title: t, category: chosenCat }));   // born typed under the chosen category
      savePresFor(id, newModelPres(id, { title: t }));
      saveLocalModelEntry({ id, title: t, blurb: '', hero: '' });
      location.href = `data-editor.html?m=${encodeURIComponent(id)}`;
    }

    async function doFork() {
      if (!forkSrc) { err.className = 'vmsg bad'; err.textContent = 'Pick a configurator to duplicate.'; return; }
      const t = forkName.value.trim() || `${forkSrc.title || forkSrc.id} (copy)`;
      const id = uniqueModelId(t, takenIds());
      let files = null;
      try { files = await loadModelFiles(forkSrc.id); } catch (_) { /* handled below */ }
      if (!files || !files.data) { err.className = 'vmsg bad'; err.textContent = 'Could not load that configurator to duplicate.'; return; }
      saveDataFor(id, forkModelData(files.data, id, { title: t }));
      savePresFor(id, forkModelPres(files.presentation || newModelPres(id, { title: t }), { title: t }));
      saveLocalModelEntry({ id, title: t, blurb: forkSrc.blurb || '', hero: '' });
      location.href = `data-editor.html?m=${encodeURIComponent(id)}`;
    }

    create.addEventListener('click', () => { Promise.resolve(mode === 'new' ? doCreateNew() : doFork()).catch((e) => { err.className = 'vmsg bad'; err.textContent = `Could not create: ${e.message}`; }); });
    const onKey = (e) => { if (e.key === 'Enter') create.click(); if (e.key === 'Escape') close(); };
    title.addEventListener('keydown', onKey); forkName.addEventListener('keydown', onKey);

    // deep-link: a card's "Fork" button opens straight into the fork path, preselected
    if (forkId) { const i = sources.findIndex((m) => m.id === forkId); if (i >= 0) { setMode('fork'); forkRowEls[i].click(); } else setMode('new'); }
    else title.focus();
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

  // a plain-language, GENERIC label for a taxonomy node (no domain/ontology words in
  // code): a domain-authored node title if present, else the id de-slugged.
  const humanize = (id) => String(id || '').replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  const nodeLabel = (id) => (nodeOf(reg, id) || {}).title || humanize(id);
  // a card's TYPE badge: the neutral glyph (climbed to a render hint) + the category the
  // model sits under (its leaf's parent), with the full ancestry as a tooltip. Makes
  // "what is this?" visible at browse time — the catalogue already derives it.
  const typeBadge = (leafId) => {
    if (!reg || !leafId || !nodeOf(reg, leafId)) return null;
    const crumbs = pathTo(reg, leafId);                             // [...registry-node ancestors, leaf]
    // show the nearest NAMED category (a real intermediate node) if one exists, else the
    // model's own class — the author's word for what it is, never the raw ontology id.
    const catId = crumbs.length >= 2 ? crumbs[crumbs.length - 2] : leafId;
    const b = el('span', 'lp-typebadge', { title: crumbs.map(nodeLabel).join(' › ') });
    b.innerHTML = `<span class="lp-typebadge-g" aria-hidden="true">${glyphOf(reg, leafId) || '◈'}</span><span>${nodeLabel(catId)}</span>`;
    return b;
  };

  // ---- a card for a leaf model (hero image resolves async → neutral placeholder) ----
  const modelCard = (row) => {
    const m = modelById[row.model] || { id: row.model, title: row.title };
    const a = el('a', 'lp-card'); a.href = `configure.html?m=${encodeURIComponent(row.model)}`;
    const media = el('div', 'lp-media'); media.innerHTML = placeholderSVG(m.title || m.id);
    const body = el('div', 'lp-cardbody');
    body.innerHTML = `<div class="lp-cardtitle">${m.title || m.id}</div><div class="lp-blurb">${m.blurb || ''}</div><div class="lp-enter">${L('cardCta', 'Enter')} <span aria-hidden="true">→</span></div>`;
    const badge = typeBadge(row.id);   // row.id = the leaf class id (registry path); absent in the degraded flat grid
    if (badge) body.insertBefore(badge, body.firstChild);
    a.append(media, body);
    if (m.hero) resolveImage(m.hero).then((u) => { if (!u) return; const im = new Image(); im.onload = () => { media.innerHTML = `<img src="${u}" alt="">`; }; im.src = u; }).catch(() => {});
    if (!features.studio) return a;
    // a "Fork" affordance sits OVER the card (a button can't live inside the <a>): one
    // click opens the create modal straight into the fork path with this model selected.
    const cw = el('div', 'lp-cardwrap'); cw.appendChild(a);
    const fork = el('button', 'lp-forkbtn', { type: 'button', text: 'Fork', title: `Duplicate ${m.title || m.id}`, 'aria-label': `Duplicate ${m.title || m.id}` });
    fork.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openCreateModel(catModels, m.id); });
    cw.appendChild(fork);
    return cw;
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

  // ---- registry-driven catalogue: grouped sections, filterable by search + type ----
  // Rendered into its own host so the toolbar below can re-run it live. The grouping
  // logic is unchanged from the shipped landing; it just runs through a filter.
  const catHost = el('div', 'lp-cat');
  const filterState = { q: '', chip: null };
  const matchText = (m, q) => !q || `${m.title || ''} ${m.blurb || ''} ${m.id || ''}`.toLowerCase().includes(q.toLowerCase());

  function renderCatalogue() {
    catHost.innerHTML = '';
    const { q, chip } = filterState;
    if (!reg) {
      // no registry → degrade to a flat grid of every catalogued model (nothing lost)
      const grid = el('div', 'lp-grid');
      for (const m of catModels) if (matchText(m, q)) grid.appendChild(modelCard({ model: m.id, title: m.title }));
      catHost.appendChild(grid.childElementCount ? grid : el('p', 'lp-empty', { text: q ? `No configurators match “${q}”.` : 'No configurators yet.' }));
      return;
    }
    const sections = childrenOf(reg, here).filter((secId) => !chip || secId === chip);   // a chip narrows to one group
    const placed = new Set();
    let shown = 0;
    if (sections.length) {
      for (const secId of sections) {
        const models = modelsUnder(reg, secId)
          .filter((r) => !placed.has(r.model))
          .filter((r) => matchText(modelById[r.model] || { id: r.model, title: r.title }, q));
        if (!models.length) continue;
        // offer a drill link only where the group actually has intermediate sub-catalogues (and not while filtering to a chip)
        const hasDepth = childrenOf(reg, secId).some((k) => !((nodeOf(reg, k) || {}).model) && childrenOf(reg, k).length);
        const { section, grid } = sectionOf(nodeLabel(secId), glyphOf(reg, secId), (!chip && hasDepth) ? `index.html?c=${encodeURIComponent(secId)}` : null);
        for (const r of models) { placed.add(r.model); grid.appendChild(modelCard(r)); shown++; }
        catHost.appendChild(section);
      }
    } else {
      // `here` is itself a leaf-bearing catalogue → one flat grid of its models
      const grid = el('div', 'lp-grid');
      for (const r of modelsUnder(reg, here)) {
        if (!matchText(modelById[r.model] || { id: r.model, title: r.title }, q)) continue;
        grid.appendChild(modelCard(r)); shown++;
      }
      catHost.appendChild(grid);
    }
    if (!shown) catHost.appendChild(el('p', 'lp-empty', { text: q ? `No configurators match “${q}”.` : 'No configurators yet.' }));
  }

  // the library toolbar: a search box, plus type-filter chips when there is more than
  // one top-level category. Both drive renderCatalogue over the already-derived registry.
  const anyModels = reg ? modelsUnder(reg, here).length > 0 : catModels.length > 0;
  if (anyModels) {
    const toolbar = el('div', 'lp-toolbar');
    const search = el('input', 'lp-search', { type: 'search', placeholder: L('searchPlaceholder', 'Search configurators…'), 'aria-label': 'Search configurators' });
    let searchTimer;
    search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { filterState.q = search.value.trim(); renderCatalogue(); }, 120); });
    toolbar.appendChild(search);
    if (reg) {
      const chipEls = [];
      const setActiveChip = (active) => chipEls.forEach((c) => c.classList.toggle('is-active', c === active));
      const chips = el('div', 'lp-chips');
      const allChip = el('button', 'lp-chip is-active', { type: 'button', text: L('allLabel', 'All') });
      allChip.addEventListener('click', () => { filterState.chip = null; setActiveChip(allChip); renderCatalogue(); });
      chipEls.push(allChip); chips.appendChild(allChip);
      for (const secId of childrenOf(reg, here)) {
        if (!modelsUnder(reg, secId).length) continue;
        const c = el('button', 'lp-chip', { type: 'button', html: `${glyphOf(reg, secId) ? `<span aria-hidden="true">${glyphOf(reg, secId)}</span> ` : ''}${nodeLabel(secId)}` });
        c.addEventListener('click', () => { filterState.chip = secId; setActiveChip(c); renderCatalogue(); });
        chipEls.push(c); chips.appendChild(c);
      }
      if (chipEls.length > 2) toolbar.appendChild(chips);   // chips only earn their place with ≥2 categories
    }
    wrap.appendChild(toolbar);
  }
  wrap.appendChild(catHost);
  renderCatalogue();

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
