import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { AccountService } from "../account/account.service";
import { dataSub } from "../../common/paths";

// patchright 是 Playwright 的隐身补丁版，API 与 playwright 一致
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chromium } = require("patchright");

@Injectable()
export class PublisherService {
  private readonly logger = new Logger(PublisherService.name);
  private profilesRoot = dataSub("profiles");
  // 半自动"人工确认发布"：填好但不点发布、留开的浏览器（按账号保存，避免越开越多）
  private heldContexts = new Map<string, any>();

  constructor(private readonly accounts: AccountService) {}

  /** 随机整数 [a,b) */
  private rnd(a: number, b: number) { return Math.floor(a + Math.random() * (b - a)); }
  /** 随机等待，拟人 */
  private async hwait(page: any, a: number, b: number) { await page.waitForTimeout(this.rnd(a, b)); }
  /** 拟人逐字输入：每字随机间隔，标点后停顿，偶尔"走神" */
  private async humanType(page: any, text: string) {
    for (const ch of text) {
      await page.keyboard.type(ch);
      let d = this.rnd(45, 145);
      if (/[，。！？、,.!?\n～]/.test(ch)) d += this.rnd(120, 420);
      if (Math.random() < 0.04) d += this.rnd(350, 1000); // 偶尔停顿，像在想
      await page.waitForTimeout(d);
    }
  }

  /** 关闭某账号留开的"人工确认"浏览器（如果有） */
  async releaseHeld(accountId: string): Promise<{ ok: boolean }> {
    const ctx = this.heldContexts.get(accountId);
    if (ctx) { try { await ctx.close(); } catch {} this.heldContexts.delete(accountId); }
    return { ok: true };
  }

