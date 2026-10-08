import { JunubError, JunubErrorCode } from '@junub-agent/contracts';
import type {
  ModelProvider,
  ModelDescriptor,
  ModelMessage,
  ModelCompletionRequest,
  ModelCompletionResponse,
  ModelUsage,
} from '../ports/model-provider.js';

export interface QwenProviderConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

export class QwenProvider implements ModelProvider {
  readonly providerId = 'qwen';

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(config: QwenProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'qwen-max';
    this.baseUrl = config.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    this.timeoutMs = config.timeoutMs ?? 30000;
    this.maxRetries = config.maxRetries ?? 3;
  }

  async isAvailable(): Promise<boolean> {
    const isLocal = this.baseUrl.includes('localhost') || this.baseUrl.includes('127.0.0.1');
    return !!(this.apiKey || isLocal);
  }

  async listModels(): Promise<readonly ModelDescriptor[]> {
    const isLocal = this.baseUrl.includes('localhost') || this.baseUrl.includes('127.0.0.1');

    if (isLocal) {
      return [{
        modelId: this.model,
        displayName: `Local: ${this.model}`,
        providerId: 'qwen',
        capabilities: ['reasoning', 'tool_use', 'code_generation', 'summarization', 'citation'],
        maxContextTokens: 32768,
        maxOutputTokens: 8192,
        costPerInputMillionTokens: 0,
        costPerOutputMillionTokens: 0,
        privacyDestination: 'local',
        supportsToolUse: true,
        supportsStreaming: true,
      }];
    }

    const isCustomModel = !['qwen-max', 'qwen-plus', 'qwen-turbo'].includes(this.model);
    if (isCustomModel || this.baseUrl.includes('openrouter')) {
      return [{
        modelId: this.model,
        displayName: this.model,
        providerId: 'qwen',
        capabilities: ['reasoning', 'tool_use', 'code_generation', 'summarization', 'citation'],
        maxContextTokens: 131072,
        maxOutputTokens: 8192,
        costPerInputMillionTokens: 1.0,
        costPerOutputMillionTokens: 3.0,
        privacyDestination: 'provider_cloud',
        supportsToolUse: true,
        supportsStreaming: true,
      }];
    }

    return [
      {
        modelId: 'qwen-max',
        displayName: 'Qwen Max',
        providerId: 'qwen',
        capabilities: ['reasoning', 'tool_use', 'code_generation', 'summarization', 'citation'],
        maxContextTokens: 32768,
        maxOutputTokens: 8192,
        costPerInputMillionTokens: 2.0,
        costPerOutputMillionTokens: 6.0,
        privacyDestination: 'provider_cloud',
        supportsToolUse: true,
        supportsStreaming: true,
      },
      {
        modelId: 'qwen-turbo',
        displayName: 'Qwen Turbo',
        providerId: 'qwen',
        capabilities: ['reasoning', 'code_generation', 'summarization'],
        maxContextTokens: 131072,
        maxOutputTokens: 8192,
        costPerInputMillionTokens: 0.4,
        costPerOutputMillionTokens: 1.2,
        privacyDestination: 'provider_cloud',
        supportsToolUse: true,
        supportsStreaming: true,
      }
    ];
  }

  async complete(request: ModelCompletionRequest): Promise<ModelCompletionResponse> {
    const isLocal = this.baseUrl.includes('localhost') || this.baseUrl.includes('127.0.0.1');
    if (!this.apiKey && !isLocal) {
      throw new JunubError(
        JunubErrorCode.CAPABILITY_UNAVAILABLE,
        'Qwen API key is not configured. Set DASHSCOPE_API_KEY or use a local provider.'
      );
    }

    const startTime = Date.now();
    const url = `${this.baseUrl}/chat/completions`;
    const messages = this.mapMessages(request.messages);

    const body = {
      model: request.modelId,
      messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxOutputTokens,
      stop: request.stopSequences,
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          throw new JunubError(JunubErrorCode.CAPABILITY_UNAVAILABLE, `API error (${response.status}): ${errorText}`);
        }

        const data = await response.json() as any;
        const choice = data.choices?.[0];

        if (!choice?.message?.content && !choice?.message?.tool_calls) {
          throw new JunubError(JunubErrorCode.CAPABILITY_UNAVAILABLE, 'Returned an empty or malformed response.');
        }

        const latencyMs = Date.now() - startTime;
        const usage = data.usage || {};
        const inputTokens = usage.prompt_tokens || 0;
        const outputTokens = usage.completion_tokens || 0;

        const costPerIn = request.modelId.includes('turbo') ? 0.4 : 2.0;
        const costPerOut = request.modelId.includes('turbo') ? 1.2 : 6.0;
        const estimatedCostUsd = isLocal ? 0 : ((inputTokens / 1000000) * costPerIn) + ((outputTokens / 1000000) * costPerOut);

        return {
          content: choice.message.content || '',
          toolCalls: choice.message.tool_calls?.map((tc: any) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments || '{}'),
          })) || [],
          servedBy: data.model || request.modelId,
          usage: { inputTokens, outputTokens, estimatedCostUsd, latencyMs },
          stopReason: this.mapStopReason(choice.finish_reason),
        };

      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isTransient = lastError.name === 'AbortError' || (lastError instanceof JunubError && lastError.message.includes('API error (5'));
        if (!isTransient || attempt === this.maxRetries) throw lastError;
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000));
      }
    }
    throw lastError || new Error('Unknown generation failure');
  }

  private mapMessages(messages: readonly ModelMessage[]): any[] {
    return messages.map(m => {
      const msg: any = { role: m.role, content: m.content };
      if (m.role === 'assistant' && m.toolCalls) {
        msg.tool_calls = m.toolCalls.map(tc => ({
          id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
        }));
      }
      if (m.role === 'tool' && m.toolResult) {
        msg.tool_call_id = m.toolResult.toolCallId;
      }
      return msg;
    });
  }

  private mapStopReason(reason: string | null | undefined): 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' {
    switch (reason) {
      case 'stop': return 'end_turn';
      case 'tool_calls': return 'tool_use';
      case 'length': return 'max_tokens';
      default: return 'end_turn';
    }
  }
}
