import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
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
    '你是研究生课堂「智慧阅读」平台中的 AI 讨论助手。请基于学生正在阅读的文献，用严谨、启发式、简洁的中文与学生讨论，帮助他们深入理解文献、提出批判性问题，而不是直接给出结论性答案。'
    + '回复使用纯文字 Markdown（标题、段落、列表、代码块 ASCII 示意图均可），但不要生成或插入任何图片。';
  if (!docSnippet) return base;
  return `${base}\n\n当前文献标题：《${title ?? '未命名'}》\n文献内容节选（可能被截断）：\n"""\n${docSnippet}\n"""`;
}

// 聊天图片扩展名 → data URL mime（与 routes/chat.ts 的上传白名单一致）
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

// 用视觉模型把学生发送的聊天图片转成文字描述。
// 讨论走 CodeBuddy 容器，但上游网关拒绝 tool 结果里的图片块（400），
// 且讨论模型本身多不支持视觉，故图片由 server 端直接识别后以文字进入 prompt。
// 成功返回描述文本；失败（未配置 / 读文件 / 接口错误）返回 null，由调用方降级提示。
export async function describeChatImage(fileName: string): Promise<string | null> {
  if (!client) return null;
  const mime = IMAGE_MIME[path.extname(fileName).toLowerCase()];
  if (!mime) return null;

  let b64: string;
  try {
    b64 = fs.readFileSync(path.join(config.uploadDir, 'chat', fileName)).toString('base64');
  } catch (err) {
    console.error('[aiService] 读取聊天图片失败:', (err as Error).message);
    return null;
  }

  try {
    const completion = await client.chat.completions.create(
      {
        model: config.ai.visionModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
              {
                type: 'text',
                text: '请用中文详细描述这张图片的内容：包括图片类型（照片/截图/图表/文档扫描等）、主体内容、可见的文字要点、颜色与布局等关键信息，供后续讨论使用。直接输出描述，不要寒暄。',
              },
            ],
          },
        ],
      },
      // 大图识别较慢，单独放宽本次请求的超时（不影响 client 全局默认值）
      { timeout: 120000 },
    );
    const desc = completion.choices[0]?.message?.content?.trim();
    return desc || null;
  } catch (err) {
    console.error('[aiService] 图片识别失败:', (err as Error).message);
    return null;
  }
}
