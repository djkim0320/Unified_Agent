import type {
  AgentStep,
  ChatMessage,
  ProviderKind,
  ProviderSecret,
  ProviderTestResult,
  ReasoningLevel,
  SearchBackendAvailability,
} from "../types.js";

export interface ProviderAdapter<K extends ProviderKind> {
  kind: K;
  label: string;
  defaultModel: string;
  listModels: (secret: ProviderSecret<K> | null) => Promise<string[]>;
  testConnection: (secret: ProviderSecret<K> | null) => Promise<ProviderTestResult>;
  planToolStep: (params: {
    secret: ProviderSecret<K>;
    model: string;
    reasoningLevel: ReasoningLevel;
    instructions: string;
    messages: ChatMessage[];
  }) => Promise<AgentStep>;
  streamFinalAnswer: (params: {
    secret: ProviderSecret<K>;
    model: string;
    reasoningLevel: ReasoningLevel;
    instructions: string;
    messages: ChatMessage[];
    onText: (chunk: string) => void;
  }) => Promise<void>;
  searchWeb?: (params: {
    secret: ProviderSecret<K>;
    model: string;
    query: string;
  }) => Promise<{
    backend: SearchBackendAvailability["kind"];
    query: string;
    summary: string;
  }>;
}
