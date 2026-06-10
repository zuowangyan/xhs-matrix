import { Logger } from "@nestjs/common";
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  SchemaType,
} from "@google/generative-ai";
import { IProtocolAdapter } from "./base.adapter";
import {
  MessageRecord,
  InternalToolDefinition,
  LLMCompletionParams,
  LLMResponseChunk,
  ToolCallItem,
} from "../types/llm.types";
import { ProviderConfig, ConnectionTestResult } from "../types/provider.types";

/** Google Gemini 原生协议适配器（移植自 guada）。支持自定义 baseUrl（国内中转）。 */
export class GeminiAdapter implements IProtocolAdapter {
  readonly protocol = "gemini";
  private readonly logger = new Logger(GeminiAdapter.name);

  private buildRequestOptions(apiUrl?: string): any {
    if (apiUrl) return { baseUrl: apiUrl.replace(/\/+$/, "") };
    return undefined;
  }

  async testConnection(config: ProviderConfig): Promise<ConnectionTestResult> {
    try {
      const apiKey = config.apiKey;
      if (!apiKey) return { success: false, message: "API Key 未配置" };
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }, this.buildRequestOptions(config.apiUrl));
      await model.generateContent("test");
      return { success: true, message: "连接成功" };
    } catch (error: any) {
      return {
        success: false,
        message:
          error.message?.includes("401") || error.message?.includes("API key not valid")
            ? "API Key 无效"
            : `连接失败: ${error.message}`,
      };
    }
  }

  async *chatCompletion(params: LLMCompletionParams): AsyncGenerator<LLMResponseChunk> {
    const cfg = params.providerConfig || {};
    const apiKey = cfg.apiKey;
    if (!apiKey) throw new Error("Gemini API Key 缺失");
    const genAI = new GoogleGenerativeAI(apiKey);
    const tools = params.tools?.length ? [{ functionDeclarations: this.convertTools(params.tools) }] : undefined;
    const model = genAI.getGenerativeModel(
      {
        model: params.model,
        generationConfig: this.buildGenerationConfig(params),
        safetySettings: this.getSafetySettings(),
        tools,
      },
      this.buildRequestOptions(cfg.apiUrl),
    );

    // history 用除最后一条外的消息，最后一条作为本轮输入
    const history = this.formatMessages(params.messages.slice(0, -1));
    const chat = model.startChat({ history });
    const last = params.messages[params.messages.length - 1];
    const contentToSend = Array.isArray(last?.content)
      ? last.content.map((p: any) => (p.type === "text" ? { text: p.text } : p))
      : last?.content || "";

    try {
      const result = await chat.sendMessageStream(contentToSend);
      for await (const chunk of result.stream) {
        const rc: LLMResponseChunk = { content: null, finishReason: null, usage: null };
        const text = chunk.text();
        if (text) rc.content = text;
        const fcs = chunk.functionCalls();
        if (fcs && fcs.length) {
          rc.toolCalls = fcs.map((fc, index): ToolCallItem => ({
            id: fc.name, index, type: "function", name: fc.name, arguments: JSON.stringify(fc.args),
          }));
        }
        yield rc;
      }
      yield { content: null, finishReason: "stop", usage: null };
    } catch (error: any) {
      this.logger.error("Gemini API error:", error?.message);
      throw error;
    }
  }

  private buildGenerationConfig(params: LLMCompletionParams) {
    const config: any = {
      temperature: params.temperature,
      topP: params.topP,
      maxOutputTokens: params.maxTokens,
    };
    const effort = params.thinkingEffort || "off";
    if (effort !== "off") config.thinkingConfig = { thinkingLevel: effort };
    return config;
  }

  private formatMessages(messages: MessageRecord[]): any[] {
    return messages.map((msg) => {
      let parts: any[] = [];
      if (Array.isArray(msg.content)) {
        parts = msg.content.map((item: any) => {
          if (item.type === "text") return { text: item.text };
          if (item.type === "image_url" && item.image_url) {
            return { inlineData: { data: item.image_url.url.split(",")[1], mimeType: "image/jpeg" } };
          }
          return { text: JSON.stringify(item) };
        });
      } else {
        parts = [{ text: msg.content || "" }];
      }
      return { role: msg.role === "assistant" ? "model" : "user", parts };
    });
  }

  private convertTools(tools: InternalToolDefinition[]): any[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: SchemaType.OBJECT as any,
        properties: tool.parameters?.properties || {},
        required: tool.parameters?.required || [],
      },
    }));
  }

  private getSafetySettings() {
    return [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ];
  }
}
