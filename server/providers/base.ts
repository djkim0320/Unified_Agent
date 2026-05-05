import type {
  ProviderKind,
  ProviderSecret,
  ProviderTestResult,
} from "../types.js";

export type ProviderModelLister<K extends ProviderKind> = (
  secret: ProviderSecret<K> | null,
) => Promise<string[]>;

export interface ProviderAdapter<K extends ProviderKind> {
  kind: K;
  label: string;
  defaultModel: string;
  listModels: ProviderModelLister<K>;
  testConnection(secret: ProviderSecret<K> | null): Promise<ProviderTestResult>;
}

export async function testProviderModelListing<K extends ProviderKind>(
  secret: ProviderSecret<K> | null,
  listModels: ProviderModelLister<K>,
  failureMessage: string,
): Promise<ProviderTestResult> {
  try {
    const models = await listModels(secret);
    return {
      ok: true,
      message: `Connected successfully. Loaded ${models.length} models.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : failureMessage,
    };
  }
}
