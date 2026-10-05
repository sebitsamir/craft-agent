/**
 * Step Action Registry (E2).
 * Maps declarative action kinds to real, safety-guarded capability calls.
 */
import { inspect as softwareInspect } from './inspect.mjs';
import { verify as softwareVerify } from './verify.mjs';
import { applyPatchWithReport } from '../../packages/kernel/dist/index.js';
import {
  inspectFilmProject,
  verifyMediaLinks,
  applyFilmPatch,
} from '../../packs/film/dist/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const ACTION_HANDLERS = {
  noop: async (params) => {
    const statement = params.statement || '';
    const delay = statement.includes('slow') ? 3000 : 400;
    await sleep(delay);
    const success = !statement.toLowerCase().includes('fail');
    return {
      success,
      failureCategory: success ? undefined : 'TERMINAL',
      errorMessage: success ? undefined : 'Simulated criterion failure',
    };
  },

  'software.inspect': async (params) => {
    const report = await softwareInspect(params.path || '.');
    return { success: true, result: report };
  },

  'software.verify': async (params) => {
    const report = await softwareVerify(params.path || '.', params.scripts || []);
    return {
      success: report.passed === true,
      failureCategory: report.passed ? undefined : 'FIXABLE',
      errorMessage: report.passed ? undefined : 'One or more declared checks failed',
    };
  },

  applyPatch: async (params) => {
    const report = await applyPatchWithReport(params.path || '.', params.patch, {
      allowDirty: params.allowDirty === true,
    });
    if (!report.validated) {
      return {
        success: false,
        failureCategory: 'FIXABLE',
        errorMessage: 'Invalid patch: ' + report.validationErrors.join('; '),
      };
    }
    if (!report.applied) {
      return {
        success: false,
        failureCategory: 'POLICY_BLOCKED',
        errorMessage: 'Safety gate blocked application (dirty worktree)',
      };
    }
    return { success: true, result: report };
  },

  'film.inspect': async (params) => {
    const report = await inspectFilmProject(params.path || '.');
    return { success: true, result: report };
  },

  'film.verify': async (params) => {
    const report = await verifyMediaLinks(params.path || '.');
    return {
      success: report.passed === true,
      failureCategory: report.passed ? undefined : 'FIXABLE',
      errorMessage: report.passed ? undefined : 'Missing media references',
    };
  },

  'film.applyPatch': async (params) => {
    const report = await applyFilmPatch(params.path || '.', params.patch, {
      allowDirty: params.allowDirty === true,
    });
    if (report.scopeViolation) {
      return {
        success: false,
        failureCategory: 'POLICY_BLOCKED',
        errorMessage: 'Media immutability violated: ' + report.scopeViolations.join(', '),
      };
    }
    if (!report.applied) {
      return {
        success: false,
        failureCategory: 'POLICY_BLOCKED',
        errorMessage: 'Safety gate blocked application (dirty worktree)',
      };
    }
    if (report.mediaLinksPassed === false) {
      return {
        success: false,
        failureCategory: 'FIXABLE',
        errorMessage: 'Patch broke media links: ' + report.missingMedia.join(', '),
      };
    }
    return { success: true, result: report };
  },
};

export function makeStepAction(actionDef) {
  const kind = actionDef?.kind ?? 'noop';
  const params = actionDef?.params ?? {};
  return async (input, attempt) => {
    const handler = ACTION_HANDLERS[kind];
    if (!handler) {
      return {
        success: false,
        failureCategory: 'UNSUPPORTED',
        errorMessage: 'Unknown action kind: ' + kind,
      };
    }
    return handler(params, { attempt });
  };
}
