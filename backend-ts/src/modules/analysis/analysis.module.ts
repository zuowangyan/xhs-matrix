import { Module } from "@nestjs/common";
import { AnalysisService } from "./analysis.service";
import { AnalysisController } from "./analysis.controller";
import { CampaignModule } from "../campaign/campaign.module";

@Module({
  imports: [CampaignModule],
  providers: [AnalysisService],
  controllers: [AnalysisController],
  exports: [AnalysisService],
})
export class AnalysisModule {}
