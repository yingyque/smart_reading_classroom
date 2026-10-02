import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpenText,
  LogOut,
  Plus,
  Upload,
  Users,
  BarChart3,
  Loader2,
  FileText,
  Copy,
  Check,
  Shuffle,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Classroom, DocumentLite, Group } from '../types';

export default function TeacherDashboard() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [active, setActive] = useState<Classroom | null>(null);
  const [documents, setDocuments] = useState<DocumentLite[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupCount, setGroupCount] = useState(4);
  const [newName, setNewName] = useState('');
  const [copied, setCopied] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [grouping, setGrouping] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadClassrooms = async () => {
    const res = await api.get('/classrooms/mine');
    setClassrooms(res.data);
    if (!active && res.data.length) selectClass(res.data[0]);
  };

  useEffect(() => {
    loadClassrooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectClass = async (c: Classroom) => {
    setActive(c);
    const [docRes, detailRes] = await Promise.all([
      api.get(`/documents/${c.id}`),
      api.get(`/classrooms/${c.id}`),
    ]);
    setDocuments(docRes.data);
    setGroups(detailRes.data.groups || []);
    setGroupCount(c.groupCount || 4);
  };

  const createClass = async () => {
    if (!newName.trim()) return;
    const res = await api.post('/classrooms', { name: newName.trim() });
    setNewName('');
    await loadClassrooms();
    selectClass(res.data);
  };

  const upload = async (file: File) => {
    if (!active) return;
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    try {
      await api.post(`/documents/${active.id}/upload`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const res = await api.get(`/documents/${active.id}`);
      setDocuments(res.data);
    } catch (err: any) {
      console.error('上传失败', err);
      alert(err.response?.data?.error || '上传失败');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const doGrouping = async () => {
    if (!active) return;
    setGrouping(true);
    try {
      const res = await api.post(`/classrooms/${active.id}/group`, { groupCount });
      setGroups(res.data);
    } catch (err: any) {
      console.error('分组失败', err);
      alert(err.response?.data?.error || '分组失败');
    } finally {
      setGrouping(false);
    }
  };

  const copyCode = () => {
    if (!active) return;
    navigator.clipboard.writeText(active.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const totalStudents = groups.reduce((s, g) => s + g.members.length, 0);

  return (
    <div className="min-h-screen bg-[#f7f8fa]">
      <nav className="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between border-b border-ink-900/5 bg-white/80 px-6 backdrop-blur-md">
        <div className="flex items-center gap-2 font-bold text-ink-900">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-500 text-white">
            <BookOpenText size={18} />
          </div>
          智慧阅读 · 教师端
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-ink-500">{user?.name} · 教师</span>
          <button onClick={logout} className="flex items-center gap-1 text-sm text-ink-500 hover:text-red-600">
            <LogOut size={16} /> 退出
          </button>
        </div>
      </nav>

      <div className="mx-auto grid max-w-7xl grid-cols-12 gap-6 px-4 pt-24">
        {/* 侧栏：课堂列表 */}
        <aside className="col-span-3">
          <div className="rounded-2xl border border-ink-900/5 bg-white p-4 shadow-soft">
            <div className="mb-3 flex items-center gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createClass()}
                placeholder="新建课堂名称"
                className="min-w-0 flex-1 rounded-lg border border-ink-900/10 px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
              <button
                onClick={createClass}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-white hover:bg-brand-600"
              >
                <Plus size={18} />
              </button>
            </div>
            <div className="space-y-1">
              {classrooms.map((c) => (
                <button
                  key={c.id}
                  onClick={() => selectClass(c)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-all ${
                    active?.id === c.id ? 'bg-brand-50 font-semibold text-brand-600' : 'text-ink-900 hover:bg-ink-900/5'
                  }`}
                >
                  <span className="truncate">{c.name}</span>
                  <span className="ml-2 shrink-0 text-xs text-ink-500">{c.code}</span>
                </button>
              ))}
              {!classrooms.length && <p className="px-2 py-4 text-center text-sm text-ink-500">还没有课堂，先新建一个</p>}
            </div>
          </div>
        </aside>

        {/* 主区 */}
        <main className="col-span-9 space-y-6 pb-10">
          {!active ? (
            <div className="rounded-2xl border border-ink-900/5 bg-white p-12 text-center text-ink-500 shadow-soft">
              请在左侧创建或选择一个课堂
            </div>
          ) : (
            <>
              {/* 课堂头部 */}
              <div className="flex items-center justify-between rounded-2xl border border-ink-900/5 bg-white p-6 shadow-soft">
                <div>
                  <h1 className="text-2xl font-bold text-ink-900">{active.name}</h1>
                  <div className="mt-2 flex items-center gap-3 text-sm text-ink-500">
                    <span>课堂码</span>
                    <button
                      onClick={copyCode}
                      className="flex items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-1 font-mono text-base font-bold tracking-widest text-brand-600 hover:bg-brand-100"
                    >
                      {active.code}
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    <span>· {totalStudents} 名学生 · {groups.length} 组</span>
                  </div>
                </div>
                <button
                  onClick={() => navigate(`/teacher/${active.id}/analytics`)}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-violet-500 px-5 py-3 font-semibold text-white shadow-glass transition-all hover:shadow-lg active:scale-95"
                >
                  <BarChart3 size={18} /> 分析看板
                </button>
              </div>

              {/* 文献管理 */}
              <section className="rounded-2xl border border-ink-900/5 bg-white p-6 shadow-soft">
                <h2 className="mb-4 flex items-center gap-2 font-semibold text-ink-900">
                  <FileText size={18} className="text-brand-500" /> 文献管理
                </h2>
                <div
                  onClick={() => fileRef.current?.click()}
                  className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-brand-500/30 bg-brand-50/40 py-8 transition-all hover:border-brand-500 hover:bg-brand-50"
                >
                  {uploading ? (
                    <Loader2 size={28} className="animate-spin text-brand-500" />
                  ) : (
                    <Upload size={28} className="text-brand-500" />
                  )}
                  <p className="mt-2 text-sm font-medium text-ink-900">点击上传文献</p>
                  <p className="text-xs text-ink-500">支持 PDF、Word (.docx)、纯文本 (.txt)</p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf,.docx,.txt"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
                  />
                </div>
                <div className="mt-4 space-y-2">
                  {documents.map((d) => (
                    <div key={d.id} className="flex items-center justify-between rounded-lg border border-ink-900/5 px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <span className="rounded bg-brand-50 px-2 py-0.5 text-xs font-semibold uppercase text-brand-600">
                          {d.fileType}
                        </span>
                        <span className="text-sm text-ink-900">{d.title}</span>
                      </div>
                      <span className="text-xs text-ink-500">{new Date(d.createdAt).toLocaleString('zh-CN')}</span>
                    </div>
                  ))}
                  {!documents.length && <p className="py-3 text-center text-sm text-ink-500">还没有上传文献</p>}
                </div>
              </section>

              {/* 随机分组 */}
              <section className="rounded-2xl border border-ink-900/5 bg-white p-6 shadow-soft">
                <h2 className="mb-4 flex items-center gap-2 font-semibold text-ink-900">
                  <Users size={18} className="text-teal-500" /> 随机分组
                </h2>
                <div className="flex items-center gap-3">
                  <label className="text-sm text-ink-500">分组数量</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={groupCount}
                    onChange={(e) => setGroupCount(Number(e.target.value))}
                    className="w-24 rounded-lg border border-ink-900/10 px-3 py-2 text-center text-sm outline-none focus:border-brand-500"
                  />
                  <button
                    onClick={doGrouping}
                    disabled={grouping}
                    className="flex items-center gap-2 rounded-xl bg-teal-500 px-5 py-2 font-semibold text-white transition-all hover:brightness-110 active:scale-95 disabled:opacity-70"
                  >
                    {grouping ? <Loader2 size={16} className="animate-spin" /> : <Shuffle size={16} />}
                    一键随机分组
                  </button>
                  <span className="text-xs text-ink-500">系统会把已加入课堂的学生随机均衡分配到各组</span>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-3">
                  {groups.map((g) => (
                    <div key={g.id} className="rounded-xl border border-ink-900/5 bg-[#f7f8fa] p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-semibold text-ink-900">{g.name}</span>
                        <span className="text-xs text-ink-500">{g.members.length} 人</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {g.members.map((m) => (
                          <span key={m.userId} className="rounded bg-white px-2 py-0.5 text-xs text-ink-900 shadow-sm">
                            {m.user.name}
                          </span>
                        ))}
                        {!g.members.length && <span className="text-xs text-ink-500">暂无成员</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
