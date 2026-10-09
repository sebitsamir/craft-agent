import { JunubError, JunubErrorCode } from './errors.js';
import { validateDomainId } from './domain.js';
import type { EvidenceMethod, TaskContract, TaskImpact } from './task.js';
import type { ArtifactLifecycleState, ArtifactVersion } from './artifact.js';
import type { CriterionEvidenceStatus, EvidenceRecord } from './evidence.js';
import type { Project } from './project.js';

/**
 * SHA-256 hex digest pattern.
 *
 * Artifact integrity and evidence binding rely on this hash.
 */
const HASH_REGEX = /^[a-fA-F0-9]{64}$/;

/**
 * Shared length and cardinality limits.
 *
 * These limits protect against malformed contracts and unbounded memory use.
 * They are intentionally conservative for F1.
 */
const MAX_ID_LENGTH = 120;
const MAX_TITLE_LENGTH = 200;
const MAX_INTENT_LENGTH = 4000;
const MAX_KIND_LENGTH = 80;
const MAX_FORMAT_LENGTH = 40;
const MAX_MIME_LENGTH = 120;
const MAX_STATEMENT_LENGTH = 1000;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_EVIDENCE_DESCRIPTION_LENGTH = 2000;
const MAX_ROLE_LENGTH = 120;
const MAX_SOURCE_LENGTH = 2000;
const MAX_CONSTRAINT_LENGTH = 1000;
const MAX_POLICY_VERSION_LENGTH = 80;
const MAX_PATH_LENGTH = 1000;
const MAX_ENVIRONMENT_LENGTH = 200;
const MAX_ISO_DATE_LENGTH = 80;

const MAX_OUTPUTS = 20;
const MAX_CRITERIA = 30;
const MAX_DOMAINS = 8;
const MAX_ROLES = 10;
const MAX_ARTIFACT_IDS = 20;
const MAX_CONSTRAINTS = 50;
const MAX_SOURCES = 50;

const MAX_PROJECT_NAME_LENGTH = 200;
const MAX_PROJECT_PURPOSE_LENGTH = 4000;
const MAX_COLLABORATORS = 50;
const MAX_PERMISSIONS = 50;
const MAX_RESOURCES = 100;
const MAX_ARTIFACT_LINKS = 100;
const MAX_HISTORY_ENTRIES = 100;
const MAX_POLICY_RULES = 100;

const HASH_LENGTH = 64;

const IMPACTS: ReadonlySet<TaskImpact> = new Set<TaskImpact>([
  'low',
  'moderate',
  'high',
]);

const EVIDENCE_METHODS: ReadonlySet<EvidenceMethod> = new Set<EvidenceMethod>([
  'test',
  'render',
  'source_check',
  'expert_review',
  'calculation',
  'human_review',
  'manual_demo',
]);

const ARTIFACT_STATES: ReadonlySet<ArtifactLifecycleState> =
  new Set<ArtifactLifecycleState>([
    'created',
    'verified',
    'reviewed',
    'accepted',
    'rejected',
    'published',
    'archived',
  ]);

