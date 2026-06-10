import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service";
import { CampaignService } from "../campaign/campaign.service";
import { MockCollector } from "./collector/mock.collector";
import { PublisherService } from "../publish/publisher.service";
import { AccountService } from "../account/account.service";
import { GatewayService } from "../gateway/gateway.service";

@Injectable()
export class CollectService {
  private readonly logger = new Logger(CollectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignService,
    private readonly mock: MockCollector,
    private readonly publisher: PublisherService,
    private readonly accounts: AccountService,
    private readonly gateway: GatewayService,
  ) {}

  /** 找该项目可用的采集号（优先项目指定，否则任一已登录采集号） */
  private async pickCollector(campaign: any): Promise<string | null> {
    const ids: string[] = campaign.collectAccountIds || [];
    for (const id of ids) {
      const a = await this.prisma.account.findUnique({ where: { id } });
      if (a && a.role === "collector" && a.status === "active") return a.id;
    }
    const any = await this.prisma.account.findFirst({ where: { role: "collector", status: "active" } });
    return any?.id || null;
  }

  /** AI 热点扩展：按产品+人群补几个当下热门角度关键词 */
  private async hotExpand(campaign: any): Promise<string[]> {
    try {
      const sys = `你是小红书选题专家。围绕给定产品和人群，给出 4 个"当下热门角度"的搜索关键词（结合季节/场景/热点话题），只输出 JSON 数组：["词1","词2","词3","词4"]，不要解释。`;
      const { content } = await this.gateway.chat(
        [
          { role: "system", content: sys },
          { role: "user", content: `产品：${campaign.productName || campaign.name}；人群关键词：${(campaign.keywords || []).join("、")}` },
        ],
        { temperature: 0.7, maxTokens: 300 },
      );
      const m = content.replace(/```(?:json)?/gi, "").match(/\[[\s\S]*\]/);
      return m ? (JSON.parse(m[0]) as string[]).slice(0, 4) : [];
    } catch {
      return [];
    }
  }

  async runForCampaign(campaignId: string) {
    const campaign = await this.campaigns.findOne(campaignId);
    const cadence = campaign.cadence || {};
    const sort = cadence.collectSort || "general"; // general | time_descending | popularity_descending
    const hotOn = !!cadence.hotExpand;

    // 关键词 = 项目关键词 + 竞品 (+ AI 热点扩展)
    let keywords: string[] = [...(campaign.keywords || [])];
    if (hotOn) {
      const hot = await this.hotExpand(campaign);
      keywords = [...new Set([...keywords, ...hot])];
    }
    if (!keywords.length) keywords = [campaign.productName || campaign.name];

    const collectorId = await this.pickCollector(campaign);
    const useReal = !!collectorId;

    const task = await this.prisma.collectTask.create({
      data: {
        campaignId,
        type: "keyword",
        query: keywords.join(", ") + (useReal ? " [真实采集]" : " [示例]") + ` [排序:${sort}]`,
        accountId: collectorId || "mock",
        status: "running",
      },
    });

    let noteCount = 0;
    let newCount = 0;
    let updatedCount = 0;
    let commentCount = 0;
    try {
      for (const kw of keywords) {
        let result: { notes: any[]; comments: any[] };
        if (useReal) {
          result = await this.publisher.collectKeyword(collectorId!, kw, 12, sort as any);
        } else {
          result = await this.mock.collect({ type: "keyword", query: kw, limit: 6 });
        }
        for (const note of result.notes) {
          // 区分新增 vs 仅更新（用于"重复采集"可视化与新鲜度判断）
          const existed = await this.prisma.note.findUnique({ where: { id: note.id }, select: { id: true } });
          if (existed) updatedCount++; else newCount++;
          await this.prisma.note.upsert({
            where: { id: note.id },
            create: {
              id: note.id, campaignId, title: note.title, content: note.content || note.title,
              authorId: note.authorId, authorName: note.authorName, likes: note.likes || 0,
              collects: note.collects || 0, comments: note.comments || 0,
              images: JSON.stringify(note.images || []), tags: JSON.stringify(note.tags || []),
              publishTime: note.publishTime ? new Date(note.publishTime) : null, source: kw,
            },
            update: { likes: note.likes || 0, collects: note.collects || 0, comments: note.comments || 0, campaignId, source: kw },
          });
          noteCount++;
        }
        for (const c of result.comments) {
          await this.prisma.comment.upsert({
            where: { id: c.id },
            create: { id: c.id, noteId: c.noteId, content: c.content, likes: c.likes || 0, authorId: c.authorId || "u" },
            update: { likes: c.likes || 0 },
          });
          commentCount++;
        }
      }
      await this.prisma.collectTask.update({
        where: { id: task.id },
        data: { status: "done", result: JSON.stringify({ noteCount, newCount, updatedCount, commentCount, real: useReal, sort }) },
      });
    } catch (e: any) {
      this.logger.error(`采集失败: ${e.message}`);
      await this.prisma.collectTask.update({
        where: { id: task.id },
        data: { status: "failed", result: JSON.stringify({ error: e.message }) },
      });
      throw e;
    }
    return { taskId: task.id, noteCount, newCount, updatedCount, commentCount, real: useReal };
  }

  /** 清空该项目的采集/分析/草稿数据（去除示例污染或重置） */
  async clearCampaignData(campaignId: string) {
    const notes = await this.prisma.note.findMany({ where: { campaignId }, select: { id: true } });
    const noteIds = notes.map((n) => n.id);
    if (noteIds.length) await this.prisma.comment.deleteMany({ where: { noteId: { in: noteIds } } });
    const [n, ci, t, d, ct] = await Promise.all([
      this.prisma.note.deleteMany({ where: { campaignId } }),
      this.prisma.commentInsight.deleteMany({ where: { campaignId } }),
      this.prisma.topic.deleteMany({ where: { campaignId } }),
      this.prisma.draft.deleteMany({ where: { campaignId } }),
      this.prisma.collectTask.deleteMany({ where: { campaignId } }),
    ]);
    return { notes: n.count, insights: ci.count, topics: t.count, drafts: d.count, tasks: ct.count };
  }

  async tasksByCampaign(campaignId: string) {
    return this.prisma.collectTask.findMany({ where: { campaignId }, orderBy: { createdAt: "desc" } });
  }

  async notesByCampaign(campaignId: string) {
    const rows = await this.prisma.note.findMany({ where: { campaignId }, orderBy: { likes: "desc" }, take: 200 });
    return rows.map((r) => ({ ...r, images: this.safeParse(r.images, []), tags: this.safeParse(r.tags, []) }));
  }

  async commentsByNote(noteId: string) {
    return this.prisma.comment.findMany({ where: { noteId }, orderBy: { likes: "desc" } });
  }

  private safeParse(v: string, fallback: any) {
    try { return JSON.parse(v); } catch { return fallback; }
  }
}
