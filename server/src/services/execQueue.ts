import { config } from '../config/env';

// 全局并发队列：限制同时执行的 codebuddy exec 数量（每个峰值 ~300MB），
// 超出的请求 FIFO 排队并回调队列位置，防止全班同时提问把内存打爆。
// 单实例部署，进程内实现即可。

// 排队等待超时：提示用户稍后再试，而不是无限挂住
export class QueueTimeoutError extends Error {
  constructor() {
    super('QUEUE_TIMEOUT');
    this.name = 'QueueTimeoutError';
  }
}

interface Waiter {
  onPosition: (pos: number) => void;
  timer: NodeJS.Timeout;
  resolve: (release: () => void) => void;
  reject: (err: Error) => void;
}

let running = 0;
const queue: Waiter[] = [];

function notifyPositions(): void {
  queue.forEach((w, i) => w.onPosition(i + 1));
}

function releaseSlot(): void {
  running -= 1;
  // FIFO：唤醒队首
  const next = queue.shift();
  if (next) {
    clearTimeout(next.timer);
    running += 1;
    next.onPosition(0);
    next.resolve(releaseSlot);
  }
}

// 获取一个执行坑位；onPosition(0) 表示已获得执行权，>0 为排队位次
function acquire(onPosition: (pos: number) => void): Promise<() => void> {
  return new Promise((resolve, reject) => {
    if (running < config.workspace.maxConcurrent) {
      running += 1;
      onPosition(0);
      resolve(releaseSlot);
      return;
    }
    const timer = setTimeout(() => {
      const idx = queue.indexOf(waiter);
      if (idx >= 0) queue.splice(idx, 1);
      reject(new QueueTimeoutError());
    }, config.workspace.queueWaitMs);
    const waiter: Waiter = { onPosition, timer, resolve, reject };
    queue.push(waiter);
    onPosition(queue.length);
  });
}

// 在并发坑位内执行 fn；排队期间通过 onPosition 反馈位次
export async function runWithSlot<T>(
  fn: () => Promise<T>,
  onPosition?: (pos: number) => void,
): Promise<T> {
  const notify = onPosition ?? (() => undefined);
  const release = await acquire(notify);
  try {
    return await fn();
  } finally {
    release();
  }
}

// 当前队列状态（观测用）
export function getStats(): { running: number; queued: number; maxConcurrent: number } {
  return { running, queued: queue.length, maxConcurrent: config.workspace.maxConcurrent };
}
