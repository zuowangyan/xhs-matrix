import { Injectable } from "@nestjs/common";
import { ICollector, CollectQuery, CollectResult, RawNote, RawComment } from "./collector.types";

// 示例采集器（P1）：根据关键词生成可信的样例数据，让"主线"端到端跑起来。
// P1b 将新增 SpiderXhsCollector（调 Python sidecar），实现同一 ICollector 接口即可无缝替换。
@Injectable()
export class MockCollector implements ICollector {
  readonly id = "mock";

  private rand(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  async collect(q: CollectQuery): Promise<CollectResult> {
    const n = q.limit ?? 8;
    const notes: RawNote[] = [];
    const comments: RawComment[] = [];

    const titleTemplates = [
      `${q.query}｜真实测评，喝了一个月的变化`,
      `被低估的${q.query}，气血差的姐妹冲`,
      `${q.query}怎么选？避坑指南`,
      `坚持喝${q.query}的第30天，皮肤状态…`,
      `${q.query}的3个隐藏吃法`,
      `谁懂啊，${q.query}真的有用吗？`,
      `${q.query}红黑榜，别再交智商税`,
      `老中医说${q.query}要这样搭配`,
    ];
    const commentTemplates = [
      "请问孕妇能喝吗？",
      "喝了会上火吗？",
      "多大年纪适合喝呀",
      "和阿胶比哪个好",
      "口感怎么样，会不会很难喝",
      "经期能喝吗",
      "求链接！在哪买正品",
      "喝多久能看到效果",
    ];

    for (let i = 0; i < n; i++) {
      const noteId = `mock_${Date.now()}_${i}_${this.rand(1000, 9999)}`;
      notes.push({
        id: noteId,
        title: titleTemplates[i % titleTemplates.length],
        content: `这是关于「${q.query}」的样例笔记正文（示例数据，P1b 接入 Spider_XHS 后为真实内容）。`,
        authorId: `author_${this.rand(100, 999)}`,
        authorName: `用户${this.rand(100, 999)}`,
        likes: this.rand(50, 9999),
        collects: this.rand(10, 3000),
        comments: this.rand(5, 800),
        images: [],
        tags: [q.query, "种草", "食养"],
        publishTime: new Date(Date.now() - this.rand(0, 30) * 86400000).toISOString(),
      });
      // 每篇 3-5 条评论
      const cc = this.rand(3, 5);
      for (let j = 0; j < cc; j++) {
        comments.push({
          id: `${noteId}_c${j}`,
          noteId,
          content: commentTemplates[(i + j) % commentTemplates.length],
          likes: this.rand(0, 200),
          authorId: `cuser_${this.rand(100, 999)}`,
        });
      }
    }

    // 模拟网络耗时
    await new Promise((r) => setTimeout(r, 600));
    return { notes, comments };
  }
}