const EVIDENCE_STATUSES: ReadonlySet<CriterionEvidenceStatus> =
  new Set<CriterionEvidenceStatus>([
    'pass',
    'fail',
    'not_run',
    'blocked',
    'not_applicable',
    'human_review_required',
  ]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonemptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isStringArray(
  value: unknown,
  maxItemLength: number,
  maxItems: number,
  allowEmpty = false,
): value is readonly string[] {
  if (!Array.isArray(value)) {
    return false;
  }

  if (!allowEmpty && value.length === 0) {
    return false;
  }

  if (value.length > maxItems) {
    return false;
  }

  return value.every((item) => isNonemptyString(item, maxItemLength));
}

function validateOptionalNonemptyString(
  container: Record<string, unknown>,
  field: string,
  maxLength: number,
  subject: string,
  errorCode: JunubErrorCode = JunubErrorCode.MALFORMED_TASK_CONTRACT,
): void {
  const value = container[field];

  if (value === undefined) {
    return;
  }

  if (!isNonemptyString(value, maxLength)) {
    throw new JunubError(
      errorCode,
      `${subject}.${field} must be a nonempty string of at most ${maxLength} characters when present.`,
      { field },
    );
  }
}

function validateOptionalIsoDate(
  container: Record<string, unknown>,
  field: string,
  subject: string,
  errorCode: JunubErrorCode = JunubErrorCode.MALFORMED_TASK_CONTRACT,
): void {
  const value = container[field];

  if (value === undefined) {
    return;
  }

  if (!isNonemptyString(value, MAX_ISO_DATE_LENGTH) || Number.isNaN(Date.parse(value))) {
    throw new JunubError(
      errorCode,
      `${subject}.${field} must be an ISO 8601 timestamp when present.`,
      { field },
    );
  }
}

function validateOptionalStringArray(
  container: Record<string, unknown>,
  field: string,
  maxItemLength: number,
  maxItems: number,
  subject: string,
  errorCode: JunubErrorCode = JunubErrorCode.MALFORMED_TASK_CONTRACT,
): void {
  const value = container[field];

  if (value === undefined) {
    return;
  }

  if (!isStringArray(value, maxItemLength, maxItems, true)) {
    throw new JunubError(
      errorCode,
      `${subject}.${field} must be an array of nonempty strings when present.`,
      { field },
    );
  }
}

function validateOptionalRecord(
  container: Record<string, unknown>,
  field: string,
  subject: string,
  errorCode: JunubErrorCode = JunubErrorCode.MALFORMED_TASK_CONTRACT,
): void {
  const value = container[field];

  if (value === undefined) {
    return;
  }

  if (!isRecord(value)) {
    throw new JunubError(
      errorCode,
      `${subject}.${field} must be an object when present.`,
      { field },
    );
  }
}

const BUDGET_FIELDS = [
  'maxModelCalls',
  'maxComputeMinutes',
  'maxCost',
  'maxStorageBytes',
  'maxOutputBytes',
  'maxRetryAttempts',
] as const;

function validateBudget(
  raw: unknown,
  subject: string,
  errorCode: JunubErrorCode,
): void {
  if (raw === undefined) {
    return;
  }

  if (!isRecord(raw)) {
    throw new JunubError(errorCode, `${subject}.budget must be an object.`);
  }

  for (const field of BUDGET_FIELDS) {
    const value = raw[field];

    if (value === undefined) {
      continue;
    }

    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new JunubError(
        errorCode,
        `${subject}.budget.${field} must be a non-negative finite number.`,
        { field },
      );
    }
  }
}

function validateTaskDeadlines(raw: unknown): void {
  if (raw === undefined) {
    return;
  }

  if (!isRecord(raw)) {
    throw new JunubError(
      JunubErrorCode.INVALID_DEADLINE,
      'task.deadlines must be an object.',
    );
  }

  const parseDate = (value: unknown, field: string): number | undefined => {
    if (value === undefined) {
      return undefined;
    }

    if (!isNonemptyString(value, MAX_ISO_DATE_LENGTH) || Number.isNaN(Date.parse(value))) {
      throw new JunubError(
        JunubErrorCode.INVALID_DEADLINE,
        `task.deadlines.${field} must be an ISO 8601 timestamp.`,
        { field },
      );
    }

    return Date.parse(value);
  };

  const target = parseDate(raw.target, 'target');
  const hardStop = parseDate(raw.hardStop, 'hardStop');

  if (target !== undefined && hardStop !== undefined && hardStop < target) {
    throw new JunubError(
      JunubErrorCode.INVALID_DEADLINE,
      'task.deadlines.hardStop must be after or equal to task.deadlines.target.',
      { target: raw.target, hardStop: raw.hardStop },
    );
  }
}

/**
 * Validates a TaskContract at a serialized runtime boundary.
 *
 * This function is domain-neutral. It does not decide whether the requested
 * domain is supported. Capability support is reported by resolveCapability().
 */
