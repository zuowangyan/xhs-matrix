// 供应商统一接口（移植自 guada llm-core）

export interface ProviderMetadata {
  id: string;
  name: string;
  description?: string;
  apiKeyUrl?: string;
  protocols: string[];
  defaultApiUrl: string;
  features?: string[];
}

export interface ModelConfig {
  inputCapabilities: string[];
  outputCapabilities: string[];
  features: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
}

export interface ModelDefinition {
  modelName: string;
  modeType: "text" | "embedding" | "image";
  config: ModelConfig;
}

export interface ModelFilterOptions {
  modeType?: "text" | "embedding" | "image";
  feature?: string;
}

export interface ProviderConfig {
  apiUrl: string;
  apiKey: string;
  protocol?: string;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  details?: any;
}

export interface IModelProvider {
  readonly id: string;
  readonly name: string;
  readonly protocols: string[];
  readonly defaultApiUrl: string;
  getMetadata(): ProviderMetadata;
  getModels(options?: ModelFilterOptions): ModelDefinition[];
  getModelThinkingEfforts(modelName: string): string[];
  getAdapter(protocol: string): import("../adapters/base.adapter").IProtocolAdapter | null;
}
