/**
 * Model Provider Port
 *
 * This is the "brain socket" of Craft Agent. Every LLM, vision model,
 * code-completion model, or image generator connects through this interface.
 *
 * Design principles from the Master Spec (Section 11):
 * - Capability-based routing: the system routes by what the model CAN do,
 *   not by a hard-coded domain-to-model mapping.
 * - Provider isolation: the kernel never imports a specific SDK.
 * - Reproducible identifiers: every call records which exact model version ran.
 * - Budget awareness: usage is reported per call so the kernel can enforce limits.
 * - Failure honesty: providers return structured errors, not swallowed exceptions.
 */

// ---------------------------------------------------------------------------
// Capability declarations
// ---------------------------------------------------------------------------

/**
 * Capabilities a model provider can advertise.
 *
 * The Master Spec explicitly says: "The system should not pretend one model
 * excels at every domain." Each provider declares what it is actually good at.
 */
export type ModelCapability =
  | 'reasoning'        // Multi-step logical reasoning and planning
  | 'tool_use'         // Structured function/tool calling
  | 'vision'           // Image understanding
  | 'code_generation'  // Code writing and editing
  | 'code_completion'  // Low-latency inline suggestions
  | 'embedding'        // Semantic search vectors
  | 'image_generation' // Text-to-image
  | 'audio_generation' // Text-to-speech / music
  | 'video_generation' // Text/image-to-video
  | 'summarization'    // Long-context condensation
  | 'citation';        // Source-grounded generation

/**
 * Metadata a provider advertises for one model.
 *
 * This is used by the capability router to decide which model handles
 * which step, and by the budget guard to estimate cost before execution.
 */
export interface ModelDescriptor {
  /** Stable provider-specific model id, e.g., "claude-sonnet-4-20250514". */
  readonly modelId: string;

  /** Human-readable display name. */
  readonly displayName: string;

  /** The provider that serves this model, e.g., "anthropic", "openai", "local". */
  readonly providerId: string;

  /** Capabilities this model advertises. */
  readonly capabilities: readonly ModelCapability[];

  /** Maximum context window in tokens. */
  readonly maxContextTokens: number;

  /** Maximum output tokens per single call. */
  readonly maxOutputTokens: number;

  /** Estimated cost per 1M input tokens (USD). Zero for local models. */
  readonly costPerInputMillionTokens: number;

  /** Estimated cost per 1M output tokens (USD). Zero for local models. */
  readonly costPerOutputMillionTokens: number;

  /** Privacy destination: where the data physically goes. */
  readonly privacyDestination: 'local' | 'provider_cloud' | 'self_hosted';

  /** Whether this model supports structured tool calling. */
  readonly supportsToolUse: boolean;

  /** Whether this model supports streaming responses. */
  readonly supportsStreaming: boolean;
}

// ---------------------------------------------------------------------------
// Request and response types
// ---------------------------------------------------------------------------

/**
 * A single message in a model conversation.
 *
 * We keep this provider-neutral. Provider adapters translate to/from
 * their native SDK format internally.
 */
export interface ModelMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;

  /** Optional tool call metadata for assistant messages. */
  readonly toolCalls?: readonly ModelToolCall[];

  /** Optional tool result metadata for tool messages. */
  readonly toolResult?: {
    readonly toolCallId: string;
    readonly output: string;
    readonly isError: boolean;
  };
}

/**
 * A structured tool call requested by the model.
 *
 * IMPORTANT: The model PROPOSES tool calls. The kernel VALIDATES and
 * AUTHORIZES them. A model can never execute a tool directly.
 */
export interface ModelToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

/**
 * Tool definition passed to the model so it knows what actions are available.
 *
 * The kernel filters this list based on granted permissions before sending.
 * A model never sees tools it is not authorized to propose.
 */
export interface ModelToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parametersSchema: Record<string, unknown>;

  /** Permission required to execute this tool. */
  readonly requiredPermission: string;
}

/**
 * A completion request to a model provider.
 */
export interface ModelCompletionRequest {
  /** Which model to use. Must match a registered descriptor. */
  readonly modelId: string;

  /** Conversation messages in order. */
  readonly messages: readonly ModelMessage[];

  /** Tools the model may propose (kernel-filtered by permission). */
  readonly tools?: readonly ModelToolDefinition[];

  /** Sampling temperature. Lower = more deterministic. */
  readonly temperature?: number;

  /** Maximum tokens to generate in this call. */
  readonly maxOutputTokens?: number;

  /** Optional stop sequences. */
  readonly stopSequences?: readonly string[];
}

/**
 * Usage statistics reported by the provider after a completion.
 *
 * These feed directly into the kernel budget guard.
 */
export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
  readonly latencyMs: number;
}

/**
 * A successful completion response from a provider.
 */
export interface ModelCompletionResponse {
  /** The model's text response. */
  readonly content: string;

  /** Structured tool calls proposed by the model (if any). */
  readonly toolCalls: readonly ModelToolCall[];

  /** Exact model version that served this request. */
  readonly servedBy: string;

  /** Token usage and cost for budget enforcement. */
  readonly usage: ModelUsage;

  /** Stop reason reported by the provider. */
  readonly stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

/**
 * The provider port that all model backends must implement.
 *
 * Implementations:
 * - FakeProvider (F3): deterministic, offline, for testing
 * - AnthropicProvider (future): Claude API
 * - OpenAIProvider (future): GPT API
 * - OllamaProvider (future): local inference
 *
 * The kernel depends ONLY on this interface, never on a concrete adapter.
 */
export interface ModelProvider {
  /** Unique provider identifier, e.g., "fake", "anthropic", "ollama". */
  readonly providerId: string;

  /** Returns all models this provider currently supports. */
  listModels(): Promise<readonly ModelDescriptor[]>;

  /**
   * Sends a completion request and returns the response.
   *
   * Contract:
   * - Must throw CraftError on failure, not return partial garbage.
   * - Must report accurate usage for budget enforcement.
   * - Must not execute tools; only PROPOSE them.
   * - Must not include secrets from the request in error messages.
   */
  complete(request: ModelCompletionRequest): Promise<ModelCompletionResponse>;

  /** Health check: can this provider currently serve requests? */
  isAvailable(): Promise<boolean>;
}