export function validateTaskContract(raw: unknown): TaskContract {
  if (!isRecord(raw)) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_TASK_CONTRACT,
      'Task contract must be an object.',
    );
  }

  if (raw.schemaVersion !== 1) {
    throw new JunubError(
      JunubErrorCode.SCHEMA_VERSION_UNSUPPORTED,
      `Unsupported task schemaVersion: ${String(raw.schemaVersion)}. Expected 1.`,
      { schemaVersion: raw.schemaVersion },
    );
  }

  validateOptionalNonemptyString(raw, 'taskId', MAX_ID_LENGTH, 'task');
  validateOptionalNonemptyString(raw, 'projectId', MAX_ID_LENGTH, 'task');
  validateOptionalIsoDate(raw, 'createdAt', 'task');
  validateOptionalIsoDate(raw, 'updatedAt', 'task');

  if (!isNonemptyString(raw.title, MAX_TITLE_LENGTH)) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_TASK_CONTRACT,
      'task.title must be a nonempty string of at most 200 characters.',
    );
  }

  if (!isNonemptyString(raw.intent, MAX_INTENT_LENGTH)) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_TASK_CONTRACT,
      'task.intent must be a nonempty string of at most 4000 characters.',
    );
  }

  const primaryDomain = validateDomainId(raw.domain, 'task.domain');

  if (raw.domains !== undefined) {
    if (
      !Array.isArray(raw.domains) ||
      raw.domains.length < 1 ||
      raw.domains.length > MAX_DOMAINS
    ) {
      throw new JunubError(
        JunubErrorCode.MALFORMED_TASK_CONTRACT,
        `task.domains must be an array with between 1 and ${MAX_DOMAINS} domain ids.`,
      );
    }

    const domainSet = new Set<string>();

    for (let index = 0; index < raw.domains.length; index += 1) {
      const domain = validateDomainId(raw.domains[index], `task.domains[${index}]`);

      if (domainSet.has(domain)) {
        throw new JunubError(
          JunubErrorCode.MALFORMED_TASK_CONTRACT,
          `task.domains[${index}] duplicates domain "${domain}".`,
          { domain },
        );
      }

      domainSet.add(domain);
    }

    if (!domainSet.has(primaryDomain)) {
      throw new JunubError(
        JunubErrorCode.MALFORMED_TASK_CONTRACT,
        'task.domains must include the primary task.domain value.',
        { domain: primaryDomain },
      );
    }
  }

  if (typeof raw.impact !== 'string' || !IMPACTS.has(raw.impact as TaskImpact)) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_TASK_CONTRACT,
      'task.impact must be "low", "moderate", or "high".',
    );
  }

  if (
    raw.version !== undefined &&
    (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1)
  ) {
    throw new JunubError(
      JunubErrorCode.INVALID_TASK_VERSION,
      'task.version must be a positive integer when present.',
    );
  }

  if (!Array.isArray(raw.outputs) || raw.outputs.length < 1 || raw.outputs.length > MAX_OUTPUTS) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_TASK_CONTRACT,
      `task.outputs must contain between 1 and ${MAX_OUTPUTS} artifacts.`,
    );
  }

  const seenOutputIds = new Set<string>();

  for (let index = 0; index < raw.outputs.length; index += 1) {
    const output = raw.outputs[index];
    const label = `task.outputs[${index}]`;

    if (!isRecord(output)) {
      throw new JunubError(JunubErrorCode.MALFORMED_TASK_CONTRACT, `${label} must be an object.`);
    }

    if (!isNonemptyString(output.kind, MAX_KIND_LENGTH)) {
      throw new JunubError(
        JunubErrorCode.MALFORMED_TASK_CONTRACT,
        `${label}.kind must be a nonempty string of at most ${MAX_KIND_LENGTH} characters.`,
      );
    }

    if (!isNonemptyString(output.format, MAX_FORMAT_LENGTH)) {
      throw new JunubError(
        JunubErrorCode.MALFORMED_TASK_CONTRACT,
        `${label}.format must be a nonempty string of at most ${MAX_FORMAT_LENGTH} characters.`,
      );
    }

    if (!isNonemptyString(output.description, MAX_DESCRIPTION_LENGTH)) {
      throw new JunubError(
        JunubErrorCode.MALFORMED_TASK_CONTRACT,
        `${label}.description must be a nonempty string of at most ${MAX_DESCRIPTION_LENGTH} characters.`,
      );
    }

    const outputId = output.id;

    if (outputId !== undefined) {
      if (!isNonemptyString(outputId, MAX_ID_LENGTH)) {
        throw new JunubError(
          JunubErrorCode.MALFORMED_TASK_CONTRACT,
          `${label}.id must be a nonempty string of at most ${MAX_ID_LENGTH} characters when present.`,
        );
      }

      if (seenOutputIds.has(outputId)) {
        throw new JunubError(
          JunubErrorCode.DUPLICATE_OUTPUT_ID,
          `${label}.id duplicates output id "${outputId}".`,
          { outputId },
        );
      }

      seenOutputIds.add(outputId);
    }

    if (output.required !== undefined && typeof output.required !== 'boolean') {
      throw new JunubError(
        JunubErrorCode.MALFORMED_TASK_CONTRACT,
        `${label}.required must be a boolean when present.`,
      );
    }

    validateOptionalNonemptyString(output, 'pathPattern', MAX_PATH_LENGTH, label);
    validateOptionalRecord(output, 'metadata', label);
  }

  if (
    !Array.isArray(raw.acceptance) ||
    raw.acceptance.length < 1 ||
    raw.acceptance.length > MAX_CRITERIA
  ) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_TASK_CONTRACT,
      `task.acceptance must contain between 1 and ${MAX_CRITERIA} criteria.`,
    );
  }

  const seenCriterionIds = new Set<string>();

  for (let index = 0; index < raw.acceptance.length; index += 1) {
    const criterion = raw.acceptance[index];
    const label = `task.acceptance[${index}]`;

    if (!isRecord(criterion)) {
      throw new JunubError(JunubErrorCode.MALFORMED_TASK_CONTRACT, `${label} must be an object.`);
    }

    if (!isNonemptyString(criterion.id, MAX_ID_LENGTH)) {
      throw new JunubError(
        JunubErrorCode.MALFORMED_TASK_CONTRACT,
        `${label}.id must be a nonempty string of at most ${MAX_ID_LENGTH} characters.`,
      );
    }

    if (seenCriterionIds.has(criterion.id)) {
      throw new JunubError(
        JunubErrorCode.DUPLICATE_CRITERION_ID,
        `Duplicate criterion id "${criterion.id}" found in acceptance criteria.`,
        { criterionId: criterion.id },
      );
    }

    seenCriterionIds.add(criterion.id);

    if (!isNonemptyString(criterion.statement, MAX_STATEMENT_LENGTH)) {
      throw new JunubError(
        JunubErrorCode.MALFORMED_TASK_CONTRACT,
        `${label}.statement must be a nonempty string of at most ${MAX_STATEMENT_LENGTH} characters.`,
      );
    }

    if (criterion.required !== undefined && typeof criterion.required !== 'boolean') {
      throw new JunubError(
        JunubErrorCode.MALFORMED_TASK_CONTRACT,
        `${label}.required must be a boolean when present.`,
      );
    }

    if (!isRecord(criterion.evidence)) {
      throw new JunubError(
        JunubErrorCode.MALFORMED_TASK_CONTRACT,
        `${label}.evidence must be an object.`,
      );
    }

    const evidence = criterion.evidence;

    if (
      typeof evidence.method !== 'string' ||
      !EVIDENCE_METHODS.has(evidence.method as EvidenceMethod)
    ) {
      throw new JunubError(
        JunubErrorCode.MALFORMED_TASK_CONTRACT,
        `${label}.evidence.method must be one of: ${Array.from(EVIDENCE_METHODS).join(', ')}.`,
      );
    }

    if (!isNonemptyString(evidence.description, MAX_DESCRIPTION_LENGTH)) {
      throw new JunubError(
        JunubErrorCode.MALFORMED_TASK_CONTRACT,
        `${label}.evidence.description must be a nonempty string of at most ${MAX_DESCRIPTION_LENGTH} characters.`,
      );
    }

    const requiredArtifactIds = evidence.requiredArtifactIds;

    if (
      requiredArtifactIds !== undefined &&
      !isStringArray(requiredArtifactIds, MAX_ID_LENGTH, MAX_ARTIFACT_IDS, true)
    ) {
      throw new JunubError(
        JunubErrorCode.MALFORMED_TASK_CONTRACT,
        `${label}.evidence.requiredArtifactIds must be an array of artifact ids when present.`,
      );
    }
  }

  if (raw.impact === 'high' && raw.review === undefined) {
    throw new JunubError(
      JunubErrorCode.MISSING_REVIEWER_ROLE,
      'High-impact tasks require a review object with a named qualified-reviewer role.',
    );
  }

  if (raw.review !== undefined) {
    const review = raw.review;

    if (!isRecord(review)) {
      throw new JunubError(
        JunubErrorCode.MALFORMED_TASK_CONTRACT,
        'task.review must be an object.',
      );
    }

    if (typeof review.required !== 'boolean') {
      throw new JunubError(
        JunubErrorCode.MALFORMED_TASK_CONTRACT,
        'task.review.required must be a boolean.',
      );
    }

    // High-impact tasks cannot opt out of review.
    if (raw.impact === 'high' && review.required !== true) {
      throw new JunubError(
        JunubErrorCode.MISSING_REVIEWER_ROLE,
        'High-impact tasks require review.required=true and a named qualified-reviewer role.',
      );
    }

    const reviewRoles = new Set<string>();

    const role = review.role;

    if (role !== undefined) {
      if (!isNonemptyString(role, MAX_ROLE_LENGTH)) {
        throw new JunubError(
          JunubErrorCode.MALFORMED_TASK_CONTRACT,
          'task.review.role must be a nonempty string when present.',
        );
      }

      reviewRoles.add(role);
    }

    const roles = review.roles;

    if (roles !== undefined) {
      if (!isStringArray(roles, MAX_ROLE_LENGTH, MAX_ROLES, true)) {
        throw new JunubError(
          JunubErrorCode.MALFORMED_TASK_CONTRACT,
          'task.review.roles must be an array of nonempty role strings when present.',
        );
      }

      for (const roleValue of roles) {
        if (reviewRoles.has(roleValue)) {
          throw new JunubError(
            JunubErrorCode.MALFORMED_TASK_CONTRACT,
            `task.review.roles duplicates role "${roleValue}".`,
            { role: roleValue },
          );
        }

        reviewRoles.add(roleValue);
      }
    }

    if (review.required && reviewRoles.size === 0) {
      if (raw.impact === 'high') {
        throw new JunubError(
          JunubErrorCode.MISSING_REVIEWER_ROLE,
          'High-impact tasks require a named qualified-reviewer role in review.role or review.roles.',
        );
      }

      throw new JunubError(
        JunubErrorCode.MALFORMED_TASK_CONTRACT,
        'task.review.required=true requires at least one reviewer role.',
      );
    }
  }

  validateBudget(raw.budget, 'task', JunubErrorCode.INVALID_BUDGET);
  validateTaskDeadlines(raw.deadlines);

  validateOptionalStringArray(
    raw,
    'constraints',
    MAX_CONSTRAINT_LENGTH,
    MAX_CONSTRAINTS,
    'task',
  );

  validateOptionalStringArray(
    raw,
    'sources',
    MAX_SOURCE_LENGTH,
    MAX_SOURCES,
    'task',
  );

  validateOptionalNonemptyString(
    raw,
    'policyVersion',
    MAX_POLICY_VERSION_LENGTH,
    'task',
    JunubErrorCode.INVALID_POLICY_VERSION,
  );

  validateOptionalRecord(raw, 'metadata', 'task');

  return raw as unknown as TaskContract;
}

