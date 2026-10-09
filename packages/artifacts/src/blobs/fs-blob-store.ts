import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { JunubError, JunubErrorCode } from '@junub-agent/contracts';

/**
 * Filesystem content-addressed blob store.
 *
 * Storage layout:
 *   <root>/ab/cdef0123...
 *
 * The file name is the SHA-256 hash of the content.
 * This makes artifact versions immutable and deduplicated.
 */

/**
 * SHA-256 hex pattern.
 */
const HASH_REGEX = /^[a-fA-F0-9]{64}$/;

/**
 * Result of writing a blob.
 */
export interface BlobWriteResult {
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly path: string;
  readonly alreadyExisted: boolean;
}

/**
 * Options for reading blobs.
 */
export interface BlobReadOptions {
  /**
   * When true, the store re-hashes the bytes after reading and compares
   * them to the requested hash. This is safer but more expensive.
   */
  readonly verify?: boolean;
}

/**
 * Constructor options for FsBlobStore.
 */
export interface FsBlobStoreOptions {
  /**
   * Default verification behavior for readBytes().
   */
  readonly verifyOnRead?: boolean;
}

export class FsBlobStore {
  private readonly rootDir: string;
  private readonly verifyOnRead: boolean;

  constructor(rootDir: string, options: FsBlobStoreOptions = {}) {
    this.rootDir = rootDir;
    this.verifyOnRead = options.verifyOnRead ?? false;
  }

  /**
   * Writes bytes to the content-addressed store.
   *
   * If the hash already exists, the existing blob is kept unchanged.
   */
  async writeBytes(bytes: Uint8Array): Promise<BlobWriteResult> {
    // Compute SHA-256 before writing.
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    // Resolve the final sharded path.
    const finalPath = this.pathFor(sha256);

    // Ensure the shard directory exists.
    await mkdir(path.dirname(finalPath), { recursive: true });

    // If the blob already exists, do not rewrite it.
    if (await fileExists(finalPath)) {
      return {
        sha256,
        sizeBytes: bytes.byteLength,
        path: finalPath,
        alreadyExisted: true,
      };
    }

    // Write to a temporary file first, then rename atomically.
    const tmpPath = `${finalPath}.${randomUUID()}.tmp`;

    try {
      await writeFile(tmpPath, bytes);
      await rename(tmpPath, finalPath);
    } catch (error) {
      // Clean up temp file if rename/write failed.
      await unlink(tmpPath).catch(() => {
        // Ignore cleanup failure; the original error is more important.
      });

      throw error;
    }

    return {
      sha256,
      sizeBytes: bytes.byteLength,
      path: finalPath,
      alreadyExisted: false,
    };
  }

  /**
   * Returns true when a blob exists locally.
   */
  async has(sha256: string): Promise<boolean> {
    const normalized = requireValidHash(sha256);
    return fileExists(this.pathFor(normalized));
  }

  /**
   * Reads blob bytes by hash.
   */
  async readBytes(sha256: string, options: BlobReadOptions = {}): Promise<Uint8Array> {
    const normalized = requireValidHash(sha256);
    const filePath = this.pathFor(normalized);

    // Missing blob is a recoverable/storage-level error, not a generic exception.
    if (!(await fileExists(filePath))) {
      throw new JunubError(
        JunubErrorCode.ARTIFACT_BLOB_MISSING,
        `Artifact blob is missing for hash "${normalized}".`,
        { sha256: normalized, filePath },
      );
    }

    const bytes = await readFile(filePath);

    // Optional integrity verification.
    const shouldVerify = options.verify ?? this.verifyOnRead;

    if (shouldVerify) {
      const actualHash = createHash('sha256').update(bytes).digest('hex');

      if (actualHash !== normalized) {
        throw new JunubError(
          JunubErrorCode.ARTIFACT_HASH_MISMATCH,
          `Artifact blob hash mismatch: expected "${normalized}", got "${actualHash}".`,
          {
            expectedHash: normalized,
            actualHash,
            filePath,
          },
        );
      }
    }

    return bytes;
  }

  /**
   * Maps a hash to a sharded filesystem path.
   */
  private pathFor(sha256: string): string {
    // First two characters form a shard directory.
    const shard = sha256.slice(0, 2);
    const rest = sha256.slice(2);

    return path.join(this.rootDir, shard, rest);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validates a SHA-256 hash before using it in filesystem paths.
 */
function requireValidHash(sha256: string): string {
  const normalized = sha256.toLowerCase();

  if (!HASH_REGEX.test(normalized)) {
    throw new JunubError(
      JunubErrorCode.MALFORMED_ARTIFACT,
      'Blob hash must be a 64-character SHA-256 hex string.',
      { sha256 },
    );
  }

  return normalized;
}

/**
 * Returns true if a file exists.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
