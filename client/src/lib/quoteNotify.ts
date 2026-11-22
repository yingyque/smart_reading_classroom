import type { QuoteNotify } from '../types';

// 被引用通知的"待消费"存储：点击 Toast 跳转时写入，
// ReadingRoom 挂载后取走并定位到被引用消息（覆盖从其他页面跳转进来的场景）
let pending: QuoteNotify | null = null;

export function setPendingQuoteNotify(q: QuoteNotify): void {
  pending = q;
}

export function takePendingQuoteNotify(): QuoteNotify | null {
  const p = pending;
  pending = null;
  return p;
}
