import {
  IModelProvider,
  ProviderMetadata,
  ModelDefinition,
  ModelFilterOptions,
} from "../types/provider.types";
import { IProtocolAdapter } from "../adapters/base.adapter";
import { OpenAIAdapter } from "../adapters/openai.adapter";
import { GeminiAdapter } from "../adapters/gemini.adapter";

export interface ProviderSpec {
  id: string;
  name: string;
  defaultApiUrl: string;
  apiKeyUrl?: string;
  description?: string;
  protocols?: string[]; // 支持的协议；默认 ['openai']
  models: string[]; // 推荐文本模型名（用户仍可自行增删）
}

function textModel(name: string): ModelDefinition {
  return {
    modelName: name,
    modeType: "text",
    config: { inputCapabilities: ["text"], outputCapabilities: ["text"], features: [] },
  };
}

/**
 * 通用 OpenAI 兼容供应商（数据驱动，移植自 guada 的 provider 形式）。
 * 所有 OpenAI 兼容服务（含 Anthropic 兼容端点）共用 OpenAIAdapter，
 * 因此都自动具备 cache_control 缓存命中能力（Claude 命中）。
 */
export class GenericOpenAIProvider implements IModelProvider {
  readonly id: string;
  readonly name: string;
  readonly protocols: string[];
  readonly defaultApiUrl: string;
  private openaiAdapter = new OpenAIAdapter();
  private geminiAdapter = new GeminiAdapter();
  private _models: ModelDefinition[];
  private spec: ProviderSpec;

  constructor(spec: ProviderSpec) {
    this.spec = spec;
    this.id = spec.id;
    this.name = spec.name;
    this.defaultApiUrl = spec.defaultApiUrl;
    this.protocols = spec.protocols && spec.protocols.length ? spec.protocols : ["openai"];
    this._models = spec.models.map(textModel);
  }

  // 按协议返回适配器：gemini → 谷歌原生；openai/openai-response/anthropic → OpenAI 兼容
  getAdapter(protocol: string): IProtocolAdapter | null {
    if (!this.protocols.includes(protocol)) return null;
    if (protocol === "gemini") return this.geminiAdapter;
    return this.openaiAdapter;
  }

  getMetadata(): ProviderMetadata {
    return {
      id: this.id,
      name: this.name,
      description: this.spec.description,
      apiKeyUrl: this.spec.apiKeyUrl,
      protocols: this.protocols,
      defaultApiUrl: this.defaultApiUrl,
    };
  }

  getModels(options?: ModelFilterOptions): ModelDefinition[] {
    if (!options) return this._models;
    return this._models.filter((m) => !options.modeType || m.modeType === options.modeType);
  }

  getModelThinkingEfforts(): string[] {
    return [];
  }
}
