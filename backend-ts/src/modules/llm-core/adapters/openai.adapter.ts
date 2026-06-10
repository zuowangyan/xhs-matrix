import { Logger } from "@nestjs/common";
import { OpenAI, APIError } from "openai";
import { IProtocolAdapter } from "./base.adapter";
import { ProviderConfig, ConnectionTestResult } from "../types/provider.types";
import {
  MessageRecord,
  InternalToolDefinition,
  LLMCompletionParams,
  LLMResponseChunk,
  ToolCallItem,
} from "../types/llm.types";

/**
 * OpenAI 协议适配器（移植自 guada）。
 * 关键：formatMessages 给 system 与末条用户消息加 cache_control:{type:"ephemeral"}，
 * 指向 Anthropic 兼容端点时即可触发 Claude 提示缓存命中（cache_read_input_tokens）。
 */
export class OpenAIAdapter implements IProtocolAdapter {
  readonly protocol = "openai";
  private readonly logger = new Logger(OpenAIAdapter.name);

  protected normalizeApiUrl(apiUrl: string): string {
    if (!apiUrl) return apiUrl;
    let url = apiUrl.replace(/\/+$/, "");
    if (!/\/v\d+$/.test(url)) url = url + "/v1";
    return url;
  }

  protected createClient(config: ProviderConfig): OpenAI {
    return new OpenAI({
      baseURL: this.normalizeApiUrl(config.apiUrl),
      apiKey: config.apiKey,
    });
  }

  async testConnection(config: ProviderConfig): Promise<ConnectionTestResult> {
    try {
      const client = this.createClient(config);
      await client.models.list();
      return { success: true, message: "连接成功" };
    } catch (error: any) {
      return {
        success: false,
        message: error.message?.includes("401") ? "API Key 无效" : `连接失败: ${error.message}`,
        details: error,
      };
    }
  }

  protected buildRequestParam(params: any): any {
    const requestParams: any = {
      model: params.model,
      messages: params.messages,
      stream: params.stream,
      timeout: params.timeout,
    };
    if (params.stream) requestParams.stream_options = { include_usage: true };
    Object.assign(requestParams, params.extraBody || {});
    if (params.temperature !== undefined && params.temperature !== null) requestParams.temperature = params.temperature;
    if (params.topP !== undefined && params.topP !== null) requestParams.top_p = params.topP;
    if (params.frequencyPenalty !== undefined && params.frequencyPenalty !== null) requestParams.frequency_penalty = params.frequencyPenalty;
    if (params.maxTokens !== undefined && params.maxTokens !== null) requestParams.max_tokens = params.maxTokens;
    if (params.tools?.length) {
      requestParams.tools = this.convertTools(params.tools);
      requestParams.tool_choice = "auto";
    }
    if (params.thinkingEffort && ["minimum", "low", "medium", "high", "xhigh"].includes(params.thinkingEffort)) {
      requestParams.reasoning_effort = params.thinkingEffort;
    }
    return requestParams;
  }

  async *chatCompletion(params: LLMCompletionParams): AsyncGenerator<LLMResponseChunk> {
    const client = this.createClient(params.providerConfig);
    const filterMessages = this.formatMessages(params.messages);
    const requestParams = this.buildRequestParam({
      model: params.model,
      messages: filterMessages,
      stream: params.stream,
      timeout: params.timeout,
      temperature: params.temperature,
      topP: params.topP,
      frequencyPenalty: params.frequencyPenalty,
      maxTokens: params.maxTokens,
      tools: params.tools,
      extraBody: params.extraBody,
      thinkingEffort: params.thinkingEffort,
    });

    let response: any = null;
    try {
      response = await client.chat.completions.create(requestParams, { signal: params.abortSignal });
      if (params.stream) {
        yield* this.handleStreamResponse(response);
      } else {
        yield this.handleNonStreamResponse(response);
      }
    } catch (error: any) {
      const errorMsg = error?.message || "";
      const isToolError =
        (error?.status === 404 || error?.status === 400) &&
        (errorMsg.includes("tool") || errorMsg.includes("function")) &&
        requestParams.tools;
      if (isToolError) {
        this.logger.warn(`模型不支持 tools，去掉后重试: ${errorMsg}`);
        delete requestParams.tools;
        delete requestParams.tool_choice;
        response = await client.chat.completions.create(requestParams, { signal: params.abortSignal });
        if (params.stream) yield* this.handleStreamResponse(response);
        else yield this.handleNonStreamResponse(response);
        return;
      }
      this.handleError(error, params.stream);
    }
  }

