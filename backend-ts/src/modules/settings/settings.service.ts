import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execFile } from "child_process";

// 通用设置：按 group 存一组 key/value（value 为 JSON 字符串）。
// 例如 group="llm" 存 { baseURL, apiKey, model }。
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  // ===== 开机自启（Windows 启动文件夹快捷方式，指向 exe 启动器）=====
  private appRoot() {
    // 后端 cwd = .../小红书矩阵/backend-ts → 上一级是包根目录
    return path.resolve(process.cwd(), "..");
  }
  private launcherPath() {
    const root = this.appRoot();
    const exe = path.join(root, "小红书矩阵.exe");
    return fs.existsSync(exe) ? exe : path.join(root, "启动.bat");
  }
  private startupLnk() {
    const startup = path.join(
      process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming"),
      "Microsoft", "Windows", "Start Menu", "Programs", "Startup",
    );
    return path.join(startup, "小红书矩阵.lnk");
  }

  // ===== 局域网共享信息：是否开启 + 本机可分享的访问地址 =====
  getLanInfo(): { enabled: boolean; port: number; urls: string[] } {
    const enabled = process.env.LAN_ACCESS === "1" || process.env.LAN_ACCESS === "true";
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4180;
    const urls: string[] = [];
    try {
      const ifaces = os.networkInterfaces();
      for (const name of Object.keys(ifaces)) {
        for (const ni of ifaces[name] || []) {
          if (ni.family === "IPv4" && !ni.internal) {
            const ip = ni.address;
            // 优先常见局域网网段；过滤虚拟网卡(vEthernet 172.x 等仍列出，排在后面)
            if (/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\./.test(ip)) {
              urls.push(`http://${ip}:${port}`);
            }
          }
        }
      }
    } catch {}
    return { enabled, port, urls };
  }

  getAutoLaunch(): { enabled: boolean } {
    try { return { enabled: fs.existsSync(this.startupLnk()) }; } catch { return { enabled: false }; }
  }

  async setAutoLaunch(enabled: boolean): Promise<{ enabled: boolean; message: string }> {
    const lnk = this.startupLnk();
    if (!enabled) {
      try { if (fs.existsSync(lnk)) fs.unlinkSync(lnk); } catch {}
      return { enabled: false, message: "已关闭开机自启" };
    }
    const target = this.launcherPath();
    const root = this.appRoot();
    const icon = fs.existsSync(path.join(root, "小红书矩阵.exe"))
      ? path.join(root, "小红书矩阵.exe") + ",0"
      : path.join(root, "electron", "build-resources", "icon.ico");
    const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${lnk}');`
      + `$s.TargetPath='${target}';$s.WorkingDirectory='${root}';$s.IconLocation='${icon}';$s.Save()`;
    await new Promise<void>((resolve, reject) => {
      execFile("powershell", ["-NoProfile", "-Command", ps], (err) => (err ? reject(err) : resolve()));
    });
    return { enabled: true, message: "已设为开机自启" };
  }

  async getGroup(group: string): Promise<Record<string, any>> {
    const rows = await this.prisma.setting.findMany({ where: { group } });
    const out: Record<string, any> = {};
    for (const r of rows) {
      try {
        out[r.key] = JSON.parse(r.value);
      } catch {
        out[r.key] = r.value;
      }
    }
    return out;
  }

  async setGroup(group: string, data: Record<string, any>) {
    for (const [key, value] of Object.entries(data)) {
      const v = JSON.stringify(value);
      await this.prisma.setting.upsert({
        where: { group_key: { group, key } },
        create: { group, key, value: v },
        update: { value: v },
      });
    }
    return this.getGroup(group);
  }
}
