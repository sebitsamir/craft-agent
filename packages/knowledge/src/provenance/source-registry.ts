import { createHash } from 'node:crypto';

/**
 * A verified source record used for citations in plans and evidence.
 *
 * The Master Spec (Section 11) requires:
 * "Attach source URI/path, line/page/time range, retrieval date,
 * jurisdiction/standard version, content hash and confidence.
 * Stale or inaccessible sources are flagged."
 */
export interface SourceRecord {
  readonly uri: string;
  readonly retrievedAt: string;
  readonly contentHash: string;
  readonly confidence: number;
  readonly jurisdiction?: string;
  readonly standardVersion?: string;
  readonly isStale?: boolean;
}

/**
 * Creates a cryptographically bound source record.
 *
 * @param uri The source identifier (URL, file path, DOI).
 * @param content The raw text/content of the source at retrieval time.
 * @param options Optional metadata and staleness bounds.
 */
export function createSourceRecord(
  uri: string,
  content: string,
  options: {
    retrievedAt?: string;
    confidence?: number;
    jurisdiction?: string;
    standardVersion?: string;
    maxAgeDays?: number;
  } = {},
): SourceRecord {
  const retrievedAt = options.retrievedAt ?? new Date().toISOString();

  // Bind the citation to the exact content hash at retrieval time.
  const contentHash = createHash('sha256').update(content).digest('hex');

  let isStale = false;
  if (options.maxAgeDays !== undefined) {
    const retrievedDate = new Date(retrievedAt);
    const now = new Date();
    const diffDays = (now.getTime() - retrievedDate.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > options.maxAgeDays) {
      isStale = true;
    }
  }

  return {
    uri,
    retrievedAt,
    contentHash,
    confidence: options.confidence ?? 1.0,
    jurisdiction: options.jurisdiction,
    standardVersion: options.standardVersion,
    isStale,
  };
}
