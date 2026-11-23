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
  MessageCircleQuestion,
  MessagesSquare,
  Download,
  X,
  FileText,
  NotebookPen,
} from 'lucide-react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useAuth } from '../context/AuthContext';
import { csvCell, localDateStr, saveCsv } from '../lib/csv';
import { AnalyticsResult, InteractionLogItem, QuestionLogItem, NoteLogItem } from '../types';
import WordCloudPanel from '../components/charts/WordCloudPanel';
import ActivityTimeline from '../components/charts/ActivityTimeline';
import GroupCompare from '../components/charts/GroupCompare';
import InteractionNetwork from '../components/charts/InteractionNetwork';
import MarkdownContent from '../components/MarkdownContent';

// 前端导出记录为 CSV
// replyHeader 存在时额外导出配对的 AI 回答列（仅提问记录使用）
function downloadRecordsCsv(
  filename: string,
  rows: (QuestionLogItem | InteractionLogItem)[],
  contentHeader: string,
  replyHeader?: string,
) {
  const header = ['时间', '学生', '小组', '文献', contentHeader];
  if (replyHeader) header.push(replyHeader);
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) {
    const cells = [
      new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false }),
      r.senderName,
      r.groupName,
      r.documentTitle ?? '',
      r.content,
    ];
    if (replyHeader) cells.push('aiReply' in r ? r.aiReply ?? '' : '');
    lines.push(cells.map(csvCell).join(','));
  }
  saveCsv(filename, lines);
}

