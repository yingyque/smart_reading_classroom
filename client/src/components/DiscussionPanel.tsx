import { useEffect, useRef, useState } from 'react';
import { Send, Bot, Users, Loader2 } from 'lucide-react';
import { Socket } from 'socket.io-client';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
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

export default function DiscussionPanel({ socket, classroomId, groupId, documentId, me }: Props) {
  const [tab, setTab] = useState<MessageType>('PEER');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [aiTyping, setAiTyping] = useState(false);
  // 排队位次（null = 不在排队）：全班并发高时 AI 请求进全局队列，显示位次
  const [queuePos, setQueuePos] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
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

  // 加入房间 + 监听
  useEffect(() => {
    socket.emit('group:join', { groupId });

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
      socket.off('message:new', onNew);
      socket.off('ai:typing', onTyping);
      socket.off('ai:queued', onQueued);
    };
  }, [socket, groupId]);

  // 自动滚底
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, aiTyping, queuePos, tab]);

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
            placeholder={tab === 'PEER' ? '对小组成员说点什么…' : '向 AI 提问…'}
            className="max-h-28 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink-900 outline-none placeholder:text-ink-500/50"
          />
          <button
            onClick={send}
            disabled={!input.trim()}
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

// AI 回复的 Markdown 渲染（react-markdown 默认不渲染原始 HTML，无 XSS 风险）
const mdComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mb-2 text-base font-bold">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1.5 mt-3 text-[15px] font-bold">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-bold">{children}</h3>,
  ul: ({ children }) => <ul className="mb-2 list-disc pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal pl-4">{children}</ol>,
  li: ({ children }) => <li className="mb-0.5">{children}</li>,
  // 代码块：pre 深色底；[&_code] 重置块内 code 的行内样式
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-lg bg-ink-900 p-2.5 text-xs [&_code]:bg-transparent [&_code]:px-0 [&_code]:py-0 [&_code]:text-[inherit] [&_code]:text-ink-50">
      {children}
    </pre>
  ),
  code: ({ children }) => <code className="rounded bg-ink-900/10 px-1 py-0.5 font-mono text-[13px]">{children}</code>,
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-ink-900/15 bg-ink-900/5 px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-ink-900/15 px-2 py-1">{children}</td>,
  blockquote: ({ children }) => <blockquote className="mb-2 border-l-2 border-violet-400 pl-2 text-ink-500">{children}</blockquote>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="break-all text-violet-600 underline underline-offset-2">
      {children}
    </a>
  ),
  hr: () => <hr className="my-2 border-ink-900/10" />,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
};

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
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {msg.content}
          </ReactMarkdown>
        ) : (
          msg.content
        )}
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
