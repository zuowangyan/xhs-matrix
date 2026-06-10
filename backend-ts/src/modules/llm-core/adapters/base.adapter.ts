import { LLMCompletionParams, LLMResponseChunk } from "../types/llm.types";
import { ProviderConfig, ConnectionTestResult } from "../types/provider.types";

// 协议适配器接口（移植自 guada）
export interface IProtocolAdapter {
  readonly protocol: string;
  testConnection(config: ProviderConfig): Promise<ConnectionTestResult>;
  chatCompletion(
    params: LLMCompletionParams,
  ): AsyncGenerator<LLMResponseChunk> | Promise<LLMResponseChunk>;
}
