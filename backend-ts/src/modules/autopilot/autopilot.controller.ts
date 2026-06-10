import { Body, Controller, Get, Param, Post, Put, Query } from "@nestjs/common";
import { OrchestratorService } from "./orchestrator.service";
import { PrismaService } from "../../common/database/prisma.service";

@Controller("autopilot")
export class AutopilotController {
  constructor(
    private readonly orch: OrchestratorService,
    private readonly prisma: PrismaService,
  ) {}

  // 立即跑一轮（异步执行，前端轮询状态/日志）
  @Post("run-once/:campaignId")
  async runOnce(@Param("campaignId") campaignId: string) {
    if (this.orch.isRunning(campaignId)) return { started: false, message: "已在运行中" };
    // 后台执行，不阻塞响应
    this.orch.runOnce(campaignId).catch(() => {});
    return { started: true, message: "已开始运行，稍后查看日志" };
  }

  // 开关全自动
  @Put("toggle/:campaignId")
  async toggle(@Param("campaignId") campaignId: string, @Body() body: { enabled: boolean }) {
    await this.prisma.campaign.update({ where: { id: campaignId }, data: { autopilotEnabled: body.enabled } });
    return { enabled: body.enabled };
  }

  // 状态
  @Get("status")
  async status(@Query("campaignId") campaignId: string) {
    const c = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    return {
      enabled: c?.autopilotEnabled || false,
      runMode: c?.runMode,
      lastRunAt: c?.lastRunAt,
      running: this.orch.isRunning(campaignId),
    };
  }

  // 运行日志
  @Get("logs")
  logs(@Query("campaignId") campaignId: string) {
    return this.prisma.runLog.findMany({ where: { campaignId }, orderBy: { createdAt: "desc" }, take: 30 });
  }
}
