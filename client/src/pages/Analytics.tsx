import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  MessageSquare,
  Bot,
  Users,
  UserCheck,
  Loader2,
  RefreshCw,
  Cloud,
  Activity,
  Share2,
  BarChart3,
  Trophy,
} from 'lucide-react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useAuth } from '../context/AuthContext';
import { AnalyticsResult } from '../types';
import WordCloudPanel from '../components/charts/WordCloudPanel';
import ActivityTimeline from '../components/charts/ActivityTimeline';
import GroupCompare from '../components/charts/GroupCompare';
import InteractionNetwork from '../components/charts/InteractionNetwork';

export default function Analytics() {
  const { classroomId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState<AnalyticsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const socket = useMemo(() => getSocket(), []);

  const load = async (silent = false) => {
    if (!classroomId) return;
    if (silent) setRefreshing(true);
    try {
      const res = await api.get(`/analytics/${classroomId}`);
      setData(res.data);
    } catch (err) {
      console.error('加载看板失败', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId]);

  // 教师加入全局监听，收到新消息时节流刷新看板
  useEffect(() => {
    if (!classroomId || user?.role !== 'TEACHER') return;
    socket.emit('teacher:watch', { classroomId });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onNew = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        load(true);
      }, 4000);
    };
    socket.on('message:new', onNew);
    return () => {
      socket.off('message:new', onNew);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId, user, socket]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-ink-500">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f8fa]">
      <nav className="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between border-b border-ink-900/5 bg-white/80 px-6 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-900/5"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2 font-bold text-ink-900">
            <BarChart3 size={18} className="text-brand-500" /> 对话数据分析看板
          </div>
        </div>
        <button
          onClick={() => load(true)}
          className="flex items-center gap-2 rounded-lg border border-ink-900/10 px-3 py-1.5 text-sm text-ink-500 hover:border-brand-500 hover:text-brand-600"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> 刷新
        </button>
      </nav>

      <main className="mx-auto max-w-7xl px-4 pb-10 pt-24">
        {/* 指标卡 */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard icon={<MessageSquare size={20} />} label="学生间聊天量" value={data?.peerMessageCount ?? 0} color="brand" />
          <MetricCard icon={<Bot size={20} />} label="AI 使用次数" value={data?.aiUsageCount ?? 0} color="violet" />
          <MetricCard icon={<Users size={20} />} label="活跃小组数" value={data?.activeGroupCount ?? 0} color="teal" />
          <MetricCard icon={<UserCheck size={20} />} label="参与人数" value={data?.participantCount ?? 0} color="green" />
        </div>

        {/* 图表网格 */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ChartCard title="讨论热词词云" icon={<Cloud size={16} />} className="lg:col-span-2">
            <div className="h-72">
              <WordCloudPanel words={data?.wordCloud ?? []} />
            </div>
          </ChartCard>

          <ChartCard title="活跃度时间线" icon={<Activity size={16} />}>
            <div className="h-64">
              <ActivityTimeline data={data?.timeline ?? []} />
            </div>
          </ChartCard>

          <ChartCard title="小组互动网络" icon={<Share2 size={16} />}>
            <div className="h-64">
              <InteractionNetwork network={data?.network ?? { nodes: [], links: [] }} />
            </div>
          </ChartCard>

          <ChartCard title="小组活跃度对比" icon={<BarChart3 size={16} />} className="lg:col-span-2">
            <div className="h-72">
              <GroupCompare data={data?.groupCompare ?? []} />
            </div>
          </ChartCard>

          {/* 个人画像 */}
          <ChartCard title="学生个人画像" icon={<Trophy size={16} />} className="lg:col-span-2">
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white text-left text-xs text-ink-500">
                  <tr className="border-b border-ink-900/5">
                    <th className="px-3 py-2 font-medium">排名</th>
                    <th className="px-3 py-2 font-medium">姓名</th>
                    <th className="px-3 py-2 font-medium">小组</th>
                    <th className="px-3 py-2 font-medium text-right">小组发言</th>
                    <th className="px-3 py-2 font-medium text-right">AI 提问</th>
                    <th className="px-3 py-2 font-medium text-right">总计</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.personalProfiles ?? []).map((p, i) => (
                    <tr key={p.userId} className="border-b border-ink-900/5 last:border-0 hover:bg-ink-900/[0.02]">
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                            i < 3 ? 'bg-amber-500/10 text-amber-600' : 'text-ink-500'
                          }`}
                        >
                          {i + 1}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-medium text-ink-900">{p.name}</td>
                      <td className="px-3 py-2 text-ink-500">{p.groupName}</td>
                      <td className="px-3 py-2 text-right text-brand-600">{p.peer}</td>
                      <td className="px-3 py-2 text-right text-violet-500">{p.ai}</td>
                      <td className="px-3 py-2 text-right font-semibold text-ink-900">{p.peer + p.ai}</td>
                    </tr>
                  ))}
                  {!(data?.personalProfiles ?? []).length && (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-ink-500">
                        暂无学生发言数据
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </div>
      </main>
    </div>
  );
}

const COLOR_MAP = {
  brand: 'from-brand-500 to-brand-600 text-brand-600 bg-brand-50',
  violet: 'from-violet-500 to-purple-600 text-violet-500 bg-violet-500/10',
  teal: 'from-teal-500 to-cyan-600 text-teal-500 bg-teal-500/10',
  green: 'from-emerald-500 to-green-600 text-emerald-600 bg-emerald-500/10',
};

function MetricCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: keyof typeof COLOR_MAP;
}) {
  const cls = COLOR_MAP[color];
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-ink-900/5 bg-white p-5 shadow-soft">
      <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${cls.split(' ').slice(2).join(' ')}`}>
        {icon}
      </div>
      <div>
        <p className="text-sm text-ink-500">{label}</p>
        <p className="text-2xl font-bold text-ink-900">{value}</p>
      </div>
    </div>
  );
}

function ChartCard({
  title,
  icon,
  children,
  className = '',
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-ink-900/5 bg-white p-5 shadow-soft ${className}`}>
      <h3 className="mb-4 flex items-center gap-2 font-semibold text-ink-900">
        <span className="text-brand-500">{icon}</span>
        {title}
      </h3>
      {children}
    </div>
  );
}
