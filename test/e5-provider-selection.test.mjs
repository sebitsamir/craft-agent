import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { selectModelProvider } from '../src/lib/providers.mjs';

describe('E5 Slice 1: model provider selection', () => {
  test('falls back to FakeProvider when no API key is set', () => {
    const { provider, source } = selectModelProvider({});
    assert.equal(source, 'fake');
    assert.equal(typeof provider.complete, 'function');
  });

  test('selects QwenProvider when DASHSCOPE_API_KEY is set', () => {
    const { provider, source } = selectModelProvider({ DASHSCOPE_API_KEY: 'sk-test' });
    assert.equal(source, 'qwen');
    assert.equal(provider.providerId, 'qwen');
  });

  test('selects QwenProvider when QWEN_API_KEY is set', () => {
    const { provider, source } = selectModelProvider({ QWEN_API_KEY: 'sk-test' });
    assert.equal(source, 'qwen');
    assert.equal(provider.providerId, 'qwen');
  });

  test('treats an empty API key as absent (falls back to FakeProvider)', () => {
    const { provider, source } = selectModelProvider({ DASHSCOPE_API_KEY: '' });
    assert.equal(source, 'fake');
  });

  test('prefers DASHSCOPE_API_KEY when both keys are set', () => {
    const { source } = selectModelProvider({ DASHSCOPE_API_KEY: 'a', QWEN_API_KEY: 'b' });
    assert.equal(source, 'qwen');
  });
});
