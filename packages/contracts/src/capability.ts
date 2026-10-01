import { CraftError, CraftErrorCode } from './errors.js';

/**
 * Capability status reported to users and callers.
 *
 * An unsupported domain must say “planned” or “requires a specialist”, not
 * produce a convincing-looking but unverified answer.
 */
export type CapabilityStatus = 'available' | 'unavailable' | 'planned' | 'restricted';

/**
 * One action exposed by a capability pack.
 */
export interface CapabilityAction {
  readonly name: string;
  readonly description: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly permissions: readonly string[];
}

/**
 * Versioned capability pack manifest.
 *
 * A pack cannot request more permission merely by adding prompt text.
 * Permissions are declared here and enforced by the kernel.
 */
export interface CapabilityPackManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly domain: string;
  readonly status: CapabilityStatus;
  readonly description: string;

  readonly actions: readonly CapabilityAction[];
  readonly validators: readonly string[];
  readonly permissions: readonly string[];

  readonly toolScopes?: readonly string[];
  readonly formats?: readonly string[];
  readonly examples?: readonly string[];
  readonly riskRules?: readonly string[];
  readonly evalSet?: readonly string[];

  readonly compatibility?: string;
  readonly maintainerSignature?: string;
}

/**
 * Official semantic version pattern.
 */
export const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const MAX_ID_LENGTH = 120;
const MAX_NAME_LENGTH = 200;
const MAX_TEXT_LENGTH = 2000;
const MAX_ARRAY_ITEMS = 100;

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

/**
 * Validates that a string is a valid semantic version.
 */
export function validateSemver(version: string): string {
  if (typeof version !== 'string' || !SEMVER_REGEX.test(version)) {
    throw new CraftError(
      CraftErrorCode.INVALID_SEMVER,
      `Invalid semantic version: "${version}". Expected format X.Y.Z with optional prerelease/build metadata.`,
      { version },
    );
  }

  return version;
}

/**
 * Validates a capability pack manifest structure.
 *
 * This validator intentionally does not decide whether the pack is trusted.
 * Trust review, signature verification, and permission granting happen in
 * later kernel/policy phases.
 */
export function validateCapabilityManifest(raw: unknown): CapabilityPackManifest {
  if (!isRecord(raw)) {
    throw new CraftError(
      CraftErrorCode.INVALID_MANIFEST,
      'Capability manifest must be a non-null object.',
    );
  }

  if (!isNonemptyString(raw.id, MAX_ID_LENGTH)) {
    throw new CraftError(
      CraftErrorCode.INVALID_MANIFEST,
      'Capability manifest requires a nonempty "id" string.',
    );
  }

  if (!isNonemptyString(raw.name, MAX_NAME_LENGTH)) {
    throw new CraftError(
      CraftErrorCode.INVALID_MANIFEST,
      'Capability manifest requires a nonempty "name" string.',
    );
  }

  if (typeof raw.version !== 'string') {
    throw new CraftError(
      CraftErrorCode.INVALID_MANIFEST,
      'Capability manifest requires a "version" string.',
    );
  }

  validateSemver(raw.version);

  if (!isNonemptyString(raw.domain, MAX_ID_LENGTH)) {
    throw new CraftError(
      CraftErrorCode.INVALID_MANIFEST,
      'Capability manifest requires a nonempty "domain" string.',
    );
  }

  const validStatuses: readonly CapabilityStatus[] = [
    'available',
    'unavailable',
    'planned',
    'restricted',
  ];

  if (!validStatuses.includes(raw.status as CapabilityStatus)) {
    throw new CraftError(
      CraftErrorCode.INVALID_MANIFEST,
      `Capability manifest status must be one of: ${validStatuses.join(', ')}. Received: "${String(raw.status)}".`,
      { status: raw.status },
    );
  }

  if (!isNonemptyString(raw.description, MAX_TEXT_LENGTH)) {
    throw new CraftError(
      CraftErrorCode.INVALID_MANIFEST,
      'Capability manifest requires a nonempty "description" string.',
    );
  }

  if (!Array.isArray(raw.actions)) {
    throw new CraftError(
      CraftErrorCode.INVALID_MANIFEST,
      'Capability manifest requires an "actions" array.',
    );
  }

  for (let index = 0; index < raw.actions.length; index += 1) {
    const action = raw.actions[index];

    if (!isRecord(action)) {
      throw new CraftError(
        CraftErrorCode.INVALID_MANIFEST,
        `Action at index ${index} must be an object.`,
      );
    }

    if (!isNonemptyString(action.name, MAX_ID_LENGTH)) {
      throw new CraftError(
        CraftErrorCode.INVALID_MANIFEST,
        `Action at index ${index} requires a nonempty "name".`,
      );
    }

    if (!isNonemptyString(action.description, MAX_TEXT_LENGTH)) {
      throw new CraftError(
        CraftErrorCode.INVALID_MANIFEST,
        `Action "${action.name}" requires a nonempty "description".`,
      );
    }

    const inputs = action.inputs;
    const outputs = action.outputs;
    const permissions = action.permissions;

    if (!isStringArray(inputs, MAX_TEXT_LENGTH, MAX_ARRAY_ITEMS, true)) {
      throw new CraftError(
        CraftErrorCode.INVALID_MANIFEST,
        `Action "${action.name}" requires an "inputs" string array.`,
      );
    }

    if (!isStringArray(outputs, MAX_TEXT_LENGTH, MAX_ARRAY_ITEMS, true)) {
      throw new CraftError(
        CraftErrorCode.INVALID_MANIFEST,
        `Action "${action.name}" requires an "outputs" string array.`,
      );
    }

    if (!isStringArray(permissions, MAX_TEXT_LENGTH, MAX_ARRAY_ITEMS, true)) {
      throw new CraftError(
        CraftErrorCode.INVALID_MANIFEST,
        `Action "${action.name}" requires a "permissions" string array.`,
      );
    }
  }

  if (!isStringArray(raw.validators, MAX_TEXT_LENGTH, MAX_ARRAY_ITEMS, true)) {
    throw new CraftError(
      CraftErrorCode.INVALID_MANIFEST,
      'Capability manifest requires a "validators" string array.',
    );
  }

  if (!isStringArray(raw.permissions, MAX_TEXT_LENGTH, MAX_ARRAY_ITEMS, true)) {
    throw new CraftError(
      CraftErrorCode.INVALID_MANIFEST,
      'Capability manifest requires a "permissions" string array.',
    );
  }

  const optionalStringArrayFields = [
    'toolScopes',
    'formats',
    'examples',
    'riskRules',
    'evalSet',
  ] as const;

  for (const field of optionalStringArrayFields) {
    const value = raw[field];

    if (value !== undefined && !isStringArray(value, MAX_TEXT_LENGTH, MAX_ARRAY_ITEMS, true)) {
      throw new CraftError(
        CraftErrorCode.INVALID_MANIFEST,
        `Capability manifest field "${field}" must be a string array when present.`,
      );
    }
  }

  if (raw.compatibility !== undefined && !isNonemptyString(raw.compatibility, MAX_TEXT_LENGTH)) {
    throw new CraftError(
      CraftErrorCode.INVALID_MANIFEST,
      'Capability manifest field "compatibility" must be a nonempty string when present.',
    );
  }

  if (
    raw.maintainerSignature !== undefined &&
    !isNonemptyString(raw.maintainerSignature, MAX_TEXT_LENGTH)
  ) {
    throw new CraftError(
      CraftErrorCode.INVALID_MANIFEST,
      'Capability manifest field "maintainerSignature" must be a nonempty string when present.',
    );
  }

  return raw as unknown as CapabilityPackManifest;
}

