/**
 * Secret Redaction Filter
 *
 * The Master Spec (Section 10 & 12) requires:
 * "Sensitive content is excluded or redacted before persistence where possible"
 * "A prompt cannot authorize filesystem escape, network exfiltration..."
 *
 * This filter scans strings and objects for common secret patterns and replaces
 * them with a safe placeholder before the text is sent to a model provider
 * or written to the event log.
 */

// Patterns for common secrets
const SECRET_PATTERNS: ReadonlyArray<{ regex: RegExp; label: string }> = [
  // OpenAI / Anthropic / Generic API keys
  { regex: /\b(sk-[a-zA-Z0-9]{20,}|sk-ant-[a-zA-Z0-9-]{20,})\b/g, label: 'api_key' },
  // GitHub tokens
  { regex: /\b(ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{22,})\b/g, label: 'github_token' },
  // AWS Access Keys
  { regex: /\bAKIA[0-9A-Z]{16}\b/g, label: 'aws_access_key' },
  // Private Keys (PEM format)
  { regex: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g, label: 'private_key' },
  // Generic Bearer tokens in headers
  { regex: /(Bearer\s+)[a-zA-Z0-9\-._~+\/]+=*/gi, label: 'bearer_token' },
  // Connection strings (postgres, mysql, mongodb)
  { regex: /\b(postgres|mysql|mongodb):\/\/[^@\s]+:[^@\s]+@[^\s]+\b/gi, label: 'connection_string' },
];

const REDACTION_PLACEHOLDER = '[REDACTED:secret]';

export interface RedactionResult {
  readonly redactedText: string;
  readonly secretsFound: number;
  readonly labels: readonly string[];
}

/**
 * Scans a string for known secret patterns and replaces them.
 */
export function redactSecrets(input: string): RedactionResult {
  let redactedText = input;
  let secretsFound = 0;
  const labelsSet = new Set<string>();

  for (const { regex, label } of SECRET_PATTERNS) {
    // Reset regex state
    regex.lastIndex = 0;

    if (regex.test(redactedText)) {
      // Count matches
      regex.lastIndex = 0;
      const matches = redactedText.match(regex);
      if (matches) {
        secretsFound += matches.length;
        labelsSet.add(label);
      }

      // Replace matches
      regex.lastIndex = 0;
      redactedText = redactedText.replace(regex, REDACTION_PLACEHOLDER);
    }
  }

  return {
    redactedText,
    secretsFound,
    labels: Array.from(labelsSet),
  };
}

/**
 * Recursively scans an object/array and redacts secrets.
 * Also redacts values of keys explicitly named like passwords/secrets.
 */
export function redactSecretsInObject(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return redactSecrets(obj).redactedText;
  }
  if (Array.isArray(obj)) {
    return obj.map(redactSecretsInObject);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Redact keys that are explicitly named like passwords/secrets
      if (/password|secret|token|key|authorization/i.test(key) && typeof value === 'string') {
        result[key] = REDACTION_PLACEHOLDER;
      } else {
        result[key] = redactSecretsInObject(value);
      }
    }
    return result;
  }
  return obj;
}
