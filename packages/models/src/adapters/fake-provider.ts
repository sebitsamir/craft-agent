import { CraftError, CraftErrorCode } from '@craft-agent/contracts'
import type {
  ModelCompletionRequest,
  ModelCompletionResponse,
  ModelDescriptor,
  ModelProvider,
} from '../ports/model-provider.js';

/**
 * Deterministic Fake Model Provider
 *
 * This adapter exists so the entire planning/execution pipeline can be
 * tested WITHOUT an API key, network access, or non-deterministic output.
 *
 * The Master Prompt explicitly requires:
 * "Use fake model adapters for deterministic early tests; do not demand
 * a paid API key before the architecture and headless loop work."
 *
 * Behavior:
 * - Returns pre-scripted responses keyed by a "scenario" in the system message.
 * - Reports fixed usage so budget tests are reproducible.
 * - Never calls the network.
 * - Never proposes unauthorized tool calls.
 */

// ---------------------------------------------------------------------------
// Scenario registry
// ---------------------------------------------------------------------------

/**
 * A scripted response the fake provider can return.
 */
interface FakeScenario {
  readonly content: string;
  readonly toolCalls?: readonly {
    readonly id: string;
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  }[];
  readonly stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
}

/**
 * Built-in scenarios for deterministic testing.
 *
 * Tests select a scenario by including `[scenario:NAME]` in the system message.
 * This avoids fragile string matching on user content.
 */
const SCENARIOS: Record<string, FakeScenario> = {
  // A simple read-only plan with two steps and citations.
  'simple-plan': {
    content: JSON.stringify({
      plan: [
        {
          stepId: 'step-read-files',
          action: 'read_files',
          description: 'Read the target source files to understand current structure.',
          readOnly: true,
          sources: [
            {
              uri: 'file:///src/index.ts',
              retrievedAt: '2026-10-01T00:00:00.000Z',
              confidence: 1.0,
            },
          ],
        },
        {
          stepId: 'step-summarize',
          action: 'summarize',
          description: 'Produce a summary of the codebase architecture.',
          readOnly: true,
          sources: [
            {
              uri: 'file:///README.md',
              retrievedAt: '2026-10-01T00:00:00.000Z',
              confidence: 0.95,
            },
          ],
        },
      ],
      estimatedModelCalls: 2,
      estimatedCostUsd: 0,
    }),
    stopReason: 'end_turn',
  },

  // A plan that proposes a tool call (read-only).
  'tool-proposal': {
    content: 'I will read the repository structure first.',
    toolCalls: [
      {
        id: 'call-001',
        name: 'read_directory',
        arguments: { path: '/src', recursive: true },
      },
    ],
    stopReason: 'tool_use',
  },

  // A scenario that simulates a transient failure.
  'transient-error': {
    content: '',
    stopReason: 'end_turn',
  },

  // A scenario that simulates an accurate "I cannot do this" response.
  'honest-refusal': {
    content: JSON.stringify({
      plan: [],
      refusal: {
        reason: 'UNSUPPORTED',
        message: 'This task requires video generation, which is not available in this environment.',
        suggestedNextAction: 'Install the media capability pack or use an external render service.',
      },
    }),
    stopReason: 'end_turn',
  },
};

// ---------------------------------------------------------------------------
// Fake provider implementation
// ---------------------------------------------------------------------------

/**
 * Configuration for the fake provider.
 */
export interface FakeProviderConfig {
  /** Fixed latency to simulate (ms). Default 0. */
  readonly simulatedLatencyMs?: number;

  /** Fixed input token count for usage reporting. Default 100. */
  readonly fixedInputTokens?: number;

  /** Fixed output token count for usage reporting. Default 50. */
  readonly fixedOutputTokens?: number;

  /** If set, the provider fails with this error on every call. */
  readonly forceError?: {
    readonly code: string;
    readonly message: string;
  };
}

export class FakeProvider implements ModelProvider {
  readonly providerId = 'fake';

  private readonly config: FakeProviderConfig;

  constructor(config: FakeProviderConfig = {}) {
    this.config = config;
  }

  /**
   * Returns a single fake model descriptor for testing.
   */
  async listModels(): Promise<readonly ModelDescriptor[]> {
    return [
      {
        modelId: 'fake-deterministic-v1',
        displayName: 'Fake Deterministic Model v1',
        providerId: this.providerId,
        capabilities: ['reasoning', 'tool_use', 'summarization', 'citation'],
        maxContextTokens: 8192,
        maxOutputTokens: 4096,
        costPerInputMillionTokens: 0,
        costPerOutputMillionTokens: 0,
        privacyDestination: 'local',
        supportsToolUse: true,
        supportsStreaming: false,
      },
    ];
  }

  /**
   * Returns a deterministic response based on the scenario tag.
   *
   * If no scenario tag is found, returns a default "empty plan" response
   * so tests never hang or produce random output.
   */
  async complete(request: ModelCompletionRequest): Promise<ModelCompletionResponse> {
    // Simulate provider failure if configured.
    if (this.config.forceError) {
      throw new CraftError(
        this.config.forceError.code as never,
        this.config.forceError.message,
      );
    }

    // Simulate latency for timing-sensitive tests.
    if (this.config.simulatedLatencyMs && this.config.simulatedLatencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.simulatedLatencyMs));
    }

    // Extract scenario from system message.
    const scenarioName = this.extractScenario(request);
    const scenario = SCENARIOS[scenarioName];

    // Default response if no scenario matches.
    if (!scenario) {
      return {
        content: JSON.stringify({ plan: [], note: 'No scenario matched. Returning empty plan.' }),
        toolCalls: [],
        servedBy: 'fake-deterministic-v1',
        usage: this.buildUsage(),
        stopReason: 'end_turn',
      };
    }

    // Special case: transient-error scenario throws.
    if (scenarioName === 'transient-error') {
      throw new CraftError(
        'TRANSIENT_PROVIDER_ERROR' as never,
        'Simulated transient provider failure (rate limit).',
      );
    }

    return {
      content: scenario.content,
      toolCalls: scenario.toolCalls ?? [],
      servedBy: 'fake-deterministic-v1',
      usage: this.buildUsage(),
      stopReason: scenario.stopReason,
    };
  }

  /**
   * The fake provider is always available (it's local and deterministic).
   */
  async isAvailable(): Promise<boolean> {
    return true;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Extracts the scenario name from a `[scenario:NAME]` tag in the system message.
   */
  private extractScenario(request: ModelCompletionRequest): string {
    const systemMessage = request.messages.find((m) => m.role === 'system');
    if (!systemMessage) return 'default';

    const match = systemMessage.content.match(/\[scenario:([a-z0-9-]+)\]/i);
    return match && match[1] ? match[1] : 'default';
  }

  /**
   * Builds reproducible usage statistics.
   */
  private buildUsage(): {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    latencyMs: number;
  } {
    return {
      inputTokens: this.config.fixedInputTokens ?? 100,
      outputTokens: this.config.fixedOutputTokens ?? 50,
      estimatedCostUsd: 0, // Fake provider is free.
      latencyMs: this.config.simulatedLatencyMs ?? 0,
    };
  }
}
