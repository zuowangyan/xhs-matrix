import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { PublishService } from "./publish.service";
import { PublisherService } from "./publisher.service";

@Controller("publish")
export class PublishController {
  constructor(
    private readonly svc: PublishService,
    private readonly publisher: PublisherService,
  ) {}

  // 扫码登录某账号（会弹出隐身浏览器，等待用户扫码，最多 120s）
  @Post("login/:accountId")
  login(@Param("accountId") accountId: string) {
    return this.publisher.login(accountId);
  }

  // 校验登录态
  @Post("check/:accountId")
  check(@Param("accountId") accountId: string) {
    return this.publisher.checkLogin(accountId).then((ok) => ({ ok }));
  }

  // 探测发布页结构（不发帖，联调用）
  @Post("inspect/:accountId")
  inspect(@Param("accountId") accountId: string) {
    return this.publisher.inspectPublishPage(accountId);
  }

  // 探测搜索页结构（采集联调用）
  @Post("inspect-search/:accountId")
  inspectSearch(@Param("accountId") accountId: string, @Body() body: { keyword: string }) {
    return this.publisher.inspectSearch(accountId, body.keyword);
  }

  // 发布草稿（holdForManual=true 则拟人填好但不点发布，留给人工）
  @Post("draft")
  publishDraft(@Body() body: { draftId: string; accountId: string; holdForManual?: boolean }) {
    return this.svc.publishDraft(body.draftId, body.accountId, { holdForManual: body.holdForManual });
  }

  // 人工在浏览器里点了发布后，标记草稿为已发布
  @Post("mark-done")
  markDone(@Body() body: { draftId: string; accountId?: string }) {
    return this.svc.markPublished(body.draftId, body.accountId);
  }

  // 关闭某账号留开的"人工确认"浏览器
  @Post("release/:accountId")
  release(@Param("accountId") accountId: string) {
    return this.publisher.releaseHeld(accountId);
  }

  @Get("jobs")
  jobs(@Query("campaignId") campaignId: string) {
    return this.svc.jobsByCampaign(campaignId);
  }
}
