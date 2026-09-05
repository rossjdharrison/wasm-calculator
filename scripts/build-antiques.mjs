// Author the Fine Art & Antiques model (data + presentation) into web/models/antiques/.
// Re-runnable. Exercises the SAME generic engine as vehicles: a hero "piece" deck,
// a 2d price table (piece × provenance), 1d deltas, availability gating (framing for
// paintings, condition for museum tier, uv-glazing needs a frame, installation for
// certain pieces), a multichoice "services" set, bundles, spec tables and computeds.
import { readFileSync, writeFileSync } from 'node:fs';
import { buildIR, mergeModel, referenceEvaluate } from '../web/assembler.mjs';
import { validateDocAgainstSchema } from '../web/schema-check.mjs';

const OUT = 'web/models/antiques/';

// ---- expr helpers ----
const field = (x) => ({ op: 'field', args: [x] });
const eq = (f, v) => ({ op: 'eq', args: [field(f), v] });
const or = (...a) => ({ op: 'or', args: a });
const and = (...a) => ({ op: 'and', args: a });
const not = (x) => ({ op: 'not', args: [x] });
const has = (f, o) => ({ op: 'has', args: [f, o] });
const L1 = (t, f) => ({ op: 'lookup', args: [t, field(f)] });
const L2 = (t, a, b) => ({ op: 'lookup', args: [t, field(a), field(b)] });
const iff = (c, a, b) => ({ op: 'if', args: [c, a, b] });
const add = (...a) => ({ op: 'add', args: a });
const mul = (...a) => ({ op: 'mul', args: a });
const div = (a, b) => ({ op: 'div', args: [a, b] });

// ---- the 8 pieces ----
const PIECES = [
  { id: 'mingVase',         label: 'Ming Dynasty Vase',        prov: [18000, 24000, 32000],   h: 45,  w: 24,  kg: 6,  painting: false, installs: false },
  { id: 'baroqueConsole',   label: 'Baroque Giltwood Console', prov: [12000, 15500, 21000],   h: 88,  w: 132, kg: 34, painting: false, installs: true },
  { id: 'impressionistOil', label: 'Impressionist Oil, c.1890', prov: [145000, 185000, 240000], h: 65, w: 81, kg: 5, painting: true,  installs: false },
  { id: 'turnerWatercolour', label: 'Turner Watercolour Study', prov: [42000, 55000, 72000],  h: 38,  w: 54,  kg: 3,  painting: true,  installs: false },
  { id: 'artDecoClock',     label: 'Art Deco Mantel Clock',    prov: [6500, 8500, 12000],     h: 32,  w: 20,  kg: 4,  painting: false, installs: false },
  { id: 'rodinBronze',      label: 'Bronze, School of Rodin',  prov: [88000, 115000, 155000], h: 52,  w: 28,  kg: 18, painting: false, installs: false },
  { id: 'persianRug',       label: 'Antique Persian Rug',      prov: [9500, 12500, 17000],    h: 340, w: 240, kg: 22, painting: false, installs: true },
  { id: 'muranoChandelier', label: 'Murano Glass Chandelier',  prov: [14000, 18000, 24500],   h: 110, w: 80,  kg: 28, painting: false, installs: true },
];
const PROV = ['documented', 'certified', 'museum'];
const painting = or(...PIECES.filter((p) => p.painting).map((p) => eq('piece', p.id)));
const installable = or(...PIECES.filter((p) => p.installs).map((p) => eq('piece', p.id)));

const SERVICES = [
  { id: 'insuranceValuation', label: 'Insurance valuation', price: 650 },
  { id: 'conditionReport',    label: 'Condition report',    price: 450 },
  { id: 'whiteGlove',         label: 'White-glove delivery', price: 1200 },
  { id: 'climatePackaging',   label: 'Climate packaging',   price: 750 },
  { id: 'installation',       label: 'Installation',        price: 900, availableWhen: installable },
  { id: 'uvGlazing',          label: 'UV museum glazing',   price: 550, availableWhen: not(eq('framing', 'none')) },
];
const BUNDLES = [
  { id: 'collectorsCare',   label: "Collector's Care",  requires: ['insuranceValuation', 'conditionReport', 'climatePackaging'], discount: 300 },
  { id: 'presentationSuite', label: 'Presentation Suite', requires: ['conditionReport', 'whiteGlove', 'installation'], discount: 350 },
];