/**
 * Validates an ArtifactVersion structure at runtime.
 */
export function validateArtifactVersion(raw: unknown): ArtifactVersion {
  if (!isRecord(raw)) {
    throw new JunubError(JunubErrorCode.MALFORMED_ARTIFACT, 'ArtifactVersion must be an object.');
  }

  if (!isNonemptyString(raw.id, MAX_ID_LENGTH)) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_ARTIFACT,
      'ArtifactVersion.id must be a nonempty string.',
    );
  }

  if (!isNonemptyString(raw.artifactId, MAX_ID_LENGTH)) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_ARTIFACT,
      'ArtifactVersion.artifactId must be a nonempty string.',
    );
  }

  if (
    typeof raw.version !== 'number' ||
    !Number.isInteger(raw.version) ||
    raw.version < 1
  ) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_ARTIFACT,
      'ArtifactVersion.version must be a positive integer.',
    );
  }

  if (typeof raw.hash !== 'string' || !HASH_REGEX.test(raw.hash)) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_ARTIFACT,
      `ArtifactVersion.hash must be a ${HASH_LENGTH}-character SHA-256 hex string.`,
      { hash: raw.hash },
    );
  }

  if (
    typeof raw.sizeBytes !== 'number' ||
    !Number.isFinite(raw.sizeBytes) ||
    raw.sizeBytes < 0
  ) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_ARTIFACT,
      'ArtifactVersion.sizeBytes must be a non-negative finite number.',
    );
  }

  if (
    typeof raw.state !== 'string' ||
    !ARTIFACT_STATES.has(raw.state as ArtifactLifecycleState)
  ) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_ARTIFACT,
      `ArtifactVersion.state must be one of: ${Array.from(ARTIFACT_STATES).join(', ')}.`,
      { state: raw.state },
    );
  }

  if (
    !isNonemptyString(raw.createdAt, MAX_ISO_DATE_LENGTH) ||
    Number.isNaN(Date.parse(raw.createdAt))
  ) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_ARTIFACT,
      'ArtifactVersion.createdAt must be an ISO 8601 timestamp.',
    );
  }

  validateOptionalNonemptyString(raw, 'format', MAX_FORMAT_LENGTH, 'artifactVersion', JunubErrorCode.MALFORMED_ARTIFACT);
  validateOptionalNonemptyString(raw, 'mimeType', MAX_MIME_LENGTH, 'artifactVersion', JunubErrorCode.MALFORMED_ARTIFACT);
  validateOptionalNonemptyString(raw, 'storagePath', MAX_PATH_LENGTH, 'artifactVersion', JunubErrorCode.MALFORMED_ARTIFACT);
  validateOptionalNonemptyString(raw, 'sourceReference', MAX_SOURCE_LENGTH, 'artifactVersion', JunubErrorCode.MALFORMED_ARTIFACT);
  validateOptionalRecord(raw, 'metadata', 'artifactVersion', JunubErrorCode.MALFORMED_ARTIFACT);

  return raw as unknown as ArtifactVersion;
}

