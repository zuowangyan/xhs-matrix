import { Injectable, NotFoundException, Logger } from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service";
import { GatewayService } from "../gateway/gateway.service";

// 模板骨架（创建空间时自动生成分类页面 pageType=category）
const TEMPLATES: Record<string, string[]> = {
  product: ["产品卖点", "成分功效", "适用人群", "常见问答(FAQ)", "合规话术"],
  persona: ["品牌故事", "口吻范文", "风格样例", "禁忌与红线"],
  general: ["概览"],
};

export type WikiPageType = "category" | "source" | "entity" | "topic" | "synthesis";

@Injectable()
export class WikiService {
  private readonly logger = new Logger(WikiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: GatewayService,
  ) {}

  // ---- 空间 ----
  async createSpace(data: { name: string; description?: string; template?: string }) {
    const space = await this.prisma.wikiSpace.create({
      data: { name: data.name, description: data.description, template: data.template },
    });
    const cats = TEMPLATES[data.template || "general"] || [];
    let order = 0;
    for (const c of cats) {
      await this.prisma.wikiPage.create({
        data: { spaceId: space.id, title: c, content: "", order: order++, pageType: "category" },
      });
    }
    return space;
  }

  listSpaces() {
    return this.prisma.wikiSpace.findMany({ orderBy: { createdAt: "desc" } });
  }

  async removeSpace(id: string) {
    await this.prisma.wikiSpace.delete({ where: { id } });
    return { ok: true };
  }

  // ---- 页面（树形 + 分层）----
  async pageTree(spaceId: string) {
    const pages = await this.prisma.wikiPage.findMany({ where: { spaceId }, orderBy: { order: "asc" } });
    const byId: Record<string, any> = {};
    pages.forEach((p) => (byId[p.id] = { ...p, children: [] }));
    const roots: any[] = [];
    pages.forEach((p) => {
      if (p.parentId && byId[p.parentId]) byId[p.parentId].children.push(byId[p.id]);
      else roots.push(byId[p.id]);
    });
    return roots;
  }

  getPage(id: string) {
    return this.prisma.wikiPage.findUnique({ where: { id } });
  }

  createPage(data: {
    spaceId: string;
    parentId?: string;
    title: string;
    content?: string;
    pageType?: WikiPageType;
    tags?: string;
    confidence?: string;
  }) {
    return this.prisma.wikiPage.create({
      data: {
        spaceId: data.spaceId,
        parentId: data.parentId,
        title: data.title,
        content: data.content || "",
        pageType: data.pageType || "topic",
        tags: data.tags,
        confidence: data.confidence,
      },
    });
  }

  async updatePage(id: string, data: { title?: string; content?: string; tags?: string; confidence?: string }) {
    return this.prisma.wikiPage.update({ where: { id }, data });
  }

  async removePage(id: string) {
    await this.prisma.wikiPage.deleteMany({ where: { parentId: id } });
    await this.prisma.wikiPage.delete({ where: { id } });
    return { ok: true };
  }

  /** AI 写回：按标题+类型 create/update/append（对齐 guada write 工具） */
  async write(data: {
    spaceId: string;
    title: string;
    content: string;
    pageType?: WikiPageType;
    tags?: string;
    confidence?: string;
    mode?: "create" | "update" | "append";
  }) {
    const pageType = data.pageType || "topic";
    const existing = await this.prisma.wikiPage.findFirst({
      where: { spaceId: data.spaceId, title: data.title, pageType },
    });
    if (existing && data.mode !== "create") {
      const content = data.mode === "append" ? existing.content + "\n\n" + data.content : data.content;
      return this.prisma.wikiPage.update({
        where: { id: existing.id },
        data: { content, tags: data.tags ?? existing.tags, confidence: data.confidence ?? existing.confidence },
      });
    }
    return this.createPage({ ...data, pageType });
  }

  // ---- 检索（生成时 RAG 注入）----
  async search(spaceIds: string[], query: string, limit = 6) {
    if (!spaceIds?.length || !query) return [];
    const terms = query.split(/\s+/).filter(Boolean).slice(0, 6);
    const pages = await this.prisma.wikiPage.findMany({
      where: {
        spaceId: { in: spaceIds },
        pageType: { not: "category" },
        OR: terms.flatMap((t) => [
          { title: { contains: t } },
          { content: { contains: t } },
          { tags: { contains: t } },
        ]),
      },
      take: limit,
    });
    return pages.map((p) => ({ title: p.title, content: p.content.slice(0, 800), pageType: p.pageType }));
  }

