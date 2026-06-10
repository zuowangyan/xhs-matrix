import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import * as express from "express";
import helmet from "helmet";
import * as os from "os";

// 全局兜底：防止未捕获异常杀死后端进程（Electron 内置 Node 默认会因此退出）
process.on("unhandledRejection", (reason: any) => {
  console.error("[未捕获 rejection，已忽略以保活]", reason?.stack || String(reason));
});
process.on("uncaughtException", (err: any) => {
  console.error("[未捕获异常，已忽略以保活]", err?.stack || String(err));
});

function getLanIps(): string[] {
  const out: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === "IPv4" && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: false,
    }),
  );

  // 全局 API 前缀（前端用相对路径 /api/v1，浏览器从任意 IP 进来都同源）
  app.setGlobalPrefix("api/v1");

  app.use(express.urlencoded({ extended: true, limit: "20mb" }));
  app.use(express.json({ limit: "20mb" }));

  // 局域网访问开关：默认 127.0.0.1（仅本机），开启后绑 0.0.0.0
  const lanAccess = process.env.LAN_ACCESS === "1" || process.env.LAN_ACCESS === "true";
  const host = lanAccess ? "0.0.0.0" : "127.0.0.1";
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4180;

  // CORS：本机 + 局域网网段
  app.enableCors({
    origin: [
      /^http:\/\/localhost:\d+$/,
      /^http:\/\/127\.0\.0\.1:\d+$/,
      /^http:\/\/192\.168\.\d+\.\d+:\d+$/,
      /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,
      /^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+:\d+$/,
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  // 前端同源托管由 ServeStaticModule（app.module.ts）负责，含 SPA fallback。

  await app.listen(port, host);

  console.log(`\n========================================`);
  console.log(`  xhs-matrix 后端已启动`);
  console.log(`  本机:   http://127.0.0.1:${port}`);
  if (lanAccess) {
    for (const ip of getLanIps()) {
      console.log(`  局域网: http://${ip}:${port}`);
    }
  } else {
    console.log(`  局域网: 已关闭（设 LAN_ACCESS=1 开启）`);
  }
  console.log(`  健康检查: /api/v1/health`);
  console.log(`========================================\n`);
}

bootstrap();
