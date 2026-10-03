import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  redactSecrets,
  redactSecretsInObject,
  createSourceRecord,
} from '../packages/knowledge/dist/index.js';

describe('F3 Slice 2: Secret redaction and source provenance', () => {
  test('redactSecrets scrubs OpenAI and Anthropic API keys', () => {
    const input = 'My OpenAI key is sk-1234567890abcdefghijklmnopqrstuv and my Anthropic key is sk-ant-api03-1234567890abcdefghijklmnop.';
    const result = redactSecrets(input);

    assert.equal(result.secretsFound, 2);
    assert.ok(result.labels.includes('api_key'));
    assert.ok(!result.redactedText.includes('sk-1234'));
    assert.ok(!result.redactedText.includes('sk-ant-'));
    assert.equal(result.redactedText, 'My OpenAI key is [REDACTED:secret] and my Anthropic key is [REDACTED:secret].');
  });

  test('redactSecrets scrubs GitHub tokens and AWS keys', () => {
    const input = 'Token: ghp_1234567890abcdefghijklmnopqrstuvwxyz. AWS: AKIA1234567890ABCDEF.';
    const result = redactSecrets(input);

    assert.equal(result.secretsFound, 2);
    assert.ok(result.labels.includes('github_token'));
    assert.ok(result.labels.includes('aws_access_key'));
  });

  test('redactSecretsInObject recursively scrubs nested secrets and sensitive keys', () => {
    const input = {
      user: 'admin',
      password: 'super-secret-password-123', // Sensitive key name
      config: {
        db_url: 'postgres://admin:password123@localhost:5432/db', // Connection string pattern
        notes: 'No secrets here.',
      },
    };

    const result = redactSecretsInObject(input);

    assert.equal(result.password, '[REDACTED:secret]');
    assert.equal(result.config.db_url, '[REDACTED:secret]');
    assert.equal(result.user, 'admin');
    assert.equal(result.config.notes, 'No secrets here.');
  });

  test('createSourceRecord binds citation to exact content hash', () => {
    const uri = 'https://example.com/spec/v1';
    const content = 'The orbital period is 365.25 days.';

    const record1 = createSourceRecord(uri, content, { retrievedAt: '2026-10-01T00:00:00Z' });
    const record2 = createSourceRecord(uri, content, { retrievedAt: '2026-10-01T00:00:00Z' });

    // Same content must produce same hash
    assert.equal(record1.contentHash, record2.contentHash);
    assert.equal(record1.contentHash.length, 64); // SHA-256 hex length

    // Different content must produce different hash
    const record3 = createSourceRecord(uri, 'The orbital period is 365.24 days.', { retrievedAt: '2026-10-01T00:00:00Z' });
    assert.notEqual(record1.contentHash, record3.contentHash);
  });

  test('createSourceRecord flags stale sources based on maxAgeDays', () => {
    const uri = 'https://example.com/old-spec';
    const content = 'Old data.';

    // Retrieved 100 days ago
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 100);

    const record = createSourceRecord(uri, content, {
      retrievedAt: oldDate.toISOString(),
      maxAgeDays: 30
    });

    assert.equal(record.isStale, true);
  });
});
