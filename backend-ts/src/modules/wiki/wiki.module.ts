import { Global, Module } from "@nestjs/common";
import { WikiService } from "./wiki.service";
import { WikiController } from "./wiki.controller";

@Global()
@Module({
  providers: [WikiService],
  controllers: [WikiController],
  exports: [WikiService],
})
export class WikiModule {}
