import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import axios from "axios";
import { PrismaService } from "../../common/database/prisma.service";
import { SettingsService } from "../settings/settings.service";
import { LlmService } from "../llm-core/llm.service";
import { MessageRecord } from "../llm-core/types/llm.types";

@Injectable()
export class GatewayService {
  private readonly logger = new Logger(GatewayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly llm: LlmService,
  ) {}

  // ---------- 内置模板 ----------
  listTemplates() {
    return this.llm.listTemplates();
  }

  // ---------- 供应商配置 CRUD ----------
  async listProviders() {
    return this.prisma.modelProvider.findMany({
      orderBy: { createdAt: "asc" },
      include: { models: { orderBy: { createdAt: "asc" } } },
    });
  }

  async createProvider(data: {
    name: string;
    provider: string;
    protocol?: string;
    apiUrl: string;
    apiKey?: string;
  }) {
    return this.prisma.modelProvider.create({ data });
  }

  async updateProvider(id: string, data: any) {
    if (data.apiKey === "" || data.apiKey === undefined) delete data.apiKey; // 留空不覆盖
    return this.prisma.modelProvider.update({ where: { id }, data });
  }

  async removeProvider(id: string) {
    await this.prisma.modelProvider.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- 模型 CRUD（可加多个）----------
  async addModel(providerId: string, modelName: string, modelType = "text", name?: string) {
    return this.prisma.model.create({ data: { providerId, modelName, modelType, name } });
  }

  async removeModel(id: string) {
    await this.prisma.model.delete({ where: { id } });
    return { ok: true };
  }

  async toggleModel(id: string, isActive: boolean) {
    return this.prisma.model.update({ where: { id }, data: { isActive } });
  }

  // ---------- 当前模型选择（settings: gateway）----------
  async getActive() {
    const g = await this.settings.getGroup("gateway");
    return { activeTextModelId: g.activeTextModelId || "", activeImageModelId: g.activeImageModelId || "" };
  }

  async setActive(field: "activeTextModelId" | "activeImageModelId", modelId: string) {
    await this.settings.setGroup("gateway", { [field]: modelId });
    return this.getActive();
  }

  // ---------- 解析模型 → 调用所需配置 ----------
  private async resolveModel(modelId: string) {
    const model = await this.prisma.model.findUnique({ where: { id: modelId }, include: { provider: true } });
    if (!model) throw new BadRequestException("模型不存在");
    const p = model.provider;
    if (!p.apiKey) throw new BadRequestException(`供应商「${p.name}」未配置 API Key`);
    return {
      modelName: model.modelName,
      modelType: model.modelType,
      providerConfig: {
        provider: p.provider,
        protocol: p.protocol || "openai",
        apiUrl: p.apiUrl,
        apiKey: p.apiKey,
      },
    };
  }

  private async resolveActiveText(modelId?: string) {
    let id = modelId;
    if (!id) id = (await this.getActive()).activeTextModelId;
    if (!id) throw new BadRequestException("未选择文本模型：请到「设置」配置并选为当前");
    return this.resolveModel(id);
  }

  // ---------- 文本对话 ----------
  async chat(
    messages: MessageRecord[],
    opts: { temperature?: number; maxTokens?: number; modelId?: string } = {},
  ): Promise<{ content: string; usage: any }> {
    const r = await this.resolveActiveText(opts.modelId);
    const res = await this.llm.completions({
      model: r.modelName,
      messages,
      temperature: opts.temperature ?? 0.8,
      maxTokens: opts.maxTokens ?? 1500,
      stream: false,
      providerConfig: r.providerConfig,
    });
    return { content: res?.content || "", usage: res?.usage || null };
  }

  async testText(modelId?: string) {
    try {
      const r = await this.chat([{ role: "user", content: "回复两个字：你好" }], { maxTokens: 20, modelId });
      return { ok: true, message: r.content.trim() || "(空)", usage: r.usage };
    } catch (e: any) {
      return { ok: false, message: e?.message || "失败" };
    }
  }

  // 比例 → OpenAI images 尺寸 + 文字描述（小红书默认竖版 3:4）
  private static RATIO: Record<string, { size: string; desc: string }> = {
    "3:4": { size: "1024x1792", desc: "竖版 3:4（小红书推荐）" },
    "9:16": { size: "1024x1792", desc: "竖版 9:16" },
    "1:1": { size: "1024x1024", desc: "正方形 1:1" },
    "4:3": { size: "1792x1024", desc: "横版 4:3" },
    "16:9": { size: "1792x1024", desc: "横版 16:9" },
  };

  // ---------- 生图（统一进网关）----------
  // A) chat 出图：gemini-image / nano-banana / OpenRouter（图片在 message.images）
  // B) /images/generations：DALL·E 等
  // 比例：AI 默认竖版 3:4，可手动指定；chat 模型把比例写进提示词，images 接口走 size。
  async generateImage(prompt: string, opts: { modelId?: string; aspectRatio?: string; n?: number } = {}) {
    let id = opts.modelId;
    if (!id) id = (await this.getActive()).activeImageModelId;
    if (!id) throw new BadRequestException("未选择生图模型：请到「设置」配置并选为当前");
    const r = await this.resolveModel(id);
    const ratio = opts.aspectRatio && GatewayService.RATIO[opts.aspectRatio] ? opts.aspectRatio : "3:4";
    const ratioCfg = GatewayService.RATIO[ratio];

    // A) chat 出图
    let chatErr = "";
    try {
      const promptWithRatio = `${prompt}\n\n[图片要求] 比例 ${ratio}（${ratioCfg.desc}），高清、真实质感、无文字水印。`;
      const res = await this.llm.completions({
        model: r.modelName,
        messages: [{ role: "user", content: promptWithRatio }],
        providerConfig: r.providerConfig,
        stream: false,
        maxTokens: 4096,
      });
      const imgs = this.extractImages(res?.content || "");
      if (imgs.length) return { images: await this.saveImages(imgs) };
      chatErr = "chat 返回中无图片";
    } catch (e: any) {
      chatErr = e?.message || "chat 出图失败";
    }

    // B) /images/generations
    const base = (r.providerConfig.apiUrl || "").replace(/\/+$/, "");
    const url = (/\/v\d+$/.test(base) ? base : base + "/v1") + "/images/generations";
    try {
      const resp = await axios.post(
        url,
        { model: r.modelName, prompt, size: ratioCfg.size, n: opts.n || 1 },
        { headers: { Authorization: `Bearer ${r.providerConfig.apiKey}`, "Content-Type": "application/json" }, timeout: 120000 },
      );
      const items = resp.data?.data || [];
      const images = items.map((it: any) => it.url || (it.b64_json ? `data:image/png;base64,${it.b64_json}` : null)).filter(Boolean);
      if (images.length) return { images: await this.saveImages(images) };
      throw new Error("images 接口无返回");
    } catch (e: any) {
      const detail = e?.response?.data?.error?.message || e?.message || "请求失败";
      throw new BadRequestException(`生图失败（chat: ${chatErr}；images: ${detail}）`);
    }
  }

  /** 把 data:base64 图片存成文件，返回 /generated/xxx URL（http 图片原样保留）；避免 base64 撑爆数据库 */
  private async saveImages(images: string[]): Promise<string[]> {
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const { dataSub } = require("../../common/paths");
    const dir = dataSub("generated-images");
    const out: string[] = [];
    for (const img of images) {
      if (img.startsWith("data:")) {
        const b64 = img.split(",")[1] || "";
        const buf = Buffer.from(b64, "base64");
        // 去 AI 痕迹：重新编码，剥离 EXIF/C2PA 等"这是AI生成"元数据，并轻度重压缩
        // （注意：像 Google SynthID 那类像素级隐形水印无法保证去除，需配合"真实素材图"使用）
        const { buf: outBuf, ext } = await this.deAiProcess(buf);
        const name = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}.${ext}`;
        fs.writeFileSync(path.join(dir, name), outBuf);
        out.push(`/generated/${name}`);
      } else {
        out.push(img);
      }
    }
    return out;
  }

  /** 重编码图片以剥离元数据 + 轻度扰动，降低被平台判定为 AI 的概率 */
  private async deAiProcess(buf: Buffer): Promise<{ buf: Buffer; ext: string }> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sharp = require("sharp");
      const meta = await sharp(buf).metadata();
      const w = meta.width || 0;
      // 极轻微缩放（~99.4%）再以 jpeg 重压，破坏隐形水印一致性，肉眼无差
      const targetW = w ? Math.max(1, Math.round(w * 0.994)) : undefined;
      let s = sharp(buf, { failOn: "none" }).rotate(); // rotate() 按 EXIF 摆正后丢弃方向元数据
      if (targetW) s = s.resize(targetW);
      // 默认不 withMetadata() → 输出不含 EXIF/ICC/C2PA 文本元数据
      const outBuf = await s.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
      return { buf: outBuf, ext: "jpg" };
    } catch {
      // 处理失败则按原样保存
      return { buf, ext: this.detectExt(buf) };
    }
  }

  /** 按 magic bytes 判图片格式（不信任 data URL 声明的 MIME） */
  private detectExt(buf: Buffer): string {
    if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
    if (buf[0] === 0x89 && buf[1] === 0x50) return "png";
    if (buf[8] === 0x57 && buf[9] === 0x45) return "webp"; // RIFF....WEBP
    if (buf[0] === 0x47 && buf[1] === 0x49) return "gif";
    return "png";
  }

  /** 从文本中提取图片 URL（markdown 图片 或 裸 data:/http 链接） */
  private extractImages(content: string): string[] {
    if (!content) return [];
    const out: string[] = [];
    const md = /!\[[^\]]*\]\((data:[^)]+|https?:\/\/[^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = md.exec(content))) out.push(m[1]);
    if (!out.length) {
      const bare = /(data:image\/[^\s)]+|https?:\/\/[^\s)]+\.(?:png|jpe?g|webp))/gi;
      while ((m = bare.exec(content))) out.push(m[1]);
    }
    return out;
  }
}
