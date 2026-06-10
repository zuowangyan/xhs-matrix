import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { WikiService } from "./wiki.service";

@Controller("wiki")
export class WikiController {
  constructor(private readonly svc: WikiService) {}

  @Get("spaces") spaces() { return this.svc.listSpaces(); }
  @Post("spaces") createSpace(@Body() b: any) { return this.svc.createSpace(b); }
  @Delete("spaces/:id") removeSpace(@Param("id") id: string) { return this.svc.removeSpace(id); }

  @Get("spaces/:id/tree") tree(@Param("id") id: string) { return this.svc.pageTree(id); }

  @Get("pages/:id") page(@Param("id") id: string) { return this.svc.getPage(id); }
  @Post("pages") createPage(@Body() b: any) { return this.svc.createPage(b); }
  @Patch("pages/:id") updatePage(@Param("id") id: string, @Body() b: any) { return this.svc.updatePage(id, b); }
  @Delete("pages/:id") removePage(@Param("id") id: string) { return this.svc.removePage(id); }

  @Get("search") search(@Query("spaceIds") spaceIds: string, @Query("q") q: string) {
    return this.svc.search((spaceIds || "").split(",").filter(Boolean), q);
  }

  // 自动更新：LLM 综合写回
  @Post("synthesize")
  synthesize(@Body() b: { spaceId: string; sourceText: string; sourceLabel?: string }) {
    return this.svc.synthesize(b.spaceId, b.sourceText, b.sourceLabel);
  }

  @Post("synthesize-from-campaign")
  synthFromCampaign(@Body() b: { spaceId: string; campaignId: string }) {
    return this.svc.synthesizeFromCampaign(b.spaceId, b.campaignId);
  }
}
