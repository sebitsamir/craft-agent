import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CraftError,
  CraftErrorCode,
  validateTaskContract,
  resolveCapability,
  serializeProtocolMessage,
  parseProtocolMessage,
  validateProtocolRequest,
} from '../dist/index.js';

/**
 * Phase F1 exit gate:
 * - Film and software contracts validate through the same kernel.
 * - Unsupported capabilities are visibly reported.
 * - High-impact tasks require a named reviewer role.
 * - Duplicate criteria are rejected.
 * - Local protocol messages are bounded and parseable.
 */
describe('Phase F1 exit gate', () => {
  const baseTask = {
    schemaVersion: 1,
    taskId: 'task-001',
    projectId: 'project-001',
    title: 'Universal contract smoke test',
    intent: 'Prove the same kernel validates multiple domains without domain-specific branching.',
    impact: 'low',
    outputs: [
      {
        id: 'output-1',
        kind: 'document',
        format: 'markdown',
        description: 'A reviewable text artifact.',
      },
    ],
    acceptance: [
      {
        id: 'criterion-1',
        statement: 'The artifact must exist in the required format.',
        evidence: {
          method: 'source_check',
          description: 'Check the artifact source exists and is readable.',
        },
      },
    ],
  };

  it('validates software and film task contracts through the same kernel', () => {
    const softwareTask = { ...baseTask, domain: 'software' };
    const filmTask = { ...baseTask, domain: 'film' };

    assert.doesNotThrow(() => validateTaskContract(softwareTask));
    assert.doesNotThrow(() => validateTaskContract(filmTask));
  });

  it('requires a named reviewer role for high-impact tasks', () => {
    const highImpactTask = { ...baseTask, domain: 'software', impact: 'high' };

    assert.throws(
      () => validateTaskContract(highImpactTask),
      (error) => error instanceof CraftError && error.code === CraftErrorCode.MISSING_REVIEWER_ROLE,
    );

    const reviewedHighImpactTask = {
      ...highImpactTask,
      review: { required: true, roles: ['staff-software-reviewer'] },
    };

    assert.doesNotThrow(() => validateTaskContract(reviewedHighImpactTask));
  });

  it('rejects high-impact tasks that declare review as not required', () => {
    const invalidHighImpact = {
      ...baseTask,
      domain: 'software',
      impact: 'high',
      review: { required: false, roles: ['staff-software-reviewer'] },
    };

    assert.throws(
      () => validateTaskContract(invalidHighImpact),
      (error) => error instanceof CraftError && error.code === CraftErrorCode.MISSING_REVIEWER_ROLE,
    );
  });

  it('rejects duplicate acceptance criterion ids', () => {
    const invalidTask = {
      ...baseTask,
      domain: 'software',
      acceptance: [
        baseTask.acceptance[0],
        {
          id: 'criterion-1',
          statement: 'Duplicate id should fail.',
          evidence: { method: 'manual_demo', description: 'Duplicate criterion evidence.' },
        },
      ],
    };

    assert.throws(
      () => validateTaskContract(invalidTask),
      (error) => error instanceof CraftError && error.code === CraftErrorCode.DUPLICATE_CRITERION_ID,
    );
  });

  it('accepts unsupported domain schemas but reports planned capabilities visibly', () => {
    const medicineTask = {
      ...baseTask,
      taskId: 'task-002',
      domain: 'medicine',
      title: 'Educational medical explainer',
      intent: 'Demonstrate unsupported domains are reported, not silently accepted as usable.',
    };

    // Schema validation is domain-neutral.
    assert.doesNotThrow(() => validateTaskContract(medicineTask));

    const plannedMedicineManifest = {
      id: 'pack-medicine',
      name: 'Medicine Pack',
      version: '0.1.0',
      domain: 'medicine',
      status: 'planned',
      description: 'Planned medical research/education assistance pack.',
      actions: [],
      validators: [],
      permissions: [],
    };

    assert.throws(
      () => resolveCapability([plannedMedicineManifest], 'medicine'),
      (error) => error instanceof CraftError && error.code === CraftErrorCode.CAPABILITY_PLANNED,
    );
  });

  it('serializes and parses bounded NDJSON protocol requests', () => {
    const request = {
      protocolVersion: 1,
      requestId: 'request-1',
      method: 'task.validate',
      projectId: 'project-001',
      taskId: 'task-001',
      params: {},
      idempotencyKey: 'idem-1',
      timestamp: new Date('2026-10-01T00:00:00.000Z').toISOString(),
    };

    const serialized = serializeProtocolMessage(request);
    assert.equal(serialized.endsWith('\n'), true);

    const parsed = validateProtocolRequest(parseProtocolMessage(serialized));
    assert.equal(parsed.requestId, 'request-1');
    assert.equal(parsed.method, 'task.validate');
  });
});
