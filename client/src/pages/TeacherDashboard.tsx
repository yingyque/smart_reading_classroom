import { useEffect, useRef, useState, type DragEvent } from 'react';
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
  Container,
  Pause,
  Play,
  Trash2,
  GripVertical,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Classroom, DocumentLite, Group } from '../types';

interface WorkspaceContainer {
  id: string;
  studentName: string;
  studentEmail: string;
  containerName: string;
  status: string;
  keyActivated: boolean;
  lastActiveAt: string;
  createdAt: string;
}

interface WorkspaceSummary {
  total: number;
  running: number;
  containers: WorkspaceContainer[];
}

export default function TeacherDashboard() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [active, setActive] = useState<Classroom | null>(null);
  const [documents, setDocuments] = useState<DocumentLite[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [unassigned, setUnassigned] = useState<{ id: string; name: string }[]>([]);
  const [groupCount, setGroupCount] = useState(4);
  const [dragging, setDragging] = useState<string | null>(null); // 拖拽中/已选中的学生 userId
  const [docDragId, setDocDragId] = useState<string | null>(null); // 拖拽排序中的文献 id
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary | null>(null);
  const [newName, setNewName] = useState('');
  const [copied, setCopied] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [grouping, setGrouping] = useState(false);
  const [wsBusy, setWsBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadClassrooms = async () => {
    try {
      const res = await api.get('/classrooms/mine');
      setClassrooms(res.data);
      if (!active && res.data.length) selectClass(res.data[0]);
    } catch (err: any) {
      console.error('课堂列表加载失败', err);
      alert(err.response?.data?.error || '课堂列表加载失败，请重新登录后再试');
    }
  };

  useEffect(() => {
    loadClassrooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectClass = async (c: Classroom) => {
    setActive(c);
    const [docRes, detailRes, wsRes] = await Promise.all([
      api.get(`/documents/${c.id}`),
      api.get(`/classrooms/${c.id}`),
      api.get(`/workspaces/${c.id}`).catch(() => null),
    ]);
    setDocuments(docRes.data);
    setGroups(detailRes.data.groups || []);
    setUnassigned(detailRes.data.unassigned || []);
    setGroupCount(c.groupCount || 4);
    setWorkspaces(wsRes?.data ?? null);
  };

  const refreshWorkspaces = async () => {
    if (!active) return;
    const res = await api.get(`/workspaces/${active.id}`).catch(() => null);
    setWorkspaces(res?.data ?? null);
  };

  const toggleWorkspace = async (c: WorkspaceContainer, pause: boolean) => {
    if (!active) return;
    setWsBusy(c.id);
    try {
      await api.post(`/workspaces/${active.id}/${c.id}/${pause ? 'pause' : 'resume'}`);
      await refreshWorkspaces();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      alert(`操作失败：${msg || '请稍后重试'}`);
    } finally {
      setWsBusy(null);
    }
  };

  const toggleAll = async (pause: boolean) => {
    if (!active) return;
    setWsBusy('all');
    try {
      await api.post(`/workspaces/${active.id}/pause-all`, { paused: pause });
      await refreshWorkspaces();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      alert(`操作失败：${msg || '请稍后重试'}`);
    } finally {
      setWsBusy(null);
    }
  };

  const createClass = async () => {
    if (!newName.trim()) {
      alert('请先填写课堂名称');
      return;
    }
    try {
      const res = await api.post('/classrooms', { name: newName.trim() });
      setNewName('');
      await loadClassrooms();
      selectClass(res.data);
    } catch (err: any) {
      console.error('创建课堂失败', err);
      alert(err.response?.data?.error || '创建课堂失败，请稍后重试');
    }
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

  const deleteDoc = async (docId: string) => {
    if (!active) return;
    if (!confirm('删除该文献？相关讨论消息会保留，但不再关联此文献。')) return;
    try {
      await api.delete(`/documents/doc/${docId}`);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    } catch (err: any) {
      console.error('删除文献失败', err);
      alert(err.response?.data?.error || '删除文献失败');
    }
  };

  // 拖拽排序：把 dragId 文献移动到 targetId 的位置（乐观更新，失败回滚）
  const reorderDocs = async (dragId: string, targetId: string) => {
    if (!active || dragId === targetId) return;
    const old = documents;
    const from = old.findIndex((d) => d.id === dragId);
    const to = old.findIndex((d) => d.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...old];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDocuments(next);
    try {
      await api.post(`/documents/${active.id}/reorder`, { orderedIds: next.map((d) => d.id) });
    } catch (err: any) {
      console.error('文献排序失败', err);
      setDocuments(old);
      alert(err.response?.data?.error || '文献排序失败');
    }
  };

  const doGrouping = async () => {
    if (!active) return;
    setGrouping(true);
    try {
      const res = await api.post(`/classrooms/${active.id}/group`, { groupCount });
      setGroups(res.data.groups);
      setUnassigned(res.data.unassigned);
    } catch (err: any) {
      console.error('分组失败', err);
      alert(err.response?.data?.error || '分组失败');
    } finally {
      setGrouping(false);
    }
  };

  const addGroup = async () => {
    if (!active) return;
    try {
      const res = await api.post(`/classrooms/${active.id}/groups`);
      setGroups(res.data.groups);
      setUnassigned(res.data.unassigned);
    } catch (err: any) {
      console.error('添加分组失败', err);
      alert(err.response?.data?.error || '添加分组失败');
    }
  };

  const deleteGroup = async (groupId: string) => {
    if (!active) return;
    if (!confirm('删除该分组？组内成员将回到未分组。')) return;
    try {
      const res = await api.delete(`/classrooms/${active.id}/groups/${groupId}`);
      setGroups(res.data.groups);
      setUnassigned(res.data.unassigned);
    } catch (err: any) {
      console.error('删除分组失败', err);
      alert(err.response?.data?.error || '删除分组失败');
    }
  };

  // 拖拽落点：toGroupId 为 null 表示移回未分组池
  const moveStudent = async (userId: string, toGroupId: string | null) => {
    if (!active) return;
    try {
      const res = await api.post(`/classrooms/${active.id}/groups/move`, { userId, toGroupId });
      setGroups(res.data.groups);
      setUnassigned(res.data.unassigned);
    } catch (err: any) {
      console.error('调整分组失败', err);
      alert(err.response?.data?.error || '调整分组失败');
    }
  };

  const onDropTo = (e: DragEvent, target: string | null) => {
    e.preventDefault();
    setDropTarget(null);
    const uid = e.dataTransfer.getData('text/plain');
    if (uid) moveStudent(uid, target);
  };

  // 点击兜底（触屏设备无法拖拽）：点击学生选中，再点击目标组/未分组池完成移动
  const selectStudent = (id: string) => {
    setDragging((prev) => (prev === id ? null : id));
  };

  const clickMoveTo = (target: string | null) => {
    if (!dragging) return;
    moveStudent(dragging, target);
    setDragging(null);
  };

  const copyCode = async () => {
    if (!active) return;
    const text = active.code;
    let ok = false;
    // 优先用原生剪贴板（需安全上下文，即 HTTPS 或 localhost）
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    // HTTP（非安全上下文）下走 execCommand 兜底：用屏幕外定位而非 opacity:0，后者在部分浏览器无法选中复制
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, text.length);
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else {
      alert('复制失败，请手动长按/选择课堂码复制');
    }
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
                    <div
                      key={d.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', d.id);
                        e.dataTransfer.effectAllowed = 'move';
                        setDocDragId(d.id);
                      }}
                      onDragEnd={() => setDocDragId(null)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const dragId = e.dataTransfer.getData('text/plain') || docDragId;
                        setDocDragId(null);
                        if (dragId) reorderDocs(dragId, d.id);
                      }}
                      className={`flex items-center justify-between rounded-lg border px-4 py-2.5 transition-all ${
                        docDragId === d.id
                          ? 'border-brand-500 bg-brand-50/50 opacity-50'
                          : docDragId
                            ? 'border-brand-500/40'
                            : 'border-ink-900/5'
                      } ${documents.length > 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        {documents.length > 1 && (
                          <GripVertical size={16} className="shrink-0 text-ink-400" />
                        )}
                        <span className="rounded bg-brand-50 px-2 py-0.5 text-xs font-semibold uppercase text-brand-600">
                          {d.fileType}
                        </span>
                        <span className="text-sm text-ink-900">{d.title}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-ink-500">{new Date(d.createdAt).toLocaleString('zh-CN')}</span>
                        <button
                          onClick={() => deleteDoc(d.id)}
                          title="删除文献"
                          className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-red-50 hover:text-red-500"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {!documents.length && <p className="py-3 text-center text-sm text-ink-500">还没有上传文献</p>}
                  {!!documents.length && documents.length > 1 && (
                    <p className="pt-1 text-center text-xs text-ink-400">按住文献行可拖动调整顺序，顺序即学生端展示顺序</p>
                  )}
                </div>
              </section>

              {/* 分组管理：随机分组 + 手动拖拽 */}
              <section className="rounded-2xl border border-ink-900/5 bg-white p-6 shadow-soft">
                <h2 className="mb-4 flex items-center gap-2 font-semibold text-ink-900">
                  <Users size={18} className="text-teal-500" /> 分组管理
                </h2>
                <div className="flex flex-wrap items-center gap-3">
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
                  <button
                    onClick={addGroup}
                    className="flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-2 font-semibold text-teal-700 transition-all hover:bg-teal-100 active:scale-95"
                  >
                    <Plus size={16} /> 添加分组
                  </button>
                  <span className="text-xs text-ink-500">随机分组会重新分配全部学生；调整分组：拖拽学生卡片，或先点击学生选中、再点击目标分组</span>
                </div>

                {/* 未分组学生池（可拖入下方任意组，也可点击选中后点目标组） */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDropTarget('pool');
                  }}
                  onDragLeave={() => setDropTarget((t) => (t === 'pool' ? null : t))}
                  onDrop={(e) => onDropTo(e, null)}
                  onClick={() => clickMoveTo(null)}
                  className={`mt-5 rounded-xl border-2 border-dashed p-4 transition-all ${
                    dropTarget === 'pool' || (dragging && !dropTarget)
                      ? 'border-brand-500 bg-brand-50/50'
                      : 'border-ink-900/10 bg-[#f7f8fa]'
                  } ${dragging ? 'cursor-pointer' : ''}`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold text-ink-900">未分组学生</span>
                    <span className="text-xs text-ink-500">{unassigned.length} 人 · 拖入或点选后移到下方分组</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {unassigned.map((s) => (
                      <StudentChip
                        key={s.id}
                        id={s.id}
                        name={s.name}
                        selected={dragging === s.id}
                        onDragStart={setDragging}
                        onDragEnd={() => setDragging(null)}
                        onSelect={selectStudent}
                      />
                    ))}
                    {!unassigned.length && <span className="text-xs text-ink-500">暂无未分组学生</span>}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
                  {groups.map((g) => (
                    <div
                      key={g.id}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDropTarget(g.id);
                      }}
                      onDragLeave={() => setDropTarget((t) => (t === g.id ? null : t))}
                      onDrop={(e) => onDropTo(e, g.id)}
                      onClick={() => clickMoveTo(g.id)}
                      className={`rounded-xl border p-4 transition-all ${
                        dropTarget === g.id || (dragging && !dropTarget)
                          ? 'border-brand-500 bg-brand-50/50 ring-2 ring-brand-500/20'
                          : 'border-ink-900/5 bg-[#f7f8fa]'
                      } ${dragging ? 'cursor-pointer' : ''}`}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-semibold text-ink-900">{g.name}</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-ink-500">{g.members.length} 人</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteGroup(g.id);
                            }}
                            title="删除分组"
                            className="rounded p-1 text-ink-400 transition-colors hover:bg-red-50 hover:text-red-500"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {g.members.map((m) => (
                          <StudentChip
                            key={m.userId}
                            id={m.userId}
                            name={m.user.name}
                            selected={dragging === m.userId}
                            onDragStart={setDragging}
                            onDragEnd={() => setDragging(null)}
                            onSelect={selectStudent}
                          />
                        ))}
                        {!g.members.length && <span className="text-xs text-ink-500">拖拽或点选学生移入此处</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* AI 工作台容器 */}
              <section className="rounded-2xl border border-ink-900/5 bg-white p-6 shadow-soft">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <h2 className="flex items-center gap-2 font-semibold text-ink-900">
                    <Container size={18} className="text-violet-500" /> AI 工作台容器
                  </h2>
                  {!!workspaces?.containers.length && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => toggleAll(false)}
                        disabled={wsBusy !== null}
                        className="flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                      >
                        <Play size={13} /> 全部开启
                      </button>
                      <button
                        onClick={() => toggleAll(true)}
                        disabled={wsBusy !== null}
                        className="flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
                      >
                        <Pause size={13} /> 全部暂停
                      </button>
                    </div>
                  )}
                </div>
                <p className="mb-4 text-xs text-ink-500">
                  每名学生加入课堂后自动创建专属 AI 容器（容器数 = 已加入学生数），AI Key 已由系统统一配置，学生无需自行输入。
                  容器启动后<strong className="text-ink-700">常驻运行、不会自动休眠</strong>，由你在此手动暂停或开启；暂停期间学生提问会收到提示。
                </p>
                <div className="mb-4 flex gap-3">
                  <div className="flex-1 rounded-xl bg-violet-500/5 p-3 text-center">
                    <div className="text-2xl font-bold text-violet-600">{workspaces?.total ?? 0}</div>
                    <div className="text-xs text-ink-500">容器总数（学生数）</div>
                  </div>
                  <div className="flex-1 rounded-xl bg-emerald-500/5 p-3 text-center">
                    <div className="text-2xl font-bold text-emerald-600">{workspaces?.running ?? 0}</div>
                    <div className="text-xs text-ink-500">运行中</div>
                  </div>
                  <div className="flex-1 rounded-xl bg-amber-500/5 p-3 text-center">
                    <div className="text-2xl font-bold text-amber-600">
                      {workspaces?.containers.filter((c) => c.keyActivated).length ?? 0}
                    </div>
                    <div className="text-xs text-ink-500">已激活 Key</div>
                  </div>
                </div>
                <div className="space-y-2">
                  {workspaces?.containers.map((c) => (
                    <div key={c.id} className="flex items-center justify-between rounded-lg border border-ink-900/5 px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <StatusDot status={c.status} />
                        <div>
                          <div className="text-sm font-medium text-ink-900">{c.studentName}</div>
                          <div className="font-mono text-xs text-ink-500">{c.containerName}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className={c.keyActivated ? 'text-emerald-600' : 'text-ink-500'}>
                          {c.keyActivated ? 'Key 已激活' : 'Key 未激活'}
                        </span>
                        <span className="hidden text-ink-500 sm:inline">
                          活跃于 {new Date(c.lastActiveAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {c.status === 'RUNNING' ? (
                          <button
                            onClick={() => toggleWorkspace(c, true)}
                            disabled={wsBusy !== null}
                            className="flex items-center gap-1 rounded-lg border border-amber-200 px-2.5 py-1 font-medium text-amber-700 transition hover:bg-amber-50 disabled:opacity-50"
                          >
                            {wsBusy === c.id ? <Loader2 size={13} className="animate-spin" /> : <Pause size={13} />} 暂停
                          </button>
                        ) : (
                          <button
                            onClick={() => toggleWorkspace(c, false)}
                            disabled={wsBusy !== null}
                            className="flex items-center gap-1 rounded-lg border border-emerald-200 px-2.5 py-1 font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
                          >
                            {wsBusy === c.id ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} 开启
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {workspaces && workspaces.containers.length === 0 && (
                    <p className="py-3 text-center text-sm text-ink-500">还没有学生加入课堂</p>
                  )}
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'RUNNING'
      ? 'bg-emerald-500'
      : status === 'PAUSED'
        ? 'bg-amber-400'
        : 'bg-ink-900/20';
  const label =
    status === 'RUNNING' ? '运行中' : status === 'PAUSED' ? '已暂停' : '待启动';
  return (
    <span className="flex items-center gap-1.5" title={label}>
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      <span className="text-xs text-ink-500">{label}</span>
    </span>
  );
}

// 学生卡片：桌面可拖拽（dataTransfer 携带 userId），触屏可点击选中后点目标组移动
function StudentChip({
  id,
  name,
  selected,
  onDragStart,
  onDragEnd,
  onSelect,
}: {
  id: string;
  name: string;
  selected: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <span
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(id);
      }}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(id);
      }}
      className={`cursor-grab select-none rounded px-2 py-0.5 text-xs shadow-sm transition-all hover:shadow active:cursor-grabbing ${
        selected
          ? 'bg-brand-50 ring-2 ring-brand-500 font-semibold text-brand-700'
          : 'bg-white text-ink-900'
      }`}
    >
      {name}
    </span>
  );
}