  /** 给 system 与末条用户消息加 cache_control（Claude 缓存命中关键） */
  private formatMessages(messages: MessageRecord[]) {
    let lastUserMsgIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") { lastUserMsgIndex = i; break; }
    }
    return messages.map((msg, index) => {
      const filtered: any = { role: msg.role, content: msg.content || "" };
      if (msg.reasoningContent !== undefined) filtered.reasoning_content = msg.reasoningContent;
      if (msg.toolCallId !== undefined) filtered.tool_call_id = msg.toolCallId;
      if (msg.toolCalls) {
        filtered.tool_calls = msg.toolCalls.map((tc, idx) => ({
          id: tc.id, index: idx, type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }
      const isMultimodal = Array.isArray(msg.content);
      if (msg.role === "system") {
        filtered.content = [
          { type: "text", text: (typeof msg.content === "string" ? msg.content : "") || "", cache_control: { type: "ephemeral" } },
        ];
      } else if (index === lastUserMsgIndex && messages.length > 3) {
        if (isMultimodal) {
          const parts = [...(msg.content as any[])];
          const firstText = parts.find((p: any) => p.type === "text");
          if (firstText) firstText.cache_control = { type: "ephemeral" };
          filtered.content = parts;
        } else {
          filtered.content = [{ type: "text", text: msg.content || "", cache_control: { type: "ephemeral" } }];
        }
      }
      return filtered;
    });
  }

  protected extractUsage(rawUsage: any): LLMResponseChunk["usage"] {
    if (!rawUsage) return null;
    const usage: any = {
      promptTokens: rawUsage.prompt_tokens || 0,
      completionTokens: rawUsage.completion_tokens || 0,
      totalTokens: rawUsage.total_tokens || 0,
    };
    if (rawUsage.prompt_tokens_details?.cached_tokens) usage.cachedTokens = rawUsage.prompt_tokens_details.cached_tokens;
    if (rawUsage.cache_creation_input_tokens !== undefined) usage.cacheCreationTokens = rawUsage.cache_creation_input_tokens;
    if (rawUsage.cache_read_input_tokens !== undefined) usage.cacheReadTokens = rawUsage.cache_read_input_tokens;
    return usage;
  }

  private convertTools(tools: InternalToolDefinition[]): any[] {
    return tools.map((tool) => ({
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
  }

  private async *handleStreamResponse(response: any): AsyncGenerator<LLMResponseChunk> {
    for await (const chunk of response) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta;
      const responseChunk: LLMResponseChunk = {
        content: this.extractTextContent(delta?.content),
        reasoningContent: (delta as any)?.reasoning_content || null,
        finishReason: choice.finish_reason || null,
        toolCalls: undefined,
        usage: null,
      };
      if ((chunk as any).usage) responseChunk.usage = this.extractUsage((chunk as any).usage);
      if (delta?.tool_calls) {
        responseChunk.toolCalls = delta.tool_calls.map((tc: any): ToolCallItem => ({
          id: tc.id, index: tc.index, type: "function", name: tc.function?.name, arguments: tc.function?.arguments,
        }));
      }
      if (responseChunk.content || responseChunk.reasoningContent || responseChunk.finishReason || responseChunk.toolCalls || responseChunk.usage) {
        yield responseChunk;
      }
    }
  }

  private handleNonStreamResponse(response: any): LLMResponseChunk {
    const choice = response.choices?.[0];
    if (!choice || !choice.message) throw new Error("LLM API 返回无效");
    const message = choice.message;
    // 出图模型（gemini-image / OpenRouter 等）把图片放在 message.images，content 可能为 null
    let textContent = this.extractTextContent(message.content);
    const imgMd = this.convertImagesToMarkdown((message as any).images);
    if (imgMd) textContent = (textContent || "") + imgMd;
    const result: LLMResponseChunk = {
      content: textContent,
      reasoningContent: (message as any).reasoning_content || null,
      finishReason: choice.finish_reason || null,
      toolCalls: undefined,
      usage: null,
    };
    if (response.usage) result.usage = this.extractUsage(response.usage);
    if (message.tool_calls) {
      result.toolCalls = message.tool_calls.map((tc: any): ToolCallItem => ({
        id: tc.id, index: tc.index, type: tc.type || "function", name: tc.function?.name, arguments: tc.function?.arguments,
      }));
    }
    return result;
  }

  /** 把 message.images（OpenRouter/网关出图格式）转成 markdown 图片 */
  private convertImagesToMarkdown(images: any[]): string | null {
    if (!images || !Array.isArray(images) || !images.length) return null;
    const parts: string[] = [];
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const url = img?.image_url?.url || img?.url || img?.b64_json;
      if (url) {
        const dataUrl = url.startsWith("data:") ? url : (url.startsWith("http") ? url : `data:image/png;base64,${url}`);
        parts.push(`![image ${i + 1}](${dataUrl})`);
      }
    }
    return parts.length ? "\n\n" + parts.join("\n\n") + "\n\n" : null;
  }

  private extractTextContent(content: any): string | null {
    if (!content) return null;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const part of content) {
        if (part.type === "text" && part.text) parts.push(part.text);
        else if (part.type === "image_url" && part.image_url?.url) parts.push(`\n\n![image](${part.image_url.url})\n\n`);
      }
      return parts.length ? parts.join("") : null;
    }
    return String(content);
  }

  private handleError(error: any, isStream: boolean): never {
    this.logger.error(`LLM API error (${isStream ? "stream" : "non-stream"}): ${error?.message}`);
    if (error instanceof APIError) {
      throw new Error(`LLM API Error: ${error.status} - ${error.message}`);
    }
    if (error.name === "AbortError") throw new Error("LLM request aborted");
    throw error;
  }
}
