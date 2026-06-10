import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service";

const JSON_FIELDS = ["hashtags", "wikiSpaceIds"] as const;

@Injectable()
export class PersonaService {
  constructor(private readonly prisma: PrismaService) {}

  private serialize(input: any) {
    const data: any = { ...input };
    for (const f of JSON_FIELDS) if (data[f] !== undefined) data[f] = JSON.stringify(data[f]);
    return data;
  }
  private deserialize(row: any) {
    if (!row) return row;
    const out = { ...row };
    for (const f of JSON_FIELDS) {
      try { out[f] = row[f] ? JSON.parse(row[f]) : []; } catch { out[f] = []; }
    }
    return out;
  }

  async create(input: any) {
    return this.deserialize(await this.prisma.persona.create({ data: this.serialize(input) }));
  }
  async findAll() {
    return (await this.prisma.persona.findMany({ orderBy: { createdAt: "desc" } })).map((r) => this.deserialize(r));
  }
  async findOne(id: string) {
    const row = await this.prisma.persona.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("人设不存在");
    return this.deserialize(row);
  }
  async update(id: string, input: any) {
    return this.deserialize(await this.prisma.persona.update({ where: { id }, data: this.serialize(input) }));
  }
  async remove(id: string) {
    await this.prisma.persona.delete({ where: { id } });
    return { ok: true };
  }
}
