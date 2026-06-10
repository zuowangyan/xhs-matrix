// 采集器抽象：便于将来从"示例数据"切换到真实 Spider_XHS sidecar，互不影响上层。
export interface CollectQuery {
  type: "keyword" | "competitor" | "hot";
  query: string; // 关键词 或 竞品账号
  limit?: number;
}

export interface RawNote {
  id: string;
  title: string;
  content: string;
  authorId: string;
  authorName: string;
  likes: number;
  collects: number;
  comments: number;
  images: string[];
  tags: string[];
  publishTime?: string;
}

export interface RawComment {
  id: string;
  noteId: string;
  content: string;
  likes: number;
  authorId: string;
}

export interface CollectResult {
  notes: RawNote[];
  comments: RawComment[];
}

export interface ICollector {
  readonly id: string;
  collect(q: CollectQuery): Promise<CollectResult>;
}
