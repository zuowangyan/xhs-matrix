import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { AnalysisService } from "./analysis.service";

@Controller("analysis")
export class AnalysisController {
  constructor(private readonly service: AnalysisService) {}

  // 按项目运行分析（评论痛点聚类 + 选题候选）
  @Post("run")
  run(@Body() body: { campaignId: string }) {
    return this.service.runForCampaign(body.campaignId);
  }

  @Post("import-pains")
  importPains(@Body() body: { campaignId: string; text: string }) {
    return this.service.importPainPoints(body.campaignId, body.text);
  }

  @Get("insights")
  insights(@Query("campaignId") campaignId: string) {
    return this.service.insightsByCampaign(campaignId);
  }

  @Get("topics")
  topics(@Query("campaignId") campaignId: string) {
    return this.service.topicsByCampaign(campaignId);
  }

  @Patch("topics/:id")
  updateTopic(@Param("id") id: string, @Body() body: { status: "adopted" | "discarded" | "candidate" }) {
    return this.service.updateTopicStatus(id, body.status);
  }

  @Post("samples")
  samples(@Body() body: { ids: string[] }) {
    return this.service.sampleComments(body.ids);
  }
}
