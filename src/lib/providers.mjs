import { FakeProvider, QwenProvider } from '../../packages/models/dist/index.js';

/**
 * Selects the model provider for planning based on environment configuration.
 *
 * Returns the real QwenProvider when an API key is available, otherwise
 * falls back to the deterministic FakeProvider for offline/test use.
 *
 * The kernel and planner never know which one was chosen — they only see
 * the ModelProvider port. This keeps provider isolation intact.
 */
export function selectModelProvider(env = process.env) {
  const apiKey = env.DASHSCOPE_API_KEY || env.QWEN_API_KEY;

  if (apiKey) {
    return {
      provider: new QwenProvider({ apiKey, timeoutMs: 30000 }),
      source: 'qwen',
    };
  }

  return {
    provider: new FakeProvider(),
    source: 'fake',
  };
}
