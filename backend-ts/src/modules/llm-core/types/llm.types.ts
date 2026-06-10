// LLM 交互统一类型（自包含版，移植自 guada llm-core）

export interface ToolCallItem {
  id?: string;
  index?: number;
  type?: string;
  name?: string;
  arguments?: string;
}

export interface MessageRecord {
  role: "system" | "user" | "assistant" | "tool";
  content: any; // string 或 多模态数组
  reasoningContent?: string;
  toolCallId?: string;
  toolCalls?: ToolCallItem[];
}

export interface ToolParameterProperty {
  type: string;
  description?: string;
  enum?: any[];
  properties?: Record<string, ToolParameterProperty>;
  required?: string[];
  items?: ToolParameterProperty;
  default?: any;
}

export interface InternalToolDefinition {
  name: string;
  description: string;
  parameters?: {
    type: "object";
    properties: Record<string, ToolParameterProperty>;
    required?: string[];
  };
}

export interface LLMCompletionParams {
  model: string;
  messages: MessageRecord[];
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  maxTokens?: number;
  tools?: InternalToolDefinition[];
  thinkingEffort?: string;
  extraBody?: Record<string, any>;
  abortSignal?: AbortSignal;
  providerConfig?: any;
  stream?: boolean;
  timeout?: number;
}

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** OpenAI 兼容：缓存命中 Token 数 */
  cachedTokens?: number;
  /** Anthropic 风格：缓存创建的输入 Token 数 */
  cacheCreationTokens?: number;
  /** Anthropic 风格：缓存读取的输入 Token 数（Claude 命中即看这个） */
  cacheReadTokens?: number;
}

export interface LLMResponseChunk {
  content?: string | null;
  reasoningContent?: string | null;
  finishReason?: string | null;
  toolCalls?: ToolCallItem[];
  usage?: LLMUsage | null;
}
