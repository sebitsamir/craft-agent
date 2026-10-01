import { CraftError, CraftErrorCode } from "./errors.js";

/**
 * Domain identifiers are stable lowercase machine ids, not display string.
 *
 * Examples:
 * - software
 * - film
 * - game
 * - astronomy
 * - medicine
 */

export const DOMAIN_ID_REGEX = /^[a-z][a-z0-9-]{1,63}$/;

/**
 * Domain known to the current planning baseline
 *
 * This is metadata only. Presence here does not mean a capability is
 * implemented. Capability availability id determined by capability manifests.
 */

export const KNOWN_DOMAINS = [
  'software',
  'writing',
  'film',
  'game',
  'education',
  'astronomy',
  'medicine',
  'accounting',
  'law',
  'custom',
] as const;

export type knownDomain = (typeof KNOWN_DOMAINS)[number];

/**
 * Return true when the value is one of the known planning domains.
 */
export function isKnownDomain(value: unknown): value is knownDomain {
  return typeof value === 'string' && (KNOWN_DOMAINS as readonly string[]).includes(value);
}

/**
 * Validate a domain identifier at runtime boundary.
 * @param value Raw input value
 * @param fieldName Field name used in error details.
 * @returns The validated domain id.
 */
export function validateDomainId(value: unknown, fieldName = 'domain'): string {
  if (typeof value !== 'string' || !DOMAIN_ID_REGEX.test(value)) {
    throw new CraftError(
    CraftErrorCode.MALFORMED_DOMAIN,
    `${fieldName} must be a lowercase domain id matching ${DOMAIN_ID_REGEX.source}.`,
    );
  }

  return value;
}


