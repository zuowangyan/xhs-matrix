import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from "@nestjs/common";
import { GatewayService } from "./gateway.service";

// 脱敏：apiKey 不直接下发
function maskProvider(p: any) {
  const k = p.apiKey || "";
  return {
    ...p,
    apiKey: undefined,
    hasKey: !!k,
    apiKeyMask: k ? (k.length > 4 ? "****" + k.slice(-4) : "****") : "",
  };
}

@Controller("gateway")
export class GatewayController {
  constructor(private readonly svc: GatewayService) {}

  // 内置供应商模板（含协议、推荐模型）
  @Get("templates")
  templates() {
    return this.svc.listTemplates();
  }

  // 已配置供应商（含其模型）
  @Get("providers")
  async providers() {
    const list = await this.svc.listProviders();
    return list.map(maskProvider);
  }

  @Post("providers")
  createProvider(@Body() body: any) {
    return this.svc.createProvider(body).then(maskProvider);
  }

  @Patch("providers/:id")
  updateProvider(@Param("id") id: string, @Body() body: any) {
    return this.svc.updateProvider(id, body).then(maskProvider);
  }

  @Delete("providers/:id")
  removeProvider(@Param("id") id: string) {
    return this.svc.removeProvider(id);
  }

  // 模型增删（可多个）
  @Post("models")
  addModel(@Body() body: { providerId: string; modelName: string; modelType?: string; name?: string }) {
    return this.svc.addModel(body.providerId, body.modelName, body.modelType, body.name);
  }

  @Delete("models/:id")
  removeModel(@Param("id") id: string) {
    return this.svc.removeModel(id);
  }

  @Patch("models/:id")
  toggleModel(@Param("id") id: string, @Body() body: { isActive: boolean }) {
    return this.svc.toggleModel(id, body.isActive);
  }

  // 当前模型
  @Get("active")
  active() {
    return this.svc.getActive();
  }

  @Put("active")
  setActive(@Body() body: { field: "activeTextModelId" | "activeImageModelId"; modelId: string }) {
    return this.svc.setActive(body.field, body.modelId);
  }

  // 测试 / 生图
  @Post("test")
  test(@Body() body: { modelId?: string }) {
    return this.svc.testText(body?.modelId);
  }

  @Post("image")
  image(@Body() body: { prompt: string; modelId?: string; aspectRatio?: string }) {
    return this.svc.generateImage(body.prompt, { modelId: body.modelId, aspectRatio: body.aspectRatio });
  }
}
