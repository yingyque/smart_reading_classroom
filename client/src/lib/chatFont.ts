// 聊天窗文字大小偏好（localStorage 持久化 + 自定义事件广播）
// 三档：小 14px（原默认）/ 默认 17px / 大 20px，每档 +3px
export type ChatFontSize = 'small' | 'default' | 'large';

const KEY = 'chat-font-size';
const EVENT = 'chat-font-size-change';

export const CHAT_FONT_SIZES: { key: ChatFontSize; label: string; px: number }[] = [
  { key: 'small', label: '小', px: 14 },
  { key: 'default', label: '默认', px: 17 },
  { key: 'large', label: '大', px: 20 },
];

/** 当前档位（非法/未设置值一律回退「小」，保持老用户看到的原字号） */
export function getChatFontSize(): ChatFontSize {
  const v = localStorage.getItem(KEY);
  return v === 'default' || v === 'large' ? v : 'small';
}

export function setChatFontSize(size: ChatFontSize): void {
  localStorage.setItem(KEY, size);
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** 订阅档位变化（设置弹窗改完，聊天窗立即生效），返回取消函数 */
export function subscribeChatFontSize(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
