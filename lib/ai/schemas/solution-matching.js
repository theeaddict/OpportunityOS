import { SchemaBuilder, nonEmpty, strArray, num100 } from './util.js';

/**
 * SOLUTION_MATCHING_AGENT output schema.
 * The agent may ONLY pick solution ids from the candidate list supplied in the
 * prompt; the validator enforces this (allowedIds).
 */
export function createSolutionMatchingSchema(allowedIds) {
  const allowed = allowedIds instanceof Set ? allowedIds : new Set(allowedIds);

  return {
    name: 'solution_matching',

    describe() {
      return `{
  "recommended_solution": { "solution_id": number (from the provided candidates), "fit_reason": string },
  "alternative_solutions": [{ "solution_id": number, "fit_reason": string }],
  "fit_score": 0..100
}
Only use solution_id values from the provided candidate list.`;
    },

    validate(data) {
      const b = new SchemaBuilder(this.name);
      if (!b.require(data && typeof data === 'object', 'response must be a JSON object')) return b.result(null);

      const rec = data.recommended_solution;
      if (!rec || typeof rec !== 'object') {
        b.require(false, 'recommended_solution object required');
        return b.result(null);
      }
      const recId = Number(rec.solution_id);
      if (!b.require(Number.isInteger(recId) && allowed.has(recId),
        `recommended_solution.solution_id must be one of: ${[...allowed].join(', ')}`)) {
        return b.result(null);
      }
      if (!b.require(nonEmpty(rec.fit_reason, 2000), 'recommended_solution.fit_reason required')) {
        return b.result(null);
      }

      const alternatives = [];
      let i = 0;
      for (const a of Array.isArray(data.alternative_solutions) ? data.alternative_solutions : []) {
        const id = a && Number(a.solution_id);
        if (!Number.isInteger(id) || !allowed.has(id) || id === recId) {
          b.require(false, `alternative_solutions[${i}].solution_id invalid or duplicates recommendation`);
        } else {
          alternatives.push({
            solution_id: id,
            fit_reason: nonEmpty(a.fit_reason, 1000) ? String(a.fit_reason).slice(0, 1000) : '',
          });
        }
        i++;
      }

      const fitScore = num100(data.fit_score);
      if (!b.require(fitScore !== null, 'fit_score (0-100) required')) return b.result(null);

      return b.result({
        recommended_solution: { solution_id: recId, fit_reason: String(rec.fit_reason).slice(0, 2000) },
        alternative_solutions: alternatives.slice(0, 5),
        fit_score: fitScore,
      });
    },
  };
}
