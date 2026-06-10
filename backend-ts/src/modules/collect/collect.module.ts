import { Module } from "@nestjs/common";
import { CollectService } from "./collect.service";
import { CollectController } from "./collect.controller";
import { MockCollector } from "./collector/mock.collector";
import { CampaignModule } from "../campaign/campaign.module";
import { PublishModule } from "../publish/publish.module";

@Module({
  imports: [CampaignModule, PublishModule],
  providers: [CollectService, MockCollector],
  controllers: [CollectController],
  exports: [CollectService],
})
export class CollectModule {}
