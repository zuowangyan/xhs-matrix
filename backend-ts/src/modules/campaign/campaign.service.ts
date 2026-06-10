import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service";
import { GatewayService } from "../gateway/gateway.service";

// 前端传数组/对象，DB 存 JSON 字符串。这里统一序列化/反序列化。
const JSON_FIELDS = [
  "keywords",
  "competitors",
  "collectAccountIds",
  "publishAccountIds",
  "gates",
  "cadence",
] as const;

export interface CampaignInput {
  name: string;
  productName?: string;
  personaId?: string;
  keywords?: string[];
  competitors?: string[];
  collectAccountIds?: string[];
  publishAccountIds?: string[];
  playbook?: string;
  runMode?: "manual" | "semi" | "auto";
  cadence?: Record<string, any>;
  gates?: Record<string, "auto" | "manual">;
  status?: string;
}

@Injectable()
export class CampaignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: GatewayService,
  ) {}

  /** AI 一句话生成项目配置建议（不落库，前端确认后再创建） */
  async aiSuggest(description: string) {
    const personas = await this.prisma.persona.findMany({ select: { id: true, name: true, audience: true } });
    const personaList = personas.map((p) => `${p.id}:${p.name}(${p.audience || ""})`).join("; ") || "无";
    const sys = `你是小红书运营策划。根据用户的产品简述，生成运营项目配置。
现有可绑定人设：${personaList}

【铁律】
- productName 必须严格等于用户描述里出现的产品名，原样照抄，绝不可改写、缩写或臆造成别的产品。
- "人群/宝妈/女性"指的是【购买和使用该产品的消费者】，不是要卖给小孩；不要因为出现"宝妈"就联想成婴童产品。
- keywords 必须围绕"该产品本身 + 其卖点 + 目标人群的相关需求/痛点/场景"，不得偏离到别的品类。

严格输出一个 JSON 对象（不要前言/代码块）：
{"name":"项目名(产品+玩法)","productName":"严格用原产品名","keywords":["6-10个采集关键词"],"competitors":[],"playbook":"种草文|测评文|教程文|对比文","runMode":"semi","personaId":"从上面选最匹配的人设id，没合适就空字符串","personaReason":"为何选这个人设"}`;
    const { content } = await this.gateway.chat(
      [
        { role: "system", content: sys },
        { role: "user", content: description },
      ],
      { temperature: 0.5, maxTokens: 1200 },
    );
    let s = content.replace(/```(?:json)?/gi, "").trim();
    let obj: any = {};
    try {
      obj = JSON.parse(s);
    } catch {
      const m = s.match(/\{[\s\S]*\}/);
      if (m) try { obj = JSON.parse(m[0]); } catch {}
    }
    return {
      name: obj.name || "",
      productName: obj.productName || "",
      keywords: Array.isArray(obj.keywords) ? obj.keywords : [],
      competitors: Array.isArray(obj.competitors) ? obj.competitors : [],
      playbook: obj.playbook || "种草文",
      runMode: obj.runMode || "semi",
      personaId: obj.personaId || "",
      personaReason: obj.personaReason || "",
    };
  }

  private serialize(input: CampaignInput): any {
    const data: any = { ...input };
    for (const f of JSON_FIELDS) {
      if (data[f] !== undefined) data[f] = JSON.stringify(data[f]);
    }
    return data;
  }

  private deserialize(row: any): any {
    if (!row) return row;
    const out = { ...row };
    for (const f of JSON_FIELDS) {
      try {
        out[f] = row[f] ? JSON.parse(row[f]) : Array.isArray(out[f]) ? [] : {};
      } catch {
        /* 保持原值 */
      }
    }
    return out;
  }

  async create(input: CampaignInput) {
    const row = await this.prisma.campaign.create({ data: this.serialize(input) });
    return this.deserialize(row);
  }

  async findAll() {
    const rows = await this.prisma.campaign.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map((r) => this.deserialize(r));
  }

  async findOne(id: string) {
    const row = await this.prisma.campaign.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`运营项目不存在: ${id}`);
    return this.deserialize(row);
  }

  async update(id: string, input: Partial<CampaignInput>) {
    await this.findOne(id);
    const row = await this.prisma.campaign.update({
      where: { id },
      data: this.serialize(input as CampaignInput),
    });
    return this.deserialize(row);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.campaign.delete({ where: { id } });
    return { ok: true };
  }
}
