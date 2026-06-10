import { Global, Module } from "@nestjs/common";
import { MaterialService } from "./material.service";
import { MaterialController } from "./material.controller";

@Global()
@Module({
  providers: [MaterialService],
  controllers: [MaterialController],
  exports: [MaterialService],
})
export class MaterialModule {}
