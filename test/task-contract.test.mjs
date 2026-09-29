import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { validateTask } from '../src/lib/task-contract.mjs';
import { domainById } from '../src/lib/domains.mjs';

test('a creative task records outputs and verifiable acceptance without claiming the pack works', async () => {
  const task = JSON.parse(await readFile(new URL('../examples/film-task.json', import.meta.url)));
  const result = validateTask(task);
  assert.equal(result.valid, true);
  assert.equal(result.summary.outputCount, 2);
  assert.match(result.warnings.join(' '), /planned/);
  assert.equal(domainById('film').status, 'planned');
});

test('high-impact work cannot pass the task contract without a reviewer role', () => {
  const task = {
    schemaVersion: 1, title: 'Review patient data', intent: 'Summarize observations',
    domain: 'medicine', impact: 'high',
    outputs: [{ kind: 'report', format: 'md', description: 'Observational draft' }],
    acceptance: [{ id: 'trace', statement: 'Sources are traceable', evidence: { method: 'source_check', description: 'Verify each claim' } }],
    review: { required: false },
  };
  const blocked = validateTask(task);
  assert.equal(blocked.valid, false);
  assert.match(blocked.errors.join(' '), /qualified-reviewer/);
  task.review = { required: true, role: 'licensed clinician' };
  assert.equal(validateTask(task).valid, true);
});

test('duplicate criteria and unsupported evidence are rejected; custom domains remain extensible', () => {
  const task = {
    schemaVersion: 1, title: 'Design a garden', intent: 'Produce a planting plan',
    domain: 'landscape', impact: 'low',
    outputs: [{ kind: 'plan', format: 'pdf', description: 'Planting diagram' }],
    acceptance: [
      { id: 'a', statement: 'Measured plot', evidence: { method: 'manual_demo', description: 'Measure the site' } },
      { id: 'a', statement: 'Plant list', evidence: { method: 'magic', description: 'Check the list' } },
    ],
  };
  const result = validateTask(task);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /Duplicate criterion/);
  assert.match(result.errors.join(' '), /supported evidence method/);
  assert.match(result.warnings.join(' '), /No built-in domain pack/);
});