  /** 每个账号独立的持久化用户目录（cookie/登录态在此保存，互不串味） */
  private profileDir(accountId: string) {
    const dir = path.join(this.profilesRoot, accountId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** 用账号的指纹启动隐身持久化浏览器上下文 */
  private async launchContext(accountId: string, headless: boolean) {
    const fp = await this.accounts.getFingerprint(accountId);
    let viewport = { width: 1440, height: 900 };
    let ua: string | undefined;
    let locale = "zh-CN";
    let timezoneId = "Asia/Shanghai";
    if (fp) {
      try { viewport = JSON.parse(fp.viewport); } catch {}
      ua = fp.ua;
      locale = (fp.language || "zh-CN").split(",")[0];
      timezoneId = fp.timezone || "Asia/Shanghai";
    }
    const context = await chromium.launchPersistentContext(this.profileDir(accountId), {
      headless,
      // 有头模式下最大化窗口（viewport=null 用真实窗口尺寸），无头用固定 viewport
      viewport: headless ? viewport : null,
      args: headless ? [] : ["--start-maximized"],
      userAgent: ua,
      locale,
      timezoneId,
      // patchright 默认应用隐身补丁（隐藏 webdriver / CDP 痕迹等），不要叠加 stealth 插件
    });
    // 强制把闭合 shadow DOM 变成开放，否则发布按钮(xhs-publish-btn 内 closed shadow)无法定位
    await context.addInitScript(
      "(()=>{const o=Element.prototype.attachShadow;Element.prototype.attachShadow=function(i){i=i||{};i.mode='open';return o.call(this,i);};})()",
    );
    return context;
  }

  /**
   * 扫码登录：打开有头浏览器到创作平台，用户扫码；轮询会话 cookie，成功即保存登录态。
   * 直连方案：不走代理，使用主机网络。
   */
  async login(accountId: string): Promise<{ ok: boolean; message: string }> {
    const account = await this.accounts.findOne(accountId);
    await this.accounts.setStatus(accountId, "login_required");
    const context = await this.launchContext(accountId, false);
    try {
      const page = context.pages()[0] || (await context.newPage());
      // 采集号登录主站(用搜索页，能强制弹二维码)，发文号登录创作平台
      const isCollector = account.role === "collector";
      const loginUrl = isCollector
        ? "https://www.xiaohongshu.com/search_result?keyword=" + encodeURIComponent("养生")
        : "https://creator.xiaohongshu.com/login";
      await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3000);

      const shotDir = dataSub("shots");
      fs.mkdirSync(shotDir, { recursive: true });
      try { await page.screenshot({ path: path.join(shotDir, `login_start_${accountId}_${Date.now()}.png`) }); } catch {}
      this.logger.log(`账号「${account.nickname}」(${account.role}) 请在弹出的浏览器扫码（最多150秒）…`);

      // 检测登录：①登录墙文字消失 ②或 web_session 真值。先确认墙出现过，避免误判。
      const wallText = ["登录后查看", "扫码登录", "手机号登录", "新用户可直接登录"];
      const isWall = async () => {
        try {
          const t = (await page.evaluate(() => document.body.innerText || "")) as string;
          return wallText.some((w) => t.includes(w));
        } catch { return false; }
      };
      // 注意：web_session 匿名访客也有(且很长)，不可用作登录判断！
      // 创作平台有专属 cookie 可判断；主站只能靠"登录墙消失"。
      const creatorLoggedIn = async () => {
        const cs = await context.cookies();
        const cr = cs.find((c: any) => c.name === "access-token-creator.xiaohongshu.com");
        return !!cr && !!cr.value;
      };

      const deadline = Date.now() + 150000;
      let sawWall = false;
      let loggedIn = false;
      while (Date.now() < deadline) {
        const wall = await isWall();
        if (wall) sawWall = true;
        if (isCollector) {
          // 主站：登录墙出现过且现在消失 → 已扫码登录
          if (sawWall && !wall) { loggedIn = true; break; }
        } else {
          if ((await creatorLoggedIn()) || (sawWall && !wall)) { loggedIn = true; break; }
        }
        await new Promise((r) => setTimeout(r, 2000));
      }

      try { await page.screenshot({ path: path.join(shotDir, `login_end_${accountId}_${Date.now()}.png`) }); } catch {}
      if (loggedIn) {
        const cookies = await context.cookies();
        await this.accounts.saveCookie(accountId, JSON.stringify(cookies));
        this.logger.log(`账号「${account.nickname}」登录成功`);
        return { ok: true, message: "登录成功" };
      }
      return { ok: false, message: "登录超时（150s 内未检测到扫码登录）" };
    } catch (e: any) {
      return { ok: false, message: "登录失败: " + e.message };
    } finally {
      await context.close();
    }
  }

  /** 校验登录态是否有效 */
  async checkLogin(accountId: string): Promise<boolean> {
    const context = await this.launchContext(accountId, true);
    try {
      const page = context.pages()[0] || (await context.newPage());
      await page.goto("https://creator.xiaohongshu.com/creator/home", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000);
      const url = page.url();
      const ok = !url.includes("/login");
      await this.accounts.setStatus(accountId, ok ? "active" : "login_required");
      return ok;
    } catch {
      return false;
    } finally {
      await context.close();
    }
  }

  /**
   * 发布图文笔记。注意：创作平台 DOM 选择器需结合真实账号联调，以下为首版实现，
   * 待真实账号到位后按实际页面微调选择器。
   */
  async publishNote(
    accountId: string,
    note: { title: string; body: string; images: string[]; topics?: string[] },
    opts?: { holdForManual?: boolean },
  ): Promise<{ ok: boolean; url?: string; message: string; manual?: boolean }> {
    if (!note.images?.length) throw new BadRequestException("发布图文需要至少一张图片");
    const hold = !!opts?.holdForManual;
    const localImages = await this.ensureLocalImages(note.images);

    // 人工确认模式：先关掉该账号上次留开的窗口，避免越开越多
    if (hold) await this.releaseHeld(accountId);

    const context = await this.launchContext(accountId, false);
    let keepOpen = false;
    try {
      const page = context.pages()[0] || (await context.newPage());
      await page.goto("https://creator.xiaohongshu.com/publish/publish", { waitUntil: "domcontentloaded", timeout: 60000 });
      await this.hwait(page, 2500, 4500);
      if (page.url().includes("/login")) return { ok: false, message: "登录态失效，请重新登录" };

      // 1) 切到"上传图文"tab（页面内叶子节点点击，最稳）
      await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll("div,span,a,li,button"));
        const t = els.find((e) => e.children.length === 0 && (e.textContent || "").trim() === "上传图文");
        if (t) (t as HTMLElement).click();
      });
      await this.hwait(page, 1800, 3200);