/**
 * Validates an EvidenceRecord structure at runtime.
 */
export function validateEvidenceRecord(raw: unknown): EvidenceRecord {
  if (!isRecord(raw)) {
    throw new JunubError(JunubErrorCode.MALFORMED_EVIDENCE, 'EvidenceRecord must be an object.');
  }

  if (!isNonemptyString(raw.id, MAX_ID_LENGTH)) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_EVIDENCE,
      'EvidenceRecord.id must be a nonempty string.',
    );
  }

  if (!isNonemptyString(raw.criterionId, MAX_ID_LENGTH)) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_EVIDENCE,
      'EvidenceRecord.criterionId must be a nonempty string.',
    );
  }

  if (!isNonemptyString(raw.artifactId, MAX_ID_LENGTH)) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_EVIDENCE,
      'EvidenceRecord.artifactId must be a nonempty string.',
    );
  }

  if (
    typeof raw.artifactVersion !== 'number' ||
    !Number.isInteger(raw.artifactVersion) ||
    raw.artifactVersion < 1
  ) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_EVIDENCE,
      'EvidenceRecord.artifactVersion must be a positive integer.',
    );
  }

  if (typeof raw.contentHash !== 'string' || !HASH_REGEX.test(raw.contentHash)) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_EVIDENCE,
      `EvidenceRecord.contentHash must be a ${HASH_LENGTH}-character SHA-256 hex string.`,
      { contentHash: raw.contentHash },
    );
  }

  if (
    typeof raw.method !== 'string' ||
    !EVIDENCE_METHODS.has(raw.method as EvidenceMethod)
  ) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_EVIDENCE,
      `EvidenceRecord.method must be one of: ${Array.from(EVIDENCE_METHODS).join(', ')}.`,
      { method: raw.method },
    );
  }

  if (
    typeof raw.status !== 'string' ||
    !EVIDENCE_STATUSES.has(raw.status as CriterionEvidenceStatus)
  ) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_EVIDENCE,
      `EvidenceRecord.status must be one of: ${Array.from(EVIDENCE_STATUSES).join(', ')}.`,
      { status: raw.status },
    );
  }

  if (!isNonemptyString(raw.description, MAX_EVIDENCE_DESCRIPTION_LENGTH)) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_EVIDENCE,
      `EvidenceRecord.description must be a nonempty string of at most ${MAX_EVIDENCE_DESCRIPTION_LENGTH} characters.`,
    );
  }

  if (
    !isNonemptyString(raw.recordedAt, MAX_ISO_DATE_LENGTH) ||
    Number.isNaN(Date.parse(raw.recordedAt))
  ) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_EVIDENCE,
      'EvidenceRecord.recordedAt must be an ISO 8601 timestamp.',
    );
  }

  validateOptionalNonemptyString(raw, 'environment', MAX_ENVIRONMENT_LENGTH, 'evidenceRecord', JunubErrorCode.MALFORMED_EVIDENCE);
  validateOptionalNonemptyString(raw, 'sourceReference', MAX_SOURCE_LENGTH, 'evidenceRecord', JunubErrorCode.MALFORMED_EVIDENCE);
  validateOptionalNonemptyString(raw, 'boundedOutput', MAX_PATH_LENGTH, 'evidenceRecord', JunubErrorCode.MALFORMED_EVIDENCE);
  validateOptionalNonemptyString(raw, 'reviewer', MAX_ROLE_LENGTH, 'evidenceRecord', JunubErrorCode.MALFORMED_EVIDENCE);
  validateOptionalRecord(raw, 'details', 'evidenceRecord', JunubErrorCode.MALFORMED_EVIDENCE);

  return raw as unknown as EvidenceRecord;
}

