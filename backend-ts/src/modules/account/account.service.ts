import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service";
import { generateFingerprint } from "./fingerprint.util";

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: { nickname: string; role?: string; dailyQuota?: number; personaId?: string }) {
    // 自动生成并绑定一套独立指纹
    const fp = await this.prisma.fingerprint.create({ data: generateFingerprint() });
    return this.prisma.account.create({
      data: {
        nickname: input.nickname,
        role: input.role || "publisher",
        status: "login_required",
        fingerprintId: fp.id,
        personaId: input.personaId,
        dailyQuota: input.dailyQuota ?? 2,
      },
    });
  }

  async findAll() {
    const accounts = await this.prisma.account.findMany({ orderBy: { createdAt: "desc" } });
    // 附带今日已发布数
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result = [];
    for (const a of accounts) {
      const publishedToday = await this.prisma.publishJob.count({
        where: { accountId: a.id, status: "published", createdAt: { gte: today } },
      });
      result.push({ ...a, cookie: undefined, hasCookie: !!a.cookie, publishedToday });
    }
    return result;
  }

  async findOne(id: string) {
    const a = await this.prisma.account.findUnique({ where: { id } });
    if (!a) throw new NotFoundException("账号不存在");
    return a;
  }

  async update(id: string, data: any) {
    await this.findOne(id);
    return this.prisma.account.update({ where: { id }, data });
  }

  async setStatus(id: string, status: string) {
    return this.prisma.account.update({ where: { id }, data: { status } });
  }

  async saveCookie(id: string, cookie: string) {
    return this.prisma.account.update({ where: { id }, data: { cookie, status: "active" } });
  }

  async getFingerprint(id: string) {
    const a = await this.findOne(id);
    if (!a.fingerprintId) return null;
    return this.prisma.fingerprint.findUnique({ where: { id: a.fingerprintId } });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.account.delete({ where: { id } });
    return { ok: true };
  }
}