      // 2) 上传图片（图文 tab 下第一个文件输入为图片上传）
      await page.locator('input[type="file"]').first().setInputFiles(localImages);
      await this.hwait(page, 5000, 8000); // 等上传完成 + 编辑器渲染（拟人不固定）

      // 3) 标题（逐字拟人输入）
      const titleInput = page.locator('input[placeholder*="填写标题"]').first();
      if (await titleInput.count()) {
        await titleInput.click();
        await this.hwait(page, 300, 800);
        await this.humanType(page, note.title.slice(0, 20));
      }

      // 4) 正文（先只打正文，避免 # 触发话题弹窗卡住），逐字拟人输入
      const bodyEditor = page.locator('[contenteditable="true"]').first();
      if (await bodyEditor.count()) {
        await bodyEditor.click();
        await this.hwait(page, 400, 1000);
        await this.humanType(page, note.body);
        await page.keyboard.press("Enter");
        // 话题：逐个输入 #词 → 等下拉 → 回车选中（间隔随机）
        for (const t of (note.topics || []).slice(0, 6)) {
          await page.keyboard.type(" #");
          await this.humanType(page, t);
          await this.hwait(page, 900, 1800); // 等话题下拉
          await page.keyboard.press("Enter"); // 选中第一个/创建
          await this.hwait(page, 300, 700);
        }
      }
      await this.hwait(page, 1500, 3000);

      // ── 人工确认模式：填好后【不点发布】，把浏览器留开给用户自己点 ──
      if (hold) {
        // 轮询确认发布按钮已渲染（让用户知道可以点了），但不点击
        let ready = false;
        const dl = Date.now() + 40000;
        while (Date.now() < dl && !ready) {
          try { if (await page.locator("button.ce-btn.bg-red").count()) { ready = true; break; } } catch {}
          await page.waitForTimeout(1500);
        }
        keepOpen = true;
        this.heldContexts.set(accountId, context);
        return {
          ok: true,
          manual: true,
          message: ready
            ? "已为你拟人填好图文，请在弹出的浏览器里核对后【自己点「发布」】（系统不会自动发）。发完可回来点「标记已发布」。"
            : "已填好图文，但暂未检测到发布按钮，请在浏览器里手动检查图片是否上传完成后再发布。",
        };
      }

      // 5) 全自动：点"发布"。按钮在 xhs-publish-btn 的 shadow DOM（已被 initScript 强制开放）。
      let clicked = false;
      const deadline = Date.now() + 40000;
      while (Date.now() < deadline && !clicked) {
        try {
          const b = page.locator("button.ce-btn.bg-red");
          if (await b.count()) { await b.last().click({ timeout: 4000 }); clicked = true; break; }
        } catch {}
        try {
          const b = page.getByRole("button", { name: "发布", exact: true });
          if (await b.count()) { await b.last().click({ timeout: 4000 }); clicked = true; break; }
        } catch {}
        if (!clicked) await page.waitForTimeout(2000);
      }
      if (!clicked) {
        try {
          const shotDir = dataSub("shots");
          fs.mkdirSync(shotDir, { recursive: true });
          await page.screenshot({ path: path.join(shotDir, `pubfail_${accountId}_${Date.now()}.png`), fullPage: true });
        } catch {}
        return { ok: false, message: "等待 40s 仍未找到发布按钮（请确认图片已上传完成）" };
      }
      await page.waitForTimeout(6000);