// ---- DATA MODEL ----
const data = {
  $schema: 'https://quote.rowblaa.com/schema/model.schema.json',
  id: 'antiques-configurator', version: '1.0.0', currency: 'GBP',
  fields: [
    { id: 'piece', type: 'choice', default: 'mingVase', options: PIECES.map((p) => ({ id: p.id })) },
    { id: 'provenance', type: 'choice', default: 'documented', options: PROV.map((id) => ({ id })) },
    { id: 'condition', type: 'choice', default: 'asFound', options: [
      { id: 'asFound', availableWhen: not(eq('provenance', 'museum')) },  // museum-dossier pieces are supplied conserved
      { id: 'conserved' }, { id: 'restored' },
    ] },
    { id: 'framing', type: 'choice', default: 'none', options: [
      { id: 'none' },
      { id: 'gallery', availableWhen: painting }, { id: 'gilt', availableWhen: painting },
    ] },
    { id: 'services', type: 'multichoice', default: [], options: SERVICES.map((s) => (s.availableWhen ? { id: s.id, availableWhen: s.availableWhen } : { id: s.id })) },
    { id: 'settlement', type: 'choice', default: 'full', options: [{ id: 'full' }, { id: 'plan6' }, { id: 'plan12' }] },
  ],
  effects: [],
  tables: {
    pieceProvenancePrice: { kind: '2d', rows: Object.fromEntries(PIECES.map((p) => [p.id, Object.fromEntries(PROV.map((pr, i) => [pr, p.prov[i]]))])) },
    conditionDelta: { kind: '1d', map: { asFound: 0, conserved: 2500, restored: 6500 } },
    framingDelta: { kind: '1d', map: { none: 0, gallery: 1800, gilt: 4200 } },
    exportDoc: { kind: '1d', map: { documented: 0, certified: 150, museum: 400 } },
    instalmentMonths: { kind: '1d', map: { full: 1, plan6: 6, plan12: 12 } },
    specHeight: { kind: '1d', map: Object.fromEntries(PIECES.map((p) => [p.id, p.h])) },
    specWidth: { kind: '1d', map: Object.fromEntries(PIECES.map((p) => [p.id, p.w])) },
    specWeight: { kind: '1d', map: Object.fromEntries(PIECES.map((p) => [p.id, p.kg])) },
  },
  computed: [
    { id: 'servicesTotal', label: 'Services total', formula: add(...SERVICES.map((s) => iff(has('services', s.id), s.price, 0))) },
    { id: 'bundlesDiscount', formula: add(...BUNDLES.map((b) => iff(and(...b.requires.map((r) => has('services', r))), -b.discount, 0))) },
    { id: 'itemPrice', label: 'Acquisition', currency: true, formula: add(
      L2('pieceProvenancePrice', 'piece', 'provenance'), L1('conditionDelta', 'condition'), L1('framingDelta', 'framing'),
      field('servicesTotal'), field('bundlesDiscount'),
    ) },
    { id: 'feesTotal', label: 'Fees', currency: true, formula: add(250, L1('exportDoc', 'provenance')) },
    { id: 'total', label: 'Guide price', currency: true, formula: add(field('itemPrice'), field('feesTotal')) },
    { id: 'monthlyPayment', label: 'Instalment', currency: true, formula: iff(eq('settlement', 'full'), 0, div(field('total'), L1('instalmentMonths', 'settlement'))) },
    { id: 'insuranceValue', label: 'Insurance value', currency: true, formula: mul(field('itemPrice'), 1.15) },
    { id: 'height', formula: L1('specHeight', 'piece') },
    { id: 'width', formula: L1('specWidth', 'piece') },
    { id: 'weight', formula: L1('specWeight', 'piece') },
  ],
  validations: [
    { id: 'museum_note', field: 'condition', severity: 'info', message: 'Museum-dossier pieces are supplied conserved.', when: eq('provenance', 'museum') },
    { id: 'restored_note', field: 'condition', severity: 'info', message: 'Restoration is fully disclosed in the condition report.', when: eq('condition', 'restored') },
  ],
  bundles: BUNDLES,
};

// ---- PRESENTATION MODEL ----
const provLabel = { documented: 'Documented', certified: 'Certified', museum: 'Museum dossier' };
const condLabel = { asFound: 'As found', conserved: 'Conserved', restored: 'Restored' };
const frameLabel = { none: 'Unframed', gallery: 'Gallery frame', gilt: 'Gilt frame' };
const settleLabel = { full: 'Settle in full', plan6: '6 monthly', plan12: '12 monthly' };
const cur0 = { type: 'currency', decimals: 0, currencyCode: 'GBP' };

