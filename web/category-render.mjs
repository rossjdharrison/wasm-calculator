// =============================================================================
// category-render.mjs — the L0 CATEGORY → renderer registry. The journey shell
// renders individuals BY their inferred neutral HQDM category, never by domain
// id: an amount_of_money is a money chip, a class_of_physical_object is a hero,
// a party is a party card, a state is a begin/end status chip. Unknown → a
// neutral card. This is what lets the same shell present any sale (vehicles,
// antiques, …) and any downstream context (financing, fulfilment) with no
// domain-specific view code. The stateChip ships now; live temporal driving is
// deferred to EXCHANGE/FULFILMENT.
// =============================================================================
import { el } from './ui.mjs';
import { leafCategoryOf } from './hqdm.mjs';

const money = (n) => el('div', 'cr cr-money', { html: `<span class="cr-l">${n.label || 'Amount'}</span><span class="cr-v num">${n.display ?? n.amount ?? ''}</span>${n.origin ? `<span class="cr-badge">${n.origin}</span>` : ''}` });
const transfer = (n) => el('div', 'cr cr-transfer', { html: `<span class="cr-l">${n.label || 'Transfer'}</span><span class="cr-v">${n.value || n.display || n.by || ''}</span>` });

export const CATEGORY_RENDERERS = {
  amount_of_money: money,
  physical_quantity: (n) => el('div', 'cr cr-qty', { html: `<span class="cr-l">${n.label || ''}</span><span class="cr-v num">${n.display ?? n.value ?? ''}</span>` }),
  class_of_physical_object: (n) => el('div', 'cr cr-hero', { html: `<div class="cr-hero-t">${n.label || 'Specification'}</div>` + (n.parts ? `<div class="cr-parts">${Object.entries(n.parts).map(([k, v]) => `<span class="cr-part"><b>${k}</b> ${Array.isArray(v) ? (v.join(', ') || '—') : v}</span>`).join('')}</div>` : '') }),
  party: (n) => el('div', 'cr cr-party', { html: `<span class="cr-l">${n.role || 'Party'}</span><span class="cr-v">${n.name || ''}</span>` }),
  organization: (n) => CATEGORY_RENDERERS.party(n),
  person: (n) => CATEGORY_RENDERERS.party(n),
  agreement: (n) => el('div', 'cr cr-contract', { html: `<span class="cr-l">Agreement</span><span class="cr-v">${n.ref || n.label || '—'}</span>` }),
  sign: (n) => el('div', 'cr cr-sign', { html: `<span class="cr-l">Signature</span><span class="cr-v">${n.by || '—'}</span>` }),
  activity: (n) => el('div', 'cr cr-step', { html: `<span class="cr-l">${n.label || 'Step'}</span>${n.detail ? `<span class="cr-v">${n.detail}</span>` : ''}` }),
  state: (n) => el('div', 'cr cr-state', { html: `<span class="cr-dot ${n.status || 'pending'}"></span><span class="cr-l">${n.label || ''}</span>${n.begin ? `<span class="cr-when">${n.begin}${n.end ? ' – ' + n.end : ''}</span>` : ''}` }),
  // a period_of_time is a timeline of temporal parts (the current one marked).
  period_of_time: (n) => el('div', 'cr cr-timeline', { html: `<span class="cr-l">${n.label || 'Timeline'}</span><div class="cr-tl">${(n.parts || []).map((p) => `<span class="cr-tl-part${p.current ? ' current' : ''}"><b>${p.label}</b>${p.at ? `<span class="cr-when">${p.at}</span>` : ''}</span>`).join('')}</div>` }),
  transfer_of_ownership: transfer,
  transfer_of_possession: transfer,
};

// render a node by the (inferred) neutral category of `category`. `types` = the
// model's own type declarations, so a domain type resolves to its neutral leaf.
export function renderByCategory(category, node = {}, types) {
  const leaf = leafCategoryOf(category, types) || category;
  const r = CATEGORY_RENDERERS[leaf];
  return r ? r(node) : el('div', 'cr cr-neutral', { html: `<span class="cr-l">${node.label || category || ''}</span><span class="cr-v">${node.display ?? node.value ?? ''}</span>` });
}
