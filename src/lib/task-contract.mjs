import { domainById } from './domains.mjs';

const DOMAIN_ID = /^[a-z][a-z0-9-]{1,63}$/;
const EVIDENCE_METHODS = new Set(['test', 'render', 'source_check', 'expert_review', 'calculation', 'human_review', 'manual_demo']);
const IMPACTS = new Set(['low', 'moderate', 'high']);

const nonempty = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Validates intent and verifiability, not professional correctness or safety.
 * Unknown domains remain valid to allow third-party packs in the future.
 */
export function validateTask(task) {
  const errors = [];
  const warnings = [];
  if (!object(task)) return { valid: false, errors: ['Task must be an object.'], warnings, summary: null };
  if (task.schemaVersion !== 1) errors.push('schemaVersion must be 1.');
  if (!nonempty(task.title, 200)) errors.push('title must be a nonempty string of at most 200 characters.');
  if (!nonempty(task.intent, 4000)) errors.push('intent must be a nonempty string of at most 4000 characters.');
  if (typeof task.domain !== 'string' || !DOMAIN_ID.test(task.domain)) errors.push('domain must be a lowercase identifier.');
  if (!IMPACTS.has(task.impact)) errors.push('impact must be low, moderate, or high.');
  if (!Array.isArray(task.outputs) || task.outputs.length < 1 || task.outputs.length > 20) {
    errors.push('outputs must contain 1 to 20 artifacts.');
  } else {
    task.outputs.forEach((output, i) => {
      if (!object(output) || !nonempty(output.kind, 80) || !nonempty(output.format, 40) || !nonempty(output.description, 1000)) {
        errors.push(`outputs[${i}] needs kind, format, and description.`);
      }
    });
  }
  if (!Array.isArray(task.acceptance) || task.acceptance.length < 1 || task.acceptance.length > 30) {
    errors.push('acceptance must contain 1 to 30 criteria.');
  } else {
    const ids = new Set();
    task.acceptance.forEach((criterion, i) => {
      if (!object(criterion) || !nonempty(criterion.id, 80) || !nonempty(criterion.statement, 1000)) {
        errors.push(`acceptance[${i}] needs an id and statement.`);
      } else if (ids.has(criterion.id)) errors.push(`Duplicate criterion id: ${criterion.id}.`);
      else ids.add(criterion.id);
      if (!object(criterion?.evidence) || !EVIDENCE_METHODS.has(criterion.evidence.method) ||
          !nonempty(criterion.evidence.description, 1000)) {
        errors.push(`acceptance[${i}] needs a supported evidence method and description.`);
      }
    });
  }
  if (task.impact === 'high' && (!object(task.review) || task.review.required !== true || !nonempty(task.review.role, 120))) {
    errors.push('High-impact tasks require a named qualified-reviewer role.');
  }
  if (task.review !== undefined && (!object(task.review) || typeof task.review.required !== 'boolean' ||
      (task.review.required && !nonempty(task.review.role, 120)))) {
    errors.push('review must specify required and a role when required is true.');
  }
  if (typeof task.domain === 'string' && DOMAIN_ID.test(task.domain)) {
    const domain = domainById(task.domain);
    if (!domain) warnings.push('No built-in domain pack is registered; domain-specific verification is unavailable.');
    else if (domain.status !== 'bootstrap') warnings.push(`The ${task.domain} domain pack is planned; this validator does not create or verify its outputs.`);
    if (domain?.reviewHint === 'consequential-use' && task.impact !== 'high') {
      warnings.push('Check whether this use could affect a real person or consequential decision; impact may need to be high.');
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      title: typeof task.title === 'string' ? task.title : null,
      domain: typeof task.domain === 'string' ? task.domain : null,
      impact: task.impact ?? null,
      outputCount: Array.isArray(task.outputs) ? task.outputs.length : 0,
      criterionCount: Array.isArray(task.acceptance) ? task.acceptance.length : 0,
      qualifiedReviewRequired: task.impact === 'high',
    },
  };
}
