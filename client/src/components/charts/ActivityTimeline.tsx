import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TimelineItem } from '../../types';

export default function ActivityTimeline({ data }: { data: TimelineItem[] }) {
  if (!data.length) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-500">暂无活跃数据</div>;
  }

  const formatted = data.map((d) => ({
    ...d,
    label: d.time.slice(5, 16), // MM-DD HH:00
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={formatted} margin={{ top: 10, right: 12, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="peerGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563EB" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="aiGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7C3AED" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#7C3AED" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#5F696E' }} tickLine={false} axisLine={false} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#5F696E' }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ borderRadius: 12, border: '1px solid #eef2f7', boxShadow: '0 8px 30px rgba(31,41,55,0.08)' }}
          labelStyle={{ color: '#1F2937', fontWeight: 600 }}
        />
        <Area type="monotone" dataKey="peer" name="小组讨论" stroke="#2563EB" strokeWidth={2} fill="url(#peerGrad)" />
        <Area type="monotone" dataKey="ai" name="AI 讨论" stroke="#7C3AED" strokeWidth={2} fill="url(#aiGrad)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
