import { FakeProvider, QwenProvider } from '../../packages/models/dist/index.js';

export function selectModelProvider(env = process.env) {
  // Support OpenRouter, DashScope, and local Ollama keys
  const apiKey = env.OPENROUTER_API_KEY || env.DASHSCOPE_API_KEY || env.QWEN_API_KEY;
  const baseUrl = env.QWEN_BASE_URL || 'https://openrouter.ai/api/v1';
  const model = env.QWEN_MODEL || 'qwen-max';

  const isLocal = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1');
  const isOpenRouter = baseUrl.includes('openrouter.ai');

  if (apiKey || isLocal) {
    return {
      provider: new QwenProvider({
        apiKey: apiKey || 'ollama',
        baseUrl,
        model,
        // Give cloud models 60s, local models 120s
        timeoutMs: isLocal ? 120000 : 60000
      }),
      source: isLocal ? 'ollama (local)' : isOpenRouter ? `openrouter (${model})` : `qwen (${model})`,
      model: model,
    };
  }

  return {
    provider: new FakeProvider(),
    source: 'fake',
    model: 'fake-model',
  };
}
