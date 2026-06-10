import { Injectable, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service";
import { PublisherService } from "./publisher.service";

@Injectable()
export class PublishService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: PublisherService,
  ) {}

  private safe(v: string, fb: any) {
    try { return JSON.parse(v); } catch { return fb; }
  }

  /**
   * 发布某草稿到某账号。
   * holdForManual=true：拟人填好图文但【不点发布】，浏览器留开给用户自己点；
   *                     草稿状态保持 ready，待用户确认后调 markPublished 收尾。
   */
  async publishDraft(draftId: string, accountId: string, opts?: { holdForManual?: boolean }) {
    const draft = await this.prisma.draft.findUnique({ where: { id: draftId } });
    if (!draft) throw new BadRequestException("草稿不存在");
    const images = this.safe(draft.images, []);
    const topics = this.safe(draft.hashtags, []);
    const hold = !!opts?.holdForManual;

    const job = await this.prisma.publishJob.create({
      data: {
        campaignId: draft.campaignId, draftId, accountId, scheduledAt: new Date(),
        status: hold ? "manual_filling" : "publishing",
      },
    });

    const res = await this.publisher.publishNote(accountId, { title: draft.title, body: draft.body, images, topics }, opts);

    if (hold) {
      // 留给人工点发布：作业标记等待人工，草稿仍为 ready（还没真正发出去）
      await this.prisma.publishJob.update({
        where: { id: job.id },
        data: { status: res.ok ? "awaiting_manual" : "failed", result: res.message, accountId },
      });
      return { ok: res.ok, message: res.message, manual: true };
    }

    await this.prisma.publishJob.update({
      where: { id: job.id },
      data: { status: res.ok ? "published" : "failed", result: res.url || res.message },
    });
    await this.prisma.draft.update({
      where: { id: draftId },
      data: { status: res.ok ? "published" : "failed", accountId },
    });
    return { ok: res.ok, message: res.message, url: res.url };
  }

  /** 人工在浏览器里点了发布后，回来把草稿收尾标记为已发布 */
  async markPublished(draftId: string, accountId?: string) {
    const draft = await this.prisma.draft.findUnique({ where: { id: draftId } });
    if (!draft) throw new BadRequestException("草稿不存在");
    await this.prisma.draft.update({
      where: { id: draftId },
      data: { status: "published", accountId: accountId || draft.accountId || null },
    });
    await this.prisma.publishJob.create({
      data: {
        campaignId: draft.campaignId, draftId, accountId: accountId || draft.accountId || "manual",
        scheduledAt: new Date(), status: "published", result: "人工确认已发布",
      },
    });
    // 收尾时顺手关掉留开的浏览器
    if (accountId) await this.publisher.releaseHeld(accountId);
    return { ok: true };
  }

  async jobsByCampaign(campaignId: string) {
    return this.prisma.publishJob.findMany({ where: { campaignId }, orderBy: { createdAt: "desc" } });
  }
}
