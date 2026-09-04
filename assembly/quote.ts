// =============================================================================
// Quote engine — compiled to WebAssembly (AssemblyScript).
//
// This is the "brain" of the quote machine. The browser passes the current form
// values into `compute(...)` on every keystroke/change, then reads the results
// back through the `get*` exports. Two kinds of things come back out:
//
//   1. NUMBERS  — unit price, subtotal, discounts, tax, total.
//   2. OPTIONS  — which choices are currently allowed, and their dynamic limits
//                 (e.g. "screen printing needs >=12 units", "embroidery caps at
//                 2 locations"). The UI uses these to enable/disable/clamp its
//                 controls, so the available options change as the user types.
//
// The WASM boundary is intentionally PURE-NUMERIC (numbers in, numbers out) so
// there is no memory marshalling to worry about. Results are stashed in module
// globals by `compute` and exposed via getters.
//
// -- Adapting this to your own quote domain -----------------------------------
// Replace the enums, the pricing tables (`garmentBase`, `printCost`,
// `volumeDiscount`) and the rules inside `compute`. Keep the plumbing (numeric
// args in, getters out, a flags bitfield for availability) and the front-end
// keeps working. Remember to mirror any enum/flag changes in web/app.js.
// =============================================================================

// ---- Domain enums (i32 codes so they cross the WASM boundary as numbers) -----
// Garment tier
const TIER_STANDARD: i32 = 0;
const TIER_PREMIUM: i32 = 1;
const TIER_ORGANIC: i32 = 2;

// Print method
const METHOD_SCREEN: i32 = 0;
const METHOD_DTG: i32 = 1;
const METHOD_EMBROIDERY: i32 = 2;

// ---- Option-availability flags (bitfield returned by getFlags) --------------
// The UI reads these to decide which controls to enable / show / clamp.
const FLAG_SCREEN_AVAILABLE: i32 = 1 << 0;
const FLAG_DTG_AVAILABLE: i32 = 1 << 1;
const FLAG_EMBROIDERY_AVAILABLE: i32 = 1 << 2;
const FLAG_COLORS_APPLICABLE: i32 = 1 << 3;
const FLAG_RUSH_AVAILABLE: i32 = 1 << 4;
const FLAG_MEMBERSHIP_APPLIED: i32 = 1 << 5;

// ---- Validation codes (returned by getValidation) ---------------------------
const VALID_OK: i32 = 0;
const VALID_BELOW_MIN_QTY: i32 = 1;
const VALID_TOO_MANY_COLORS: i32 = 2;
const VALID_TOO_MANY_LOCATIONS: i32 = 3;
const VALID_RUSH_UNAVAILABLE: i32 = 4;

// ---- Business constants (tune these to your pricing) ------------------------
const SCREEN_MIN_QTY: i32 = 12;         // screen printing needs a minimum run
const SCREEN_MAX_COLORS: i32 = 6;       // colours per location for screen print
const EMBROIDERY_MAX_LOCATIONS: i32 = 2;
const OTHER_MAX_LOCATIONS: i32 = 4;
const RUSH_MAX_QTY: i32 = 250;          // can't rush very large runs
const RUSH_SURCHARGE: f64 = 0.20;       // +20%
const MEMBER_DISCOUNT: f64 = 0.10;      // -10%
const MAX_DISCOUNT: f64 = 0.50;         // cap on stacked discounts
const TAX_RATE: f64 = 0.08;

// ---- Pricing tables ---------------------------------------------------------
// Base garment cost per unit, by tier.
function garmentBase(tier: i32): f64 {
  if (tier == TIER_PREMIUM) return 9.50;
  if (tier == TIER_ORGANIC) return 12.00;
  return 6.00; // standard
}

// Volume discount rate, by quantity.
function volumeDiscount(qty: i32): f64 {
  if (qty >= 500) return 0.25;
  if (qty >= 250) return 0.18;
  if (qty >= 100) return 0.12;
  if (qty >= 50) return 0.06;
  if (qty >= 24) return 0.03;
  return 0.0;
}

// Per-unit decoration cost for the chosen method / locations / colours.
function printCost(method: i32, locations: i32, colors: i32): f64 {
  if (method == METHOD_SCREEN) {
    // cheap ink per unit, but each colour at each location adds a little
    return f64(locations) * (1.20 + f64(colors) * 0.35);
  }
  if (method == METHOD_DTG) {
    // full-colour, flat per location, pricier per unit
    return f64(locations) * 4.50;
  }
  // embroidery: premium per location, colours irrelevant (thread)
  return f64(locations) * 6.75;
}

