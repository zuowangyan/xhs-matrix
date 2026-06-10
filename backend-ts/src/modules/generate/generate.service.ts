import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service";
import { CampaignService } from "../campaign/campaign.service";
import { GatewayService } from "../gateway/gateway.service";
import { WikiService } from "../wiki/wiki.service";
import { MaterialService } from "../material/material.service";

@Injectable()
export class GenerateService {
  private readonly logger = new Logger(GenerateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignService,
    private readonly gateway: GatewayService,
    private readonly wiki: WikiService,
    private readonly materials: MaterialService,
  ) {}

  /**
   * 由"采纳的选题 + 项目上下文(产品/玩法/人设)"生成图文草稿。
   */
  // 主题 → 写作定位
  private static THEME_DESC: Record<string, string> = {
    养生: "养生知识分享：实用、专业、贴近生活的食养/调理知识，建立信任",
    干货: "实用干货：方法论、清单、避坑、技巧类，干货满满、可收藏",
    小孩: "育儿/宝宝相关：宝妈视角的带娃、辅食、儿童健康日常，真实有共鸣",
    种草: "产品种草：围绕产品真实体验种草，自然引导",
    测评: "产品测评：客观体验对比，真实优缺点",
  };

  async generateFromTopic(
    topicId: string,
    opts: { theme?: string; embedProduct?: boolean } = {},
  ) {
    const topic = await this.prisma.topic.findUnique({ where: { id: topicId } });
    if (!topic) throw new BadRequestException("选题不存在");
    const campaign = topic.campaignId ? await this.campaigns.findOne(topic.campaignId) : null;

    const product = campaign?.productName || "产品";
    const theme = opts.theme || "种草";
    const isProduct = theme === "种草" || theme === "测评";
    const embedProduct = opts.embedProduct ?? isProduct;
    const playbook = GenerateService.THEME_DESC[theme] ? theme : campaign?.playbook || "种草文";

    // 人设：若项目绑定了 persona 则读取结构化旋钮 + 关联 Wiki 空间，否则默认食养博主口吻
    let personaDesc = "小红书食养类博主，口吻亲切真诚、像朋友分享，多用 emoji，不夸大功效、合规表达。";
    let wikiSpaceIds: string[] = [];
    if (campaign?.personaId) {
      const p = await this.prisma.persona.findUnique({ where: { id: campaign.personaId } });
      if (p) {
        personaDesc = `人设：${p.name}。语气：${p.tone}。定位：${p.positioning}。目标人群：${p.audience}。禁忌：${p.taboo}。固定话术：${p.signature}。`;
        try { wikiSpaceIds = JSON.parse(p.wikiSpaceIds || "[]"); } catch { wikiSpaceIds = []; }
      }
    }

    // 知识库 RAG：按"产品+选题"检索人设绑定的 Wiki 空间，注入产品卖点/成分/合规话术等
    let knowledge = "";
    if (wikiSpaceIds.length) {
      let hits = await this.wiki.search(wikiSpaceIds, `${product} ${topic.title} ${topic.angle}`);
      if (!hits.length) hits = await this.wiki.dump(wikiSpaceIds);
      if (hits.length) {
        knowledge =
          "\n\n【产品知识库（务必基于以下事实，不要编造卖点/成分）】\n" +
          hits.map((h) => `# ${h.title}\n${h.content}`).join("\n\n");
      }
    }

    const kbRule = knowledge
      ? `5. 卖点/成分/功效可参考下方资料，但【产品名称一律写「${product}」】，资料里若出现其它产品名（如别的同类产品），一律替换成「${product}」，不得编造。${knowledge}`
      : `5. 基于公认常识与真实体验表达，不夸大、不编造具体功效数据；多写使用场景与感受。`;

    // 品牌名（导流用，可选）
    const brand = (campaign?.cadence && campaign.cadence.brandName) || "";
    const brandPart = brand ? `品牌「${brand}」的` : "";

    // 主题定位 + 是否软植入产品
    const themeDesc = GenerateService.THEME_DESC[theme] || theme;
    let typeRule = `这是一篇【${theme}】：${themeDesc}。`;
    if (isProduct) {
      typeRule += `围绕${brandPart}「${product}」真实体验种草，正文里必须明确出现产品名「${product}」${brand ? `和品牌「${brand}」` : ""}（自然口吻、不夸大），结尾自然引导（如"我喝的是${product}"）。`;
    } else if (embedProduct && campaign?.productName) {
      typeRule += `正文以${theme}内容为主，但要在合适处自然点名${brandPart}「${product}」（至少出现一次产品名「${product}」），像朋友顺口安利自用，不硬广、不强推。`;
    } else {
      typeRule += `纯${theme}分享，不提及任何产品。`;
    }

    const sys = `你是一个真实的小红书博主本人在写自己的笔记（不是营销号、不是AI）。${personaDesc}
本篇定位：${typeRule}

【产品名称锁定·最高优先】本篇产品名称固定为「${product}」。全文（标题+正文）出现产品时一律且只能用「${product}」，严禁出现其它产品名（同类竞品/别名），即使参考资料里写的是别的名字也要改成「${product}」。

【写作风格·去AI味，必须做到】
- 像真人随手分享，口语、自然、有具体细节和个人经历，句子长短不一。
- emoji 适量穿插：全文 4-8 个左右，自然点缀在句尾或分点处（别太素，也别每句都堆）；不要满屏加粗小标题。
- 严禁套路开头/口水话：如"姐妹们后台被问到手软""谁懂啊""真的会谢""先说结论👇""划重点""家人们""集美们""手把手"。
- 不要机械分点罗列；用自然段落，像聊天一样娓娓道来。
- 标题别太"标题党"，像真人会写的、口语随意。
- 写出真实感（具体场景、时间、小细节、个人感受），可以有一点点不完美的口语。

【硬性要求】
1. 标题 ≤20 字，自然口语。
2. 正文 200-380 字（小红书要求不少于 100 字，务必写够，绝不能短于 120 字）。
3. 5-8 个话题标签（不带#）。
4. 合规：不得出现"治疗、根治、最有效、100%"等夸大表述。
${kbRule}

【输出格式·必须严格遵守】不要用 JSON、不要 markdown 代码块、不要前言或解释。严格按下面三个标记输出（正文可多段多行）：
标题: 在这里写标题
正文:
在这里写正文，可多段多行
标签: 标签1,标签2,标签3`;

    const user = `产品：${product}
主题：${theme}
选题参考：${topic.title}
切入角度：${topic.angle}
请据此写一篇自然、不像AI的小红书${theme}笔记。`;

    const { content: raw } = await this.gateway.chat(
      [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      { temperature: 0.85, maxTokens: 4000 },
    );

    const parsed = this.parseContent(raw, topic.title);
    const draft = await this.prisma.draft.create({
      data: {
        campaignId: topic.campaignId,
        topicId: topic.id,
        personaId: campaign?.personaId || "",
        playbook: theme + (embedProduct && !isProduct ? "·含植入" : ""),
        title: parsed.title || topic.title,
        body: parsed.body || raw,
        images: "[]",
        hashtags: JSON.stringify(parsed.hashtags || []),
        complianceChecked: false,
        status: "ready",
      },
    });
    return this.deserialize(draft);
  }

  /** 解析"标题:/正文:/标签:"标记格式（容忍多行、容忍 JSON 残留）。 */
  private parseContent(raw: string, fallbackTitle: string): { title: string; body: string; hashtags: string[] } {
    let s = (raw || "").replace(/```[a-z]*/gi, "").trim();
    // 若模型仍输出了 JSON，尽量兼容
    if (s.startsWith("{")) {
      try {
        const o = JSON.parse(s);
        if (o.title || o.body) return { title: o.title || fallbackTitle, body: o.body || "", hashtags: o.hashtags || [] };
      } catch {}
    }
    const titleM = s.match(/标题\s*[:：]\s*(.+)/);
    const tagM = s.match(/标签\s*[:：]\s*(.+)/);
    let body = "";
    const bodyM = s.match(/正文\s*[:：]\s*([\s\S]*?)(?:\n\s*标签\s*[:：]|$)/);
    if (bodyM) body = bodyM[1].trim();
    const title = (titleM ? titleM[1] : "").trim().slice(0, 30) || fallbackTitle;
    let hashtags: string[] = [];
    if (tagM) hashtags = tagM[1].split(/[,，、#\s]+/).map((t) => t.trim()).filter(Boolean).slice(0, 8);
    // 兜底：没解析到正文就用整段（去掉标记行）
    if (!body) body = s.replace(/^标题\s*[:：].*$/m, "").replace(/^正文\s*[:：]\s*$/m, "").replace(/^标签\s*[:：].*$/m, "").trim();
    return { title, body, hashtags };
  }

  /** 用文本模型把整篇文章转成"具体画面描述"，再交给生图模型（图文更贴）。 */
  private async buildScenePrompt(draft: any, campaign: any): Promise<string> {
    const fallback = () => {
      const tpl =
        (campaign?.cadence && campaign.cadence.imagePrompt) ||
        "小红书风格配图，主题：{标题}。{正文}。干净清新、真实质感、暖色调、无文字水印。";
      const firstLine = (draft.body || "").split("\n").find((l: string) => l.trim()) || "";
      return tpl.replace(/\{标题\}/g, draft.title).replace(/\{正文\}/g, firstLine.slice(0, 60));
    };
    try {
      const sys =
        "你是小红书配图美术。根据笔记内容，输出【一句具体的画面描述】用于AI生图。" +
        "要求：包含主体(人物/物品)、场景、动作、光线、氛围；真实摄影质感、小红书清新风；" +
        "画面要具体可视化、贴合笔记主题；不要出现任何文字/水印/logo；只输出这句描述本身，不要解释，60字以内。";
      const user =
        `标题：${draft.title}\n正文：${(draft.body || "").slice(0, 240)}\n` +
        `产品：${campaign?.productName || ""}`;
      const { content } = await this.gateway.chat(
        [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        { temperature: 0.7, maxTokens: 200 },
      );
      let scene = (content || "").trim().replace(/^["「『]+|["」』]+$/g, "").split("\n")[0].trim();
      if (scene) return scene + "，真实摄影质感，自然光，小红书清新风，竖构图，无文字无水印";
    } catch {
      /* 失败回退模板 */
    }
    return fallback();
  }

  /** 给草稿生成配图：用网关当前"生图模型"出图并挂到草稿上。 */
  async generateImageForDraft(
    draftId: string,
    extraPrompt?: string,
    aspectRatio?: string,
    count = 1,
    source: "ai" | "library" | "mix" = "ai",
  ) {
    const draft = await this.prisma.draft.findUnique({ where: { id: draftId } });
    if (!draft) throw new BadRequestException("草稿不存在");
    const campaign = draft.campaignId ? await this.campaigns.findOne(draft.campaignId) : null;
    const ratio = aspectRatio || "3:4";
    const n = Math.min(Math.max(count, 1), 4);

    // 生图提示词三选一（优先级从高到低）：
    //  1) 手填 extraPrompt（这一条单独指定）
    //  2) AI 智能扩写：先把文章转成"具体画面描述"再生图（默认开，图文最贴）
    //  3) 模板填空：模板里嵌入标题 + 正文首句（关掉 AI 扩写时用）
    const aiExpand = !(campaign?.cadence && campaign.cadence.imageAiExpand === false);
    let basePrompt: string;
    if (extraPrompt?.trim()) {
      basePrompt = extraPrompt.trim();
    } else if (aiExpand) {
      basePrompt = await this.buildScenePrompt(draft, campaign);
    } else {
      const tpl =
        (campaign?.cadence && campaign.cadence.imagePrompt) ||
        "小红书风格配图，主题：{标题}。{正文}。干净清新、真实质感、暖色调、无文字水印。";
      const firstLine = (draft.body || "").split("\n").find((l) => l.trim()) || "";
      basePrompt = tpl.replace(/\{标题\}/g, draft.title).replace(/\{正文\}/g, firstLine.slice(0, 60));
    }

    // 决定图库取几张、AI 生几张
    let libCount = 0;
    if (source === "library") libCount = n;
    else if (source === "mix") libCount = Math.ceil(n / 2);
    const newImages: string[] = [];

    const materialDir = (campaign?.cadence && campaign.cadence.materialDir) || undefined;

    // 图库素材（上传 + 局域网文件夹，裁成比例）；按文章主题智能匹配文件名/子目录，尽量图文相符
    if (libCount > 0 && draft.campaignId) {
      const bodyFirst = (draft.body || "").split("\n").find((l: string) => l.trim()) || "";
      const matchText = [draft.title, bodyFirst.slice(0, 40), campaign?.productName, (campaign?.keywords || []).join(" ")]
        .filter(Boolean)
        .join(" ");
      const libImgs = await this.materials.pickForDraft(draft.campaignId, ratio, libCount, materialDir, matchText);
      newImages.push(...libImgs);
    }
    // AI 生成补足剩余
    const aiCount = n - newImages.length;
    const aiImgs: string[] = [];
    for (let i = 0; i < aiCount; i++) {
      const p = aiCount > 1 ? `${basePrompt}（第${i + 1}张，换个角度/构图）` : basePrompt;
      try {
        const { images } = await this.gateway.generateImage(p, { aspectRatio: ratio });
        aiImgs.push(...images);
      } catch (e) {
        if (source === "ai" && newImages.length === 0 && aiImgs.length === 0) throw e;
      }
    }
    newImages.push(...aiImgs);
    // AI 图另存到局域网素材文件夹（可复用，下次可当素材）
    if (aiImgs.length && campaign?.cadence?.saveAiToFolder) this.materials.saveToFolder(aiImgs, materialDir);
    if (!newImages.length) throw new BadRequestException("没有可用配图（素材为空且AI生成失败）");

    const merged = [...(this.safe(draft.images, []) as string[]), ...newImages];
    const row = await this.prisma.draft.update({ where: { id: draftId }, data: { images: JSON.stringify(merged) } });
    return this.deserialize(row);
  }

  /** 手动选图：把用户从图库/局域网文件夹选定的图，裁成比例后追加到草稿 */
  async addPickedImages(
    draftId: string,
    picks: { source: "upload" | "folder"; ref: string }[],
    aspectRatio?: string,
  ) {
    const draft = await this.prisma.draft.findUnique({ where: { id: draftId } });
    if (!draft) throw new BadRequestException("草稿不存在");
    const campaign = draft.campaignId ? await this.campaigns.findOne(draft.campaignId) : null;
    const materialDir = (campaign?.cadence && campaign.cadence.materialDir) || undefined;
    const ratio = aspectRatio || "3:4";
    const urls = await this.materials.cropPicks(picks, ratio, materialDir);
    if (!urls.length) throw new BadRequestException("没有可用的选中图片");
    const merged = [...(this.safe(draft.images, []) as string[]), ...urls];
    const row = await this.prisma.draft.update({ where: { id: draftId }, data: { images: JSON.stringify(merged) } });
    return this.deserialize(row);
  }

  /** 修复旧草稿：body 是 JSON 串的，重新解析成正常的标题/正文/标签 */
  async repairDrafts(campaignId: string) {
    const drafts = await this.prisma.draft.findMany({ where: { campaignId } });
    let fixed = 0;
    for (const d of drafts) {
      const body = (d.body || "").trim();
      if (!body.includes('"body"') && !body.startsWith("{") && !body.includes("```")) continue;
      let s = body.replace(/```(?:json)?/gi, "").trim();
      let title = "", bd = "", tags: string[] = [];
      // 先试标准 JSON
      const m = s.match(/\{[\s\S]*\}/);
      if (m) { try { const o = JSON.parse(m[0]); title = o.title || ""; bd = o.body || ""; tags = o.hashtags || []; } catch {} }
      // 兜底：正则抠（容忍未转义换行的非法 JSON）
      if (!bd) {
        const tm = s.match(/"title"\s*:\s*"([\s\S]*?)"\s*,/);
        const bm = s.match(/"body"\s*:\s*"([\s\S]*?)"\s*,\s*"hashtags"/) || s.match(/"body"\s*:\s*"([\s\S]*?)"\s*\}/);
        const hm = s.match(/"hashtags"\s*:\s*\[([\s\S]*?)\]/);
        if (tm) title = tm[1];
        if (bm) bd = bm[1].replace(/\\n/g, "\n").trim();
        if (hm) tags = hm[1].split(",").map((x) => x.replace(/["\s]/g, "")).filter(Boolean);
      }
      if (bd) {
        await this.prisma.draft.update({
          where: { id: d.id },
          data: { title: title || d.title, body: bd, hashtags: JSON.stringify(tags.length ? tags : this.safe(d.hashtags, [])) },
        });
        fixed++;
      }
    }
    return { fixed, total: drafts.length };
  }

  async draftsByCampaign(campaignId: string) {
    const rows = await this.prisma.draft.findMany({
      where: { campaignId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.deserialize(r));
  }

  async updateDraft(id: string, data: any) {
    if (data.hashtags && Array.isArray(data.hashtags)) data.hashtags = JSON.stringify(data.hashtags);
    if (data.images && Array.isArray(data.images)) data.images = JSON.stringify(data.images);
    const row = await this.prisma.draft.update({ where: { id }, data });
    return this.deserialize(row);
  }

  async remove(id: string) {
    await this.prisma.draft.delete({ where: { id } });
    return { ok: true };
  }

  private parseJson(raw: string): any {
    if (!raw) return {};
    // 去代码块围栏 + 去 <think>…</think> 思考块（reasoning 模型会带）
    let s = raw.replace(/```(?:json)?/gi, "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    try { const v = JSON.parse(s); if (v && v.title) return v; } catch {}
    // 扫描每个 '{' 起点，取第一个能解析且含 title 的平衡 JSON 对象
    for (let start = s.indexOf("{"); start >= 0; start = s.indexOf("{", start + 1)) {
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === "\\") esc = true;
          else if (ch === '"') inStr = false;
        } else {
          if (ch === '"') inStr = true;
          else if (ch === "{") depth++;
          else if (ch === "}") {
            depth--;
            if (depth === 0) {
              try { const v = JSON.parse(s.slice(start, i + 1)); if (v && (v.title || v.body)) return v; } catch {}
              break;
            }
          }
        }
      }
    }
    return {};
  }

  private deserialize(r: any) {
    return {
      ...r,
      hashtags: this.safe(r.hashtags, []),
      images: this.safe(r.images, []),
    };
  }
  private safe(v: string, fb: any) {
    try {
      return JSON.parse(v);
    } catch {
      return fb;
    }
  }
}
