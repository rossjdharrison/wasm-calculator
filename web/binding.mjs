// =============================================================================
// binding.mjs — cross-file integrity between the data model and the presentation
// model. Errors block a build/save; warnings are advisory. Pure (unit-tested).
// =============================================================================
export function validateBinding(data, presentation) {
  const errors = [];
  const warnings = [];
  const fieldIds = new Set((data.fields || []).map((f) => f.id));
  const computedIds = new Set((data.computed || []).map((c) => c.id));
  const allIds = new Set([...fieldIds, ...computedIds]);
  const sectionIds = new Set((presentation.sections || []).map((s) => s.id));
  const presFields = new Map((presentation.fields || []).map((f) => [f.id, f]));
  const dataFields = new Map((data.fields || []).map((f) => [f.id, f]));

  for (const f of data.fields || []) {
    const pf = presFields.get(f.id);
    if (!pf) { warnings.push(`Field "${f.id}" has no presentation binding (renders with its id as label).`); continue; }
    if (pf.section && !sectionIds.has(pf.section)) errors.push(`Field "${f.id}" is placed in unknown section "${pf.section}".`);
    for (const o of f.options || []) {
      const po = (pf.options || []).find((x) => x.id === o.id);
      if (!po || po.label === undefined) warnings.push(`Option "${f.id}.${o.id}" has no label.`);
    }
  }

  for (const pf of presentation.fields || []) {
    if (!fieldIds.has(pf.id)) errors.push(`Presentation binds unknown field "${pf.id}".`);
    const df = dataFields.get(pf.id);
    if (df) {
      const dOpt = new Set((df.options || []).map((o) => o.id));
      for (const po of pf.options || []) if (!dOpt.has(po.id)) errors.push(`Field "${pf.id}" labels unknown option "${po.id}".`);
    }
  }

  for (const o of presentation.outputs || []) {
    if (!allIds.has(o.id)) errors.push(`Output "${o.id}" references an unknown value.`);
  }

  return { errors, warnings };
}