// ---- Result globals (written by compute, read by the getters) ---------------
let rUnitPrice: f64 = 0;
let rSubtotal: f64 = 0;
let rDiscountRate: f64 = 0;
let rDiscountAmount: f64 = 0;
let rRushFee: f64 = 0;
let rTax: f64 = 0;
let rTotal: f64 = 0;
let rFlags: i32 = 0;
let rMaxColors: i32 = 0;
let rMaxLocations: i32 = 0;
let rValidation: i32 = 0;

// =============================================================================
// compute — run every rule against the current inputs.
// booleans are passed as 0/1 because the WASM boundary only speaks numbers.
// =============================================================================
export function compute(
  quantity: i32,
  tier: i32,
  method: i32,
  locations: i32,
  colors: i32,
  rush: i32,   // 0 / 1
  member: i32  // 0 / 1
): void {
  // ---- 1. Which OPTIONS are available given the current inputs? ------------
  let flags: i32 = 0;

  const screenAvailable = quantity >= SCREEN_MIN_QTY; // screen needs a min run
  if (screenAvailable) flags |= FLAG_SCREEN_AVAILABLE;
  flags |= FLAG_DTG_AVAILABLE;        // DTG works at any quantity
  flags |= FLAG_EMBROIDERY_AVAILABLE; // embroidery works at any quantity

  const colorsApplicable = method == METHOD_SCREEN; // only screen uses colours
  if (colorsApplicable) flags |= FLAG_COLORS_APPLICABLE;

  // dynamic limits for the current method
  const maxColors = method == METHOD_SCREEN ? SCREEN_MAX_COLORS : 0;
  const maxLocations =
    method == METHOD_EMBROIDERY ? EMBROIDERY_MAX_LOCATIONS : OTHER_MAX_LOCATIONS;

  // rush only for small/medium, non-embroidery orders
  const rushAvailable = quantity <= RUSH_MAX_QTY && method != METHOD_EMBROIDERY;
  if (rushAvailable) flags |= FLAG_RUSH_AVAILABLE;

  // ---- 2. Validate the requested inputs against the rules ------------------
  let validation = VALID_OK;
  if (method == METHOD_SCREEN && quantity < SCREEN_MIN_QTY) {
    validation = VALID_BELOW_MIN_QTY;
  } else if (colorsApplicable && colors > maxColors) {
    validation = VALID_TOO_MANY_COLORS;
  } else if (locations > maxLocations) {
    validation = VALID_TOO_MANY_LOCATIONS;
  } else if (rush == 1 && !rushAvailable) {
    validation = VALID_RUSH_UNAVAILABLE;
  }

  // ---- 3. Clamp the values we actually price with, so the quote is sane ----
  let effColors = colorsApplicable ? (colors > maxColors ? maxColors : colors) : 0;
  if (effColors < 0) effColors = 0;
  let effLocations = locations > maxLocations ? maxLocations : locations;
  if (effLocations < 1) effLocations = 1;

  // ---- 4. Price it --------------------------------------------------------
  const unit = garmentBase(tier) + printCost(method, effLocations, effColors);
  const subtotal = unit * f64(quantity);

  let discountRate = volumeDiscount(quantity);
  if (member == 1) {
    discountRate += MEMBER_DISCOUNT;
    flags |= FLAG_MEMBERSHIP_APPLIED;
  }
  if (discountRate > MAX_DISCOUNT) discountRate = MAX_DISCOUNT;
  const discountAmount = subtotal * discountRate;
  const afterDiscount = subtotal - discountAmount;

  let rushFee: f64 = 0;
  if (rush == 1 && rushAvailable) rushFee = afterDiscount * RUSH_SURCHARGE;

  const taxable = afterDiscount + rushFee;
  const tax = taxable * TAX_RATE;
  const total = taxable + tax;

  // ---- 5. Stash results for the getters -----------------------------------
  rUnitPrice = unit;
  rSubtotal = subtotal;
  rDiscountRate = discountRate;
  rDiscountAmount = discountAmount;
  rRushFee = rushFee;
  rTax = tax;
  rTotal = total;
  rFlags = flags;
  rMaxColors = maxColors;
  rMaxLocations = maxLocations;
  rValidation = validation;
}

// ---- Getters (read after each compute) --------------------------------------
export function getUnitPrice(): f64 { return rUnitPrice; }
export function getSubtotal(): f64 { return rSubtotal; }
export function getDiscountRate(): f64 { return rDiscountRate; }
export function getDiscountAmount(): f64 { return rDiscountAmount; }
export function getRushFee(): f64 { return rRushFee; }
export function getTax(): f64 { return rTax; }
export function getTotal(): f64 { return rTotal; }
export function getFlags(): i32 { return rFlags; }
export function getMaxColors(): i32 { return rMaxColors; }
export function getMaxLocations(): i32 { return rMaxLocations; }
export function getValidation(): i32 { return rValidation; }
