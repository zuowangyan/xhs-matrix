import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { PersonaService } from "./persona.service";

@Controller("personas")
export class PersonaController {
  constructor(private readonly svc: PersonaService) {}

  @Post() create(@Body() b: any) { return this.svc.create(b); }
  @Get() findAll() { return this.svc.findAll(); }
  @Get(":id") findOne(@Param("id") id: string) { return this.svc.findOne(id); }
  @Patch(":id") update(@Param("id") id: string, @Body() b: any) { return this.svc.update(id, b); }
  @Delete(":id") remove(@Param("id") id: string) { return this.svc.remove(id); }
}
