// =============================================================================
// preview.mjs — the shared "what does this model produce?" preview, used by the
// Data page and the JSON page (both show a live default quote from the engine).
// Extracted from the two verbatim copies; the fmt() percent branch is reconciled
// to the fuller rule (min + max fraction digits).
// =============================================================================
import { el, formatOutput } from './ui.mjs';

// default inputs for a live preview — first option / empty / false / 0 per type
export function buildDefaults(ir) {
  const inp = {};
  for (const f of ir.fields) {
    if (f.type === 'choice') inp[f.id] = f.defaultRaw ?? f.options[0]?.id;
    else if (f.type === 'multichoice') inp[f.id] = f.defaultRaw ?? [];
    else if (f.type === 'boolean') inp[f.id] = !!f.defaultRaw;
    else inp[f.id] = f.defaultRaw ?? 0;
  }
  return inp;
}

// format one output value — the shared formatter (ui.mjs), re-exported so the
// studio preview and the live Configurator can never drift.
export const fmt = formatOutput;

// the static "Default quote" list of visible outputs
export function renderStaticPreview(host, ir, res, title = 'Default quote (live)') {
  host.innerHTML = '';
  host.appendChild(el('div', 'qc-preview__title', { text: title }));
  ir.outputs.forEach((o, i) => {
    const r = res.outputs[i]; if (!r.visible) return;
    const row = el('div', 'qc-preview__row');
    row.append(el('span', null, { text: o.label }), el('span', null, { text: fmt(r) }));
    host.appendChild(row);
  });
}
