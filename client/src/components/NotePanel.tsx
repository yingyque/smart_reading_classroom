import { useEffect, useRef, useState } from 'react';
import { NotebookPen, FileText, Pencil, Trash2, Loader2, X, Check, Users, Download } from 'lucide-react';
import { api } from '../lib/api';
import { NoteItem, DocumentLite } from '../types';
import { cn } from '../lib/cn';
import { csvCell, saveCsv } from '../lib/csv';

interface Props {
  classroomId: string;
  /** 当前正在阅读的文献（写笔记时自动关联） */
  documentId: string | null;
  documents: DocumentLite[];
  /** 外部笔记变化（如阅读器新增高亮）时递增，触发重新加载 */
  refreshKey?: number;
  /** 本面板增删改笔记后通知外部（阅读器高亮同步刷新） */
  onNotesChanged?: () => void;
}

// 高亮颜色 → 引用块样式（左边框 + 底色）
const HL_QUOTE_STYLE: Record<string, string> = {
  blue: 'border-blue-400 bg-blue-50 text-blue-900',
  green: 'border-emerald-400 bg-emerald-50 text-emerald-900',
  yellow: 'border-amber-400 bg-amber-50 text-amber-900',
};

// 学生学习笔记面板：本人笔记可编辑，同小组组员笔记只读互见
export default function NotePanel({ classroomId, documentId, documents, refreshKey, onNotesChanged }: Props) {
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editInput, setEditInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeTitle = documents.find((d) => d.id === documentId)?.title;

  const load = () => {
    setLoading(true);
    api
      .get(`/notes/${classroomId}/mine`)
      .then((res) => setNotes(res.data))
      .catch((err) => console.error('加载笔记失败', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId, refreshKey]);

  // 自动滚底
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [notes]);

  const add = async () => {
    const content = input.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      await api.post(`/notes/${classroomId}`, { content, documentId: documentId ?? undefined });
      setInput('');
      load();
      onNotesChanged?.();
    } catch (err: any) {
      console.error('保存笔记失败', err);
      alert(err.response?.data?.error || '保存笔记失败');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (n: NoteItem) => {
    setEditingId(n.id);
    setEditInput(n.content);
  };

  const saveEdit = async () => {
    if (!editingId || busy) return;
    const content = editInput.trim();
    // 普通笔记内容不能为空；高亮笔记的 content 是评论、允许清空
    const editing = notes.find((n) => n.id === editingId);
    if (editing?.kind !== 'highlight' && !content) return;
    setBusy(true);
    try {
      await api.put(`/notes/${classroomId}/${editingId}`, { content });
      setEditingId(null);
      load();
      onNotesChanged?.();
    } catch (err: any) {
      console.error('修改笔记失败', err);
      alert(err.response?.data?.error || '修改笔记失败');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (noteId: string) => {
    if (!confirm('删除这条笔记？')) return;
    try {
      await api.delete(`/notes/${classroomId}/${noteId}`);
      load();
      onNotesChanged?.();
    } catch (err: any) {
      console.error('删除笔记失败', err);
      alert(err.response?.data?.error || '删除笔记失败');
    }
  };

  // 下载本人的学习笔记 CSV（时间戳 + 内容，高亮含原文/页码/颜色），按创建时间升序
  const downloadMyNotes = () => {
    const mine = notes.filter((n) => n.mine !== false);
    if (!mine.length) return;
    const header = ['创建时间', '更新时间', '文献', '类型', '高亮原文', '页码', '颜色', '笔记内容'];
    const lines = [header.map(csvCell).join(',')];
    for (const n of [...mine].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      lines.push(
        [
          new Date(n.createdAt).toLocaleString('zh-CN', { hour12: false }),
          new Date(n.updatedAt).toLocaleString('zh-CN', { hour12: false }),
          n.documentTitle ?? '',
          n.kind === 'highlight' ? '文献高亮' : '普通笔记',
          n.quote ?? '',
          n.page != null ? String(n.page) : '',
          n.color ?? '',
          n.content ?? '',
        ].map(csvCell).join(','),
      );
    }
    saveCsv(`我的学习笔记_${new Date().toISOString().slice(0, 10)}.csv`, lines);
  };

  const myNoteCount = notes.filter((n) => n.mine !== false).length;

  return (
    <div className="flex h-full flex-col bg-white">
      {/* 顶部工具条：下载本人的笔记 */}
      <div className="flex shrink-0 items-center justify-end px-3 py-1.5">
        <button
          onClick={downloadMyNotes}
          disabled={!myNoteCount}
          title="导出我的全部笔记（含时间戳与内容）"
          className="flex items-center gap-1.5 rounded-lg border border-ink-900/10 px-2.5 py-1 text-xs text-ink-500 transition-colors hover:border-brand-500 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download size={13} /> 下载我的笔记 CSV
        </button>
      </div>
      {/* 笔记时间线 */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-auto p-4">
        {loading ? (
          <div className="flex h-full items-center justify-center text-ink-500">
            <Loader2 className="animate-spin" />
          </div>
        ) : notes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-ink-500">
            <NotebookPen size={32} className="mb-2 opacity-30" />
            阅读时随手记下你的想法…
          </div>
        ) : (
          notes.map((n) => {
            const isMine = n.mine !== false;
            return (
            <div
              key={n.id}
              className={cn(
                'group rounded-xl border px-3.5 py-2.5',
                isMine ? 'border-ink-900/5 bg-[#f7f8fa]' : 'border-brand-100 bg-brand-50/40',
              )}
            >
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-500">
                  {!isMine && n.studentName && (
                    <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-brand-100 px-1.5 py-0.5 font-medium text-brand-700">
                      <Users size={10} />
                      {n.studentName}
                    </span>
                  )}
                  <FileText size={12} className="shrink-0 text-brand-500" />
                  <span className="truncate">{n.documentTitle ?? '未关联文献'}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs text-ink-400">
                  {n.updatedAt !== n.createdAt && <span className="italic">已编辑</span>}
                  {new Date(n.updatedAt).toLocaleString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {isMine && editingId !== n.id && (
                    <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => startEdit(n)}
                        title="编辑"
                        className="rounded p-1 text-ink-400 hover:bg-ink-900/5 hover:text-ink-900"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => remove(n.id)}
                        title="删除"
                        className="rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-500"
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  )}
                </span>
              </div>
              {editingId === n.id ? (
                <div className="space-y-2">
                  {n.kind === 'highlight' && (
                    <blockquote
                      className={cn(
                      'rounded-r-lg border-l-4 px-2.5 py-1.5 text-sm',
                      HL_QUOTE_STYLE[n.color || 'yellow'] ?? HL_QUOTE_STYLE.yellow,
                    )}
                    >
                      {n.quote}
                    </blockquote>
                  )}
                  <textarea
                    value={editInput}
                    onChange={(e) => setEditInput(e.target.value)}
                    rows={3}
                    autoFocus
                    placeholder={n.kind === 'highlight' ? '补充评论（可留空）…' : undefined}
                    className="w-full resize-none rounded-lg border border-ink-900/10 bg-white px-2.5 py-2 text-sm text-ink-900 outline-none focus:border-brand-500"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setEditingId(null)}
                      className="flex items items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-ink-500 hover:bg-ink-900/5"
                    >
                      <X size={13} /> 取消
                    </button>
                    <button
                      onClick={saveEdit}
                      disabled={busy || (n.kind !== 'highlight' && !editInput.trim())}
                      className="flex items-center gap-1 rounded-lg bg-brand-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-40"
                    >
                      <Check size={13} /> 保存
                    </button>
                  </div>
                </div>
              ) : n.kind === 'highlight' ? (
                <div className="space-y-1.5">
                  <blockquote
                    className={cn(
                      'rounded-r-lg border-l-4 px-2.5 py-1.5 text-sm leading-relaxed',
                      HL_QUOTE_STYLE[n.color || 'yellow'] ?? HL_QUOTE_STYLE.yellow,
                    )}
                  >
                    {n.quote}
                    {n.page != null && (
                      <span className="ml-1.5 whitespace-nowrap text-[11px] font-normal opacity-70">
                        （第 {n.page} 页）
                      </span>
                    )}
                  </blockquote>
                  {n.content ? (
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-900">
                      {n.content}
                    </p>
                  ) : isMine ? (
                    <button
                      onClick={() => startEdit(n)}
                      className="text-xs text-ink-400 italic hover:text-brand-600"
                    >
                      点击补充评论…
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-900">
                  {n.content}
                </p>
              )}
            </div>
            );
          })
        )}
      </div>

      {/* 输入区 */}
      <div className="border-t border-ink-900/5 p-3">
        <div className="flex items-end gap-2 rounded-xl border border-ink-900/10 bg-[#f7f8fa] p-2 focus-within:border-amber-500">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={1}
            placeholder={activeTitle ? `记录关于《${activeTitle}》的想法…` : '记录你的想法…'}
            className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink-900 outline-none placeholder:text-ink-500/50"
          />
          <button
            onClick={add}
            disabled={!input.trim() || busy}
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white transition-all active:scale-90 disabled:opacity-40',
              'bg-amber-500 hover:bg-amber-600',
            )}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <NotebookPen size={16} />}
          </button>
        </div>
        {activeTitle && (
          <p className="mt-1.5 px-1 text-xs text-ink-400">
            将关联文献《{activeTitle}》
          </p>
        )}
      </div>
    </div>
  );
}
