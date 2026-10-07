import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { QwenProvider } from '../packages/models/dist/index.js';
import { CapabilityRouter } from '../packages/models/dist/index.js';
import { JunubError } from '../packages/contracts/dist/index.js';

describe('E3 Slice 2: Capability Router with Qwen Provider', () => {
  test('router selects qwen-turbo when constrained by low cost', async () => {
    const qwen = new QwenProvider({ apiKey: 'fake-key-for-routing' });
    const router = new CapabilityRouter([qwen]);
    await router.refreshModels();

    const decision = await router.route({
      requiredCapabilities: ['reasoning'],
      maxCostPerOutputMillionTokens: 2.0,
    });

    assert.equal(decision.model.modelId, 'qwen-turbo', 'Should select qwen-turbo due to cost constraint (1.2 < 2.0)');
    assert.equal(decision.provider.providerId, 'qwen');
    assert.ok(decision.reason.includes('qwen-turbo'));
  });

  test('router selects qwen-max when cost allows and citation is required', async () => {
    const qwen = new QwenProvider({ apiKey: 'fake-key-for-routing' });
    const router = new CapabilityRouter([qwen]);
    await router.refreshModels();

    const decision = await router.route({
      requiredCapabilities: ['reasoning', 'citation'],
      maxCostPerOutputMillionTokens: 10.0,
    });

    assert.equal(decision.model.modelId, 'qwen-max', 'Should select qwen-max (only one with citation + reasoning)');
  });

  test('router respects privacy constraints (excludes cloud if local required)', async () => {
    const qwen = new QwenProvider({ apiKey: 'fake-key-for-routing' });
    const router = new CapabilityRouter([qwen]);
    await router.refreshModels();

    // Qwen models are 'provider_cloud'. Asking for 'local' only should fail.
    await assert.rejects(
      () => router.route({
        requiredCapabilities: ['reasoning'],
        allowedPrivacyDestinations: ['local']
      }),
      (err) => {
        assert.ok(err instanceof JunubError);
        assert.equal(err.code, 'CAPABILITY_NOT_FOUND');
        return true;
      }
    );
  });

  test('router throws CAPABILITY_NOT_FOUND for unsupported capabilities', async () => {
    const qwen = new QwenProvider({ apiKey: 'fake-key-for-routing' });
    const router = new CapabilityRouter([qwen]);
    await router.refreshModels();

    await assert.rejects(
      () => router.route({ requiredCapabilities: ['video_generation'] }),
      (err) => {
        assert.ok(err instanceof JunubError);
        assert.equal(err.code, 'CAPABILITY_NOT_FOUND');
        return true;
      }
    );
  });

  test('router skips unavailable providers and throws if no candidates remain', async () => {
    // Provider with no API key reports isAvailable() === false
    const unavailableQwen = new QwenProvider({ apiKey: '' });
    const router = new CapabilityRouter([unavailableQwen]);
    await router.refreshModels();

    await assert.rejects(
      () => router.route({ requiredCapabilities: ['reasoning'] }),
      (err) => {
        assert.ok(err instanceof JunubError);
        assert.equal(err.code, 'CAPABILITY_NOT_FOUND');
        return true;
      }
    );
  });
});
