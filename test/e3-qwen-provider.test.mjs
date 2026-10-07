import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { QwenProvider } from '../packages/models/dist/index.js';
import { JunubError } from '../packages/contracts/dist/index.js';

describe('E3 Slice 1: Qwen Model Provider', () => {
  test('throws classified error if API key is missing', async () => {
    const provider = new QwenProvider({ apiKey: '' });
    
    assert.equal(await provider.isAvailable(), false, 'Provider must report unavailable without key');

    await assert.rejects(
      () => provider.complete({ modelId: 'qwen-max', messages: [{ role: 'user', content: 'hello' }] }),
      (err) => {
        assert.ok(err instanceof JunubError);
        assert.equal(err.code, 'CAPABILITY_UNAVAILABLE');
        return true;
      }
    );
  });

  test('listModels returns correctly typed descriptors', async () => {
    const provider = new QwenProvider({ apiKey: 'fake-key' });
    const models = await provider.listModels();
    
    assert.ok(models.length > 0);
    const max = models.find(m => m.modelId === 'qwen-max');
    assert.ok(max);
    assert.equal(max.providerId, 'qwen');
    assert.ok(max.capabilities.includes('reasoning'));
    assert.equal(max.privacyDestination, 'provider_cloud');
  });

  test('successfully generates text when API key is present', { 
    skip: !(process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY) 
  }, async () => {
    const apiKey = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;
    const provider = new QwenProvider({ apiKey });
    
    assert.equal(await provider.isAvailable(), true);

    const response = await provider.complete({
      modelId: 'qwen-turbo', // Fast/cheap for tests
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Say "Hello, Junub Agent!"' }
      ],
      temperature: 0.1,
      maxOutputTokens: 50,
    });

    assert.ok(response.content.toLowerCase().includes('hello') || response.content.toLowerCase().includes('junub'));
    assert.ok(response.usage, 'Usage metrics must be returned');
    assert.ok(response.usage.inputTokens > 0, 'Input tokens must be > 0');
    assert.ok(response.usage.latencyMs > 0, 'Latency must be recorded');
    assert.equal(response.servedBy.includes('qwen'), true, 'ServedBy must report the model used');
  });
});