/**
 * Result of resolving a capability pack for a domain/action.
 */
export interface CapabilityResolution {
  readonly manifest: CapabilityPackManifest;
  readonly action?: CapabilityAction;
}

/**
 * Resolves a capability and reports its exact state.
 *
 * This is the F1 mechanism for “unsupported capabilities are visibly reported”.
 * Schema validation is domain-neutral, but capability resolution refuses to
 * pretend an unavailable/planned/restricted pack is usable.
 */
export function resolveCapability(
  manifests: readonly CapabilityPackManifest[],
  domain: string,
  actionName?: string,
): CapabilityResolution {
  if (actionName !== undefined && actionName.trim().length === 0) {
    throw new CraftError(
      CraftErrorCode.CAPABILITY_NOT_FOUND,
      'Requested capability action name must be nonempty when provided.',
      { domain },
    );
  }

  const manifest = manifests.find((candidate) => candidate.domain === domain);

  if (!manifest) {
    throw new CraftError(
      CraftErrorCode.CAPABILITY_NOT_FOUND,
      `No capability pack registered for domain "${domain}".`,
      { domain },
    );
  }

  switch (manifest.status) {
    case 'unavailable':
      throw new CraftError(
        CraftErrorCode.CAPABILITY_UNAVAILABLE,
        `Capability pack for domain "${domain}" is currently unavailable in this environment.`,
        { domain, manifestId: manifest.id },
      );

    case 'planned':
      throw new CraftError(
        CraftErrorCode.CAPABILITY_PLANNED,
        `Capability pack for domain "${domain}" is planned and not yet functional.`,
        { domain, manifestId: manifest.id },
      );

    case 'restricted':
      throw new CraftError(
        CraftErrorCode.CAPABILITY_RESTRICTED,
        `Capability pack for domain "${domain}" is restricted and requires elevated authorization or governance.`,
        { domain, manifestId: manifest.id },
      );

    case 'available':
      break;
  }

  if (actionName !== undefined) {
    const action = manifest.actions.find((candidate) => candidate.name === actionName);

    if (!action) {
      throw new CraftError(
        CraftErrorCode.CAPABILITY_NOT_FOUND,
        `Action "${actionName}" not found in capability pack "${manifest.id}".`,
        { domain, manifestId: manifest.id, actionName },
      );
    }

    return { manifest, action };
  }

  return { manifest };
}