  async dump(spaceIds: string[], limit = 12) {
    if (!spaceIds?.length) return [];
    const pages = await this.prisma.wikiPage.findMany({
      where: { spaceId: { in: spaceIds }, content: { not: "" }, pageType: { not: "category" } },
      take: limit,
    });
    return pages.map((p) => ({ title: p.title, content: p.content.slice(0, 800), pageType: p.pageType }));
  }

  // ========== 自动更新：LLM 综合写回 ==========
  /**
   * 把一段原始素材交给 LLM，自动拆成分层知识页（entity/topic/synthesis）写入空间。
   * 同时把原始素材本身存为 source 页（可追溯）。
   */
  async synthesize(spaceId: string, sourceText: string, sourceLabel = "原始素材") {
    const space = await this.prisma.wikiSpace.findUnique({ where: { id: spaceId } });
    if (!space) throw new NotFoundException("空间不存在");

    // 1) 存原始素材为 source 页
    await this.write({
      spaceId,
      title: `${sourceLabel}-${new Date().toLocaleString("zh-CN")}`,
      content: sourceText.slice(0, 5000),
      pageType: "source",
      confidence: "EXTRACTED",
      mode: "create",
    });

    // 2) LLM 抽取结构化知识
    const sys = `你是知识库构建助手。把用户提供的素材抽取成结构化的小红书运营知识页面。
分层规则：
- entity：实体（产品名/成分/人物/品牌）
- topic：主题（功效/适用场景/卖点/FAQ/合规话术）
- synthesis：综合分析（多条信息归纳的结论/竞品规律）
每页给 tags（逗号分隔，便于检索）和 confidence（EXTRACTED=直接来自素材 / INFERRED=推理 / UNVERIFIED=待验证）。
控制在 4-8 条。
【输出格式·必须严格遵守】直接输出一个 JSON 数组，禁止任何前言、解释、思考过程或 markdown 代码块（不要 \`\`\`）。
格式：[{"title":"","content":"Markdown","pageType":"entity|topic|synthesis","tags":"a,b,c","confidence":"EXTRACTED"}]`;
    const { content: raw } = await this.gateway.chat(
      [
        { role: "system", content: sys },
        { role: "user", content: sourceText.slice(0, 6000) },
      ],
      { temperature: 0.4, maxTokens: 4000 },
    );

    const pages: any[] = this.parseJsonArray(raw);

    // 3) 写回（同名 update，自动更新）
    let written = 0;
    for (const p of pages) {
      if (!p.title || !p.content) continue;
      await this.write({
        spaceId,
        title: p.title,
        content: p.content,
        pageType: ["entity", "topic", "synthesis"].includes(p.pageType) ? p.pageType : "topic",
        tags: p.tags,
        confidence: p.confidence || "INFERRED",
        mode: "update",
      });
      written++;
    }
    this.logger.log(`synthesize 空间 ${spaceId}: 写入 ${written} 页`);
    return { written, total: pages.length };
  }

  /** 健壮解析 LLM 返回的 JSON 数组（容忍代码块/前言/截断） */
  private parseJsonArray(raw: string): any[] {
    if (!raw) return [];
    let s = raw.replace(/```(?:json)?/gi, "").trim();
    try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch {}
    const start = s.indexOf("[");
    if (start < 0) return [];
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; }
      else if (ch === '"') inStr = true;
      else if (ch === "[") depth++;
      else if (ch === "]") { depth--; if (depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return []; } } }
    }
    // 截断：尝试闭合到最后一个完整对象
    const lastObj = s.lastIndexOf("}");
    if (lastObj > start) { try { return JSON.parse(s.slice(start, lastObj + 1) + "]"); } catch {} }
    return [];
  }

  /** 从某项目已采集的笔记自动沉淀进知识库 */
  async synthesizeFromCampaign(spaceId: string, campaignId: string) {
    const notes = await this.prisma.note.findMany({ where: { campaignId }, take: 20, orderBy: { likes: "desc" } });
    if (!notes.length) return { written: 0, total: 0, message: "该项目还没有采集数据" };
    const text = notes.map((n) => `【${n.title}】(赞${n.likes}) ${n.content}`).join("\n\n");
    return this.synthesize(spaceId, text, "采集沉淀");
  }
}
