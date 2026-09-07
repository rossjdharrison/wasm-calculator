// =============================================================================
// offer.mjs — is a saved offer still valid against the CURRENT models? (pure)
//
// A journey seals an OPAQUE offer snapshot onto the StepDone payload of the step
// flagged `sealsOffer` (the moment the customer assents to a total). This module
// reads that snapshot from the RAW event log and grades it against the latest
// models — WITHOUT teaching order.mjs any money/offer vocabulary (order.mjs still
// folds no derived value). Pure + DOM-free; domain-neutral.
//
//   sealedOffer(events)                          -> the last sealed offer, or null
//   checkOffer(events, journey, models, host)    -> { status, reason, offer, current }
//     status:
//       'draft'   — never sealed (or a legacy order with no snapshot): resume live,
//                   never expired. This is the grandfather path.
//       'valid'   — stamped versions match current (bytecode identical, so the
//                   numbers cannot have moved), OR a recompute reproduces the seal.
//       'expired' — a committed input no longer computes/validates, or the priced
//                   total moved beyond tolerance / a currency total appeared or went.
// =============================================================================
import { fold } from './order.mjs';
import { evaluateJourney } from './compose.mjs';

// the last offer snapshot sealed into the raw log (or null if never sealed).
export function sealedOffer(events) {
  let snap = null;
  for (const e of (events || [])) if (e.type === 'StepDone' && e.payload && e.payload.offer) snap = e.payload.offer;
  return snap;
}

const currentVersions = (models) =>
  Object.fromEntries(Object.entries(models || {}).map(([a, m]) => [a, (m && m.merged && m.merged.version) || null]));

// cheap gate: identical journey + per-model versions => identical bytecode => the
// sealed numbers still hold, so no recompute is needed.
function versionsMatch(snap, journey, models) {
  if (!snap) return false;
  if ((snap.journeyVersion ?? null) !== ((journey && journey.version) ?? null)) return false;
  const cur = currentVersions(models);
  const stamped = snap.modelVersions || {};
  for (const a of new Set([...Object.keys(cur), ...Object.keys(stamped)])) {
    if ((stamped[a] ?? null) !== (cur[a] ?? null)) return false;
  }
  return true;
}

export async function checkOffer(events, journey, models, host, { tolerance = 0.005 } = {}) {
  const snap = sealedOffer(events);
  if (!snap) return { status: 'draft', reason: 'no sealed offer', offer: null, current: null };

  // versions unchanged -> the total cannot have moved; skip the recompute.
  if (versionsMatch(snap, journey, models)) return { status: 'valid', reason: 'versions unchanged', offer: snap, current: null };

  // versions drifted -> the authoritative test: re-run the committed inputs through the
  // CURRENT models and compare against the sealed snapshot.
  let current;
  try {
    const o = fold(events);
    current = await evaluateJourney(journey, models, host, o.configByAlias);
  } catch (_) {
    return { status: 'expired', reason: 'the saved configuration no longer computes against the current models', offer: snap, current: null };
  }

  // structural: a committed input is no longer valid in the current model.
  for (const [alias, r] of Object.entries(current.byAlias || {})) {
    if (r && Array.isArray(r.blocking) && r.blocking.length) {
      return { status: 'expired', reason: `"${alias}" is no longer valid in the current model`, offer: snap, current };
    }
  }

  // price: a sealed total that moved beyond tolerance, went missing, or a new currency
  // total that appeared, expires the offer. Totals are pre-conversion (model base
  // currency), so the viewer's display-currency choice never affects this.
  const was = snap.totalsByCurrency || {};
  const now = current.totalsByCurrency || {};
  for (const [cur, wasAmt] of Object.entries(was)) {
    if (!(cur in now)) return { status: 'expired', reason: `the ${cur} price is no longer offered`, offer: snap, current };
    const denom = Math.abs(wasAmt) || 1;
    if (Math.abs(now[cur] - wasAmt) / denom > tolerance) {
      return { status: 'expired', reason: `the price changed (${cur} ${Math.round(wasAmt)} → ${Math.round(now[cur])})`, offer: snap, current };
    }
  }
  for (const cur of Object.keys(now)) if (!(cur in was)) return { status: 'expired', reason: `a new ${cur} total now applies`, offer: snap, current };

  return { status: 'valid', reason: 'recomputed; no material change', offer: snap, current };
}