const pres = {
  name: 'Fine Art & Antiques',
  brand: { mark: 'ROWBLAA', rest: 'LUXURY', descriptor: 'Art & Antiques', tagline: 'Haarlem', cta: 'Enquire about this piece ▸' },
  sections: [
    { id: 's_piece', label: 'The piece', order: 1 },
    { id: 's_provenance', label: 'Provenance & condition', order: 2 },
    { id: 's_presentation', label: 'Framing & presentation', order: 3 },
    { id: 's_services', label: 'Services', order: 4 },
    { id: 's_settlement', label: 'Settlement', order: 5 },
  ],
  fields: [
    { id: 'piece', label: 'Piece', control: 'buttons', section: 's_piece', width: 'full', options: PIECES.map((p) => ({ id: p.id, label: p.label })) },
    { id: 'provenance', label: 'Provenance', control: 'buttons', section: 's_provenance', width: 'full', options: PROV.map((id) => ({ id, label: provLabel[id] })) },
    { id: 'condition', label: 'Condition', control: 'buttons', section: 's_provenance', width: 'full', options: ['asFound', 'conserved', 'restored'].map((id) => ({ id, label: condLabel[id] })) },
    { id: 'framing', label: 'Framing', control: 'buttons', section: 's_presentation', width: 'full', visibleWhen: painting, options: ['none', 'gallery', 'gilt'].map((id) => ({ id, label: frameLabel[id] })) },
    { id: 'services', label: 'Services', control: 'buttons', section: 's_services', width: 'full', options: SERVICES.map((s) => ({ id: s.id, label: s.label })) },
    { id: 'settlement', label: 'Settlement', control: 'buttons', section: 's_settlement', width: 'full', options: ['full', 'plan6', 'plan12'].map((id) => ({ id, label: settleLabel[id] })) },
  ],
  outputs: [
    { id: 'itemPrice', label: 'Acquisition', format: cur0 },
    { id: 'total', label: 'Guide price', format: cur0, emphasis: true, compare: 'low', compareLabel: 'Guide price' },
    { id: 'monthlyPayment', label: 'Instalment', format: cur0, visibleWhen: not(eq('settlement', 'full')) },
    { id: 'height', label: 'Height', format: { type: 'unit', unit: 'cm', decimals: 0 }, spec: true, compare: 'high' },
    { id: 'width', label: 'Width', format: { type: 'unit', unit: 'cm', decimals: 0 }, spec: true, compare: 'high' },
    { id: 'weight', label: 'Weight', format: { type: 'unit', unit: 'kg', decimals: 0 }, spec: true },
    { id: 'insuranceValue', label: 'Insurance value', format: cur0, spec: true, compare: 'high' },
  ],
};

writeFileSync(OUT + 'data-model.json', JSON.stringify(data, null, 2) + '\n');
writeFileSync(OUT + 'presentation-model.json', JSON.stringify(pres, null, 2) + '\n');

// ---- validate ----
const schema = JSON.parse(readFileSync('web/data.schema.json', 'utf8'));
const errs = validateDocAgainstSchema(data, schema);
console.log('schema-check:', errs.length ? JSON.stringify(errs, null, 2) : 'OK (no errors)');

const merged = mergeModel(data, pres);
const ir = buildIR(merged);
const show = (inp) => { const r = referenceEvaluate(ir, inp); return { status: r.status, item: r.valueById.itemPrice, total: r.valueById.total, monthly: r.valueById.monthlyPayment, insVal: Math.round(r.valueById.insuranceValue) }; };
console.log('Ming/documented/asFound/full:', JSON.stringify(show({ piece: 'mingVase', provenance: 'documented', condition: 'asFound', framing: 'none', services: [], settlement: 'full' })));
console.log('Oil/museum/restored/gilt + services + plan12:', JSON.stringify(show({ piece: 'impressionistOil', provenance: 'museum', condition: 'restored', framing: 'gilt', services: ['insuranceValuation', 'conditionReport', 'climatePackaging', 'uvGlazing'], settlement: 'plan12' })));
console.log('Rug/certified + install bundle:', JSON.stringify(show({ piece: 'persianRug', provenance: 'certified', condition: 'conserved', framing: 'none', services: ['conditionReport', 'whiteGlove', 'installation'], settlement: 'full' })));
console.log('✓ antiques model written to', OUT);
