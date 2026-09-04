// =============================================================================
// Quote machine — front-end glue.
//
// This file is deliberately "dumb": every pricing and option-availability RULE
// lives in build/quote.wasm (compiled from assembly/quote.ts). On each change we
//   1. read the form,
//   2. hand the raw values to the WASM engine,
//   3. paint the numbers it returns, AND
//   4. enable / disable / clamp the option controls per the engine's flags.
//
// So the options a user can pick change as they type — driven entirely by WASM.
// =============================================================================

// ---- Contract shared with assembly/quote.ts --------------------------------
// Keep these in sync with the enums/flags in assembly/quote.ts.
const METHOD = { SCREEN: 0, DTG: 1, EMBROIDERY: 2 };
const FLAG = {
  SCREEN_AVAILABLE:     1 << 0,
  DTG_AVAILABLE:        1 << 1,
  EMBROIDERY_AVAILABLE: 1 << 2,
  COLORS_APPLICABLE:    1 << 3,
  RUSH_AVAILABLE:       1 << 4,
  MEMBERSHIP_APPLIED:   1 << 5,
};
const VALIDATION = {
  0: null,
  1: 'Screen printing needs at least 12 units — raise the quantity or switch method.',
  2: 'Too many ink colours for this method.',
  3: 'Too many print locations for this method.',
  4: "Rush turnaround isn't available for this configuration.",
};

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const pct = (r) => `${Math.round(r * 100)}%`;

// ---- Load the WASM engine --------------------------------------------------
// Pure-numeric boundary, so no bindings/loader are needed — instantiate raw
// bytes. The `env` stubs cover imports AssemblyScript may emit (abort/trace/seed);
// extra entries are harmless if the module doesn't import them.
async function loadEngine() {
  // Relative URL: resolves to /quote.wasm both in local dev (served from the
  // build/ dir) and in production (flat dist/ served at the site root).
  const res = await fetch('quote.wasm');
  if (!res.ok) {
    throw new Error(`Could not load quote.wasm (${res.status}). Run "npm start" (or "npm run build") first.`);
  }
  const bytes = await res.arrayBuffer();
  const imports = { env: { abort() {}, trace() {}, seed: () => 0 } };
  const { instance } = await WebAssembly.instantiate(bytes, imports);
  return instance.exports;
}

// ---- DOM handles -----------------------------------------------------------
const el = (id) => document.getElementById(id);
const methodInputs = () => Array.from(document.querySelectorAll('input[name="method"]'));
const selectedMethod = () => document.querySelector('input[name="method"]:checked');

const ctl = {
  quantity: () => el('quantity'),
  tier: () => el('tier'),
  locations: () => el('locations'),
  colors: () => el('colors'),
  rush: () => el('rush'),
  member: () => el('member'),
};

const num = (v, fallback) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

function readInputs() {
  return {
    quantity: Math.max(1, num(ctl.quantity().value, 1)),
    tier: num(ctl.tier().value, 0),
    method: num(selectedMethod()?.value, METHOD.DTG),
    locations: Math.max(1, num(ctl.locations().value, 1)),
    colors: Math.max(0, num(ctl.colors().value, 0)),
    rush: ctl.rush().checked ? 1 : 0,
    member: ctl.member().checked ? 1 : 0,
  };
}

let engine = null;

function runEngine(i) {
  engine.compute(i.quantity, i.tier, i.method, i.locations, i.colors, i.rush, i.member);
  return {
    unitPrice: engine.getUnitPrice(),
    subtotal: engine.getSubtotal(),
    discountRate: engine.getDiscountRate(),
    discountAmount: engine.getDiscountAmount(),
    rushFee: engine.getRushFee(),
    tax: engine.getTax(),
    total: engine.getTotal(),
    flags: engine.getFlags(),
    maxColors: engine.getMaxColors(),
    maxLocations: engine.getMaxLocations(),
    validation: engine.getValidation(),
  };
}

// ---- The reactive loop -----------------------------------------------------
// Two steps, in order:
//   1. normalize() — the engine may say the current selection is invalid (e.g.
//      screen print below the minimum qty, too many locations for embroidery).
//      We correct the CONTROL VALUES and re-run until the state is stable, so
//      the displayed numbers always match the (possibly corrected) inputs.
//   2. paint() — apply every flag-driven UI change (disable / hide / clamp) and
//      the prices, all from the FINAL, stable result.
function recompute() {
  let inputs = readInputs();
  let out = runEngine(inputs);

  // Correct invalid selections; loop until stable (bounded — each correction
  // moves toward a valid state, and DTG is always available).
  for (let pass = 0; pass < 3; pass++) {
    if (!normalize(inputs, out)) break;
    inputs = readInputs();
    out = runEngine(inputs);
  }

  paint(inputs, out);
}

