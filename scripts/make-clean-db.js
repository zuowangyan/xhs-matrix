// 生成"干净分发库"：清空所有数据，只留一个通用示例项目（面膜补水种草）。
// 用法：node scripts/make-clean-db.js <目标db路径>
// 不含任何真实项目/人设/素材/知识库/账号/密钥。
const { PrismaClient } = require("@prisma/client");
const { PrismaBetterSQLite3 } = require("@prisma/adapter-better-sqlite3");
const path = require("path");

const dbPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, "..", "backend-ts", "data", "xhs_matrix.db");
console.log("生成干净库:", dbPath);

const prisma = new PrismaClient({
  adapter: new PrismaBetterSQLite3({ url: "file:" + dbPath }),
});

(async () => {
  // 1) 清空所有数据表（顺序无所谓，逐个 deleteMany）
  const ops = [
    "comment", "commentInsight", "note", "topic", "draft", "publishJob",
    "runLog", "collectTask", "material", "wikiPage", "wikiSpace",
    "persona", "campaign", "model", "modelProvider", "account",
    "fingerprint", "setting",
  ];
  for (const m of ops) {
    try { await prisma[m].deleteMany({}); } catch (e) { /* 表不存在则跳过 */ }
  }
  console.log("已清空全部数据。");

  // 2) 建一个通用示例项目（纯演示，无品牌、无密钥）
  await prisma.campaign.create({
    data: {
      name: "示例·面膜补水种草",
      productName: "XX补水面膜",
      playbook: "种草文",
      runMode: "semi",
      keywords: JSON.stringify(["补水面膜", "熬夜急救", "面膜测评", "敏感肌补水"]),
      competitors: JSON.stringify([]),
      collectAccountIds: JSON.stringify([]),
      publishAccountIds: JSON.stringify([]),
      cadence: JSON.stringify({
        contentMix: [
          { type: "护肤干货", weight: 35, embedRate: 20 },
          { type: "测评", weight: 25, embedRate: 60 },
          { type: "种草", weight: 20, embedRate: 100 },
          { type: "日常", weight: 20, embedRate: 20 },
        ],
        adoptMin: 1, adoptMax: 2, draftsPerTopic: 1,
        intervalMinMinutes: 1430, intervalMaxMinutes: 1490,
        collectCooldownHours: 48,
        publishPerRunMax: 2, publishGapMinMinutes: 60, publishGapMaxMinutes: 180,
        pubWindowOn: true, pubWindowStart: 8, pubWindowEnd: 23,
        imageSource: "ai", imageRatio: "3:4", imageCount: 1, imageAiExpand: true,
      }),
      autopilotEnabled: false,
      status: "active",
    },
  });
  console.log("已创建示例项目：示例·面膜补水种草");

  await prisma.$disconnect();
  console.log("✅ 干净库已就绪（无任何真实数据/密钥）。");
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
