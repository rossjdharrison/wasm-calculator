// =============================================================================
// phase-stepper.mjs — the sale's phase progression (Configure → Agree & Sign →
// Exchange & Settlement → Fulfilment). Reached phases are clickable, the active
// one is aria-current, unreached phases are locked previews (disabled).
// =============================================================================
import { el } from './ui.mjs';

export function mountStepper(host, { phases, activeId, reachedIds = [], onSelect }) {
  const reached = new Set([...reachedIds, activeId]);
  const row = el('div', 'stepper', { role: 'list' });
  const render = (active) => {
    row.innerHTML = '';
    phases.forEach((p, i) => {
      const state = p.id === active ? 'active' : reached.has(p.id) ? 'done' : 'locked';
      const step = el('button', `step is-${state}`, { type: 'button', role: 'listitem', disabled: state === 'locked' });
      if (p.id === active) step.setAttribute('aria-current', 'step');
      step.innerHTML = `<span class="step-n">${state === 'done' && p.id !== active ? '✓' : state === 'locked' ? '·' : i + 1}</span><span class="step-l">${p.label}</span>`;
      if (state !== 'locked' && onSelect) step.addEventListener('click', () => onSelect(p.id));
      row.appendChild(step);
    });
  };
  render(activeId);
  host.appendChild(row);
  return {
    setActive(id, reachedNow) { if (reachedNow) reachedNow.forEach((r) => reached.add(r)); reached.add(id); render(id); },
  };
}
