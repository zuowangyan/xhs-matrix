import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";
import * as path from "path";
import * as fs from "fs";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(private configService: ConfigService) {
    // 统一把 DATABASE_URL 解析为绝对路径，规避 CLI(相对 prisma/) 与运行时(相对 cwd) 的差异，
    // 并确保目录存在（better-sqlite3 不会自动建目录）。
    const raw =
      configService.get<string>("DATABASE_URL") || "file:./data/xhs_matrix.db";
    let filePath = raw.replace(/^file:/, "");
    if (!path.isAbsolute(filePath)) {
      filePath = path.resolve(process.cwd(), filePath);
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const adapter = new PrismaBetterSQLite3({ url: `file:${filePath}` });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
    try {
      await this.$executeRawUnsafe("PRAGMA foreign_keys = ON;");
    } catch (error) {
      console.error("启用 SQLite 外键约束失败:", error);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
