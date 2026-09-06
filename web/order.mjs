// =============================================================================
// order.mjs — a GENERIC event-sourced accumulator (L3 mechanism, domain-neutral).
//
// It knows nothing about sales, agreements or signing. It folds a log of neutral
// events into an order state; the SPECIFIC process (which phases exist, which
// steps run, what "committing" or "signing" means) is DECLARED in the journey
// model and interpreted by journey-view — this engine only provides the folded
// log + single-authority guard. Only captured CONFIG comes from events; derived
// values are recomputed by the engine, never folded. Pure + DOM-free.
//
//   Started {orderId, journeyId}       — opens the order
//   Set {alias, field, value}          — a captured input value
//   Committed {alias, hash}            — an alias's capture is frozen (single-authority)
//   Entered {phase}                    — the journey advanced to a phase (id from the model)
//   StepDone {step, payload}           — a model-declared step completed (id + payload from the model)
// =============================================================================

export const ORDER_EVENTS = ['Started', 'Set', 'Committed', 'Entered', 'StepDone'];

export function startOrder(orderId, journeyId, journeyVersion) {
  return [{ type: 'Started', orderId, journeyId, journeyVersion: journeyVersion ?? null }];
}

export function fold(events) {
  const o = { orderId: null, journeyId: null, journeyVersion: null, phase: null, configByAlias: {}, committed: {}, steps: {}, seq: (events || []).length };
  for (const e of events || []) {
    switch (e.type) {
      case 'Started': o.orderId = e.orderId; o.journeyId = e.journeyId; o.journeyVersion = e.journeyVersion ?? null; break;
      case 'Set': if (!o.committed[e.alias]) (o.configByAlias[e.alias] = o.configByAlias[e.alias] || {})[e.field] = e.value; break;
      case 'Committed': o.committed[e.alias] = e.hash ?? true; break;
      case 'Entered': o.phase = e.phase; break;
      case 'StepDone': o.steps[e.step] = { ...(e.payload || {}), done: true }; break;
    }
  }
  return o;
}

// validate a command against the current fold; append the event(s) if legal.
// Never mutates the input log; on rejection returns it unchanged with an error.
export function apply(events, cmd) {
  const o = fold(events);
  const out = [...(events || [])];
  const reject = (error) => ({ events, error });
  switch (cmd.type) {
    case 'set':
      if (o.committed[cmd.alias]) return reject(`"${cmd.alias}" is committed — "${cmd.field}" cannot change (single-authority)`);
      out.push({ type: 'Set', alias: cmd.alias, field: cmd.field, value: cmd.value });
      break;
    case 'commit':
      if (o.committed[cmd.alias]) return reject(`"${cmd.alias}" is already committed`);
      out.push({ type: 'Committed', alias: cmd.alias, hash: cmd.hash ?? null });
      break;
    case 'enter':
      // `at` (a point_in_time) is passed IN by the caller (journey-view stamps
      // Date.now); order.mjs stays pure/clock-free. Defaults null for legacy events.
      out.push({ type: 'Entered', phase: cmd.phase, at: cmd.at ?? null });
      break;
    case 'complete':
      if (o.steps[cmd.step] && o.steps[cmd.step].done) return reject(`step "${cmd.step}" is already done`);
      out.push({ type: 'StepDone', step: cmd.step, payload: cmd.payload || {} });
      break;
    default:
      return reject(`unknown command "${cmd.type}"`);
  }
  return { events: out, error: null };
}

export function replay(events, toSeq) { return fold((events || []).slice(0, toSeq)); }

// the saved orders belonging to one journey (pure filter over the order index).
export const ordersForJourney = (list, journeyId) => (list || []).filter((o) => o && o.journeyId === journeyId);

// =============================================================================
// temporalOf — the 4-D projection of the raw log (order is 4-dimensionalist).
// The order is a period_of_time; its temporal parts are the phases Entered (each
// stamped with a point_in_time `at`); each individual has a succession of STATES,
// each bounded by a begin/end point_in_time. It reads the RAW ordered log (not
// fold, which discards order + payloads). Pure + deterministic — no clock inside;
// `at` values are whatever the caller stamped into the events. individual / state
// / category are OPAQUE strings sourced from a step's declared `enters` (data), so
// this engine holds no domain/state vocabulary.
//
// Returns { phaseEntries:[{phase,at}], statesByIndividual:{ [id]: [entry,...] } }
// where entry = { state, category, role, label, begin, end, status }.
// status: 'pending' (no begin), 'active' (open), 'ended' (closed by a later state).
// =============================================================================
export function temporalOf(events) {
  const phaseEntries = [];
  const statesByIndividual = {};
  for (const e of events || []) {
    if (e.type === 'Entered') { phaseEntries.push({ phase: e.phase, at: e.at ?? null }); continue; }
    if (e.type !== 'StepDone') continue;
    const at = (e.payload && e.payload.at) ?? null;
    for (const s of (e.payload && e.payload.enters) || []) {
      const ind = s.individual || '';
      const arr = (statesByIndividual[ind] = statesByIndividual[ind] || []);
      const open = arr.find((x) => x.end == null);
      // only close a prior state when we have a closing time; without one, leave it
      // open rather than fabricating an 'ended' interval with no end point_in_time.
      if (open && at != null) { open.end = at; open.status = 'ended'; }
      arr.push({ state: s.state || s.category, category: s.category, role: s.role || null, label: s.label || null, begin: at, end: null, status: at == null ? 'pending' : 'active' });
    }
  }
  return { phaseEntries, statesByIndividual };
}

// the single-authority contract a downstream context consumes (frozen config +
// completed steps). Derived values are NOT here — they are recomputed.
export function contractOf(order) {
  return { configByAlias: order.configByAlias, committed: order.committed, phase: order.phase, steps: order.steps };
}
