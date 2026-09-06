// =============================================================================
// landing.js — the site landing, driven ENTIRELY by the top-level domain model
// (web/domain.json): brand, label vocabulary, feature flags, the HQDM taxonomy,
// and the catalogue of models + journeys. Models are GROUPED by their inferred
// category (climbing the domain taxonomy via hqdm.isA — no domain words in code),
// journeys are reachable, and the Journey Studio is linked. Swap domain.json (+ its
// model dirs) and this becomes an admissions / case-file portal with no code change.
// =============================================================================
import { loadDomain, loadCatalogue, mergedModelCatalog, mergedJourneyCatalog, getLocalModelCatalog, saveDataFor, savePresFor, saveLocalModelEntry, loadModelFiles, loadJourney, CAT_ID } from './store.mjs';
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
  // control-panel (builder) framing vs the buyer storefront — a dedicated flag so the two
  // audiences are a real switch, not overloaded onto features.studio.
  const controlPanel = features.controlPanel === true;
  // the journeys once, up front, so the fleet roster can count them (reused by the section).
  let journeysAll = [];
  if (features.journeys) {
    try {
      const jc = await mergedJourneyCatalog();
      const wanted = domain.catalog && domain.catalog.journeys ? new Set(domain.catalog.journeys.map((j) => j.id)) : null;
      journeysAll = (jc.journeys || []).filter((j) => !wanted || wanted.has(j.id));
    } catch (_) { /* no journeys */ }
  }

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

  // ---- hero: builder control-panel framing (features.controlPanel) or buyer storefront ----
  const hero = el('div', 'lp-hero' + (controlPanel ? ' lp-hero--builder' : ''));
  if (controlPanel) {
    const nM = catModels.length, nJ = journeysAll.length;
    const machineWord = nM === 1 ? L('machineNoun', 'quote machine') : L('machinePlural', 'quote machines');
    const journeyWord = nJ === 1 ? L('journeyNoun', 'journey') : L('journeyPlural', 'journeys');
    const roster = `${nM} ${machineWord}${nJ ? ` · ${nJ} ${journeyWord}` : ''}`;
    hero.innerHTML = `<div class="lp-eyebrow">${L('builderEyebrow', 'Control panel')}</div>
      <h1 class="lp-title">${L('builderHeroTitle', L('heroTitle', 'Build a configurator.'))}</h1>
      <p class="lp-lede">${L('builderHeroLede', L('heroLede', ''))}</p>
      <div class="lp-roster">${roster}</div>`;
  } else {
    hero.innerHTML = `<div class="lp-eyebrow">${L('eyebrow', 'The Collections')}</div>
      <h1 class="lp-title">${L('heroTitle', 'Choose to begin.')}</h1>
      <p class="lp-lede">${L('heroLede', 'Choose one to begin.')}</p>`;
  }

  // ---- "how it works" band (builder mode) — the mechanism, legible in ten seconds ----
  const howBand = () => {
    const steps = Array.isArray(domain.howItWorks) ? domain.howItWorks : [];
    if (!controlPanel || !steps.length) return null;
    const band = el('div', 'lp-how');
    steps.forEach((step, i) => {
      const s = el('div', 'lp-how-step');
      s.innerHTML = `<span class="lp-how-n" aria-hidden="true">${i + 1}</span><span class="lp-how-g" aria-hidden="true">${step.glyph || '◆'}</span><b class="lp-how-t">${step.title || ''}</b><span class="lp-how-note">${step.note || ''}</span>`;
      band.appendChild(s);
    });
    return band;
  };

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
  const hb = howBand(); if (hb) wrap.appendChild(hb);

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
    // vitals (builder mode): each machine's shape at a glance, from data already loaded.
    if (controlPanel && reg && reg.datas && reg.datas[row.model]) {
      const dd = reg.datas[row.model];
      const vit = el('div', 'lp-vitals', { text: `${(dd.fields || []).length} ${L('fieldsUnit', 'fields')} · ${(dd.computed || []).length} ${L('computedUnit', 'computed')}` });
      body.insertBefore(vit, body.querySelector('.lp-enter'));
    }
    a.append(media, body);
    if (m.hero) resolveImage(m.hero).then((u) => { if (!u) return; const im = new Image(); im.onload = () => { media.innerHTML = `<img src="${u}" alt="">`; }; im.src = u; }).catch(() => {});
    if (!features.studio) return a;
    // In builder mode the card becomes a machine you OPERATE: the card <a> stays Open
    // (run the configurator), and an always-visible action bar puts every CANVAS one
    // click away. A button/link can't nest inside the card <a>, so the bar is a sibling
    // in .lp-cardwrap. Every href is row.model + a static filename; every label is a
    // generic L() fallback — no domain token enters this neutral module.
    const cw = el('div', 'lp-cardwrap'); cw.appendChild(a);
    const name = m.title || m.id;
    const mid = encodeURIComponent(row.model);
    const actions = el('div', 'lp-actions'); actions.setAttribute('role', 'group'); actions.setAttribute('aria-label', `Canvases for ${name}`);
    const mkLink = (label, href, aria) => { const x = el('a', 'lp-action', { href, text: label }); x.setAttribute('aria-label', `${aria} — ${name}`); return x; };
    actions.append(
      mkLink(L('editLabel', 'Edit'), `data-editor.html?m=${mid}`, `${L('editLabel', 'Edit')} data model`),
      mkLink(L('designLabel', 'Design'), `presentation-editor.html?m=${mid}`, L('designLabel', 'Design')),
      mkLink(L('loomLabel', 'Loom'), `loom.html?m=${mid}`, `${L('loomLabel', 'Loom')} — live canvas`),
    );
    const fork = el('button', 'lp-action lp-action--fork', { type: 'button', text: L('forkLabel', 'Fork') });
    fork.setAttribute('aria-label', `${L('forkLabel', 'Fork')} — ${name}`);
    fork.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openCreateModel(catModels, m.id); });
    actions.appendChild(fork);
    cw.appendChild(actions);
    return cw;
  };
  // a section header; when the sub-tree has real depth, its title links deeper (?c=).
  // An optional descriptor line teaches what this KIND is (configurator vs journey).
  const sectionOf = (title, glyph, browseHref, descriptor) => {
    const s = el('section', 'lp-section');
    const h = el('div', 'lp-section-h', { html: `${glyph ? `<span class="lp-section-g">${glyph}</span>` : ''}<h2 class="lp-section-t">${title}</h2>` });
    if (browseHref) h.appendChild(el('a', 'lp-browse', { href: browseHref, html: `Browse all <span aria-hidden="true">→</span>` }));
    s.appendChild(h);
    if (descriptor) s.appendChild(el('p', 'lp-section-note', { text: descriptor }));
    const g = el('div', 'lp-grid'); s.appendChild(g);
    return { section: s, grid: g };
  };

  // ---- registry-driven catalogue: grouped sections, filterable by search + type ----
  // Rendered into its own host so the toolbar below can re-run it live. The grouping
  // logic is unchanged from the shipped landing; it just runs through a filter.
  const catHost = el('div', 'lp-cat');
  const filterState = { q: '', chip: null };
  const matchText = (m, q) => !q || `${m.title || ''} ${m.blurb || ''} ${m.id || ''}`.toLowerCase().includes(q.toLowerCase());
  // empty state — in builder mode the first screen becomes an onboarding create card (the
  // whole point of the pitch); otherwise (or while filtering) a plain message.
  const emptyState = (q) => {
    if (q || !controlPanel) return el('p', 'lp-empty', { text: q ? `No matches for “${q}”.` : 'Nothing here yet.' });
    const card = el('button', 'lp-empty-create', { type: 'button' });
    card.innerHTML = `<span class="lp-empty-g" aria-hidden="true">＋</span><b class="lp-empty-t">${L('emptyCreateTitle', 'Create your first quote machine')}</b><span class="lp-empty-n">${L('emptyCreateNote', 'Pick what it is, name it, and start — no code.')}</span>`;
    card.addEventListener('click', () => openCreateModel(catModels));
    return card;
  };

  function renderCatalogue() {
    catHost.innerHTML = '';
    const { q, chip } = filterState;
    if (!reg) {
      // no registry → degrade to a flat grid of every catalogued model (nothing lost)
      const grid = el('div', 'lp-grid');
      for (const m of catModels) if (matchText(m, q)) grid.appendChild(modelCard({ model: m.id, title: m.title }));
      catHost.appendChild(grid.childElementCount ? grid : emptyState(q));
      return;
    }
    // BUILDER control panel: one flat, PACKED grid of the whole fleet (a chip narrows to a
    // category subtree; search filters) so many machines use the space well, rather than a
    // stack of single-card category sections. The buyer storefront keeps its collections.
    if (controlPanel) {
      const { section, grid } = sectionOf(L('machinesTitle', 'Quote machines'), '◈', null, L('machineDescriptor', ''));
      let n = 0;
      for (const r of modelsUnder(reg, chip || here)) {
        if (!matchText(modelById[r.model] || { id: r.model, title: r.title }, q)) continue;
        grid.appendChild(modelCard(r)); n++;
      }
      catHost.appendChild(n ? section : emptyState(q));
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
    if (!shown) catHost.appendChild(emptyState(q));
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
      const journeys = journeysAll;   // fetched once up front (also feeds the fleet roster)
      if (journeys.length) {
        const { section, grid } = sectionOf(L('journeysTitle', 'Journeys'), '⇄', null, L('journeyDescriptor', ''));
        for (const j of journeys) {
          const a = el('a', 'lp-card lp-card--journey'); a.href = `configure.html?j=${encodeURIComponent(j.id)}`;
          a.appendChild(el('div', 'lp-cardbody', { html: `<div class="lp-cardtitle">${j.title || j.id}</div><div class="lp-blurb">${j.blurb || ''}</div><div class="lp-enter">${L('cardCta', 'Begin')} <span aria-hidden="true">→</span></div>` }));
          // the telltale that a journey is a COMPOSITE: how many machines it threads + its phases.
          const jbody = a.querySelector('.lp-cardbody');
          if (controlPanel && jbody) {
            const vit = el('div', 'lp-vitals'); jbody.insertBefore(vit, jbody.querySelector('.lp-enter'));
            loadJourney(j.id).then((doc) => { if (!doc) return; const nm = (doc.models || []).length, np = (doc.phases || []).length; vit.textContent = `${L('threadsLabel', 'threads')} ${nm} ${L('machinesUnit', 'machines')} · ${np} ${L('phasesUnit', 'phases')}`; }).catch(() => {});
          }
          if (!features.studio) { grid.appendChild(a); continue; }
          // a journey is a composed machine — the card runs it; the bar opens its canvases.
          const cw = el('div', 'lp-cardwrap'); cw.appendChild(a);
          const jname = j.title || j.id; const jid = encodeURIComponent(j.id);
          const acts = el('div', 'lp-actions'); acts.setAttribute('role', 'group'); acts.setAttribute('aria-label', `Canvases for ${jname}`);
          const mk = (label, href, aria) => { const x = el('a', 'lp-action', { href, text: label }); x.setAttribute('aria-label', `${aria} — ${jname}`); return x; };
          acts.append(
            mk(L('canvasLabel', 'Canvas'), `journey.html?j=${jid}`, `${L('canvasLabel', 'Canvas')} — journey loom`),
            mk(L('composeLabel', 'Compose'), `journey-create.html?j=${jid}`, L('composeLabel', 'Compose')),
          );
          cw.appendChild(acts); grid.appendChild(cw);
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
