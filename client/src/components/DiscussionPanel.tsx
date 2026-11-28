import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { Send, Bot, Users, Loader2, Paperclip, FileText, X, Quote, Copy, Undo2 } from 'lucide-react';
import { Socket } from 'socket.io-client';
import { api, getToken } from '../lib/api';
import { API_PREFIX } from '../lib/config';
import { ChatMessage, MessageType, User } from '../types';
import { cn } from '../lib/cn';
import MarkdownContent from './MarkdownContent';

// 聊天附件访问地址（<img>/<a> 无法带 Authorization 头，走 ?token= 查询参数鉴权）
function chatFileUrl(fileName: string): string {
  return `${API_PREFIX}/chat/file/${fileName}?token=${encodeURIComponent(getToken() ?? '')}`;
}

// 附件是否为图片（决定气泡内缩略图 / 文件卡片两种展示）
function isImageFileName(name: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(name);
}

// 客户端允许上传的附件类型（与服务端白名单一致）
function isAllowedFileName(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|pdf|docx?|pptx?|xlsx?)$/i.test(name);
}

// 附件大小展示（KB / MB）
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// 撤回时限（与服务端一致，微信同款 2 分钟）
const RECALL_WINDOW_MS = 2 * 60 * 1000;

// 该消息当前是否可由我撤回（自己的小组消息、未撤回、2 分钟内）
function canRecallMsg(m: ChatMessage, meId: string): boolean {
  return (
    m.type === 'PEER' &&
    !m.isAiReply &&
    m.senderId === meId &&
    !m.recalledAt &&
    Date.now() - new Date(m.createdAt).getTime() < RECALL_WINDOW_MS
  );
}

// 复制文本到剪贴板：优先 Clipboard API，非安全上下文（http）降级为 execCommand
async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // 走降级路径
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

interface Props {
  socket: Socket;
  classroomId: string;
  groupId: string;
  documentId: string | null;
  me: User;
  /** 当前展示的消息类型，由 ReadingRoom 顶部三标签控制 */
  tab: MessageType;
  /** 被引用提醒跳转：需要定位到的消息 id */
  jumpToMessageId?: string | null;
  /** 定位完成后回调（清除外部状态） */
  onJumpDone?: () => void;
}

