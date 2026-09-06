// =============================================================================
// journey-create-core.mjs — the PURE, DOM-free heart of the journey create/edit
// page: mint a blank journey, slugify a title into a URL-safe id, and disambiguate
// against existing ids. No Date.now/Math.random — ids come from the title +
// caller-supplied existing-id set, so it is deterministic and unit-testable.
// =============================================================================

export function slugify(title, fallback = 'journey') {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 48)
    .replace(/^-+|-+$/g, '') || fallback;
}

// a slug not already taken by `existingIds` (an array or Set). Appends -2, -3, …
export function uniqueJourneyId(base, existingIds = []) {
  const taken = existingIds instanceof Set ? existingIds : new Set(existingIds);
  const slug = slugify(base);
  if (!taken.has(slug)) return slug;
  let n = 2; while (taken.has(`${slug}-${n}`)) n++;
  return `${slug}-${n}`;
}

// a blank, VALID-shaped journey document (passes validateJourneyShape once it has
// at least one model + one step; empty models/steps are intentional on creation).
export function newJourney(id, title, correlationPrefix = '', version = '1.0.0') {
  const j = { id, version, title, models: [], bindings: [], process: { steps: [] } };
  if (correlationPrefix) j.correlationPrefix = correlationPrefix;
  return j;
}