      const url = page.url();
      const ok = !url.includes("/publish/publish") || (await page.locator("text=发布成功").count()) > 0;
      return { ok: true, url, message: ok ? "发布成功" : "已提交发布（请到创作平台确认状态）" };
    } catch (e: any) {
      this.logger.error(`发布失败: ${e.message}`);
      return { ok: false, message: "发布失败: " + e.message };
    } finally {
      if (!keepOpen) await context.close();
    }
  }

  /**
   * 安全探测：打开创作平台发布页，截图 + 扒关键元素结构（不发帖），用于联调选择器。
   */
  async inspectPublishPage(accountId: string): Promise<any> {
    const context = await this.launchContext(accountId, false);
    try {
      const page = context.pages()[0] || (await context.newPage());
      await page.goto("https://creator.xiaohongshu.com/publish/publish", { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(4000);

      // 切到"上传图文"tab：页面内直接查找叶子节点点击（最稳）
      const tabClicked = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll("div,span,a,li,button"));
        const t = els.find((e) => e.children.length === 0 && (e.textContent || "").trim() === "上传图文");
        if (t) { (t as HTMLElement).click(); return true; }
        return false;
      });
      await page.waitForTimeout(2500);

      // 上传一张测试图，触发编辑器表单出现（不发布）
      const testImg = path.resolve(process.cwd(), "..", "electron", "build-resources", "icon-256.png");
      let uploaded = false;
      try {
        if (fs.existsSync(testImg)) {
          const fi = page.locator('input[type="file"]').first();
          await fi.setInputFiles(testImg);
          await page.waitForTimeout(7000);
          uploaded = true;
        }
      } catch {}

      const shotDir = dataSub("shots");
      fs.mkdirSync(shotDir, { recursive: true });
      const shot = path.join(shotDir, `publish_${accountId}_${Date.now()}.png`);
      await page.screenshot({ path: shot, fullPage: true });

      const dump = await page.evaluate(() => {
        const txt = (el: Element) => (el.textContent || "").trim().slice(0, 30);
        return {
          url: location.href,
          fileInputs: document.querySelectorAll('input[type="file"]').length,
          editables: Array.from(document.querySelectorAll('[contenteditable="true"]')).map((e) => txt(e) || "(空)"),
          placeholders: Array.from(document.querySelectorAll("input,textarea")).map((e: any) => e.placeholder).filter(Boolean),
          buttons: Array.from(document.querySelectorAll("button")).map((b) => txt(b)).filter(Boolean).slice(0, 30),
          tabs: Array.from(document.querySelectorAll('[class*="tab"],[class*="Tab"]')).map((e) => txt(e)).filter(Boolean).slice(0, 20),
        };
      });
      return { ok: true, screenshot: shot, tabClicked, uploaded, dom: dump };
    } catch (e: any) {
      return { ok: false, message: e.message };
    } finally {
      await context.close();
    }
  }

  /**
   * 真实采集：用采集号(已登录主站)搜索关键词，抓笔记列表 + 打开前若干篇抓评论。
   */
  async collectKeyword(
    accountId: string,
    keyword: string,
    limit = 12,
    sort: "general" | "time_descending" | "popularity_descending" = "general",
  ): Promise<{ notes: any[]; comments: any[] }> {
    const context = await this.launchContext(accountId, false); // 有头：无头会被小红书屏蔽
    const notes: any[] = [];
    const comments: any[] = []; // 评论需逐篇打开笔记，触发风控严重 → 默认不抓
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    try {
      const page = context.pages()[0] || (await context.newPage());
      await page.goto(
        `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&sort=${sort}&source=web_search_result_notes`,
        { waitUntil: "domcontentloaded", timeout: 60000 },
      );
      await page.waitForTimeout(rnd(3000, 5000));

      if (page.url().includes("/login") || (await page.locator("text=登录后查看").count())) {
        throw new BadRequestException("采集号未登录主站，请在「账号矩阵」对采集号重新扫码登录");
      }

      // 风控/验证码检测 → 有头窗口暂停，等用户手动通过（最多 90s）
      const captchaText = ["安全验证", "请勿频繁操作", "请选择最符合", "滑动验证", "验证码"];
      const hasCaptcha = async () => {
        try { const t = (await page.evaluate(() => document.body.innerText || "")) as string; return captchaText.some((w) => t.includes(w)); }
        catch { return false; }
      };
      if (await hasCaptcha()) {
        this.logger.warn(`[采集] 关键词「${keyword}」触发风控验证，等待人工在浏览器中通过…`);
        const dl = Date.now() + 90000;
        while (Date.now() < dl && (await hasCaptcha())) await page.waitForTimeout(3000);
        await page.waitForTimeout(2000);
      }

      // 轻量滚动（拟人，随机延时）
      for (let i = 0; i < 2; i++) {
        await page.mouse.wheel(0, rnd(1500, 2800));
        await page.waitForTimeout(rnd(1500, 3000));
      }

      const raw = await page.evaluate(() => {
        const parseCount = (t: string) => {
          t = (t || "").trim(); if (!t) return 0;
          if (t.includes("万")) return Math.round(parseFloat(t) * 10000);
          return parseInt(t.replace(/[^\d]/g, "")) || 0;
        };
        const cards = Array.from(document.querySelectorAll("section.note-item, .note-item"));
        return cards.map((c: any) => {
          const a = c.querySelector('a[href*="/search_result/"], a[href*="/explore/"], a.cover, a');
          const href = a?.getAttribute("href") || "";
          const m = href.match(/(?:explore|search_result)\/([0-9a-zA-Z]+)/);
          const title = (c.querySelector(".title, a.title, .footer .title span, .footer .title")?.textContent || "").trim();
          const author = (c.querySelector(".author .name, .name, .author-wrapper .name")?.textContent || "").trim();
          const like = (c.querySelector(".like-wrapper .count, .count, .like .count")?.textContent || "").trim();
          return { id: m ? m[1] : "", title, author, likes: parseCount(like) };
        }).filter((n: any) => n.id && n.title);
      });
      for (const n of raw.slice(0, limit)) {
        notes.push({
          id: n.id, title: n.title, content: n.title, authorId: n.author || "unknown",
          authorName: n.author || "用户", likes: n.likes, collects: 0, comments: 0, images: [], tags: [],
        });
      }
      return { notes, comments };
    } finally {
      await context.close();
    }
  }

  /** 探测搜索结果页结构（采集联调用） */
  async inspectSearch(accountId: string, keyword: string): Promise<any> {
    const context = await this.launchContext(accountId, false);
    try {
      const page = context.pages()[0] || (await context.newPage());
      const url = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(6000);
      const shotDir = dataSub("shots");
      fs.mkdirSync(shotDir, { recursive: true });
      const shot = path.join(shotDir, `search_${Date.now()}.png`);
      await page.screenshot({ path: shot });
      const dump = await page.evaluate(() => {
        const pick = (sel: string) => document.querySelectorAll(sel).length;
        const sample = (sel: string) =>
          Array.from(document.querySelectorAll(sel)).slice(0, 2).map((e) => (e.outerHTML || "").slice(0, 300));
        return {
          url: location.href,
          loggedIn: !document.body.innerText.includes("登录") || document.body.innerText.length > 2000,
          counts: {
            "section.note-item": pick("section.note-item"),
            ".note-item": pick(".note-item"),
            "a.cover": pick("a.cover"),
            ".feeds-page .note-item": pick(".feeds-page .note-item"),
          },
          firstCards: sample(".note-item") .concat(sample("section")),
        };
      });
      return { ok: true, screenshot: shot, dom: dump };
    } catch (e: any) {
      return { ok: false, message: e.message };
    } finally {
      await context.close();
    }
  }

  /** 把图片(URL / dataURL / 本地路径)统一落成本地文件供上传 */
  private async ensureLocalImages(images: string[]): Promise<string[]> {
    const out: string[] = [];
    const tmp = path.join(os.tmpdir(), "xhs-pub");
    fs.mkdirSync(tmp, { recursive: true });
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (!img) continue;
      if (img.startsWith("/generated/")) {
        // 本地生成图：直接定位到 data/generated-images 文件
        const local = path.join(dataSub("generated-images"), path.basename(img));
        if (fs.existsSync(local)) out.push(local);
      } else if (img.startsWith("data:")) {
        const b64 = img.split(",")[1];
        const f = path.join(tmp, `${Date.now()}_${i}.png`);
        fs.writeFileSync(f, Buffer.from(b64, "base64"));
        out.push(f);
      } else if (img.startsWith("http")) {
        try {
          const resp = await fetch(img);
          const buf = Buffer.from(await resp.arrayBuffer());
          const f = path.join(tmp, `${Date.now()}_${i}.png`);
          fs.writeFileSync(f, buf);
          out.push(f);
        } catch {}
      } else if (fs.existsSync(img)) {
        out.push(img);
      }
    }
    if (!out.length) throw new BadRequestException("没有可用的本地图片");
    return out;
  }
}
