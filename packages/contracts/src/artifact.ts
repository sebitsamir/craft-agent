export interface ArtifactRights {
  readonly license?: string;
  readonly provenance?: string;
  readonly authors?: readonly string[];
}

export interface ArtifactReference {
  readonly id: string;
  readonly kind: string;
  readonly format: string;
  readonly path: string;
  readonly hash?: string;
  readonly rights?: ArtifactRights;
  readonly metadata?: Record<string, unknown>;
}
