import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service";
import { CampaignService } from "../campaign/campaign.service";
import { CollectService } from "../collect/collect.service";
import { AnalysisService } from "../analysis/analysis.service";
import { GenerateService } from "../generate/generate.service";
import { PublishService } from "../publish/publish.service";
import { WikiService } from "../wiki/wiki.service";

/**
 * 全自动编排器：把 采集→沉淀→分析→选题→生成→(配图)→发布 串成一条链，
 * 按项目 runMode 决定在哪一步停下（闸门）：
 *   manual = 跑到分析为止（等人工采纳选题）
 *   semi   = 跑到草稿为止（等人工审核发布）
 *   auto   = 全链到发布（无人值守）
 */
@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);
  private running = new Set<string>(); // 防止同一项目并发跑

  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignService,
    private readonly collect: CollectService,
    private readonly analysis: AnalysisService,
    private readonly generate: GenerateService,
    private readonly publish: PublishService,
    private readonly wiki: WikiService,
  ) {}

  isRunning(campaignId: string) {
    return this.running.has(campaignId);
  }

  private async log(campaignId: string, stage: string, status: string, detail?: string) {
    await this.prisma.runLog.create({ data: { campaignId, stage, status, detail } });
  }

  /** 跑一轮完整流程（按 runMode 在相应闸门停下） */
  async runOnce(campaignId: string): Promise<{ summary: string[] }> {
    if (this.running.has(campaignId)) return { summary: ["已在运行中，跳过"] };
    this.running.add(campaignId);
    const summary: string[] = [];
    try {
      const c = await this.campaigns.findOne(campaignId);
      const mode = c.runMode || "semi";
      const cad0 = (c.cadence && typeof c.cadence === "object") ? c.cadence : {};

      // 1) 采集（新鲜度判断：距上次成功采集不足冷却时长，则跳过去采，直接用现有数据池往下跑，
      //    避免每轮都派采集号抓基本相同的热门笔记、徒增账号暴露/风控风险）
      try {
        const cooldownH = cad0.collectCooldownHours ?? 20; // 默认 20 小时内不重复采
        const lastDone = await this.prisma.collectTask.findFirst({
          where: { campaignId, status: "done" },
          orderBy: { createdAt: "desc" },
        });
        const noteTotal = await this.prisma.note.count({ where: { campaignId } });
        const ageH = lastDone ? (Date.now() - new Date(lastDone.createdAt).getTime()) / 3600000 : Infinity;
        const fresh = cooldownH > 0 && lastDone && ageH < cooldownH && noteTotal > 0;

        if (fresh) {
          const msg = `采集跳过（数据新鲜：${ageH.toFixed(1)}h 前刚采过，<${cooldownH}h；现有 ${noteTotal} 笔记直接复用）`;
          summary.push(msg);
          await this.log(campaignId, "collect", "skip", msg);
        } else {
          const r = await this.collect.runForCampaign(campaignId);
          const nc = (r as any).newCount ?? r.noteCount;
          const uc = (r as any).updatedCount ?? 0;
          summary.push(`采集 新增${nc}/更新${uc}（共抓 ${r.noteCount}）`);
          await this.log(campaignId, "collect", "ok", JSON.stringify(r));
        }
      } catch (e: any) {
        summary.push("采集失败:" + e.message);
        await this.log(campaignId, "collect", "error", e.message);
      }

      // 2) 知识自动沉淀（若人设绑定了 Wiki 空间）
      try {
        const spaceIds = await this.campaignWikiSpaces(c);
        if (spaceIds.length) {
          const r = await this.wiki.synthesizeFromCampaign(spaceIds[0], campaignId);
          summary.push(`知识沉淀 ${r.written || 0} 页`);
          await this.log(campaignId, "synthesize", "ok", JSON.stringify(r));
        } else {
          await this.log(campaignId, "synthesize", "skip", "无绑定知识库");
        }
      } catch (e: any) {
        await this.log(campaignId, "synthesize", "error", e.message);
      }

      // 3) 分析
      try {
        const r = await this.analysis.runForCampaign(campaignId);
        summary.push(`分析 ${r.insightCount || 0} 痛点/${r.topicCount || 0} 选题`);
        await this.log(campaignId, "analysis", "ok", JSON.stringify(r));
      } catch (e: any) {
        summary.push("分析失败:" + e.message);
        await this.log(campaignId, "analysis", "error", e.message);
      }

      // 闸门 topicReview：manual 停在这里
      if (mode === "manual") {
        summary.push("【手动模式】停在选题，等你采纳");
        await this.finish(campaignId, summary);
        return { summary };
      }

      // 自动采纳 Top 选题（auto/semi）：数量在 [adoptMin, adoptMax] 区间随机（默认 3-5）
      const cadA = c.cadence || {};
      const aMin = cadA.adoptMin || 3;
      const aMax = Math.max(cadA.adoptMax || 5, aMin);
      const adoptN = aMin + Math.floor(Math.random() * (aMax - aMin + 1));
      const topics = await this.analysis.topicsByCampaign(campaignId);
      const candidates = topics.filter((t: any) => t.status === "candidate").slice(0, adoptN);
      for (const t of candidates) await this.analysis.updateTopicStatus(t.id, "adopted");
      summary.push(`采纳 ${candidates.length} 个选题`);

      // 4) 生成：按内容配比(contentMix) 加权选主题 + 按主题软植入比例决定是否带产品
      const mix = this.getContentMix(c);
      const adopted = (await this.analysis.topicsByCampaign(campaignId)).filter((t: any) => t.status === "adopted");
      const existingDrafts = await this.generate.draftsByCampaign(campaignId);
      const draftedTopicIds = new Set(existingDrafts.map((d: any) => d.topicId));
      const perTopic = Math.min(Math.max((c.cadence || {}).draftsPerTopic || 1, 1), 5);
      let genCount = 0;
      for (const t of adopted) {
        if (draftedTopicIds.has(t.id)) continue;
        for (let dpi = 0; dpi < perTopic; dpi++) {
        const picked = this.pickTheme(mix);
        const embedProduct = picked.type === "种草" || picked.type === "测评" || Math.random() * 100 < (picked.embedRate || 0);
        try {
          const draft = await this.generate.generateFromTopic(t.id, { theme: picked.type, embedProduct });
          genCount++;
          // 全局配图规则（项目级），全自动按它走
          const cad = c.cadence || {};
          try {
            await this.generate.generateImageForDraft(
              draft.id, undefined, cad.imageRatio || "3:4", cad.imageCount || 1, cad.imageSource || "ai",
            );
          } catch {}
        } catch (e: any) {
          await this.log(campaignId, "generate", "error", e.message);
        }
        } // perTopic
      }
      summary.push(`生成 ${genCount} 篇草稿（按主题配比）`);
      await this.log(campaignId, "generate", "ok", `生成${genCount}篇`);

      // 闸门 draftReview：semi 停在这里
      if (mode === "semi") {
        summary.push("【半自动】停在草稿，等你审核发布");
        await this.finish(campaignId, summary);
        return { summary };
      }

      // 5) 发布（auto）：把 ready 草稿分配给可用发文号
      const pubResult = await this.autoPublish(c);
      summary.push(pubResult);
      await this.log(campaignId, "publish", "ok", pubResult);

      await this.finish(campaignId, summary);
      return { summary };
    } finally {
      this.running.delete(campaignId);
    }
  }

  private async finish(campaignId: string, summary: string[]) {
    // 下次运行 = 现在 + [intervalMin, intervalMax] 分钟内随机（默认 ~24h，±波动）
    const c = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    let minM = 1430, maxM = 1490; // 默认约 24h±
    let cad: any = {};
    try {
      cad = JSON.parse(c?.cadence || "{}");
      if (cad.intervalMinMinutes) minM = cad.intervalMinMinutes;
      if (cad.intervalMaxMinutes) maxM = Math.max(cad.intervalMaxMinutes, minM);
    } catch {}
    let next = new Date(Date.now() + (minM + Math.random() * (maxM - minM)) * 60000);
    // 发布时段：把下次运行对齐到时段内（避免凌晨启动→夜里发文）
    next = this.alignToWindow(next, cad);
    await this.prisma.campaign.update({ where: { id: campaignId }, data: { lastRunAt: new Date(), nextRunAt: next } });
    await this.log(campaignId, "done", "ok", summary.join(" | ") + ` | 下次约 ${next.toLocaleString("zh-CN")}`);
  }

  /** 是否启用发布时段 + 当前是否在时段内 */
  private windowCfg(cad: any) {
    const on = !!cad?.pubWindowOn;
    const start = Number(cad?.pubWindowStart ?? 8);
    const end = Number(cad?.pubWindowEnd ?? 23); // 24 表示到次日 0 点
    return { on: on && start < end, start, end };
  }
  private inWindow(date: Date, cad: any): boolean {
    const { on, start, end } = this.windowCfg(cad);
    if (!on) return true;
    const h = date.getHours() + date.getMinutes() / 60;
    return h >= start && h < end;
  }
  /** 把时间点对齐到时段内：时段前→拨到当天 start；时段后→次日 start（都带 0~30min 抖动） */
  private alignToWindow(date: Date, cad: any): Date {
    const { on, start, end } = this.windowCfg(cad);
    if (!on) return date;
    const h = date.getHours() + date.getMinutes() / 60;
    if (h >= start && h < end) return date;
    const r = new Date(date);
    if (h >= end) r.setDate(r.getDate() + 1); // 已过时段 → 次日
    r.setHours(start, Math.floor(Math.random() * 30), 0, 0);
    return r;
  }

  // 内容配比：[{type, weight, embedRate}]；无配置则给宝妈默认
  private getContentMix(campaign: any): { type: string; weight: number; embedRate: number }[] {
    let mix: any[] = [];
    // cadence 经 findOne 反序列化后是对象；兼容字符串（以防被原始查询传入）
    const cad = (campaign.cadence && typeof campaign.cadence === "object")
      ? campaign.cadence
      : (() => { try { return JSON.parse(campaign.cadence || "{}"); } catch { return {}; } })();
    mix = cad.contentMix || [];
    if (!Array.isArray(mix) || !mix.length) {
      mix = [
        { type: "养生", weight: 35, embedRate: 30 },
        { type: "干货", weight: 25, embedRate: 20 },
        { type: "小孩", weight: 20, embedRate: 20 },
        { type: "种草", weight: 20, embedRate: 100 },
      ];
    }
    return mix;
  }

  private pickTheme(mix: { type: string; weight: number; embedRate: number }[]) {
    const total = mix.reduce((s, m) => s + (m.weight || 0), 0) || 1;
    let r = Math.random() * total;
    for (const m of mix) { r -= m.weight || 0; if (r <= 0) return m; }
    return mix[0];
  }

  private async campaignWikiSpaces(campaign: any): Promise<string[]> {
    if (!campaign.personaId) return [];
    const p = await this.prisma.persona.findUnique({ where: { id: campaign.personaId } });
    if (!p) return [];
    try { return JSON.parse(p.wikiSpaceIds || "[]"); } catch { return []; }
  }

  /** 自动发布：选可用发文号（已登录 + 未超配额 + 未冷却），错峰发布 ready 草稿 */
  private async autoPublish(campaign: any): Promise<string> {
    const ready = (await this.generate.draftsByCampaign(campaign.id)).filter((d: any) => d.status === "ready");
    if (!ready.length) return "无待发布草稿";

    const pubIds: string[] = campaign.publishAccountIds || [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 发布节奏（项目级，可在「全自动设置」调）：每篇之间随机间隔 + 本轮最多发几篇
    const cad = (campaign.cadence && typeof campaign.cadence === "object") ? campaign.cadence : {};
    const gapMin = Number(cad.publishGapMinMinutes ?? 3);
    const gapMax = Math.max(Number(cad.publishGapMaxMinutes ?? 15), gapMin);
    const perRunMax = Number(cad.publishPerRunMax ?? 0); // 0 = 不限（仍受账号日上限约束）

    // 3 个月去重：最近 90 天已发布过的标题，跳过相似草稿
    const since = new Date(Date.now() - 90 * 86400000);
    const recentJobs = await this.prisma.publishJob.findMany({
      where: { campaignId: campaign.id, status: "published", createdAt: { gte: since } },
      select: { draftId: true },
    });
    const recentDraftIds = recentJobs.map((j) => j.draftId);
    const recentTitles = (
      await this.prisma.draft.findMany({ where: { id: { in: recentDraftIds } }, select: { title: true } })
    ).map((d) => d.title.replace(/\s/g, ""));

    let published = 0;
    for (const draft of ready) {
      // 发布时段守门：超出时段就停（剩余草稿留到下个时段/下一轮再发，绝不夜里发）
      if (!this.inWindow(new Date(), cad)) {
        const { start, end } = this.windowCfg(cad);
        await this.log(campaign.id, "publish", "skip", `超出发布时段(${start}:00~${end}:00)，剩余 ${ready.length - published} 篇留待下个时段`);
        break;
      }
      // 去重：标题与近 90 天已发布的高度相似则跳过
      const tt = draft.title.replace(/\s/g, "");
      if (recentTitles.some((t) => t === tt || t.includes(tt) || tt.includes(t))) {
        await this.prisma.draft.update({ where: { id: draft.id }, data: { status: "failed" } });
        await this.log(campaign.id, "publish", "skip", `去重跳过(90天内已发相似): ${draft.title}`);
        continue;
      }
      // 找一个可用账号
      let chosen: any = null;
      for (const aid of pubIds) {
        const a = await this.prisma.account.findUnique({ where: { id: aid } });
        if (!a || a.status !== "active") continue;
        const todayCount = await this.prisma.publishJob.count({
          where: { accountId: aid, status: "published", createdAt: { gte: today } },
        });
        if (todayCount >= a.dailyQuota) continue;
        chosen = a;
        break;
      }
      if (!chosen) {
        await this.log(campaign.id, "publish", "skip", "无可用发文号（未登录/超配额）");
        break;
      }
      try {
        const r = await this.publish.publishDraft(draft.id, chosen.id);
        if (r.ok) published++;
      } catch (e: any) {
        await this.log(campaign.id, "publish", "error", e.message);
      }
      // 本轮发布数量上限
      if (perRunMax > 0 && published >= perRunMax) {
        await this.log(campaign.id, "publish", "ok", `已达本轮上限 ${perRunMax} 篇，剩余下轮再发`);
        break;
      }
      // 错峰：每篇之间留随机间隔（分钟级，更像真人；后台执行不阻塞接口）
      const waitMs = (gapMin + Math.random() * (gapMax - gapMin)) * 60000;
      await new Promise((r) => setTimeout(r, waitMs));
    }
    return `发布 ${published} 篇`;
  }
}
