import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { GroupCompareItem } from '../../types';

export default function GroupCompare({ data }: { data: GroupCompareItem[] }) {
  if (!data.length) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-500">暂无分组数据</div>;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 10, right: 12, left: -16, bottom: 0 }} barGap={4}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#5F696E' }} tickLine={false} axisLine={false} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#5F696E' }} tickLine={false} axisLine={false} />
        <Tooltip
          cursor={{ fill: 'rgba(37,99,235,0.06)' }}
          contentStyle={{ borderRadius: 12, border: '1px solid #eef2f7', boxShadow: '0 8px 30px rgba(31,41,55,0.08)' }}
          labelStyle={{ color: '#1F2937', fontWeight: 600 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="peer" name="小组讨论" fill="#2563EB" radius={[4, 4, 0, 0]} />
        <Bar dataKey="ai" name="AI 讨论" fill="#7C3AED" radius={[4, 4, 0, 0]} />
        <Bar dataKey="active" name="活跃人数" fill="#1C7977" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
