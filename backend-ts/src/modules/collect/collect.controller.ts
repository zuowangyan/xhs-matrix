import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { CollectService } from "./collect.service";

@Controller("collect")
export class CollectController {
  constructor(private readonly service: CollectService) {}

  // 按运营项目运行采集
  @Post("run")
  run(@Body() body: { campaignId: string }) {
    return this.service.runForCampaign(body.campaignId);
  }

  @Post("clear")
  clear(@Body() body: { campaignId: string }) {
    return this.service.clearCampaignData(body.campaignId);
  }

  @Get("tasks")
  tasks(@Query("campaignId") campaignId: string) {
    return this.service.tasksByCampaign(campaignId);
  }

  @Get("notes")
  notes(@Query("campaignId") campaignId: string) {
    return this.service.notesByCampaign(campaignId);
  }

  @Get("notes/:noteId/comments")
  comments(@Param("noteId") noteId: string) {
    return this.service.commentsByNote(noteId);
  }
}
