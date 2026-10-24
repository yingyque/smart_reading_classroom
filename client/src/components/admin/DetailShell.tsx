import { ChevronLeft, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DetailRef } from './types';

const KIND_LABEL: Record<DetailRef['kind'], string> = {
  teacher: '教师',
  student: '学生',
  classroom: '课堂',
};

// 详情面板外壳：返回上一层 + 面包屑 + 加载态
export function DetailShell({
  stack,
  loading,
  onBack,
  children,
}: {
  stack: DetailRef[];
  loading: boolean;
  onBack: () => void;
  children: ReactNode;
}) {
  const parent = stack[stack.length - 2];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1 rounded-xl border border-ink-900/10 bg-white px-3 py-1.5 text-sm text-ink-600 transition hover:border-brand-500 hover:text-brand-600"
        >
          <ChevronLeft size={15} />
          {parent ? `返回${KIND_LABEL[parent.kind]} · ${parent.label}` : '返回列表'}
        </button>
        <nav className="flex flex-wrap items-center gap-1 text-xs text-ink-500">
          {stack.map((s, i) => (
            <span key={`${s.kind}-${s.id}`}>
              {i > 0 && <span className="mx-1 text-ink-500/50">/</span>}
              <span className={i === stack.length - 1 ? 'font-medium text-ink-900' : ''}>
                {KIND_LABEL[s.kind]} · {s.label}
              </span>
            </span>
          ))}
        </nav>
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-ink-900/5 bg-white py-20 text-ink-500 shadow-soft">
          <Loader2 className="mr-2 animate-spin" size={18} /> 加载详情…
        </div>
      ) : (
        children
      )}
    </div>
  );
}
