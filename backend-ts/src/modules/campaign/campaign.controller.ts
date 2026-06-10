import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { CampaignService, CampaignInput } from "./campaign.service";

@Controller("campaigns")
export class CampaignController {
  constructor(private readonly service: CampaignService) {}

  @Post()
  create(@Body() body: CampaignInput) {
    return this.service.create(body);
  }

  // AI 根据一句话描述生成项目配置建议
  @Post("ai-suggest")
  aiSuggest(@Body() body: { description: string }) {
    return this.service.aiSuggest(body.description);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: Partial<CampaignInput>) {
    return this.service.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