export default function DiscussionPanel({ socket, classroomId, groupId, documentId, me, tab, jumpToMessageId, onJumpDone }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [aiTyping, setAiTyping] = useState(false);
  // 排队位次（null = 不在排队）：全班并发高时 AI 请求进全局队列，显示位次
  const [queuePos, setQueuePos] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  // 待发送附件（fileName=服务端存储名，preview=图片的本地 blob 预览，origName/size=原始文件名与大小）
  const [pendingFile, setPendingFile] = useState<{
    fileName: string;
    preview: string | null;
    isImage: boolean;
    origName: string;
    size: number;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  // 拖拽附件悬停高亮
  const [dragOver, setDragOver] = useState(false);
  // 正在引用的消息（小组讨论：引用自己或组员说过的话）
  const [quoting, setQuoting] = useState<ChatMessage | null>(null);
  // 右键/双指点击消息弹出的操作菜单（Mac 双指点击与 Windows 右键均触发 contextmenu）
  // selectedText：打开菜单时若正选中该消息内的文字，记录选中内容（复制时只复制选中部分）
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; msg: ChatMessage; selectedText: string | null } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 消息列表镜像：socket 事件回调里读最新列表，避免闭包过期
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // 自己撤回的文本消息原文：供「重新编辑」一键回填输入框（仅本次会话内有效）
  const [recalledDrafts, setRecalledDrafts] = useState<Record<string, string>>({});

  // 加载历史消息（silent=true 为静默同步：按 id 合并去重、不显示加载态；
  // 无新消息时返回原数组引用，避免触发无谓的重渲染和滚动）
  const loadHistory = useCallback(
    (silent = false) => {
      if (!silent) setLoading(true);
      api
        .get(`/analytics/${classroomId}/messages/${groupId}`)
        .then((res) => {
          const incoming = res.data as ChatMessage[];
          setMessages((prev) => {
            const byId = new Map(prev.map((m) => [m.id, m]));
            let changed = false;
            for (const m of incoming) {
              const old = byId.get(m.id);
              // 新消息追加；已撤回状态同步（socket 事件丢失时靠这里兜底）
              if (!old || (!!old.recalledAt !== !!m.recalledAt)) {
                byId.set(m.id, m);
                changed = true;
              }
            }
            if (!changed) return prev;
            return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          });
          // 静默同步发现最新一条 AI 消息已是回复：清除可能卡住的"思考中/排队中"
          // （断线期间回复已到达、但 message:new 事件没收到的情况）
          if (silent) {
            const lastAi = [...incoming].reverse().find((m) => m.type === 'AI');
            if (lastAi?.isAiReply) {
              setAiTyping(false);
              setQueuePos(null);
            }
          }
        })
        .catch((err) => console.error('加载历史失败', err))
        .finally(() => {
          if (!silent) setLoading(false);
        });
    },
    [classroomId, groupId],
  );

  // 挂载 / 切换小组：全量加载
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // 加入房间 + 监听。
  // 关键：socket 断线重连后（手机锁屏/切后台/网络抖动/服务器重启），
  // 服务端房间成员随旧连接丢失，必须重新 group:join，并补拉断线期间漏掉的消息
  useEffect(() => {
    let joined = false;
    const onConnect = () => {
      socket.emit('group:join', { groupId });
      if (joined) loadHistory(true); // 重连补拉（首次连接由挂载加载负责）
      joined = true;
    };
    socket.on('connect', onConnect);
    if (socket.connected) onConnect();

    const onNew = (msg: ChatMessage) => {
      if (msg.groupId !== groupId) return;
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      if (msg.type === 'AI' && msg.isAiReply) {
        setAiTyping(false);
        setQueuePos(null);
      }
    };
    // 消息被撤回：原位替换为撤回态；正在引用它时取消引用。
    // 若撤回的是有文字的消息，先在本地留一份原文，供「重新编辑」回填
    const onRecalled = (msg: ChatMessage) => {
      if (msg.groupId !== groupId) return;
      const old = messagesRef.current.find((m) => m.id === msg.id);
      if (old?.content) {
        setRecalledDrafts((d) => ({ ...d, [msg.id]: old.content }));
      }
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)));
      setQuoting((q) => (q && q.id === msg.id ? null : q));
    };
    const onTyping = (p: { groupId: string }) => {
      if (p.groupId === groupId) {
        setAiTyping(true);
        setQueuePos(null);
      }
    };
    const onQueued = (p: { groupId: string; position: number }) => {
      if (p.groupId === groupId) setQueuePos(p.position);
    };

    socket.on('message:new', onNew);
    socket.on('message:recalled', onRecalled);
    socket.on('ai:typing', onTyping);
    socket.on('ai:queued', onQueued);
    return () => {
      socket.off('connect', onConnect);
      socket.off('message:new', onNew);
      socket.off('message:recalled', onRecalled);
      socket.off('ai:typing', onTyping);
      socket.off('ai:queued', onQueued);
    };
  }, [socket, groupId, loadHistory]);

  // 兜底同步：页面可见时每 15 秒静默拉一次 + 回到前台/窗口聚焦时立即拉。
  // socket 事件万一丢失（弱网/代理/事件漏发）也能把组员消息补回来
  useEffect(() => {
    const sync = () => {
      if (document.visibilityState === 'visible') loadHistory(true);
    };
    const timer = setInterval(sync, 15000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [loadHistory]);

  // 自动滚底
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, aiTyping, queuePos, tab]);

  // 切换标签（小组/AI）时清除引用：AI 讨论不支持引用
  useEffect(() => {
    setQuoting(null);
  }, [tab]);

  // 上传聊天附件（粘贴 / 拖拽 / 附件按钮共用；图片与文档统一走 /chat/file）
  const uploadFile = async (file: File) => {
    if (uploading) return;
    if (!isAllowedFileName(file.name)) {
      alert('仅支持图片（PNG / JPG / GIF / WebP）与 PDF / Word / PPT / Excel 文件');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      alert('文件不能超过 50MB');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/chat/file', fd);
      const isImage = isImageFileName(file.name);
      if (pendingFile?.preview) URL.revokeObjectURL(pendingFile.preview);
      setPendingFile({
        fileName: res.data.fileName,
        preview: isImage ? URL.createObjectURL(file) : null,
        isImage,
        origName: file.name,
        size: file.size,
      });
    } catch (err: any) {
      console.error('附件上传失败', err);
      const status: number | undefined = err.response?.status;
      const msg: string | undefined = err.response?.data?.error;
      // nginx（>55m 直接 413）与 multer（>50m 中文报错）都归一成大小限制提醒
      if (status === 413 || /过大|too large/i.test(String(msg))) {
        alert('文件过大，单个附件不能超过 50MB');
      } else {
        alert(msg || '附件上传失败');
      }
    } finally {
      setUploading(false);
    }
  };

  const pickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void uploadFile(file);
    e.target.value = ''; // 允许连续选择同一个
  };

  const removePendingFile = () => {
    if (pendingFile?.preview) URL.revokeObjectURL(pendingFile.preview);
    setPendingFile(null);
  };

  // 拖拽附件进入输入区：高亮提示；松手即上传（仅取第一个支持的文件，其余忽略）
  // 注意 dragover 阶段浏览器不暴露 files，只能通过 types 判断是否携带文件
  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      setDragOver(true);
    }
  };
  const onDragLeave = (e: DragEvent) => {
    e.preventDefault();
    // 拖动经过子元素时也会触发 dragleave，仅当真正离开容器才取消高亮
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDragOver(false);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = Array.from(e.dataTransfer.files).find((f) => isAllowedFileName(f.name));
    if (file) void uploadFile(file);
  };

  const send = () => {
    const content = input.trim();
    const file = pendingFile;
    if (!content && !file && !quoting) return;
    if (tab === 'PEER') {
      socket.emit('peer:send', {
        groupId,
        documentId,
        content,
        filePath: file?.fileName ?? null,
        fileOrigName: file?.origName ?? null,
        quoteId: quoting?.id ?? null,
      });
    } else {
      socket.emit('ai:send', {
        groupId,
        documentId,
        content,
        filePath: file?.fileName ?? null,
        fileOrigName: file?.origName ?? null,
      });
    }
    setInput('');
    if (file?.preview) URL.revokeObjectURL(file.preview);
    setPendingFile(null);
    setQuoting(null);
  };

  // 点击引用块跳回原消息并高亮
  const jumpToQuoted = (quoteId: string) => {
    const el = document.getElementById(`msg-${quoteId}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('msg-quote-flash');
    // 强制重排以重新触发动画
    void el.offsetWidth;
    el.classList.add('msg-quote-flash');
    setTimeout(() => el.classList.remove('msg-quote-flash'), 1600);
  };

  // 被引用提醒跳转：消息列表就绪后定位到目标消息
  useEffect(() => {
    if (!jumpToMessageId || loading) return;
    if (document.getElementById(`msg-${jumpToMessageId}`)) {
      jumpToQuoted(jumpToMessageId);
    }
    onJumpDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToMessageId, messages, loading]);

  // 右键/双指点击消息 → 弹出操作菜单（引用 / 复制 / 粘贴 / 撤回）
  const openContextMenu = (e: ReactMouseEvent, msg: ChatMessage) => {
    e.preventDefault();
    e.stopPropagation();
    // 若正选中该消息内的文字，记录下来：复制时只复制选中部分
    let selectedText: string | null = null;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode)) {
      const t = sel.toString();
      if (t.trim()) selectedText = t;
    }
    setCtxMenu({
      x: Math.min(e.clientX, window.innerWidth - 130),
      y: Math.min(e.clientY, window.innerHeight - 160),
      msg,
      selectedText,
    });
  };

  // 撤回自己的小组消息（服务端二次校验时限与归属）
  const recall = (msg: ChatMessage) => {
    socket.emit('peer:recall', { messageId: msg.id });
    setCtxMenu(null);
  };

  // 重新编辑：把撤回前保存的原文回填输入框并聚焦（发送后生成新消息）
  const reEdit = (id: string) => {
    const draft = recalledDrafts[id];
    if (!draft) return;
    setInput(draft);
    setRecalledDrafts((d) => {
      const { [id]: _removed, ...rest } = d;
      return rest;
    });
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  // 菜单外点击 / 滚动 / Esc 关闭
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('wheel', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  const shown = messages.filter((m) => m.type === tab);

  return (
    <div className="flex h-full flex-col bg-white">
      {/* 消息流 */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-auto p-4">
        {loading ? (
          <div className="flex h-full items-center justify-center text-ink-500">
            <Loader2 className="animate-spin" />
          </div>
        ) : shown.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-ink-500">
            {tab === 'PEER' ? (
              <>
                <Users size={32} className="mb-2 opacity-30" />
                和小组成员边读边聊，分享你的想法
              </>
            ) : (
              <>
                <Bot size={32} className="mb-2 opacity-30" />
                向 AI 提问，它会结合当前文献与你讨论
              </>
            )}
          </div>
        ) : (
          shown.map((m) => (
            <Bubble
              key={m.id}
              msg={m}
              mine={m.senderId === me.id && !m.isAiReply}
              canQuote={tab === 'PEER'}
              canRecall={canRecallMsg(m, me.id)}
              reEditDraft={m.senderId === me.id && !m.isAiReply ? recalledDrafts[m.id] : undefined}
              onQuote={setQuoting}
              onRecall={recall}
              onReEdit={reEdit}
              onJumpToQuoted={jumpToQuoted}
              onContextMenu={openContextMenu}
            />
          ))
        )}
        {tab === 'AI' && queuePos !== null && (
          <div className="flex items-center gap-2 text-sm text-violet-500">
            <Bot size={16} />
            <span className="flex gap-1">
              <Dot /> <Dot delay="0.15s" /> <Dot delay="0.3s" />
            </span>
            提问人数较多，排队中，第 {queuePos} 位…
          </div>
        )}
        {tab === 'AI' && aiTyping && queuePos === null && (
          <div className="flex items-center gap-2 text-sm text-violet-500">
            <Bot size={16} />
            <span className="flex gap-1">
              <Dot /> <Dot delay="0.15s" /> <Dot delay="0.3s" />
            </span>
            AI 正在思考…
          </div>
        )}
      </div>

      {/* 输入区（支持拖拽附件进来） */}
      <div className="border-t border-ink-900/5 p-3">
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={cn(
            'relative rounded-xl border p-2',
            dragOver
              ? 'border-brand-500 border-dashed bg-brand-50/60'
              : 'border-ink-900/10 bg-[#f7f8fa] focus-within:border-brand-500',
          )}
        >
          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm font-medium text-brand-600">拖拽文件到此处发送</div>
          )}
          {/* 引用条：正在引用的消息 */}
          {quoting && (
            <div className="mb-1.5 flex items-center gap-1.5 rounded-lg border-l-2 border-brand-500 bg-brand-50 px-2 py-1 text-xs text-ink-700">
              <Quote size={12} className="shrink-0 text-brand-500" />
              <span className="shrink-0 font-medium text-brand-700">{quoting.senderName}</span>
              <span className="min-w-0 flex-1 truncate">
                {quoting.content ||
                  (quoting.filePath
                    ? isImageFileName(quoting.filePath)
                      ? '[图片]'
                      : `[文件] ${quoting.fileOrigName ?? ''}`
                    : '')}
              </span>
              <button
                onClick={() => setQuoting(null)}
                title="取消引用"
                className="shrink-0 rounded p-0.5 text-ink-400 hover:bg-ink-900/5 hover:text-ink-900"
              >
                <X size={12} />
              </button>
            </div>
          )}
          {/* 待发送附件预览：图片缩略图 / 文件卡片 */}
          {pendingFile && (
            <div className="mb-1.5">
              {pendingFile.isImage ? (
                <div className="relative inline-block">
                  <img
                    src={pendingFile.preview!}
                    alt="待发送图片"
                    className="h-20 max-w-[160px] rounded-lg border border-ink-900/10 object-cover"
                  />
                  <button
                    onClick={removePendingFile}
                    title="移除图片"
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-ink-900/70 p-0.5 text-white transition-colors hover:bg-ink-900"
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <div className="relative inline-flex max-w-[280px] items-center gap-2 rounded-lg border border-ink-900/10 bg-white px-2.5 py-1.5">
                  <FileText size={18} className="shrink-0 text-brand-500" />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-900" title={pendingFile.origName}>
                    {pendingFile.origName}
                  </span>
                  <span className="shrink-0 text-[10px] text-ink-400">{formatSize(pendingFile.size)}</span>
                  <button
                    onClick={removePendingFile}
                    title="移除文件"
                    className="shrink-0 rounded p-0.5 text-ink-400 transition-colors hover:bg-ink-900/5 hover:text-ink-900"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => {
                // 支持直接粘贴截图/图片文件（文档仍需点击 📎 或拖拽）
                const file = Array.from(e.clipboardData.files).find((f) =>
                  isImageFileName(f.name) || f.type.startsWith('image/'),
                );
                if (file) {
                  e.preventDefault();
                  void uploadFile(file);
                }
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                // Ctrl+Enter / Cmd+Enter（Mac）：换行不发送
                if (e.ctrlKey || e.metaKey) {
                  e.preventDefault();
                  const el = textareaRef.current;
                  if (!el) return;
                  const { selectionStart, selectionEnd } = el;
                  setInput(input.slice(0, selectionStart) + '\n' + input.slice(selectionEnd));
                  requestAnimationFrame(() => {
                    el.selectionStart = el.selectionEnd = selectionStart + 1;
                  });
                  return;
                }
                if (!e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder={tab === 'PEER' ? '对小组成员说点什么…' : '向 AI 提问…'}
              className="max-h-28 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink-900 outline-none placeholder:text-ink-500/50"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title="发送图片或文件"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-ink-900/5 hover:text-ink-900 disabled:opacity-40"
            >
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
              className="hidden"
              onChange={pickFile}
            />
            <button
              onClick={send}
              disabled={!input.trim() && !pendingFile && !quoting}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white transition-all active:scale-90 disabled:opacity-40',
                tab === 'PEER' ? 'bg-brand-500 hover:bg-brand-600' : 'bg-violet-500 hover:brightness-110',
              )}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* 右键/双指点击消息的操作菜单：引用 / 复制 / 粘贴 / 撤回 */}
      {ctxMenu && (
        <div
          className="fixed z-[90] min-w-[112px] rounded-lg border border-ink-900/10 bg-white py-1 shadow-lg"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          {tab === 'PEER' && !ctxMenu.msg.isAiReply && !ctxMenu.msg.recalledAt && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setQuoting(ctxMenu.msg);
                setCtxMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-900 hover:bg-ink-900/5"
            >
              <Quote size={13} className="text-brand-500" /> 引用
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              void copyText(ctxMenu.selectedText || ctxMenu.msg.content);
              setCtxMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-900 hover:bg-ink-900/5"
          >
            <Copy size={13} className="text-ink-500" />
            {ctxMenu.selectedText ? '复制选中文字' : '复制'}
          </button>
          {canRecallMsg(ctxMenu.msg, me.id) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                recall(ctxMenu.msg);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-500 hover:bg-red-500/5"
            >
              <Undo2 size={13} className="text-red-500" /> 撤回
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// AI 回复的 Markdown 渲染已抽取为共享组件 MarkdownContent（与教师端问答详情共用样式）

function Bubble({
  msg,
  mine,
  canQuote,
  canRecall,
  reEditDraft,
  onQuote,
  onRecall,
  onReEdit,
  onJumpToQuoted,
  onContextMenu,
}: {
  msg: ChatMessage;
  mine: boolean;
  /** 小组讨论标签下显示「引用」按钮 */
  canQuote: boolean;
  /** 自己 2 分钟内的小组消息显示「撤回」按钮 */
  canRecall: boolean;
  /** 自己撤回的文本消息原文：存在则显示「重新编辑」 */
  reEditDraft?: string;
  onQuote: (m: ChatMessage) => void;
  onRecall: (m: ChatMessage) => void;
  onReEdit: (id: string) => void;
  onJumpToQuoted: (quoteId: string) => void;
  /** 右键/双指点击（Mac）/Windows 右键 → 操作菜单 */
  onContextMenu: (e: ReactMouseEvent, msg: ChatMessage) => void;
}) {
  const isAi = msg.isAiReply;
  // 已撤回：仅保留灰色提示（id 供引用跳转定位）；有保存原文时可「重新编辑」
  if (msg.recalledAt) {
    return (
      <div
        id={`msg-${msg.id}`}
        className={cn('flex items-center gap-2', mine ? 'justify-end' : 'justify-start')}
      >
        <span className="px-1 text-xs text-ink-400">
          {mine ? '你' : msg.senderName}撤回了一条消息
        </span>
        {mine && reEditDraft && (
          <button
            onClick={() => onReEdit(msg.id)}
            className="rounded px-1 text-xs font-medium text-brand-500 transition-colors hover:bg-brand-50 hover:text-brand-600"
          >
            重新编辑
          </button>
        )}
      </div>
    );
  }
  return (
    <div
      id={`msg-${msg.id}`}
      className={cn('group flex animate-fade-in-up flex-col', mine ? 'items-end' : 'items-start')}
      onContextMenu={(e) => onContextMenu(e, msg)}
    >
      <div className="mb-0.5 flex items-center gap-1.5 px-1 text-xs text-ink-500">
        {isAi && <Bot size={12} className="text-violet-500" />}
        <span>{msg.senderName}</span>
        <span className="opacity-60">{new Date(msg.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
        {canRecall && (
          <button
            onClick={() => onRecall(msg)}
            title="撤回这条消息（2 分钟内）"
            className="rounded p-0.5 text-ink-400 opacity-0 transition-opacity hover:bg-ink-900/5 hover:text-red-500 group-hover:opacity-100"
          >
            <Undo2 size={12} />
          </button>
        )}
        {canQuote && !isAi && (
          <button
            onClick={() => onQuote(msg)}
            title="引用这条消息"
            className="rounded p-0.5 text-ink-400 opacity-0 transition-opacity hover:bg-ink-900/5 hover:text-ink-900 group-hover:opacity-100"
          >
            <Quote size={12} />
          </button>
        )}
      </div>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
          isAi
            ? 'rounded-tl-sm bg-violet-500/10 text-ink-900'
            : mine
              ? 'rounded-tr-sm bg-brand-500 text-white'
              : 'rounded-tl-sm bg-ink-900/5 text-ink-900',
          // AI 走 Markdown 渲染（自带段落间距），其余保持纯文本换行
          isAi ? '' : 'whitespace-pre-wrap',
        )}
      >
        {isAi ? (
          <MarkdownContent content={msg.content} />
        ) : msg.quote ? (
          <button
            onClick={() => onJumpToQuoted(msg.quote!.id)}
            title="跳到原消息"
            className={cn(
              'mb-1 block w-full rounded-lg border-l-2 px-2 py-1 text-left text-xs leading-relaxed',
              mine ? 'border-white/60 bg-white/15' : 'border-ink-900/20 bg-black/5',
            )}
          >
            <span className="font-medium opacity-90">{msg.quote.senderName}：</span>
            <span className="opacity-75">
              {msg.quote.content
                ? truncate(msg.quote.content, 80)
                : msg.quote.hasImage
                  ? '[图片]'
                  : msg.quote.fileName
                    ? `[文件] ${truncate(msg.quote.fileName, 40)}`
                    : '[图片]'}
            </span>
          </button>
        ) : null}
        {!isAi && (
          <>
            {msg.content}
            {msg.filePath &&
              (isImageFileName(msg.filePath) ? (
                <a
                  href={chatFileUrl(msg.filePath)}
                  target="_blank"
                  rel="noreferrer"
                  title="点击查看大图"
                  className="mt-1 block"
                >
                  <img
                    src={chatFileUrl(msg.filePath)}
                    alt="聊天图片"
                    loading="lazy"
                    className="max-h-52 max-w-full rounded-lg bg-white/10 object-contain"
                  />
                </a>
              ) : (
                <a
                  href={chatFileUrl(msg.filePath)}
                  target="_blank"
                  rel="noreferrer"
                  download
                  title="点击下载文件"
                  className={cn(
                    'mt-1 flex max-w-[240px] items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors',
                    mine ? 'bg-white/15 hover:bg-white/25' : 'bg-black/5 hover:bg-black/10',
                  )}
                >
                  <FileText size={18} className={mine ? 'shrink-0 text-white/80' : 'shrink-0 text-brand-500'} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-xs font-medium" title={msg.fileOrigName ?? undefined}>
                      {msg.fileOrigName || '点击下载文件'}
                    </span>
                  </span>
                </a>
              ))}
          </>
        )}
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function Dot({ delay = '0s' }: { delay?: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-violet-500"
      style={{ animationDelay: delay }}
    />
  );
}
