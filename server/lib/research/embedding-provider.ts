export interface EmbeddingProvider {
  readonly kind: string;
  readonly enabled: boolean;
  embedTexts(texts: string[]): Promise<number[][]>;
}

export const DEFAULT_EMBEDDING_STATUS = {
  enabled: false as const,
  provider: "none" as const,
  reason: "Vector embeddings are disabled by default. Project RAG v1 uses local SQLite FTS only.",
};

export function createDisabledEmbeddingProvider(): EmbeddingProvider {
  return {
    kind: "none",
    enabled: false,
    async embedTexts() {
      throw new Error("Embedding provider is disabled. Enable an explicit provider before vector search.");
    },
  };
}