// Mutate control VALUES only (not disabled/visibility). Returns true if it
// changed something, meaning we should recompute.
function normalize(inputs, out) {
  const has = (f) => (out.flags & f) !== 0;
  let changed = false;

  // Selected method became unavailable → fall back to DTG (always available).
  const methodAvailable = {
    [METHOD.SCREEN]: has(FLAG.SCREEN_AVAILABLE),
    [METHOD.DTG]: has(FLAG.DTG_AVAILABLE),
    [METHOD.EMBROIDERY]: has(FLAG.EMBROIDERY_AVAILABLE),
  };
  if (!methodAvailable[inputs.method]) {
    const dtg = methodInputs().find((r) => num(r.value, -1) === METHOD.DTG);
    if (dtg && !dtg.checked) {
      dtg.checked = true;
      changed = true;
    }
  }

  // Clamp ink colours to the engine's max (only when colours apply).
  if (has(FLAG.COLORS_APPLICABLE) && out.maxColors > 0 && inputs.colors > out.maxColors) {
    ctl.colors().value = String(out.maxColors);
    changed = true;
  }

  // Clamp print locations to the engine's max for the current method.
  if (inputs.locations > out.maxLocations) {
    ctl.locations().value = String(out.maxLocations);
    changed = true;
  }

  // Rush not available for this configuration → uncheck it.
  if (!has(FLAG.RUSH_AVAILABLE) && ctl.rush().checked) {
    ctl.rush().checked = false;
    changed = true;
  }

  return changed;
}

// Apply all availability/visibility and the prices from the final result.
function paint(inputs, out) {
  const has = (f) => (out.flags & f) !== 0;

  // Print-method availability
  const methodAvailable = {
    [METHOD.SCREEN]: has(FLAG.SCREEN_AVAILABLE),
    [METHOD.DTG]: has(FLAG.DTG_AVAILABLE),
    [METHOD.EMBROIDERY]: has(FLAG.EMBROIDERY_AVAILABLE),
  };
  methodInputs().forEach((r) => {
    const code = num(r.value, METHOD.DTG);
    r.disabled = !methodAvailable[code];
    r.closest('.opt')?.classList.toggle('is-disabled', !methodAvailable[code]);
  });

  // Ink colours: only for screen print; cap to the engine's max.
  const colorsApplicable = has(FLAG.COLORS_APPLICABLE);
  el('colors-field').classList.toggle('is-hidden', !colorsApplicable);
  ctl.colors().disabled = !colorsApplicable;
  if (colorsApplicable && out.maxColors > 0) {
    ctl.colors().max = String(out.maxColors);
    if (num(ctl.colors().value, 1) < 1) ctl.colors().value = '1';
  }

  // Print locations: reflect the engine's max for the current method.
  ctl.locations().max = String(out.maxLocations);

  // Rush availability.
  const rushAvailable = has(FLAG.RUSH_AVAILABLE);
  ctl.rush().disabled = !rushAvailable;
  el('rush-field').classList.toggle('is-disabled', !rushAvailable);

  render(out);
}

function render(out) {
  el('unit-price').textContent = currency.format(out.unitPrice);
  el('subtotal').textContent = currency.format(out.subtotal);
  el('discount-rate').textContent = out.discountRate > 0 ? `−${pct(out.discountRate)}` : '—';
  el('discount-amount').textContent =
    out.discountAmount > 0 ? `−${currency.format(out.discountAmount)}` : currency.format(0);
  el('rush-fee').textContent = out.rushFee > 0 ? currency.format(out.rushFee) : '—';
  el('tax').textContent = currency.format(out.tax);
  el('total').textContent = currency.format(out.total);

  el('member-applied').classList.toggle('is-hidden', (out.flags & FLAG.MEMBERSHIP_APPLIED) === 0);
  el('screen-hint').classList.toggle('is-hidden', (out.flags & FLAG.SCREEN_AVAILABLE) !== 0);

  const msg = VALIDATION[out.validation];
  const banner = el('message');
  if (msg) {
    banner.textContent = msg;
    banner.className = 'message message--warn';
  } else {
    banner.textContent = 'Looks good — the quote updates live as you edit.';
    banner.className = 'message message--ok';
  }
}

// ---- Boot ------------------------------------------------------------------
(async function boot() {
  try {
    engine = await loadEngine();
  } catch (err) {
    const banner = el('message');
    banner.textContent = err.message;
    banner.className = 'message message--warn';
    return;
  }
  const form = el('quote-form');
  form.addEventListener('input', recompute);
  form.addEventListener('change', recompute);
  recompute();
})();
