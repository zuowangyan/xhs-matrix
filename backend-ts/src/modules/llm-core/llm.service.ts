import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { ProviderHub } from "./provider-hub.service";
import { LLMCompletionParams, LLMResponseChunk } from "./types/llm.types";

/** 底层 LLM 调用（移植自 guada）：通过 ProviderHub + 协议适配器统一路由。无状态。 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(private readonly providerHub: ProviderHub) {}

  /** 内置供应商模板（含协议、推荐模型），供前端"新增供应商"时选择 */
  listTemplates() {
    return this.providerHub.getAllProviders().map((p) => ({
      ...p.getMetadata(),
      recommendedModels: p.getModels().map((m) => m.modelName),
    }));
  }

  async completions(params: LLMCompletionParams): Promise<LLMResponseChunk> {
    const providerId = params.providerConfig?.provider;
    const protocol = params.providerConfig?.protocol || "openai";
    if (!providerId) throw new BadRequestException("providerConfig.provider 缺失");
    const provider = this.providerHub.getProvider(providerId);
    const adapter = provider.getAdapter(protocol);
    if (!adapter) throw new BadRequestException(`供应商 ${providerId} 不支持协议 ${protocol}`);
    const iterator = adapter.chatCompletion({ ...params, stream: false });
    if (Symbol.asyncIterator in (iterator as any)) {
      const r = await (iterator as AsyncIterator<LLMResponseChunk>).next();
      return r.value;
    }
    return iterator as Promise<LLMResponseChunk>;
  }
}
