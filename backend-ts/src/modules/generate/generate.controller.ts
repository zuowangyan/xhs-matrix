import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { GenerateService } from "./generate.service";

@Controller("generate")
export class GenerateController {
  constructor(private readonly service: GenerateService) {}

  // 由选题生成草稿
  @Post("from-topic")
  fromTopic(@Body() body: { topicId: string; theme?: string; embedProduct?: boolean }) {
    return this.service.generateFromTopic(body.topicId, { theme: body.theme, embedProduct: body.embedProduct });
  }

  @Get("drafts")
  drafts(@Query("campaignId") campaignId: string) {
    return this.service.draftsByCampaign(campaignId);
  }

  // 修复旧的 JSON 污染草稿
  @Post("repair")
  repair(@Body() body: { campaignId: string }) {
    return this.service.repairDrafts(body.campaignId);
  }

  // 给草稿生成配图（用网关当前生图模型）
  @Post("drafts/:id/image")
  image(@Param("id") id: string, @Body() body: { prompt?: string; aspectRatio?: string; count?: number; source?: "ai" | "library" | "mix" }) {
    return this.service.generateImageForDraft(id, body?.prompt, body?.aspectRatio, body?.count || 1, body?.source || "ai");
  }

  // 手动选图：把用户选定的图库/局域网图追加进草稿
  @Post("drafts/:id/pick-images")
  pickImages(
    @Param("id") id: string,
    @Body() body: { picks: { source: "upload" | "folder"; ref: string }[]; aspectRatio?: string },
  ) {
    return this.service.addPickedImages(id, body?.picks || [], body?.aspectRatio);
  }

  @Patch("drafts/:id")
  update(@Param("id") id: string, @Body() body: any) {
    return this.service.updateDraft(id, body);
  }

  @Delete("drafts/:id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
