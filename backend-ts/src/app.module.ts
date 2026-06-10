import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { ServeStaticModule } from "@nestjs/serve-static";
import * as path from "path";
import { AppController } from "./app.controller";
import { PrismaModule } from "./common/database/prisma.module";
import { CampaignModule } from "./modules/campaign/campaign.module";
import { CollectModule } from "./modules/collect/collect.module";
import { AnalysisModule } from "./modules/analysis/analysis.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { LlmCoreModule } from "./modules/llm-core/llm-core.module";
import { GatewayModule } from "./modules/gateway/gateway.module";
import { PersonaModule } from "./modules/persona/persona.module";
import { WikiModule } from "./modules/wiki/wiki.module";
import { GenerateModule } from "./modules/generate/generate.module";
import { AccountModule } from "./modules/account/account.module";
import { PublishModule } from "./modules/publish/publish.module";
import { AutopilotModule } from "./modules/autopilot/autopilot.module";
import { MaterialModule } from "./modules/material/material.module";

// 前端 dist 目录（编译后 __dirname=dist/ → ../../frontend/dist）
const frontendDist =
  process.env.FRONTEND_DIST_DIR ||
  path.join(__dirname, "..", "..", "frontend", "dist");
// 数据目录（打包后由 Electron 用 DATA_DIR 指向用户可写目录）
const baseDataDir = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const generatedDir = path.join(baseDataDir, "generated-images");
const materialDir = path.join(baseDataDir, "material-images");

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // 生成图片静态托管（需在前端 catch-all 之前）
    ServeStaticModule.forRoot({
      rootPath: generatedDir,
      serveRoot: "/generated",
      serveStaticOptions: { index: false, fallthrough: true },
    }),
    ServeStaticModule.forRoot({
      rootPath: materialDir,
      serveRoot: "/materials",
      serveStaticOptions: { index: false, fallthrough: true },
    }),
    // 同源托管前端：桌面端与局域网浏览器端共用同一份；排除 API 与 /generated
    ServeStaticModule.forRoot({
      rootPath: frontendDist,
      exclude: ["/api/{*path}", "/generated/{*path}", "/materials/{*path}"],
      serveStaticOptions: {
        index: ["index.html"],
        // 入口 html 永不缓存（避免远程浏览器缓存旧版导致样式/脚本错乱）；
        // 带哈希的 /assets 资源可长期缓存（内容变了文件名就变）。
        setHeaders: (res: any, filePath: string) => {
          if (filePath.endsWith(".html")) {
            res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          } else if (/[\\/]assets[\\/]/.test(filePath)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      },
    }),
    PrismaModule,
    SettingsModule,
    LlmCoreModule,
    GatewayModule,
    PersonaModule,
    WikiModule,
    AccountModule,
    CampaignModule,
    CollectModule,
    AnalysisModule,
    GenerateModule,
    PublishModule,
    AutopilotModule,
    MaterialModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
