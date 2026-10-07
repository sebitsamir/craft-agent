import { FakeProvider, QwenProvider } from '../../packages/models/dist/index.js';

/**
 * Selects the model provider for planning based on environment configuration.
 *
 * Supports any OpenAI-compatible provider (DashScope, OpenRouter, Together AI,
 * local Ollama, etc.) by reading apiKey, baseUrl, and model from env.
 *
 * Falls back to the deterministic FakeProvider when no key is configured.
 */
export function selectModelProvider(env = process.env) {
  const apiKey = env.DASHSCOPE_API_KEY || env.QWEN_API_KEY;

  if (apiKey) {
    const baseUrl = env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const model = env.QWEN_MODEL || 'qwen-max';
    return {
      provider: new QwenProvider({ apiKey, baseUrl, model, timeoutMs: 30000 }),
      source: `qwen@${baseUrl} (${model})`,
    };
  }

  return {
    provider: new FakeProvider(),
    source: 'fake',
  };
}
