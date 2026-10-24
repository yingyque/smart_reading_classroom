import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: JSX.Element;
  label: string;
  value: number;
  tone: 'brand' | 'teal' | 'violet' | 'ink';
}) {
  const bg =
    tone === 'brand'
      ? 'bg-brand-500/10 text-brand-600'
      : tone === 'teal'
        ? 'bg-teal-500/10 text-teal-600'
        : tone === 'violet'
          ? 'bg-violet-500/10 text-violet-600'
          : 'bg-ink-900/5 text-ink-700';
  return (
    <div className="rounded-2xl border border-ink-900/5 bg-white p-5 shadow-soft">
      <div className={cn('mb-2 flex h-9 w-9 items-center justify-center rounded-xl', bg)}>{icon}</div>
      <div className="text-2xl font-bold text-ink-900">{value}</div>
      <div className="text-xs text-ink-500">{label}</div>
    </div>
  );
}

export function MiniStat({
  label,
  value,
  color,
  bg,
}: {
  label: string;
  value: number | string;
  color: string;
  bg: string;
}) {
  return (
    <div className={cn('rounded-xl p-3 text-center', bg)}>
      <div className={cn('text-2xl font-bold', color)}>{value}</div>
      <div className="text-xs text-ink-500">{label}</div>
    </div>
  );
}

export function StatusDot({ status }: { status: string }) {
  const color =
    status === 'RUNNING'
      ? 'bg-emerald-500'
      : status === 'PAUSED'
        ? 'bg-amber-400'
        : 'bg-ink-900/20';
  const label = status === 'RUNNING' ? '运行中' : status === 'PAUSED' ? '已暂停' : '待启动';
  return (
    <span className="flex items-center gap-1.5" title={label}>
      <span className={cn('h-2.5 w-2.5 rounded-full', color)} />
      <span className="text-xs text-ink-500">{label}</span>
    </span>
  );
}

// 详情面板里的小节容器
export function SectionCard({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: JSX.Element;
  action?: JSX.Element;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-ink-900/5 bg-white shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-900/5 px-5 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
          {icon} {title}
        </h3>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

// 详情基本信息里的键值对
export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-ink-500">{label}</div>
      <div className="text-sm font-medium text-ink-900">{value}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-ink-500">{children}</p>;
}

export function LinkButton({
  onClick,
  children,
  disabled,
}: {
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        // 列表整行也可点击，避免按钮点击冒泡触发两次下钻
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className="text-xs text-brand-600 hover:underline disabled:text-ink-500/50 disabled:no-underline"
    >
      {children}
    </button>
  );
}

export function Th({ children, center }: { children?: ReactNode; center?: boolean }) {
  return (
    <th className={cn('whitespace-nowrap px-4 py-3', center ? 'text-center' : 'text-left')}>{children}</th>
  );
}

export function Td({ children, center }: { children: ReactNode; center?: boolean }) {
  return <td className={cn('px-4 py-3', center && 'text-center')}>{children}</td>;
}
