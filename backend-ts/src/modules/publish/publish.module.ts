import { Module } from "@nestjs/common";
import { PublishService } from "./publish.service";
import { PublisherService } from "./publisher.service";
import { PublishController } from "./publish.controller";

@Module({
  providers: [PublishService, PublisherService],
  controllers: [PublishController],
  exports: [PublishService, PublisherService],
})
export class PublishModule {}
