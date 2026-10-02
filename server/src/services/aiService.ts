import OpenAI from 'openai';
import { config, isAiConfigured } from '../config/env';

const client = isAiConfigured()
  ? new OpenAI({
      baseURL: config.ai.baseURL,
      apiKey: config.ai.apiKey,
      timeout: config.ai.timeoutMs,
    })
  : null;

export interface AiContextMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiReplyResult {
  content: string;
  promptChars: number;
  replyChars: number;
}

// 基于文献上下文与最近对话生成 AI 回复
export async function generateAiReply(params: {
  documentTitle?: string;
  documentContent?: string;
  recentMessages: AiContextMessage[];
  userMessage: string;
}): Promise<AiReplyResult> {
  const { documentTitle, documentContent, recentMessages, userMessage } = params;

  if (!client) {
    return {
      content:
        '[AI 未配置] 请在 server/.env 中填写 AI_BASE_URL 与 AI_API_KEY 后重启服务，即可启用 AI 讨论。',
      promptChars: 0,
      replyChars: 0,
    };
  }

  // 截断过长文献，控制 token 用量
  const docSnippet = (documentContent ?? '').slice(0, config.ai.contextCharLimit);
  const systemPrompt = buildSystemPrompt(documentTitle, docSnippet);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...recentMessages.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const promptChars = systemPrompt.length + recentMessages.reduce((s, m) => s + m.content.length, 0) + userMessage.length;

  try {
    const completion = await client.chat.completions.create({
      model: config.ai.model,
      messages,
      temperature: 0.7,
    });
    const content = completion.choices[0]?.message?.content?.trim() || '（AI 未返回内容）';
    return { content, promptChars, replyChars: content.length };
  } catch (err) {
    const message = (err as Error).message || '未知错误';
    console.error('[aiService] AI 调用失败:', message);
    return {
      content: `抱歉，AI 暂时无法回复（${message}）。请稍后重试或联系教师检查 AI 配置。`,
      promptChars,
      replyChars: 0,
    };
  }
}

export function buildSystemPrompt(title: string | undefined, docSnippet: string): string {
  const base =
    '你是研究生课堂「智慧阅读」平台中的 AI 讨论助手。请基于学生正在阅读的文献，用严谨、启发式、简洁的中文与学生讨论，帮助他们深入理解文献、提出批判性问题，而不是直接给出结论性答案。';
  if (!docSnippet) return base;
  return `${base}\n\n当前文献标题：《${title ?? '未命名'}》\n文献内容节选（可能被截断）：\n"""\n${docSnippet}\n"""`;
}
