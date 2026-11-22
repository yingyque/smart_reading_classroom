import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpenText, ChevronDown, Loader2, Settings, Users, Bot, NotebookPen } from 'lucide-react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useAuth } from '../context/AuthContext';
import { DocumentLite, Group, QuoteNotify, ChatMessage } from '../types';
import { takePendingQuoteNotify } from '../lib/quoteNotify';
import DocumentViewer from '../components/DocumentViewer';
import DiscussionPanel from '../components/DiscussionPanel';
import NotePanel from '../components/NotePanel';
import SettingsModal from '../components/SettingsModal';
import { cn } from '../lib/cn';

export default function ReadingRoom() {
  const { classroomId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [group, setGroup] = useState<Group | null>(null);
  const [documents, setDocuments] = useState<DocumentLite[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [docMenuOpen, setDocMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 右侧面板：小组讨论 / AI 讨论 / 学习笔记
  const [asideTab, setAsideTab] = useState<'peer' | 'ai' | 'note'>('peer');
  // 笔记版本号：阅读器新增高亮 / 笔记面板增删改后递增，双方向刷新
  const [noteTick, setNoteTick] = useState(0);
  const bumpNotes = () => setNoteTick((t) => t + 1);
  const [loading, setLoading] = useState(true);
  const socket = useMemo(() => getSocket(), []);
  // 被引用提醒跳转：定位到被引用的消息（小组讨论标签）
  const [jumpToMessageId, setJumpToMessageId] = useState<string | null>(null);
  // 未读角标：非当前标签收到新消息时计数，切到该标签清零
  const [peerUnread, setPeerUnread] = useState(0);
  const [aiUnread, setAiUnread] = useState(0);

  // 切换右侧面板标签（进入标签时清除对应未读数）
  const switchAsideTab = (tab: 'peer' | 'ai' | 'note') => {
    setAsideTab(tab);
    if (tab === 'peer') setPeerUnread(0);
    if (tab === 'ai') setAiUnread(0);
  };

  useEffect(() => {
    if (!classroomId) return;
    Promise.all([
      api.get(`/classrooms/${classroomId}/my-group`),
      api.get(`/documents/${classroomId}`),
    ])
      .then(([g, d]) => {
        setGroup(g.data);
        setDocuments(d.data);
        if (d.data.length) setActiveDocId(d.data[0].id);
      })
      .catch((err) => console.error('加载阅读室失败', err))
      .finally(() => setLoading(false));
  }, [classroomId]);

  // 消息被引用 → 点击通知跳进来：切到小组讨论并定位到被引用消息
  useEffect(() => {
    if (!classroomId) return;
    const consume = (q: QuoteNotify) => {
      if (q.classroomId !== classroomId) return;
      switchAsideTab('peer');
      setJumpToMessageId(q.quotedMessageId);
    };
    // 从其他页面跳转进来：挂载后消费 pending；已在阅读室：接收 quote:jump 窗口事件
    const pending = takePendingQuoteNotify();
    if (pending) consume(pending);
    const onJump = (e: Event) => consume((e as CustomEvent<QuoteNotify>).detail);
    window.addEventListener('quote:jump', onJump);
    return () => window.removeEventListener('quote:jump', onJump);
  }, [classroomId]);

  // 未读角标：本组新消息到达时，给非当前标签计数
  // （AI 回复归属触发它的学生本人，senderId 是自己，不能用"非本人"过滤）
  useEffect(() => {
    if (!group || !user) return;
    const onNew = (m: ChatMessage) => {
      if (m.groupId !== group.id) return;
      if (m.type === 'PEER') {
        if (m.senderId !== user.id && asideTab !== 'peer') setPeerUnread((c) => c + 1);
      } else if (m.type === 'AI' && m.isAiReply && asideTab !== 'ai') {
        setAiUnread((c) => c + 1);
      }
    };
    socket.on('message:new', onNew);
    return () => socket.off('message:new', onNew);
  }, [socket, group, user, asideTab]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-ink-500">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (!group) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-ink-500">
        <p>你尚未被分配到小组，请等待教师分组。</p>
        <button onClick={() => navigate('/student')} className="rounded-lg bg-brand-500 px-4 py-2 text-white">
          返回
        </button>
      </div>
    );
  }

  const activeDoc = documents.find((d) => d.id === activeDocId);

  return (
    <div className="flex h-screen flex-col bg-[#f7f8fa]">
      {/* 顶部导航 */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-ink-900/5 bg-white px-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/student')} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-900/5">
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2 font-bold text-ink-900">
            <BookOpenText size={18} className="text-brand-500" />
            智慧阅读
          </div>
          {/* 文献切换 */}
          <div className="relative ml-4">
            <button
              onClick={() => setDocMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-lg border border-ink-900/10 px-3 py-1.5 text-sm text-ink-900 hover:border-brand-500"
            >
              {activeDoc ? activeDoc.title : '选择文献'}
              <ChevronDown size={14} />
            </button>
            {docMenuOpen && (
              <div className="absolute left-0 top-10 z-20 w-64 rounded-xl border border-ink-900/5 bg-white p-1 shadow-soft">
                {documents.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => {
                      setActiveDocId(d.id);
                      setDocMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-900/5 ${
                      d.id === activeDocId ? 'text-brand-600' : 'text-ink-900'
                    }`}
                  >
                    <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand-600">
                      {d.fileType}
                    </span>
                    <span className="truncate">{d.title}</span>
                  </button>
                ))}
                {!documents.length && <p className="px-3 py-2 text-sm text-ink-500">教师尚未上传文献</p>}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm text-ink-500">
          <span className="rounded-full bg-teal-500/10 px-3 py-1 font-medium text-teal-500">{group.name}</span>
          <span>{user?.name}</span>
          <button
            onClick={() => setSettingsOpen(true)}
            title="设置"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-900/5 hover:text-ink-900"
          >
            <Settings size={17} />
          </button>
        </div>
      </header>

      {/* 左读右聊 */}
      <div className="flex flex-1 overflow-hidden">
        <section className="flex-1 overflow-hidden border-r border-ink-900/5 bg-white md:w-[60%]">
          {classroomId && (
            <DocumentViewer
              docId={activeDocId}
              classroomId={classroomId}
              notesVersion={noteTick}
              onNotesChanged={bumpNotes}
            />
          )}
        </section>
        <aside className="flex w-full flex-col md:w-[40%] md:min-w-[380px] md:max-w-[520px]">
          {/* 面板切换：小组讨论 / AI 讨论 / 学习笔记（带未读角标） */}
          <div className="flex shrink-0 border-b border-ink-900/5 bg-white px-2 pt-2">
            <button
              onClick={() => switchAsideTab('peer')}
              className={cn(
                'relative flex flex-1 items-center justify-center gap-1.5 rounded-t-lg px-3 py-2 text-sm font-semibold transition-all',
                asideTab === 'peer' ? 'bg-brand-50 text-brand-600' : 'text-ink-500 hover:bg-ink-900/5',
              )}
            >
              <Users size={16} /> 小组讨论
              {peerUnread > 0 && <UnreadBadge count={peerUnread} />}
            </button>
            <button
              onClick={() => switchAsideTab('ai')}
              className={cn(
                'relative flex flex-1 items-center justify-center gap-1.5 rounded-t-lg px-3 py-2 text-sm font-semibold transition-all',
                asideTab === 'ai' ? 'bg-violet-500/10 text-violet-500' : 'text-ink-500 hover:bg-ink-900/5',
              )}
            >
              <Bot size={16} /> AI 讨论
              {aiUnread > 0 && <UnreadBadge count={aiUnread} />}
            </button>
            <button
              onClick={() => switchAsideTab('note')}
              className={cn(
                'relative flex flex-1 items-center justify-center gap-1.5 rounded-t-lg px-3 py-2 text-sm font-semibold transition-all',
                asideTab === 'note' ? 'bg-amber-50 text-amber-600' : 'text-ink-500 hover:bg-ink-900/5',
              )}
            >
              <NotebookPen size={16} /> 学习笔记
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {asideTab === 'note' ? (
              classroomId && (
                <NotePanel
                  classroomId={classroomId}
                  documentId={activeDocId}
                  documents={documents}
                  refreshKey={noteTick}
                  onNotesChanged={bumpNotes}
                />
              )
            ) : (
              user && classroomId && (
                <DiscussionPanel
                  socket={socket}
                  classroomId={classroomId}
                  groupId={group.id}
                  documentId={activeDocId}
                  me={user}
                  tab={asideTab === 'ai' ? 'AI' : 'PEER'}
                  jumpToMessageId={jumpToMessageId}
                  onJumpDone={() => setJumpToMessageId(null)}
                />
              )
            )}
          </div>
        </aside>
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

// 未读消息角标：红色圆点 + 计数（超过 99 显示 99+）
function UnreadBadge({ count }: { count: number }) {
  return (
    <span className="absolute right-2 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
      {count > 99 ? '99+' : count}
    </span>
  );
}
