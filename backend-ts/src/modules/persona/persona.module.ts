import { Global, Module } from "@nestjs/common";
import { PersonaService } from "./persona.service";
import { PersonaController } from "./persona.controller";

@Global()
@Module({
  providers: [PersonaService],
  controllers: [PersonaController],
  exports: [PersonaService],
})
export class PersonaModule {}
