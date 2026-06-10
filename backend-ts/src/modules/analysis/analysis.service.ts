import { Injectable, Logger } from "@nestjs/common";
import { Jieba } from "@node-rs/jieba";
import { PrismaService } from "../../common/database/prisma.service";
import { CampaignService } from "../campaign/campaign.service";
import { GatewayService } from "../gateway/gateway.service";
import { isMeaningful } from "./stopwords";

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);
  private jieba = new Jieba();

  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignService,
    private readonly gateway: GatewayService,
  ) {}

  /** AI 推断用户痛点/常问问题（无需评论，零风控）。返回 [{topic, question}] */
  private async aiPainPoints(campaign: any): Promise<{ topic: string; q: string }[]> {
    try {
      const sys = `你是${campaign.productName || campaign.name}所在品类的资深运营。列出目标人群最真实的 6 个痛点/顾虑/高频问题（口语化，像用户会问的）。只输出 JSON 数组：[{"topic":"痛点关键词(2-6字)","q":"用户会问的具体问题"}]，不要解释。`;
      const { content } = await this.gateway.chat(
        [
          { role: "system", content: sys },
          { role: "user", content: `产品：${campaign.productName || campaign.name}；人群/关键词：${(campaign.keywords || []).join("、")}` },
        ],
        { temperature: 0.7, maxTokens: 600 },
      );
      const m = content.replace(/```(?:json)?/gi, "").match(/\[[\s\S]*\]/);
      return m ? (JSON.parse(m[0]) as any[]).slice(0, 6) : [];
    } catch {
      return [];
    }
  }

  /**
   * 评论高频痛点聚类 + 生成选题候选（基于该项目已采集的笔记+评论）。
   * P2：算法版（分词+词频）。LLM 接入后可升级为语义聚类与智能选题。
   */
  async runForCampaign(campaignId: string) {
    const campaign = await this.campaigns.findOne(campaignId);

    // 1) 取该项目的笔记(标题) + 评论
    const notes = await this.prisma.note.findMany({
      where: { campaignId },
      select: { id: true, title: true, likes: true },
    });
    const noteIds = notes.map((n) => n.id);
    if (noteIds.length === 0) {
      return { insightCount: 0, topicCount: 0, message: "该项目还没有采集数据，请先去采集" };
    }
    const comments = await this.prisma.comment.findMany({
      where: { noteId: { in: noteIds } },
    });
    // 语料 = 评论 + 笔记标题（评论抓不到时，靠标题也能聚类痛点/选题方向）
    const corpus: { id: string; content: string }[] = [
      ...comments.map((c) => ({ id: c.id, content: c.content })),
      ...notes.map((n) => ({ id: "note:" + n.id, content: n.title })),
    ];

    // 额外停用词：项目关键词/产品名本身（避免成为"痛点"噪声）
    const extraStop = new Set<string>([
      ...(campaign.keywords || []),
      ...(campaign.competitors || []),
      ...(campaign.productName ? [campaign.productName] : []),
    ]);

    // 2) 分词 + 词频统计，记录每个词的代表评论
    const freq = new Map<string, number>();
    const sample = new Map<string, string[]>();
    for (const c of corpus) {
      const words = this.jieba.cut(c.content, true);
      const seen = new Set<string>();
      for (const w of words) {
        if (!isMeaningful(w, extraStop)) continue;
        if (seen.has(w)) continue; // 同一评论内只计一次
        seen.add(w);
        freq.set(w, (freq.get(w) || 0) + 1);
        const arr = sample.get(w) || [];
        if (arr.length < 3) arr.push(c.id);
        sample.set(w, arr);
      }
    }

    // 3) 取 Top 15 作为痛点，落 CommentInsight（先清掉该项目旧的）
    const top = [...freq.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);

    await this.prisma.commentInsight.deleteMany({ where: { campaignId } });
    for (const [word, n] of top) {
      await this.prisma.commentInsight.create({
        data: {
          campaignId,
          topic: word,
          keywords: JSON.stringify([word]),
          frequency: n,
          sampleIds: JSON.stringify(sample.get(word) || []),
          source: (campaign.keywords || []).join(",") || campaign.productName || "",
        },
      });
    }

    // 4) 由 Top 痛点 + 产品 + 玩法 生成启发式选题候选（清掉旧的 candidate）
    await this.prisma.topic.deleteMany({ where: { campaignId, status: "candidate" } });
    const product = campaign.productName || campaign.name;
    const total = corpus.length || 1;
    let topicCount = 0;
    for (const [word, n] of top.slice(0, 8)) {
      const title = this.topicTitle(product, word);
      await this.prisma.topic.create({
        data: {
          campaignId,
          title,
          angle: `回应「${word}」相关顾虑`,
          rationale: `语料中「${word}」出现 ${n} 次（约 ${Math.round((n / total) * 100)}% 提及，来自笔记标题/评论）`,
          hotScore: n,
          status: "candidate",
        },
      });
      topicCount++;
    }

    // 5) AI 推断痛点补充（无需评论），作为额外痛点 + 选题
    const ai = await this.aiPainPoints(campaign);
    let aiCount = 0;
    for (const p of ai) {
      if (!p.topic) continue;
      await this.prisma.commentInsight.create({
        data: { campaignId, topic: p.topic, keywords: JSON.stringify([p.topic]), frequency: 0,
          sampleIds: JSON.stringify([]), source: "AI推断" },
      });
      await this.prisma.topic.create({
        data: { campaignId, title: this.topicTitle(product, p.topic), angle: `回应「${p.topic}」`,
          rationale: `AI 推断的高频顾虑：${p.q || p.topic}`, hotScore: 1, status: "candidate" },
      });
      aiCount++;
    }

    return { insightCount: top.length + aiCount, topicCount: topicCount + aiCount, commentsAnalyzed: corpus.length, aiPainPoints: aiCount };
  }

  private topicTitle(product: string, pain: string): string {
    const templates = [
      `${product}「${pain}」真实测评，亲测告诉你`,
      `关于${product}的「${pain}」，姐妹们最关心的答案`,
      `${product}会不会有「${pain}」问题？避坑指南`,
      `喝${product}前先看：「${pain}」到底怎么回事`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  /** 导入自己的客户真实痛点（每行一条），作为痛点 + 选题 */
  async importPainPoints(campaignId: string, text: string) {
    const campaign = await this.campaigns.findOne(campaignId);
    const product = campaign.productName || campaign.name;
    const lines = (text || "")
      .split(/[\n;；]+/)
      .map((l) => l.trim())
      .filter((l) => l.length >= 2)
      .slice(0, 30);
    let count = 0;
    for (const line of lines) {
      // 取前 6 字做痛点关键词，整句做问题
      const topicWord = line.replace(/[，。,.!！?？]/g, "").slice(0, 8);
      await this.prisma.commentInsight.create({
        data: { campaignId, topic: topicWord, keywords: JSON.stringify([topicWord]), frequency: 0,
          sampleIds: JSON.stringify([]), source: "客户导入" },
      });
      await this.prisma.topic.create({
        data: { campaignId, title: this.topicTitle(product, topicWord), angle: `回应「${topicWord}」`,
          rationale: `客户真实痛点：${line}`, hotScore: 1000, status: "candidate" }, // 客户导入权重最高
      });
      count++;
    }
    return { imported: count };
  }

  async insightsByCampaign(campaignId: string) {
    const rows = await this.prisma.commentInsight.findMany({
      where: { campaignId },
      orderBy: { frequency: "desc" },
    });
    return rows.map((r) => ({ ...r, keywords: this.safeParse(r.keywords, []), sampleIds: this.safeParse(r.sampleIds, []) }));
  }

  async topicsByCampaign(campaignId: string) {
    return this.prisma.topic.findMany({
      where: { campaignId },
      orderBy: [{ status: "asc" }, { hotScore: "desc" }],
    });
  }

  async updateTopicStatus(id: string, status: "adopted" | "discarded" | "candidate") {
    return this.prisma.topic.update({ where: { id }, data: { status } });
  }

  async sampleComments(ids: string[]) {
    if (!ids?.length) return [];
    return this.prisma.comment.findMany({ where: { id: { in: ids } } });
  }

  private safeParse(v: string, fb: any) {
    try {
      return JSON.parse(v);
    } catch {
      return fb;
    }
  }
}
