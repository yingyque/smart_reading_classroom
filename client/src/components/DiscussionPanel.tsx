import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { Send, Bot, Users, Loader2, ImagePlus, X, Quote } from 'lucide-react';
import { Socket } from 'socket.io-client';
import { api, getToken } from '../lib/api';
import { API_PREFIX } from '../lib/config';
import { ChatMessage, MessageType, User } from '../types';
import { cn } from '../lib/cn';
import MarkdownContent from './MarkdownContent';

// 聊天图片访问地址（<img> 无法带 Authorization 头，走 ?token= 查询参数鉴权）
function chatImageUrl(fileName: string): string {
  return `${API_PREFIX}/chat/image/${fileName}?token=${encodeURIComponent(getToken() ?? '')}`;
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
  // 待发送图片（fileName=服务端存储名，preview=本地 blob 预览）
  const [pendingImage, setPendingImage] = useState<{ fileName: string; preview: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  // 拖拽图片悬停高亮
  const [dragOver, setDragOver] = useState(false);
  // 正在引用的消息（小组讨论：引用自己或组员说过的话）
  const [quoting, setQuoting] = useState<ChatMessage | null>(null);
  // 右键/双指点击消息弹出的「引用」菜单（Mac 双指点击与 Windows 右键均触发 contextmenu）
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; msg: ChatMessage } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
            const seen = new Set(prev.map((m) => m.id));
            const fresh = incoming.filter((m) => !seen.has(m.id));
            if (!fresh.length) return prev;
            return [...prev, ...fresh].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
    socket.on('ai:typing', onTyping);
    socket.on('ai:queued', onQueued);
    return () => {
      socket.off('connect', onConnect);
      socket.off('message:new', onNew);
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

  // 上传聊天图片（粘贴 / 附件按钮共用）
  const uploadImage = async (file: File) => {
    if (uploading) return;
    if (!file.type.startsWith('image/')) {
      alert('仅支持图片文件（PNG / JPG / GIF / WebP）');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('图片不能超过 10MB');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/chat/image', fd);
      if (pendingImage) URL.revokeObjectURL(pendingImage.preview);
      setPendingImage({ fileName: res.data.fileName, preview: URL.createObjectURL(file) });
    } catch (err: any) {
      console.error('图片上传失败', err);
      alert(err.response?.data?.error || '图片上传失败');
    } finally {
      setUploading(false);
    }
  };

  const pickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void uploadImage(file);
    e.target.value = ''; // 允许连续选择同一张
  };

  const removePendingImage = () => {
    if (pendingImage) URL.revokeObjectURL(pendingImage.preview);
    setPendingImage(null);
  };

  // 拖拽图片进入输入区：高亮提示；松手即上传（仅取第一张图片，其余忽略）
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
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
    if (file) void uploadImage(file);
  };

  const send = () => {
    const content = input.trim();
    const image = pendingImage;
    if (!content && !image && !quoting) return;
    if (tab === 'PEER') {
      socket.emit('peer:send', {
        groupId,
        documentId,
        content,
        imagePath: image?.fileName ?? null,
        quoteId: quoting?.id ?? null,
      });
    } else {
      socket.emit('ai:send', { groupId, documentId, content, imagePath: image?.fileName ?? null });
    }
    setInput('');
    if (image) URL.revokeObjectURL(image.preview);
    setPendingImage(null);
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

  // 右键/双指点击消息 → 弹出「引用」菜单（仅小组讨论的学生消息）
  const openContextMenu = (e: ReactMouseEvent, msg: ChatMessage) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({
      x: Math.min(e.clientX, window.innerWidth - 130),
      y: Math.min(e.clientY, window.innerHeight - 60),
      msg,
    });
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
              onQuote={setQuoting}
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

      {/* 输入区（支持拖拽图片进来） */}
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
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm font-medium text-brand-600">拖拽图片到此处发送</div>
          )}
          {/* 引用条：正在引用的消息 */}
          {quoting && (
            <div className="mb-1.5 flex items-center gap-1.5 rounded-lg border-l-2 border-brand-500 bg-brand-50 px-2 py-1 text-xs text-ink-700">
              <Quote size={12} className="shrink-0 text-brand-500" />
              <span className="shrink-0 font-medium text-brand-700">{quoting.senderName}</span>
              <span className="min-w-0 flex-1 truncate">
                {quoting.content || (quoting.imagePath ? '[图片]' : '')}
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
          {/* 待发送图片预览 */}
          {pendingImage && (
            <div className="mb-1.5">
              <div className="relative inline-block">
                <img
                  src={pendingImage.preview}
                  alt="待发送图片"
                  className="h-20 max-w-[160px] rounded-lg border border-ink-900/10 object-cover"
                />
                <button
                  onClick={removePendingImage}
                  title="移除图片"
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-ink-900/70 p-0.5 text-white transition-colors hover:bg-ink-900"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => {
                // 支持直接粘贴截图/图片文件
                const file = Array.from(e.clipboardData.files).find((f) =>
                  f.type.startsWith('image/'),
                );
                if (file) {
                  e.preventDefault();
                  void uploadImage(file);
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
              title="发送图片"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-ink-900/5 hover:text-ink-900 disabled:opacity-40"
            >
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={pickFile}
            />
            <button
              onClick={send}
              disabled={!input.trim() && !pendingImage && !quoting}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white transition-all active:scale-90 disabled:opacity-40',
                tab === 'PEER' ? 'bg-brand-500 hover:bg-brand-600' : 'bg-violet-500 hover:brightness-110',
              )}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
        <p className="mt-1.5 px-1 text-xs text-ink-400">
          Enter 发送 · Shift / Ctrl / ⌘ + Enter 换行 · 支持粘贴截图、拖拽图片或点击 📎 发送
        </p>
      </div>

      {/* 右键/双指点击消息的「引用」菜单 */}
      {ctxMenu && (
        <div
          className="fixed z-[90] min-w-[104px] rounded-lg border border-ink-900/10 bg-white py-1 shadow-lg"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
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
  onQuote,
  onJumpToQuoted,
  onContextMenu,
}: {
  msg: ChatMessage;
  mine: boolean;
  /** 小组讨论标签下显示「引用」按钮 */
  canQuote: boolean;
  onQuote: (m: ChatMessage) => void;
  onJumpToQuoted: (quoteId: string) => void;
  /** 右键/双指点击（Mac）/Windows 右键 → 引用菜单 */
  onContextMenu: (e: ReactMouseEvent, msg: ChatMessage) => void;
}) {
  const isAi = msg.isAiReply;
  return (
    <div
      id={`msg-${msg.id}`}
      className={cn('group flex animate-fade-in-up flex-col', mine ? 'items-end' : 'items-start')}
      onContextMenu={canQuote && !isAi ? (e) => onContextMenu(e, msg) : undefined}
    >
      <div className="mb-0.5 flex items-center gap-1.5 px-1 text-xs text-ink-500">
        {isAi && <Bot size={12} className="text-violet-500" />}
        <span>{msg.senderName}</span>
        <span className="opacity-60">{new Date(msg.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
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
              {msg.quote.content ? truncate(msg.quote.content, 80) : '[图片]'}
            </span>
          </button>
        ) : null}
        {!isAi && (
          <>
            {msg.content}
            {msg.imagePath && (
              <a
                href={chatImageUrl(msg.imagePath)}
                target="_blank"
                rel="noreferrer"
                title="点击查看大图"
                className="mt-1 block"
              >
                <img
                  src={chatImageUrl(msg.imagePath)}
                  alt="聊天图片"
                  loading="lazy"
                  className="max-h-52 max-w-full rounded-lg bg-white/10 object-contain"
                />
              </a>
            )}
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
