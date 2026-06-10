import { Injectable, Logger } from "@nestjs/common";
import {
  IModelProvider,
  ProviderMetadata,
  ModelDefinition,
  ModelFilterOptions,
} from "./types/provider.types";

/** 供应商统一管理器（移植自 guada）：注册、发现、路由所有模型供应商 */
@Injectable()
export class ProviderHub {
  private providers = new Map<string, IModelProvider>();
  private readonly logger = new Logger(ProviderHub.name);

  register(provider: IModelProvider): void {
    this.providers.set(provider.id, provider);
    this.logger.log(`已注册供应商: ${provider.id} (${provider.name})`);
  }

  registerMany(providers: IModelProvider[]): void {
    providers.forEach((p) => this.register(p));
  }

  getProvider(id: string): IModelProvider {
    const p = this.providers.get(id);
    if (!p) throw new Error(`供应商不存在: ${id}。可用: ${[...this.providers.keys()].join(", ")}`);
    return p;
  }

  hasProvider(id: string): boolean {
    return this.providers.has(id);
  }

  getAllMetadata(): ProviderMetadata[] {
    return [...this.providers.values()].map((p) => p.getMetadata());
  }

  getAllProviders(): IModelProvider[] {
    return [...this.providers.values()];
  }

  getModels(providerId: string, options?: ModelFilterOptions): ModelDefinition[] {
    return this.getProvider(providerId).getModels(options);
  }

  getProviderCount(): number {
    return this.providers.size;
  }
}
