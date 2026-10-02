import { useEffect, useRef, useState } from 'react';
import { Send, Bot, Users, Loader2, KeyRound, CheckCircle2 } from 'lucide-react';
import { Socket } from 'socket.io-client';
import { api } from '../lib/api';
import { ChatMessage, MessageType, User } from '../types';
import { cn } from '../lib/cn';

interface Props {
  socket: Socket;
  classroomId: string;
  groupId: string;
  documentId: string | null;
  me: User;
}

interface WorkspaceState {
  exists: boolean;
  status: string | null;
  keyActivated: boolean;
  keyMask?: string | null;
}

export default function DiscussionPanel({ socket, classroomId, groupId, documentId, me }: Props) {
  const [tab, setTab] = useState<MessageType>('PEER');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [aiTyping, setAiTyping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [wsState, setWsState] = useState<WorkspaceState | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [keySubmitting, setKeySubmitting] = useState(false);
  const [keyError, setKeyError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // 加载历史消息
  useEffect(() => {
    setLoading(true);
    api
      .get(`/analytics/${classroomId}/messages/${groupId}`)
      .then((res) => setMessages(res.data))
      .catch((err) => console.error('加载历史失败', err))
      .finally(() => setLoading(false));
  }, [classroomId, groupId]);

  // 加载个人 AI 工作台状态
  useEffect(() => {
    api
      .get(`/workspaces/${classroomId}/me`)
      .then((res) => setWsState(res.data))
      .catch(() => setWsState({ exists: false, status: null, keyActivated: false }));
  }, [classroomId]);

  // 提交 AI Key 激活
  const submitKey = async () => {
    const key = keyInput.trim();
    if (!key) return;
    setKeySubmitting(true);
    setKeyError('');
    try {
      const res = await api.post(`/workspaces/${classroomId}/key`, { key });
      setWsState(res.data);
      setKeyInput('');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setKeyError(msg || '激活失败，请检查 Key 是否正确');
    } finally {
      setKeySubmitting(false);
    }
  };

  // 加入房间 + 监听
  useEffect(() => {
    socket.emit('group:join', { groupId });

    const onNew = (msg: ChatMessage) => {
      if (msg.groupId !== groupId) return;
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      if (msg.type === 'AI' && msg.isAiReply) setAiTyping(false);
    };
    const onTyping = (p: { groupId: string }) => {
      if (p.groupId === groupId) setAiTyping(true);
    };

    socket.on('message:new', onNew);
    socket.on('ai:typing', onTyping);
    return () => {
      socket.off('message:new', onNew);
      socket.off('ai:typing', onTyping);
    };
  }, [socket, groupId]);

  // 自动滚底
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, aiTyping, tab]);

  const send = () => {
    const content = input.trim();
    if (!content) return;
    if (tab === 'PEER') {
      socket.emit('peer:send', { groupId, documentId, content });
    } else {
      socket.emit('ai:send', { groupId, documentId, content });
    }
    setInput('');
  };

  const shown = messages.filter((m) => m.type === tab);

  return (
    <div className="flex h-full flex-col bg-white">
      {/* 标签 */}
      <div className="flex border-b border-ink-900/5 p-2">
        <TabButton active={tab === 'PEER'} onClick={() => setTab('PEER')} icon={<Users size={16} />} label="小组讨论" color="brand" />
        <TabButton active={tab === 'AI'} onClick={() => setTab('AI')} icon={<Bot size={16} />} label="AI 讨论" color="violet" />
      </div>

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
          shown.map((m) => <Bubble key={m.id} msg={m} mine={m.senderId === me.id && !m.isAiReply} />)
        )}
        {tab === 'AI' && aiTyping && (
          <div className="flex items-center gap-2 text-sm text-violet-500">
            <Bot size={16} />
            <span className="flex gap-1">
              <Dot /> <Dot delay="0.15s" /> <Dot delay="0.3s" />
            </span>
            AI 正在思考…
          </div>
        )}
      </div>

      {/* AI Key 激活区（仅 AI Tab 且未激活时显示） */}
      {tab === 'AI' && wsState && !wsState.keyActivated && (
        <div className="border-t border-violet-500/20 bg-violet-500/5 p-4">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-violet-600">
            <KeyRound size={15} />
            激活个人 AI 助手
          </div>
          <p className="mb-2 text-xs leading-relaxed text-ink-500">
            输入教师发放的 AI Key，即可启动你的专属 AI 容器并开始讨论。Key 仅用于激活你自己的 AI 助手。
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitKey()}
              placeholder="粘贴教师发放的 Key（sk-…）"
              className="flex-1 rounded-lg border border-ink-900/10 bg-white px-3 py-1.5 text-sm outline-none focus:border-violet-500"
            />
            <button
              onClick={submitKey}
              disabled={!keyInput.trim() || keySubmitting}
              className="rounded-lg bg-violet-500 px-4 py-1.5 text-sm font-semibold text-white transition-all hover:brightness-110 active:scale-95 disabled:opacity-40"
            >
              {keySubmitting ? <Loader2 size={16} className="animate-spin" /> : '激活'}
            </button>
          </div>
          {keyError && <p className="mt-2 text-xs text-red-500">{keyError}</p>}
        </div>
      )}

      {/* AI 已激活状态提示 */}
      {tab === 'AI' && wsState?.keyActivated && (
        <div className="flex items-center gap-1.5 border-t border-ink-900/5 bg-emerald-500/5 px-4 py-1.5 text-xs text-emerald-600">
          <CheckCircle2 size={13} />
          个人 AI 助手已激活（{wsState.keyMask ?? 'Key 已配置'}），发消息即可与 AI 讨论
        </div>
      )}

      {/* 输入区 */}
      <div className="border-t border-ink-900/5 p-3">
        <div className="flex items-end gap-2 rounded-xl border border-ink-900/10 bg-[#f7f8fa] p-2 focus-within:border-brand-500">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={tab === 'PEER' ? '对小组成员说点什么…' : wsState?.keyActivated ? '向 AI 提问…' : '请先激活 AI 助手（输入上方 Key）'}
            className="max-h-28 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink-900 outline-none placeholder:text-ink-500/50"
          />
          <button
            onClick={send}
            disabled={!input.trim() || (tab === 'AI' && !wsState?.keyActivated)}
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
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  color: 'brand' | 'violet';
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-all',
        active
          ? color === 'brand'
            ? 'bg-brand-50 text-brand-600'
            : 'bg-violet-500/10 text-violet-500'
          : 'text-ink-500 hover:bg-ink-900/5',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Bubble({ msg, mine }: { msg: ChatMessage; mine: boolean }) {
  const isAi = msg.isAiReply;
  return (
    <div className={cn('flex animate-fade-in-up flex-col', mine ? 'items-end' : 'items-start')}>
      <div className="mb-0.5 flex items-center gap-1.5 px-1 text-xs text-ink-500">
        {isAi && <Bot size={12} className="text-violet-500" />}
        <span>{msg.senderName}</span>
        <span className="opacity-60">{new Date(msg.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div
        className={cn(
          'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
          isAi
            ? 'rounded-tl-sm bg-violet-500/10 text-ink-900'
            : mine
              ? 'rounded-tr-sm bg-brand-500 text-white'
              : 'rounded-tl-sm bg-ink-900/5 text-ink-900',
        )}
      >
        {msg.content}
      </div>
    </div>
  );
}

function Dot({ delay = '0s' }: { delay?: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-violet-500"
      style={{ animationDelay: delay }}
    />
  );
}