// 导出学生学习笔记：时间戳 + 内容（高亮笔记含原文/页码/颜色），按创建时间升序
function downloadNotesCsv(filename: string, rows: NoteLogItem[]) {
  const header = ['创建时间', '更新时间', '学生', '文献', '类型', '高亮原文', '页码', '颜色', '笔记内容'];
  const lines = [header.map(csvCell).join(',')];
  for (const n of [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    lines.push(
      [
        new Date(n.createdAt).toLocaleString('zh-CN', { hour12: false }),
        new Date(n.updatedAt).toLocaleString('zh-CN', { hour12: false }),
        n.studentName,
        n.documentTitle ?? '',
        n.kind === 'highlight' ? '文献高亮' : '普通笔记',
        n.quote ?? '',
        n.page != null ? String(n.page) : '',
        n.color ?? '',
        n.content ?? '',
      ].map(csvCell).join(','),
    );
  }
  saveCsv(filename, lines);
}

export default function Analytics() {
  const { classroomId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState<AnalyticsResult | null>(null);
  const [notes, setNotes] = useState<NoteLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // 当前在弹窗中查看详情的提问记录
  const [selectedQuestion, setSelectedQuestion] = useState<QuestionLogItem | null>(null);
  // 当前在弹窗中查看笔记的学生
  const [selectedNoteStudent, setSelectedNoteStudent] = useState<{ userId: string; name: string } | null>(null);
  const socket = useMemo(() => getSocket(), []);

  // 学生笔记汇总：按学生聚合（笔记数 / 最近更新）
  const noteSummary = useMemo(() => {
    const map = new Map<string, { userId: string; studentName: string; count: number; last: string }>();
    for (const n of notes) {
      const cur = map.get(n.userId) ?? { userId: n.userId, studentName: n.studentName, count: 0, last: n.updatedAt };
      cur.count += 1;
      if (n.updatedAt > cur.last) cur.last = n.updatedAt;
      map.set(n.userId, cur);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [notes]);

  const load = async (silent = false) => {
    if (!classroomId) return;
    if (silent) setRefreshing(true);
    try {
      const [res, notesRes] = await Promise.all([
        api.get(`/analytics/${classroomId}`),
        // 学生学习笔记（仅教师可见，独立于 analytics 主接口）
        api.get(`/notes/${classroomId}`).catch(() => ({ data: [] })),
      ]);
      setData(res.data);
      setNotes(notesRes.data);
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
  // 断线重连后需重新 teacher:watch（服务端房间随旧连接丢失）
  useEffect(() => {
    if (!classroomId || user?.role !== 'TEACHER') return;
    const onConnect = () => socket.emit('teacher:watch', { classroomId });
    socket.on('connect', onConnect);
    if (socket.connected) onConnect();
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
      socket.off('connect', onConnect);
      socket.off('message:new', onNew);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId, user, socket]);

  // Esc 关闭问答详情弹窗
  useEffect(() => {
    if (!selectedQuestion && !selectedNoteStudent) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedQuestion(null);
        setSelectedNoteStudent(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedQuestion, selectedNoteStudent]);

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

          {/* 学生提问记录 */}
          <ChartCard
            title={`学生提问记录（${data?.questions.length ?? 0} 条）`}
            icon={<MessageCircleQuestion size={16} />}
            className="lg:col-span-2"
            action={
              <button
                onClick={() => downloadRecordsCsv(`学生提问记录_${localDateStr()}.csv`, data?.questions ?? [], '提问内容', 'AI 回答')}
                disabled={!(data?.questions ?? []).length}
                className="flex items-center gap-1.5 rounded-lg border border-ink-900/10 px-2.5 py-1 text-xs text-ink-500 transition-colors hover:border-brand-500 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Download size={13} /> 下载 CSV
              </button>
            }
          >
            <p className="mb-2 text-xs text-ink-500">点击任意一条可查看完整问答（含 AI 回答）</p>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white text-left text-xs text-ink-500">
                  <tr className="border-b border-ink-900/5">
                    <th className="px-3 py-2 font-medium">时间</th>
                    <th className="px-3 py-2 font-medium">学生</th>
                    <th className="px-3 py-2 font-medium">小组</th>
                    <th className="px-3 py-2 font-medium">文献</th>
                    <th className="px-3 py-2 font-medium">提问内容</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.questions ?? []).map((q) => (
                    <tr
                      key={q.id}
                      onClick={() => setSelectedQuestion(q)}
                      title="点击查看完整问答"
                      className="cursor-pointer border-b border-ink-900/5 last:border-0 hover:bg-brand-500/[0.04]"
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-500">
                        {new Date(q.createdAt).toLocaleString('zh-CN', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-ink-900">{q.senderName}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-ink-500">{q.groupName}</td>
                      <td className="max-w-40 truncate px-3 py-2 text-ink-500" title={q.documentTitle ?? ''}>
                        {q.documentTitle ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-ink-900">
                        <span className="line-clamp-3 whitespace-pre-wrap break-all">{q.content}</span>
                      </td>
                    </tr>
                  ))}
                  {!(data?.questions ?? []).length && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-ink-500">
                        暂无学生提问记录
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </ChartCard>

          {/* 学生学习笔记 */}
          <ChartCard
            title={`学生学习笔记（${notes.length} 条）`}
            icon={<NotebookPen size={16} />}
            className="lg:col-span-2"
            action={
              <button
                onClick={() => downloadNotesCsv(`学生学习笔记_${localDateStr()}.csv`, notes)}
                disabled={!notes.length}
                className="flex items-center gap-1.5 rounded-lg border border-ink-900/10 px-2.5 py-1 text-xs text-ink-500 transition-colors hover:border-brand-500 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Download size={13} /> 下载 CSV
              </button>
            }
          >
            <p className="mb-2 text-xs text-ink-500">仅学生本人和老师可见；点击学生行查看该生的全部笔记</p>
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white text-left text-xs text-ink-500">
                  <tr className="border-b border-ink-900/5">
                    <th className="px-3 py-2 font-medium">学生</th>
                    <th className="px-3 py-2 font-medium text-right">笔记数</th>
                    <th className="px-3 py-2 font-medium">最近更新</th>
                  </tr>
                </thead>
                <tbody>
                  {noteSummary.map((s) => (
                    <tr
                      key={s.userId}
                      onClick={() => setSelectedNoteStudent({ userId: s.userId, name: s.studentName })}
                      title="点击查看该生全部笔记"
                      className="cursor-pointer border-b border-ink-900/5 last:border-0 hover:bg-amber-500/[0.04]"
                    >
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-ink-900">{s.studentName}</td>
                      <td className="px-3 py-2 text-right text-amber-600">{s.count}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-500">
                        {new Date(s.last).toLocaleString('zh-CN', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                    </tr>
                  ))}
                  {!noteSummary.length && (
                    <tr>
                      <td colSpan={3} className="px-3 py-8 text-center text-ink-500">
                        暂无学生笔记
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </ChartCard>

          {/* 小组互动记录 */}
          <ChartCard
            title={`小组互动记录（${data?.interactions.length ?? 0} 条）`}
            icon={<MessagesSquare size={16} />}
            className="lg:col-span-2"
            action={
              <button
                onClick={() => downloadRecordsCsv(`小组互动记录_${localDateStr()}.csv`, data?.interactions ?? [], '发言内容')}
                disabled={!(data?.interactions ?? []).length}
                className="flex items-center gap-1.5 rounded-lg border border-ink-900/10 px-2.5 py-1 text-xs text-ink-500 transition-colors hover:border-brand-500 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Download size={13} /> 下载 CSV
              </button>
            }
          >
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white text-left text-xs text-ink-500">
                  <tr className="border-b border-ink-900/5">
                    <th className="px-3 py-2 font-medium">时间</th>
                    <th className="px-3 py-2 font-medium">学生</th>
                    <th className="px-3 py-2 font-medium">小组</th>
                    <th className="px-3 py-2 font-medium">文献</th>
                    <th className="px-3 py-2 font-medium">发言内容</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.interactions ?? []).map((q) => (
                    <tr key={q.id} className="border-b border-ink-900/5 last:border-0 hover:bg-ink-900/[0.02]">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-500">
                        {new Date(q.createdAt).toLocaleString('zh-CN', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-ink-900">{q.senderName}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-ink-500">{q.groupName}</td>
                      <td className="max-w-40 truncate px-3 py-2 text-ink-500" title={q.documentTitle ?? ''}>
                        {q.documentTitle ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-ink-900">
                        <span className="line-clamp-3 whitespace-pre-wrap break-all">{q.content}</span>
                      </td>
                    </tr>
                  ))}
                  {!(data?.interactions ?? []).length && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-ink-500">
                        暂无小组互动记录
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
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

      {/* 问答详情弹窗：完整提问 + AI 回答 */}
      {selectedQuestion && <QuestionDetailModal question={selectedQuestion} onClose={() => setSelectedQuestion(null)} />}

      {/* 学生笔记弹窗：该生的全部笔记时间线 */}
      {selectedNoteStudent && (
        <StudentNotesModal
          studentName={selectedNoteStudent.name}
          notes={notes.filter((n) => n.userId === selectedNoteStudent.userId)}
          onClose={() => setSelectedNoteStudent(null)}
        />
      )}
    </div>
  );
}

// 学生笔记弹窗：该生的全部笔记时间线（点击遮罩或按 Esc 关闭）
function StudentNotesModal({
  studentName,
  notes,
  onClose,
}: {
  studentName: string;
  notes: NoteLogItem[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部：学生信息 + 下载 + 关闭按钮 */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 font-semibold text-ink-900">
              <NotebookPen size={16} className="text-amber-500" />
              {studentName} 的学习笔记
            </div>
            <div className="mt-0.5 text-xs text-ink-500">共 {notes.length} 条</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => downloadNotesCsv(`${studentName}的学习笔记_${localDateStr()}.csv`, notes)}
              disabled={!notes.length}
              title="下载该生笔记（含时间戳与内容）"
              className="flex items-center gap-1.5 rounded-lg border border-ink-900/10 px-2.5 py-1.5 text-xs text-ink-500 transition-colors hover:border-brand-500 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download size={13} /> 下载 CSV
            </button>
            <button
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-900/5"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {notes.map((n) => (
            <div key={n.id} className="rounded-xl border border-ink-900/5 bg-[#f7f8fa] px-4 py-3">
              <div className="mb-1.5 flex items-center gap-2 text-xs text-ink-500">
                <span className="flex min-w-0 items-center gap-1.5">
                  <FileText size={12} className="shrink-0 text-brand-500" />
                  <span className="truncate">{n.documentTitle ?? '未关联文献'}</span>
                </span>
                <span className="shrink-0">
                  {new Date(n.updatedAt).toLocaleString('zh-CN', { hour12: false })}
                  {n.updatedAt !== n.createdAt && <span className="ml-1 italic">已编辑</span>}
                </span>
              </div>
              {n.kind === 'highlight' && (
                <blockquote
                  className={`mb-1.5 rounded-r-lg border-l-4 px-2.5 py-1.5 text-sm leading-relaxed ${
                    n.color === 'blue'
                      ? 'border-blue-400 bg-blue-50 text-blue-900'
                      : n.color === 'green'
                        ? 'border-emerald-400 bg-emerald-50 text-emerald-900'
                        : 'border-amber-400 bg-amber-50 text-amber-900'
                  }`}
                >
                  {n.quote}
                  {n.page != null && (
                    <span className="ml-1.5 whitespace-nowrap text-[11px] font-normal opacity-70">
                      （第 {n.page} 页）
                    </span>
                  )}
                </blockquote>
              )}
              {n.content ? (
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-900">{n.content}</p>
              ) : n.kind === 'highlight' ? (
                <p className="text-xs italic text-ink-400">（未补充评论）</p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 问答详情弹窗：点击遮罩或按 Esc 关闭
function QuestionDetailModal({ question, onClose }: { question: QuestionLogItem; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部：学生信息 + 关闭按钮 */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 font-semibold text-ink-900">
              {question.senderName}
              <span className="text-sm font-normal text-ink-500">{question.groupName}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-3 text-xs text-ink-500">
              <span>{new Date(question.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
              {question.documentTitle && (
                <span className="flex items-center gap-1">
                  <FileText size={12} />
                  {question.documentTitle}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-900/5"
          >
            <X size={18} />
          </button>
        </div>

        {/* 学生提问 */}
        <div className="rounded-xl bg-brand-500/[0.06] px-4 py-3 text-sm leading-relaxed text-ink-900 whitespace-pre-wrap break-all">
          {question.content}
        </div>

        {/* AI 回答 */}
        <div className="mt-3 rounded-xl bg-violet-500/[0.08] px-4 py-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-violet-500">
            <Bot size={14} /> AI 回答
          </div>
          {question.aiReply ? (
            <div className="text-sm leading-relaxed text-ink-900">
              <MarkdownContent content={question.aiReply} />
            </div>
          ) : (
            <p className="text-sm text-ink-500">该提问未收到 AI 回复（可能超时或调用失败）</p>
          )}
        </div>
      </div>
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
  action,
  children,
  className = '',
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-ink-900/5 bg-white p-5 shadow-soft ${className}`}>
      <h3 className="mb-4 flex items-center justify-between gap-2 font-semibold text-ink-900">
        <span className="flex items-center gap-2">
          <span className="text-brand-500">{icon}</span>
          {title}
        </span>
        {action}
      </h3>
      {children}
    </div>
  );
}
