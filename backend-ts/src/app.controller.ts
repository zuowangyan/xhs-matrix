import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "./common/database/prisma.service";

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  // GET /api/v1/health  —— 健康检查（含数据库连通性）
  @Get("health")
  async health() {
    let db = "ok";
    try {
      await this.prisma.$queryRawUnsafe("SELECT 1");
    } catch (e) {
      db = "error";
    }
    return {
      app: "xhs-matrix",
      status: "ok",
      db,
      time: new Date().toISOString(),
    };
  }
}
