import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

// 轻量全局 Toast：任意组件经 showToast 触发，ToastHost 统一渲染（挂在 App 根部）
// 用途：消息被引用时提醒原作者等跨组件通知

export interface ToastOptions {
  text: string;
  detail?: string;
  onClick?: () => void;
  /** 自动消失时长，默认 6 秒 */
  durationMs?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
}

export function showToast(opts: ToastOptions): void {
  window.dispatchEvent(new CustomEvent('app:toast', { detail: opts }));
}

export default function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const opts = (e as CustomEvent<ToastOptions>).detail;
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-2), { ...opts, id }]);
      window.setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== id));
      }, opts.durationMs ?? 6000);
    };
    window.addEventListener('app:toast', onToast);
    return () => window.removeEventListener('app:toast', onToast);
  }, []);

  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));

  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => {
            t.onClick?.();
            dismiss(t.id);
          }}
          className="pointer-events-auto flex w-72 animate-fade-in-up items-start gap-2.5 rounded-xl border border-ink-900/10 bg-white px-3.5 py-2.5 shadow-lg"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink-900">{t.text}</p>
            {t.detail && <p className="mt-0.5 truncate text-xs text-ink-500">{t.detail}</p>}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              dismiss(t.id);
            }}
            title="关闭"
            className="mt-0.5 shrink-0 rounded p-0.5 text-ink-400 hover:bg-ink-900/5 hover:text-ink-900"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
