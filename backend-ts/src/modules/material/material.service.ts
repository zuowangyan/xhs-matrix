import { Injectable, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service";
import { dataSub } from "../../common/paths";
import { Jieba } from "@node-rs/jieba";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sharp = require("sharp");

// 比例 → 裁剪目标尺寸（cover 居中裁剪，与 AI 生图比例一致）
const RATIO_DIM: Record<string, { w: number; h: number }> = {
  "3:4": { w: 1080, h: 1440 },
  "9:16": { w: 1080, h: 1920 },
  "1:1": { w: 1080, h: 1080 },
  "4:3": { w: 1440, h: 1080 },
};

@Injectable()
export class MaterialService {
  private dir = dataSub("material-images");
  private cropDir = dataSub("generated-images"); // 裁剪结果与AI图同目录，复用 /generated 托管
  private jieba = new Jieba();

  constructor(private readonly prisma: PrismaService) {}

  async upload(file: any, campaignId?: string) {
    if (!file?.buffer) throw new BadRequestException("没有文件");
    const meta = await sharp(file.buffer).metadata().catch(() => ({}));
    const ext = (meta.format === "jpeg" ? "jpg" : meta.format) || "png";
    const name = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}.${ext}`;
    fs.writeFileSync(path.join(this.dir, name), file.buffer);
    return this.prisma.material.create({
      data: {
        campaignId: campaignId || null,
        url: `/materials/${name}`,
        name: file.originalname || name,
        width: meta.width || null,
        height: meta.height || null,
      },
    });
  }

  // 该项目可用素材 = 项目专属 + 全局
  list(campaignId?: string) {
    return this.prisma.material.findMany({
      where: campaignId ? { OR: [{ campaignId }, { campaignId: null }] } : {},
      orderBy: { createdAt: "desc" },
    });
  }

  async remove(id: string) {
    const m = await this.prisma.material.findUnique({ where: { id } });
    if (m) {
      try { fs.unlinkSync(path.join(this.dir, path.basename(m.url))); } catch {}
      await this.prisma.material.delete({ where: { id } });
    }
    return { ok: true };
  }

  /** 裁任意本地文件为比例(cover居中)，输出到 /generated，返回 url */
  async cropFile(absPath: string, ratio: string): Promise<string> {
    const dim = RATIO_DIM[ratio] || RATIO_DIM["3:4"];
    if (!fs.existsSync(absPath)) throw new BadRequestException("素材不存在");
    const out = `mat_${Date.now()}_${crypto.randomBytes(3).toString("hex")}.jpg`;
    await sharp(absPath)
      .resize(dim.w, dim.h, { fit: "cover", position: "centre" })
      .jpeg({ quality: 88 })
      .toFile(path.join(this.cropDir, out));
    return `/generated/${out}`;
  }

  /** 从路径里取 SMB 共享根：\\host\share\a\b → \\host\share */
  private shareRoot(p: string): string | null {
    const m = /^(\\\\[^\\]+\\[^\\]+)/.exec(p);
    return m ? m[1] : null;
  }

  /**
   * 测试/预览局域网文件夹：
   * - 可选传 user/pass，用 net use 建立 SMB 连接（密码不入库，交给 Windows 记住）
   * - 返回找到的图片数量 + 缩略图 URL 列表（按需流式读取，不入库）
   */
  async previewFolder(dir?: string, user?: string, pass?: string): Promise<{
    ok: boolean; count: number; error?: string; images: { name: string; url: string }[];
  }> {
    const folder = (dir || "").trim();
    if (!folder) return { ok: false, count: 0, error: "未配置文件夹路径", images: [] };

    // 提供了账号 → 先用 net use 建立连接（仅 Windows、UNC 路径）
    if (user && this.shareRoot(folder)) {
      const share = this.shareRoot(folder)!;
      try {
        const { spawnSync } = require("child_process");
        // 先断开旧连接，避免 "multiple connections" 报错（忽略失败）
        spawnSync("net", ["use", share, "/delete", "/y"], { windowsHide: true });
        const r = spawnSync("net", ["use", share, pass || "", `/user:${user}`, "/persistent:yes"], {
          windowsHide: true, encoding: "utf8",
        });
        if (r.status !== 0) {
          return { ok: false, count: 0, error: "连接失败：" + ((r.stderr || r.stdout || "").trim() || "账号或密码错误"), images: [] };
        }
      } catch (e: any) {
        return { ok: false, count: 0, error: "连接异常：" + e.message, images: [] };
      }
    }

    try {
      if (!fs.existsSync(folder)) {
        return { ok: false, count: 0, error: "路径不存在或无权限访问（NAS 需先登录/映射；可在下方填账号密码测试）", images: [] };
      }
      const all = this.listFolderImages(folder); // 含子目录，与生成时取图一致
      const images = all.slice(0, 120).map((it) => ({
        name: it.rel,
        url: `/api/v1/materials/folder/file?dir=${encodeURIComponent(folder)}&name=${encodeURIComponent(it.rel)}&w=320`,
      }));
      return { ok: true, count: all.length, images };
    } catch (e: any) {
      return { ok: false, count: 0, error: "读取失败：" + e.message, images: [] };
    }
  }

  /** 流式输出局域网文件夹里某张图的缩略图（支持子目录相对路径，防目录穿越） */
  async streamFolderFile(dir: string, name: string, w: number, res: any) {
    const folder = path.resolve((dir || "").trim());
    const rel = (name || "").replace(/^[\\/]+/, "");
    const abs = path.resolve(folder, rel);
    // 防穿越：解析后的绝对路径必须仍在 folder 内
    const within = abs === folder || abs.startsWith(folder + path.sep);
    if (!folder || !rel || !within || !/\.(jpe?g|png|webp)$/i.test(abs) || !fs.existsSync(abs)) {
      res.status(404).send("not found");
      return;
    }
    try {
      const buf = await sharp(abs).resize(w || 320, null, { withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      res.set("Content-Type", "image/jpeg");
      res.set("Cache-Control", "no-store");
      res.send(buf);
    } catch {
      res.status(500).send("thumb error");
    }
  }

  /** 递归列出文件夹里的图片（含子目录），返回 {abs, rel}；rel 用于关键词匹配 */
  private listFolderImages(folder?: string): { abs: string; rel: string }[] {
    if (!folder) return [];
    const out: { abs: string; rel: string }[] = [];
    const maxFiles = 5000, maxDepth = 5;
    const walk = (cur: string, depth: number) => {
      if (depth > maxDepth || out.length >= maxFiles) return;
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (out.length >= maxFiles) break;
        const full = path.join(cur, e.name);
        if (e.isDirectory()) walk(full, depth + 1);
        else if (/\.(jpe?g|png|webp)$/i.test(e.name)) {
          out.push({ abs: full, rel: path.relative(folder, full) || e.name });
        }
      }
    };
    try { if (fs.existsSync(folder)) walk(folder, 0); } catch {}
    return out;
  }

  /** 把文本切成可匹配的关键词（去标点、保留长度≥2 的中英词） */
  private tokenize(text?: string): string[] {
    if (!text) return [];
    const words = this.jieba.cut(text, true)
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w && w.length >= 2 && !/^[\s\d\p{P}]+$/u.test(w));
    return Array.from(new Set(words));
  }

  /** 候选图与关键词的相关度评分：命中关键词越多/越长，分越高 */
  private scoreImage(searchable: string, tokens: string[]): number {
    if (!tokens.length) return 0;
    const s = searchable.toLowerCase();
    let score = 0;
    for (const t of tokens) if (s.includes(t)) score += t.length;
    return score;
  }

  /**
   * 为草稿挑 count 张素材并裁成比例。
   * 素材池 = 上传素材 + 局域网文件夹(materialDir，含子目录)。
   * 传了 matchText：按"文件名/相对路径"与文章关键词的相关度优先挑（图文相符）；
   * 没有任何命中时回退随机。不重复优先。
   */
  async pickForDraft(
    campaignId: string,
    ratio: string,
    count: number,
    materialDir?: string,
    matchText?: string,
  ): Promise<string[]> {
    const uploaded = (await this.list(campaignId)).map((m) => ({
      abs: path.join(this.dir, path.basename(m.url)),
      rel: m.name || path.basename(m.url),
    }));
    const folder = this.listFolderImages(materialDir);
    const pool = [...uploaded, ...folder].filter((p) => fs.existsSync(p.abs));
    if (!pool.length) return [];

    const tokens = this.tokenize(matchText);
    // 评分 + 加一点随机抖动，避免每次都同一张
    const ranked = pool
      .map((p) => ({ p, score: this.scoreImage(p.rel, tokens) + Math.random() * 0.5 }))
      .sort((a, b) => b.score - a.score);

    const anyHit = tokens.length > 0 && ranked.some((r) => r.score >= 1);
    const ordered = anyHit ? ranked.map((r) => r.p) : this.shuffle(pool);

    const out: string[] = [];
    let idx = 0;
    for (let i = 0; i < count; i++) {
      const src = ordered[idx % ordered.length];
      idx++;
      try { out.push(await this.cropFile(src.abs, ratio)); } catch {}
    }
    return out;
  }

  /** 手动选定的图：按来源解析为绝对路径，裁成比例，返回 /generated url 列表 */
  async cropPicks(
    picks: { source: "upload" | "folder"; ref: string }[],
    ratio: string,
    materialDir?: string,
  ): Promise<string[]> {
    const out: string[] = [];
    for (const pk of picks || []) {
      let abs = "";
      if (pk.source === "folder") {
        if (!materialDir) continue;
        const root = path.resolve(materialDir);
        const a = path.resolve(root, (pk.ref || "").replace(/^[\\/]+/, ""));
        if (a !== root && !a.startsWith(root + path.sep)) continue; // 防穿越
        abs = a;
      } else {
        abs = path.join(this.dir, path.basename(pk.ref || ""));
      }
      if (!abs || !fs.existsSync(abs)) continue;
      try { out.push(await this.cropFile(abs, ratio)); } catch {}
    }
    return out;
  }

  private shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** 把 AI 生成的图(/generated/xxx)另存一份到局域网素材文件夹 */
  saveToFolder(generatedUrls: string[], folder?: string) {
    if (!folder) return;
    try {
      if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
      for (const u of generatedUrls) {
        const src = path.join(this.cropDir, path.basename(u));
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(folder, "ai_" + path.basename(u)));
      }
    } catch {}
  }
}
