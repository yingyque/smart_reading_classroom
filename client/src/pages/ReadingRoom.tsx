import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpenText, ChevronDown, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useAuth } from '../context/AuthContext';
import { DocumentLite, Group } from '../types';
import DocumentViewer from '../components/DocumentViewer';
import DiscussionPanel from '../components/DiscussionPanel';

export default function ReadingRoom() {
  const { classroomId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [group, setGroup] = useState<Group | null>(null);
  const [documents, setDocuments] = useState<DocumentLite[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [docMenuOpen, setDocMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const socket = useMemo(() => getSocket(), []);

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
        </div>
      </header>

      {/* 左读右聊 */}
      <div className="flex flex-1 overflow-hidden">
        <section className="flex-1 overflow-hidden border-r border-ink-900/5 bg-white md:w-[60%]">
          <DocumentViewer docId={activeDocId} />
        </section>
        <aside className="w-full md:w-[40%] md:min-w-[380px] md:max-w-[520px]">
          {user && classroomId && (
            <DiscussionPanel
              socket={socket}
              classroomId={classroomId}
              groupId={group.id}
              documentId={activeDocId}
              me={user}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
