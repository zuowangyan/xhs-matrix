import { Global, Module, OnModuleInit } from "@nestjs/common";
import { ProviderHub } from "./provider-hub.service";
import { LlmService } from "./llm.service";
import { GenericOpenAIProvider } from "./providers/generic-openai.provider";
import { PROVIDER_SPECS } from "./providers/providers.data";

// 底层 LLM 核心：ProviderHub（内置供应商模板）+ LlmService（completions 路由）。
// 上层的 DB 配置 / 当前模型 / chat / 生图由 gateway 模块负责。
@Global()
@Module({
  providers: [ProviderHub, LlmService],
  exports: [ProviderHub, LlmService],
})
export class LlmCoreModule implements OnModuleInit {
  constructor(private readonly hub: ProviderHub) {}

  onModuleInit() {
    this.hub.registerMany(PROVIDER_SPECS.map((spec) => new GenericOpenAIProvider(spec)));
  }
}