/**
 * Validates a Project structure at runtime.
 */
export function validateProject(raw: unknown): Project {
  if (!isRecord(raw)) {
    throw new JunubError(JunubErrorCode.MALFORMED_PROJECT, 'Project must be an object.');
  }

  if (raw.schemaVersion !== 1) {
    throw new JunubError(
      JunubErrorCode.SCHEMA_VERSION_UNSUPPORTED,
      `Unsupported project schemaVersion: ${String(raw.schemaVersion)}. Expected 1.`,
      { schemaVersion: raw.schemaVersion },
    );
  }

  if (!isNonemptyString(raw.id, MAX_ID_LENGTH)) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_PROJECT,
      'Project.id must be a nonempty string.',
    );
  }

  if (!isNonemptyString(raw.name, MAX_PROJECT_NAME_LENGTH)) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_PROJECT,
      `Project.name must be a nonempty string of at most ${MAX_PROJECT_NAME_LENGTH} characters.`,
    );
  }

  if (!isNonemptyString(raw.owner, MAX_ID_LENGTH)) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_PROJECT,
      'Project.owner must be a nonempty string.',
    );
  }

  if (!isNonemptyString(raw.purpose, MAX_PROJECT_PURPOSE_LENGTH)) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_PROJECT,
      `Project.purpose must be a nonempty string of at most ${MAX_PROJECT_PURPOSE_LENGTH} characters.`,
    );
  }

  validateOptionalNonemptyString(raw, 'workspaceId', MAX_ID_LENGTH, 'project', JunubErrorCode.MALFORMED_PROJECT);
  validateOptionalIsoDate(raw, 'createdAt', 'project', JunubErrorCode.MALFORMED_PROJECT);
  validateOptionalIsoDate(raw, 'updatedAt', 'project', JunubErrorCode.MALFORMED_PROJECT);
  validateOptionalRecord(raw, 'metadata', 'project', JunubErrorCode.MALFORMED_PROJECT);
  validateBudget(raw.budget, 'project', JunubErrorCode.INVALID_BUDGET);

  if (raw.collaborators !== undefined) {
    if (!Array.isArray(raw.collaborators) || raw.collaborators.length > MAX_COLLABORATORS) {
      throw new JunubError(
        JunubErrorCode.MALFORMED_PROJECT,
        `Project.collaborators must be an array with at most ${MAX_COLLABORATORS} entries.`,
      );
    }

    for (let index = 0; index < raw.collaborators.length; index += 1) {
      const collaborator = raw.collaborators[index];
      const label = `project.collaborators[${index}]`;

      if (!isRecord(collaborator)) {
        throw new JunubError(JunubErrorCode.MALFORMED_PROJECT, `${label} must be an object.`);
      }

      if (!isNonemptyString(collaborator.id, MAX_ID_LENGTH)) {
        throw new JunubError(
          JunubErrorCode.MALFORMED_PROJECT,
          `${label}.id must be a nonempty string.`,
        );
      }

      if (!isNonemptyString(collaborator.role, MAX_ROLE_LENGTH)) {
        throw new JunubError(
          JunubErrorCode.MALFORMED_PROJECT,
          `${label}.role must be a nonempty string.`,
        );
      }

      validateOptionalNonemptyString(collaborator, 'name', MAX_PROJECT_NAME_LENGTH, label, JunubErrorCode.MALFORMED_PROJECT);

      const permissions = collaborator.permissions;

      if (
        permissions !== undefined &&
        !isStringArray(permissions, MAX_ROLE_LENGTH, MAX_PERMISSIONS, true)
      ) {
        throw new JunubError(
          JunubErrorCode.MALFORMED_PROJECT,
          `${label}.permissions must be a string array when present.`,
        );
      }
    }
  }

  if (raw.policy !== undefined) {
    const policy = raw.policy;

    if (!isRecord(policy)) {
      throw new JunubError(JunubErrorCode.MALFORMED_PROJECT, 'Project.policy must be an object.');
    }

    validateOptionalNonemptyString(policy, 'id', MAX_ID_LENGTH, 'project.policy', JunubErrorCode.MALFORMED_PROJECT);
    validateOptionalNonemptyString(policy, 'version', MAX_POLICY_VERSION_LENGTH, 'project.policy', JunubErrorCode.MALFORMED_PROJECT);
    validateOptionalNonemptyString(policy, 'name', MAX_PROJECT_NAME_LENGTH, 'project.policy', JunubErrorCode.MALFORMED_PROJECT);
    validateOptionalStringArray(
      policy,
      'rules',
      MAX_CONSTRAINT_LENGTH,
      MAX_POLICY_RULES,
      'project.policy',
      JunubErrorCode.MALFORMED_PROJECT,
    );
  }

  if (raw.resources !== undefined) {
    if (!Array.isArray(raw.resources) || raw.resources.length > MAX_RESOURCES) {
      throw new JunubError(
        JunubErrorCode.MALFORMED_PROJECT,
        `Project.resources must be an array with at most ${MAX_RESOURCES} entries.`,
      );
    }

    for (let index = 0; index < raw.resources.length; index += 1) {
      const resource = raw.resources[index];
      const label = `project.resources[${index}]`;

      if (!isRecord(resource)) {
        throw new JunubError(JunubErrorCode.MALFORMED_PROJECT, `${label} must be an object.`);
      }

      if (!isNonemptyString(resource.id, MAX_ID_LENGTH)) {
        throw new JunubError(
          JunubErrorCode.MALFORMED_PROJECT,
          `${label}.id must be a nonempty string.`,
        );
      }

      if (!isNonemptyString(resource.kind, MAX_KIND_LENGTH)) {
        throw new JunubError(
          JunubErrorCode.MALFORMED_PROJECT,
          `${label}.kind must be a nonempty string.`,
        );
      }

      if (!isNonemptyString(resource.uri, MAX_PATH_LENGTH)) {
        throw new JunubError(
          JunubErrorCode.MALFORMED_PROJECT,
          `${label}.uri must be a nonempty string.`,
        );
      }

      validateOptionalNonemptyString(resource, 'description', MAX_DESCRIPTION_LENGTH, label, JunubErrorCode.MALFORMED_PROJECT);

      if (resource.readOnly !== undefined && typeof resource.readOnly !== 'boolean') {
        throw new JunubError(
          JunubErrorCode.MALFORMED_PROJECT,
          `${label}.readOnly must be a boolean when present.`,
        );
      }
    }
  }

  if (raw.artifactLinks !== undefined) {
    if (!Array.isArray(raw.artifactLinks) || raw.artifactLinks.length > MAX_ARTIFACT_LINKS) {
      throw new JunubError(
        JunubErrorCode.MALFORMED_PROJECT,
        `Project.artifactLinks must be an array with at most ${MAX_ARTIFACT_LINKS} entries.`,
      );
    }

    for (let index = 0; index < raw.artifactLinks.length; index += 1) {
      const link = raw.artifactLinks[index];
      const label = `project.artifactLinks[${index}]`;

      if (!isRecord(link)) {
        throw new JunubError(JunubErrorCode.MALFORMED_PROJECT, `${label} must be an object.`);
      }

      if (!isNonemptyString(link.artifactId, MAX_ID_LENGTH)) {
        throw new JunubError(
          JunubErrorCode.MALFORMED_PROJECT,
          `${label}.artifactId must be a nonempty string.`,
        );
      }

      validateOptionalNonemptyString(link, 'role', MAX_ROLE_LENGTH, label, JunubErrorCode.MALFORMED_PROJECT);
      validateOptionalIsoDate(link, 'addedAt', label, JunubErrorCode.MALFORMED_PROJECT);
    }
  }

  if (raw.history !== undefined) {
    if (!Array.isArray(raw.history) || raw.history.length > MAX_HISTORY_ENTRIES) {
      throw new JunubError(
        JunubErrorCode.MALFORMED_PROJECT,
        `Project.history must be an array with at most ${MAX_HISTORY_ENTRIES} entries.`,
      );
    }

    for (let index = 0; index < raw.history.length; index += 1) {
      const entry = raw.history[index];
      const label = `project.history[${index}]`;

      if (!isRecord(entry)) {
        throw new JunubError(JunubErrorCode.MALFORMED_PROJECT, `${label} must be an object.`);
      }

      if (!isNonemptyString(entry.id, MAX_ID_LENGTH)) {
        throw new JunubError(
          JunubErrorCode.MALFORMED_PROJECT,
          `${label}.id must be a nonempty string.`,
        );
      }

      if (
        !isNonemptyString(entry.at, MAX_ISO_DATE_LENGTH) ||
        Number.isNaN(Date.parse(entry.at))
      ) {
        throw new JunubError(
          JunubErrorCode.MALFORMED_PROJECT,
          `${label}.at must be an ISO 8601 timestamp.`,
        );
      }

      if (!isNonemptyString(entry.kind, MAX_KIND_LENGTH)) {
        throw new JunubError(
          JunubErrorCode.MALFORMED_PROJECT,
          `${label}.kind must be a nonempty string.`,
        );
      }

      if (!isNonemptyString(entry.description, MAX_DESCRIPTION_LENGTH)) {
        throw new JunubError(
          JunubErrorCode.MALFORMED_PROJECT,
          `${label}.description must be a nonempty string.`,
        );
      }

      validateOptionalNonemptyString(entry, 'actor', MAX_ID_LENGTH, label, JunubErrorCode.MALFORMED_PROJECT);
    }
  }

  return raw as unknown as Project;
}
