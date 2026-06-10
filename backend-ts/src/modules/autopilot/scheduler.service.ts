import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../common/database/prisma.service";
import { OrchestratorService } from "./orchestrator.service";

/**
 * 定时调度：每 30 分钟检查一次开启了全自动的项目，
 * 到达节奏(cadence.everyHours, 默认 24h)就跑一轮，并加随机抖动模拟真人。
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orch: OrchestratorService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async tick() {
    const campaigns = await this.prisma.campaign.findMany({
      where: { autopilotEnabled: true, status: "active" },
    });
    if (!campaigns.length) return;
    const now = Date.now();
    for (const c of campaigns) {
      if (this.orch.isRunning(c.id)) continue;
      // 到达计划时间(nextRunAt)就跑；未排过的(无 nextRunAt)立即跑一次
      const due = !c.nextRunAt || now >= new Date(c.nextRunAt).getTime();
      if (!due) continue;
      this.logger.log(`[Autopilot] 触发项目 ${c.name}`);
      this.orch.runOnce(c.id).catch((e) => this.logger.error(`项目 ${c.name} 运行出错: ${e.message}`));
    }
  }

  /**
   * 每天凌晨清理：防止数据无限堆积。
   * - 采集笔记/评论：只保留近 30 天（热点会变，旧的清掉；按 note id upsert 本身不重复）
   * - 失败/废弃草稿：清理 14 天前的
   * - 已发布记录(PublishJob)：保留（3 个月去重要用）
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanup() {
    const noteRetentionDays = 30;
    const noteCutoff = new Date(Date.now() - noteRetentionDays * 86400000);
    const oldNotes = await this.prisma.note.findMany({
      where: { collectedAt: { lt: noteCutoff } },
      select: { id: true },
    });
    const ids = oldNotes.map((n) => n.id);
    if (ids.length) {
      await this.prisma.comment.deleteMany({ where: { noteId: { in: ids } } });
      await this.prisma.note.deleteMany({ where: { id: { in: ids } } });
    }
    // 旧的失败草稿
    const draftCutoff = new Date(Date.now() - 14 * 86400000);
    const delDrafts = await this.prisma.draft.deleteMany({
      where: { status: "failed", createdAt: { lt: draftCutoff } },
    });
    this.logger.log(`[清理] 删除旧笔记 ${ids.length}、旧评论(关联)、失败草稿 ${delDrafts.count}`);
  }
}
