// =============================================================================
// journey-view.mjs — the end-user journey RUNNER (opt-in via ?j=). It is generic:
// it reads the journey model's declared `process` (steps with a neutral `kind` +
// an L0 category) and interprets it — it hardcodes no sale concept. A `capture`
// step hosts a model's showroom; a `ceremony` step renders its declared L0
// activity + records a generic StepDone; a `preview` step shows a downstream
// model's live figures. The words "agreement"/"sign" live only in the model (a
// step id + an HQDM category) and are rendered by category-render. The order is
// event-sourced (order.mjs) — resumable, undoable, single-authority.
// =============================================================================
import { el, money, configKey, formatOutput } from './ui.mjs';
import { mountShowroom } from './showroom-view.mjs';
import { mountConfigurator } from './render-form.mjs';
import { mountStepper } from './phase-stepper.mjs';
import { renderByCategory } from './category-render.mjs';
import { evaluateJourney } from './compose.mjs';
import { categoryOf } from './individuals.mjs';
import { phasesOf } from './hqdm.mjs';
import * as order from './order.mjs';
import { loadEvents, saveEvents, commit, newOrderId, onExternalChange } from './order-store.mjs';

export function mountJourney(root, { journey, models, host, brand, resolveImage, links, resumeOrderId, phases, labels }) {
  root.innerHTML = '';
  const steps = (journey.process && journey.process.steps) || [];
  // process phases come from DATA (the domain/journey), never a baked-in constant.
  const PH = (phases && phases.length) ? phases : phasesOf(journey);
  const L = (k, d) => (labels && labels[k]) || (journey.labels && journey.labels[k]) || d;   // domain/journey label vocabulary
  const phaseIds = PH.filter((p) => steps.some((s) => s.phase === p.id)).map((p) => p.id);
  const phasesUsed = PH.filter((p) => phaseIds.includes(p.id));
  const stepFor = (phaseId) => steps.find((s) => s.phase === phaseId);
  const captureStep = steps.find((s) => s.kind === 'capture') || steps[0] || {};
  const captureAlias = captureStep.model;
  const aliasLabel = (a) => (models[a] && models[a].merged.name) || a;
  const typesOf = (a) => (models[a] && models[a].merged.types) || {};
  // types for L0 inference of temporal states: the capture model's types + the
  // journey's own declared types (e.g. lifecycle states specializing `state`).
  const mergedTypes = () => ({ ...typesOf(captureAlias), ...(journey.types || {}) });
  const fmt = (ms) => { try { return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
  const nextPhase = (id) => { const i = phaseIds.indexOf(id); return phaseIds[Math.min(phaseIds.length - 1, i + 1)]; };

  // ---- order (event-sourced): resume or start fresh ----
  let events;
  // resume only an order that belongs to THIS journey; a foreign/empty ?o= mints fresh
  // (guards against a hand-edited/bookmarked ?o= adopting another journey's log).
  if (resumeOrderId) { events = loadEvents(resumeOrderId); if (!events.length || order.fold(events).journeyId !== journey.id) resumeOrderId = null; }
  const freshOrder = !resumeOrderId;
  if (freshOrder) events = order.startOrder(newOrderId(journey.correlationPrefix || 'ORD'), journey.id, journey.version);
  const orderId = order.fold(events).orderId;
  // persist ONLY a newly-minted order's opening log; a resumed order already exists in
  // the store (re-writing it would be a needless blind overwrite + notify). Every later
  // write goes through commit() below — compare-and-set, never a whole-array clobber.
  if (freshOrder) saveEvents(orderId, events);
  // pin the active order id in the URL so a refresh resumes it (self-heals when a
  // stale ?o= resolved to an empty log above and a fresh order was minted).
  try {
    if (typeof history !== 'undefined' && history.replaceState) {
      const u = new URL(location.href);
      if (u.searchParams.get('o') !== orderId) { u.searchParams.set('o', orderId); history.replaceState(null, '', u); }
    }
  } catch (_) { /* non-browser / blocked history — harmless */ }
  // the single write path: compare-and-set on the substrate. commit() re-reads the
  // fresh stored log, re-validates `c` against it, and appends only if no other tab
  // advanced the log — so two open tabs on this order never clobber each other. We
  // ADOPT the returned authoritative log (it may already carry another tab's events).
  const cmd = (c) => { const r = commit(orderId, c); if (!r.error) events = r.events; return r; };

  // ---- layout ----
  const grid = el('div', 'journey');
  const stepHost = el('div', 'journey-steps');
  const phaseHost = el('div', 'journey-phase');
  const railHost = el('aside', 'order-rail');
  grid.append(stepHost, phaseHost, railHost);
  root.appendChild(grid);

  const reached = () => { const o = order.fold(events); const i = phaseIds.indexOf(o.phase || phaseIds[0]); return phaseIds.slice(0, i + 1); };
  const stepper = mountStepper(stepHost, { phases: phasesUsed, activeId: order.fold(events).phase || phaseIds[0], reachedIds: reached(), onSelect: gotoPhase });

  let currentConfig = { ...(order.fold(events).configByAlias[captureAlias] || {}) };
  const downstreamConfig = {};   // alias → the user's FREE (non-bound) inputs, live
  let lastResult = null;

  async function recompute() {
    const o = order.fold(events);
    const configByAlias = { ...o.configByAlias };
    if (captureAlias) configByAlias[captureAlias] = o.committed[captureAlias] ? (o.configByAlias[captureAlias] || currentConfig) : currentConfig;
    // uncommitted downstream captures overlay their live free inputs (the bound
    // field is re-injected authoritatively inside evaluateJourney, so it always wins).
    for (const a in downstreamConfig) if (!o.committed[a]) configByAlias[a] = { ...(o.configByAlias[a] || {}), ...downstreamConfig[a] };
    try { lastResult = await evaluateJourney(journey, models, host, configByAlias); } catch (_) { lastResult = null; }
    renderRail();
  }

  function renderRail() {
    const o = order.fold(events);
    railHost.innerHTML = '';
    railHost.appendChild(el('div', 'rail-title', { html: `Your ${L('record', 'record')} <span class="rail-id">${orderId}</span>` }));
    // stale-snapshot notice: this order was captured against an older journey version.
    if (o.journeyVersion && journey.version && o.journeyVersion !== journey.version) {
      railHost.appendChild(el('div', 'rail-drift', { text: `Started on ${journey.title || journey.id} v${o.journeyVersion}; now v${journey.version}. Figures are recomputed against the current version.` }));
    }
    if (lastResult) {
      for (const line of lastResult.lines) {
        // render each line by ITS inferred L0 category (money OR otherwise) — never a
        // hardcoded amount_of_money, so a money-free domain renders correctly.
        const display = line.amount != null ? money(line.amount, line.currency) : (line.value != null ? String(line.value) : '');
        railHost.appendChild(renderByCategory(line.category || 'amount_of_money', {
          label: aliasLabel(line.alias), display,
          origin: line.alias === captureAlias ? (o.committed[captureAlias] ? `set in ${(PH[0] || {}).label || 'capture'}` : 'live') : null,
        }, typesOf(line.alias)));
      }
      // the money total is shown only when there ARE money lines (a money-free domain has none).
      const totalEntries = Object.entries(lastResult.totalsByCurrency);
      if (totalEntries.length) {
        const total = totalEntries.map(([c, v]) => money(v, c)).join(' · ');
        railHost.appendChild(el('div', 'rail-total', { html: `<span>${L('recordTotal', 'Total')}</span><b class="num">${total}</b>` }));
      }
      // recurring commitments (role: recurring) shown apart from the one-off total.
      for (const rc of (lastResult.recurring || [])) {
        if (rc.amount == null) continue;
        railHost.appendChild(el('div', 'rail-recurring', { html: `<span>${aliasLabel(rc.alias)} · ${rc.label}</span><b class="num">${money(rc.amount, rc.currency)}<span class="rail-per"> recurring</span></b>` }));
      }
    } else {
      railHost.appendChild(el('div', 'rail-empty', { text: L('emptyPrompt', 'Begin to see your record here.') }));
    }
    // completed ceremony outcomes, rendered by their declared L0 category
    for (const s of steps) { const done = o.steps[s.id]; if (done && done.done && s.outcome) railHost.appendChild(renderByCategory(s.outcome, done, typesOf(captureAlias))); }

    // ---- 4-D temporal projection: the order lifecycle + live individual states ----
    const t = order.temporalOf(events);
    const byPhase = {};
    for (const pe of t.phaseEntries) if (!(pe.phase in byPhase)) byPhase[pe.phase] = pe.at; // earliest per phase
    const cur = o.phase || phaseIds[0];
    const parts = phaseIds.filter((id) => id in byPhase || id === cur)
      .map((id) => ({ label: (PH.find((p) => p.id === id) || {}).label || id, at: byPhase[id] != null ? fmt(byPhase[id]) : null, current: id === cur }));
    if (parts.length) railHost.appendChild(renderByCategory('period_of_time', { label: L('lifecycleLabel', 'Lifecycle'), parts }, mergedTypes()));
    for (const [, entries] of Object.entries(t.statesByIndividual)) {
      const e = entries[entries.length - 1]; // the current (last) state of this individual
      railHost.appendChild(renderByCategory(e.category, { label: e.label || e.role || e.category, status: e.status, begin: e.begin != null ? fmt(e.begin) : null, end: e.end != null ? fmt(e.end) : null }, mergedTypes()));
    }
  }

  // ---- generic step rendering ----
  function gotoPhase(id) {
    stepper.setActive(id, reached());
    phaseHost.innerHTML = '';
    const step = stepFor(id);
    if (!step) { phaseHost.appendChild(el('p', 'phase-note', { text: 'No step for this phase.' })); return; }
    if (step.kind === 'capture') renderCapture(step);
    else if (step.kind === 'capture-downstream') renderCaptureDownstream(step);
    else if (step.kind === 'ceremony') renderCeremony(step);
    else renderPreview(step);
  }

  function specCard() {
    const ind = lastResult && lastResult.byAlias[captureAlias] && lastResult.byAlias[captureAlias].individuals;
    const parts = (ind && ind.spec && ind.spec.parts) || order.fold(events).configByAlias[captureAlias] || {};
    return renderByCategory('class_of_physical_object', { label: `${aliasLabel(captureAlias)} — specification`, parts }, typesOf(captureAlias));
  }

  function renderCapture(step) {
    const o = order.fold(events);
    if (o.committed[step.model]) {
      const wrap = el('div', 'phase-frozen');
      wrap.append(el('div', 'phase-hd', { text: `Committed ${L('captureNoun', 'specification')}` }), specCard(), el('p', 'phase-note', { text: `This ${L('captureNoun', 'specification')} is the single source for the ${L('record', 'record')}. Use the stepper for later phases.` }));
      phaseHost.appendChild(wrap);
      return;
    }
    const slot = el('div', 'phase-configure'); phaseHost.appendChild(slot);
    const cm = models[step.model];
    host.acquire(step.model, cm.assembled).then((engine) => {
      mountShowroom(slot, {
        model: cm.merged, ir: cm.assembled.ir, engine, brand: cm.merged.brand || brand, resolveImage, links, modelId: step.model,
        initialConfig: Object.keys(currentConfig).length ? currentConfig : undefined,
        onConfigChange: (cfg) => { currentConfig = cfg; recompute(); },
        onRequest: (cfg) => completeCapture(step, cfg),
      });
    });
  }

  function completeCapture(step, cfg) {
    currentConfig = cfg;
    for (const [f, v] of Object.entries(cfg)) cmd({ type: 'set', alias: step.model, field: f, value: v });
    cmd({ type: 'commit', alias: step.model, hash: configKey(cfg) });
    const to = nextPhase(step.phase);
    cmd({ type: 'enter', phase: to, at: Date.now() });
    recompute();
    gotoPhase(to);
  }

  // an interactive downstream capture: the user configures the model's OWN free
  // inputs while the upstream-bound field(s) stay locked + authoritative. On
  // confirm it commits + records the step's transfer outcome (rendered by L0).
  function renderCaptureDownstream(step) {
    const o = order.fold(events);
    const alias = step.model; const M = models[alias];
    const ph = PH.find((p) => p.id === step.phase) || {};
    if (o.committed[alias]) {
      const wrap = el('div', 'phase-frozen');
      wrap.append(el('div', 'phase-hd', { text: `${ph.label || step.phase} · committed` }));
      const r = lastResult && lastResult.byAlias[alias];
      const card = el('div', 'preview-card'); card.appendChild(el('div', 'preview-t', { text: aliasLabel(alias) }));
      for (const c of figureCards(alias, M, r)) card.appendChild(c);
      wrap.appendChild(card);
      const done = o.steps[step.id];
      if (step.outcome && done && done.done) wrap.appendChild(renderByCategory(step.outcome, done, typesOf(captureAlias)));
      wrap.appendChild(el('p', 'phase-note', { text: 'Committed — the figures above are fixed. Continue from the stepper.' }));
      phaseHost.appendChild(wrap);
      return;
    }
    const wrap = el('div', 'phase-configure-down');
    wrap.appendChild(el('div', 'phase-hd', { text: `${ph.label || step.phase}` }));
    wrap.appendChild(el('p', 'phase-note', { text: `Configure ${aliasLabel(alias)} — upstream-bound values carry over; set the remaining inputs.` }));
    const slot = el('div', 'downstream-form'); wrap.appendChild(slot); phaseHost.appendChild(wrap);
    const locked = lockedFor(alias);   // only fields ACTUALLY injected this pass (gated bindings inject nothing)
    const injected = (lastResult && lastResult.byAlias[alias] && lastResult.byAlias[alias].config) || {};
    const init = { ...injected, ...(downstreamConfig[alias] || {}) };
    // a downstream model has no showroom turntable; the plain configurator handles
    // any field shape and honours locked (upstream-authoritative) inputs.
    host.acquire(alias, M.assembled).then((engine) => {
      mountConfigurator(slot, {
        model: M.merged, ir: M.assembled.ir, engine,
        initialConfig: Object.keys(init).length ? init : undefined,
        lockedFields: locked, ctaLabel: step.actionLabel,
        onConfigChange: (cfg) => { downstreamConfig[alias] = freeOnly(cfg, locked); recompute(); },
        onRequest: (cfg) => completeDownstream(step, cfg),
      });
    });
  }
  const freeOnly = (cfg, locked) => { const f = {}; for (const [k, v] of Object.entries(cfg)) if (!locked.has(k)) f[k] = v; return f; };
  // the fields authoritatively injected into `alias` this pass (empty for a gated
  // binding) — these are the ones locked; everything else is the user's to set.
  const lockedFor = (alias) => new Set(Object.keys((lastResult && lastResult.injected && lastResult.injected[alias]) || {}));

  function completeDownstream(step, cfg) {
    const alias = step.model; const free = freeOnly(cfg, lockedFor(alias));
    downstreamConfig[alias] = free;
    for (const [f, v] of Object.entries(free)) cmd({ type: 'set', alias, field: f, value: v });
    cmd({ type: 'commit', alias, hash: configKey(free) });
    cmd({ type: 'complete', step: step.id, payload: { outcome: step.outcome, label: step.label, value: `Ref ${orderId}-${step.id}`, at: Date.now(), enters: step.enters } });
    const to = nextPhase(step.phase);
    if (to !== step.phase) cmd({ type: 'enter', phase: to, at: Date.now() });
    recompute();
    gotoPhase(to);
  }

  function renderCeremony(step) {
    const o = order.fold(events);
    const wrap = el('div', 'phase-ceremony');
    wrap.append(el('div', 'phase-hd', { text: (PH.find((p) => p.id === step.phase) || {}).label || step.phase }), specCard());
    if (step.activity) wrap.appendChild(renderByCategory(step.activity, { label: step.label || step.id }, typesOf(captureAlias)));
    const done = o.steps[step.id] && o.steps[step.id].done;
    if (done) {
      if (step.outcome) wrap.appendChild(renderByCategory(step.outcome, o.steps[step.id], typesOf(captureAlias)));
      wrap.appendChild(el('p', 'phase-note', { text: 'Complete. Continue from the stepper.' }));
    } else {
      const box = el('div', 'sign-box');
      if (step.prompt) box.appendChild(el('label', 'sign-l', { text: step.prompt }));
      const input = el('input', 'sign-input', { type: 'text', placeholder: 'Full name', 'aria-label': step.prompt || 'Your name' });
      const btn = el('button', 'sign-go', { type: 'button', text: step.actionLabel || 'Confirm ▸', disabled: true });
      input.addEventListener('input', () => { btn.disabled = !input.value.trim(); });
      btn.addEventListener('click', () => { const r = cmd({ type: 'complete', step: step.id, payload: { by: input.value.trim(), outcome: step.outcome, ref: `${orderId}-${step.id}`, at: Date.now(), enters: step.enters } }); if (!r.error) { const to = nextPhase(step.phase); if (to !== step.phase) cmd({ type: 'enter', phase: to, at: Date.now() }); recompute(); gotoPhase(step.phase); } });
      box.append(input, btn); wrap.appendChild(box);
    }
    phaseHost.appendChild(wrap);
  }

  // format a live output value by its declared presentation format — delegated to
  // the shared formatOutput (currency/percent/unit/number) so it can never drift
  // from every other renderer. The flattened result-output shape matches its input.
  const fmtOut = (ro) => formatOutput(ro);

  // a model's live figures, each rendered by its INFERRED L0 category (never a
  // hardcoded 'amount_of_money') with its presentation role surfaced. Reused by
  // preview + downstream-capture steps.
  function figureCards(alias, M, r) {
    return (M.assembled.ir.outputs || []).map((o, i) => {
      const ro = r && r.outputs[i];
      if (!ro || ro.visible === false || ro.value == null) return null;
      const cat = categoryOf(M.merged, o.id) || 'amount_of_money';
      const label = o.label + (o.role === 'recurring' ? ' · recurring' : '');
      return renderByCategory(cat, { label, display: fmtOut(ro), origin: o.role && o.role !== 'line' ? o.role : null }, typesOf(alias));
    }).filter(Boolean);
  }

  function renderPreview(step) {
    const wrap = el('div', 'phase-preview');
    const ph = PH.find((p) => p.id === step.phase) || {};
    wrap.appendChild(el('div', 'phase-hd', { text: `${ph.label || step.phase} — what happens next` }));
    const alias = step.model;
    const M = alias && models[alias]; const r = alias && lastResult && lastResult.byAlias[alias];
    if (M) {
      const card = el('div', 'preview-card');
      card.appendChild(el('div', 'preview-t', { text: aliasLabel(alias) }));
      for (const c of figureCards(alias, M, r)) card.appendChild(c);
      wrap.appendChild(card);
    }
    wrap.appendChild(el('p', 'phase-note', { text: `Computed live from your ${L('captureNoun', 'specification')}.` }));
    phaseHost.appendChild(wrap);
  }

  // live cross-tab sync: if ANOTHER tab advances this order's log, adopt the fresh log
  // and re-render the rail + stepper. We deliberately do NOT rebuild the active input
  // panel here (that would discard in-progress typing) — the next navigation reflects
  // the new state; the CAS in cmd() has already guaranteed no write was lost.
  const stopSync = onExternalChange(() => {
    const fresh = loadEvents(orderId);
    if (fresh.length > events.length && order.fold(fresh).orderId === orderId) {
      events = fresh;
      stepper.setActive(order.fold(events).phase || phaseIds[0], reached());
      recompute();
    }
  });

  // compute the journey once BEFORE mounting the active phase, so a phase that
  // resumes straight into a downstream capture/preview has its injected figures ready.
  recompute().then(() => gotoPhase(order.fold(events).phase || phaseIds[0]));
  return { recompute, orderId, destroy: stopSync };
}
