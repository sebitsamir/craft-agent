export type DomainStatus = 'bootstrap' | 'planned' | 'active';

export interface DomainMeta {
  readonly id: string;
  readonly status: DomainStatus;
  readonly reviewHint?: string;
  readonly exampleOutputs: readonly string[];
}
