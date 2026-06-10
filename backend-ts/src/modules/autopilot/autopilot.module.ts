import { Module } from "@nestjs/common";
import { OrchestratorService } from "./orchestrator.service";
import { SchedulerService } from "./scheduler.service";
import { AutopilotController } from "./autopilot.controller";
import { CampaignModule } from "../campaign/campaign.module";
import { CollectModule } from "../collect/collect.module";
import { AnalysisModule } from "../analysis/analysis.module";
import { GenerateModule } from "../generate/generate.module";
import { PublishModule } from "../publish/publish.module";

// Wiki/Account/Persona/Prisma 为 @Global，无需在此 import
@Module({
  imports: [CampaignModule, CollectModule, AnalysisModule, GenerateModule, PublishModule],
  providers: [OrchestratorService, SchedulerService],
  controllers: [AutopilotController],
  exports: [OrchestratorService],
})
export class AutopilotModule {}
