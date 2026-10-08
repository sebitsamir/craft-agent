import { FakeProvider, QwenProvider } from '../../packages/models/dist/index.js';

export function selectModelProvider(env = process.env) {
  const apiKey = env.DASHSCOPE_API_KEY || env.QWEN_API_KEY;
  const baseUrl = env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const model = env.QWEN_MODEL || 'qwen-max';

  const isLocal = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1');

  if (apiKey || isLocal) {
    return {
      // Ollama doesn't strictly need a key, but passing 'ollama' satisfies the header requirement safely
      provider: new QwenProvider({
        apiKey: apiKey || 'ollama',
        baseUrl,
        model,
        timeoutMs: isLocal ? 120000 : 30000 // Give local models more time to respond
      }),
      source: isLocal ? 'ollama (local)' : `qwen@${baseUrl} (${model})`,
    };
  }

  return {
    provider: new FakeProvider(),
    source: 'fake',
  };
}
