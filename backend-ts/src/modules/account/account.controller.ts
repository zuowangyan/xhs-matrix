import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { AccountService } from "./account.service";

@Controller("accounts")
export class AccountController {
  constructor(private readonly svc: AccountService) {}

  @Post() create(@Body() b: any) { return this.svc.create(b); }
  @Get() findAll() { return this.svc.findAll(); }
  @Get(":id") findOne(@Param("id") id: string) { return this.svc.findOne(id).then((a) => ({ ...a, cookie: undefined, hasCookie: !!a.cookie })); }
  @Patch(":id") update(@Param("id") id: string, @Body() b: any) { return this.svc.update(id, b); }
  @Delete(":id") remove(@Param("id") id: string) { return this.svc.remove(id); }
}
