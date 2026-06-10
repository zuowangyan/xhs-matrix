import { Module } from "@nestjs/common";
import { GenerateService } from "./generate.service";
import { GenerateController } from "./generate.controller";
import { CampaignModule } from "../campaign/campaign.module";

@Module({
  imports: [CampaignModule],
  providers: [GenerateService],
  controllers: [GenerateController],
  exports: [GenerateService],
})
export class GenerateModule {}
