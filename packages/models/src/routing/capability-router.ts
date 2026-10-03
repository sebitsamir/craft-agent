import { CraftError, CraftErrorCode } from '@craft-agent/contracts';
import type {
  ModelCapability,
  ModelDescriptor,
  ModelProvider,
} from '../ports/model-provider.js';

/**
 * Capability-Based Model Router
 *
 * The Master Spec (Section 11) mandates:
 * "Use capability-based routing: reasoning/tool use, vision, image/audio/video
 * generation, code completion and embedding, with provider adapters and
 * reproducible model identifiers."
 *
 * This router does NOT hard-code "if domain === 'software' use model X".
 * Instead, it matches required capabilities against advertised capabilities.
 *
 * Privacy and budget are first-class routing constraints:
 * - If the user policy says "local only", cloud models are excluded.
 * - If the budget is nearly exhausted, expensive models are excluded.
 */

// ---------------------------------------------------------------------------
// Routing constraints
// ---------------------------------------------------------------------------

/**
 * Constraints that narrow which model can be selected.
 */
export interface RoutingConstraints {
  /** Required capabilities the model must advertise. */
  readonly requiredCapabilities: readonly ModelCapability[];

  /** Maximum acceptable cost per 1M output tokens. */
  readonly maxCostPerOutputMillionTokens?: number;

  /** Privacy restriction: only allow these data destinations. */
  readonly allowedPrivacyDestinations?: readonly ('local' | 'provider_cloud' | 'self_hosted')[];

  /** Minimum context window required for this request. */
  readonly minContextTokens?: number;

  /** Whether tool use support is mandatory. */
  readonly requiresToolUse?: boolean;
}

/**
 * Result of a successful routing decision.
 */
export interface RoutingDecision {
  /** The selected model descriptor. */
  readonly model: ModelDescriptor;

  /** The provider that serves it. */
  readonly provider: ModelProvider;

  /** Why this model was chosen (for audit/debugging). */
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Router implementation
// ---------------------------------------------------------------------------

export class CapabilityRouter {
  private readonly providers: readonly ModelProvider[];
  private models: readonly ModelDescriptor[];

  constructor(providers: readonly ModelProvider[]) {
    this.providers = providers;

    // Flatten all model descriptors from all providers at construction time.
    // In production this would be refreshed periodically.
    this.models = [];
  }

  /**
   * Discovers all available models from registered providers.
   * Must be called before routing.
   */
  async refreshModels(): Promise<void> {
    const discovered: ModelDescriptor[] = [];

    for (const provider of this.providers) {
      const available = await provider.isAvailable();
      if (!available) continue;

      const models = await provider.listModels();
      discovered.push(...models);
    }

    // Replace the model list atomically.
    this.models = discovered;
  }

  /**
   * Selects the best model matching the given constraints.
   *
   * Selection strategy (deterministic):
   * 1. Filter by all hard constraints (capabilities, privacy, tool use).
   * 2. Filter by soft constraints (cost, context window).
   * 3. Among remaining candidates, prefer:
   *    a. Local privacy destination (data stays on device).
   *    b. Lower cost.
   *    c. Alphabetical model ID (tie-breaker for determinism).
   *
   * Throws CAPABILITY_NOT_FOUND if no model matches.
   */
  async route(constraints: RoutingConstraints): Promise<RoutingDecision> {
    // Ensure models are loaded.
    if (this.models.length === 0) {
      await this.refreshModels();
    }

    // Step 1: Hard constraint filtering.
    let candidates = this.models.filter((model) => {
      // Must have ALL required capabilities.
      const hasAllCapabilities = constraints.requiredCapabilities.every(
        (cap) => model.capabilities.includes(cap),
      );
      if (!hasAllCapabilities) return false;

      // Privacy destination must be allowed.
      if (
        constraints.allowedPrivacyDestinations &&
        !constraints.allowedPrivacyDestinations.includes(model.privacyDestination)
      ) {
        return false;
      }

      // Tool use must be supported if required.
      if (constraints.requiresToolUse && !model.supportsToolUse) {
        return false;
      }

      return true;
    });

    // Step 2: Soft constraint filtering.
    if (constraints.maxCostPerOutputMillionTokens !== undefined) {
      candidates = candidates.filter(
        (m) => m.costPerOutputMillionTokens <= constraints.maxCostPerOutputMillionTokens!,
      );
    }

    if (constraints.minContextTokens !== undefined) {
      candidates = candidates.filter(
        (m) => m.maxContextTokens >= constraints.minContextTokens!,
      );
    }

    // Step 3: No candidates means the capability is genuinely unavailable.
    if (candidates.length === 0) {
      throw new CraftError(
        CraftErrorCode.CAPABILITY_NOT_FOUND,
        `No model available matching constraints: ${JSON.stringify(constraints)}.`,
        { constraints },
      );
    }

    // Step 4: Deterministic ranking.
    candidates.sort((a, b) => {
      // Prefer local over cloud.
      const privacyRank = (dest: string) => (dest === 'local' ? 0 : dest === 'self_hosted' ? 1 : 2);
      const privacyDiff = privacyRank(a.privacyDestination) - privacyRank(b.privacyDestination);
      if (privacyDiff !== 0) return privacyDiff;

      // Prefer cheaper.
      const costDiff = a.costPerOutputMillionTokens - b.costPerOutputMillionTokens;
      if (costDiff !== 0) return costDiff;

      // Alphabetical tie-breaker.
      return a.modelId.localeCompare(b.modelId);
    });

        const selected = candidates[0];

    // Safety check to satisfy TypeScript's strict null checks
    if (!selected) {
      throw new CraftError(
        CraftErrorCode.CAPABILITY_NOT_FOUND,
        'Router logic error: candidates array was empty after filtering.',
      );
    }

    // Find the provider that serves this model.
    const provider = this.providers.find((p) => p.providerId === selected.providerId);
    if (!provider) {
      throw new CraftError(
        CraftErrorCode.CAPABILITY_NOT_FOUND,
        `Provider "${selected.providerId}" for model "${selected.modelId}" is no longer registered.`,
      );
    }

    return {
      model: selected,
      provider,
      reason: `Selected "${selected.modelId}" (privacy=${selected.privacyDestination}, cost=${selected.costPerOutputMillionTokens}/M) as best match for capabilities [${constraints.requiredCapabilities.join(', ')}].`,
    };
  }
}
