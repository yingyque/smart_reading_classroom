import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpenText, LogOut, ArrowRight, Loader2, Hash } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

interface JoinedClass {
  id: string;
  name: string;
  groupName: string | null;
}

export default function StudentHome() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [code, setCode] = useState('');
  const [classrooms, setClassrooms] = useState<JoinedClass[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  // 从服务端拉取当前账号已加入的课堂（不依赖 localStorage，换账号不会串课堂）
  const loadClassrooms = async () => {
    try {
      const res = await api.get('/classrooms/joined');
      setClassrooms(res.data);
    } catch (err) {
      console.error('课堂列表加载失败', err);
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    loadClassrooms();
  }, []);

  const join = async () => {
    setError('');
    if (!code.trim()) return;
    setLoading(true);
    try {
      await api.post('/classrooms/join', { code: code.trim() });
      setCode('');
      await loadClassrooms();
    } catch (err: any) {
      console.error('加入失败', err);
      setError(err.response?.data?.error || '加入失败');
    } finally {
      setLoading(false);
    }
  };

  const refreshGroup = async (classroomId: string) => {
    try {
      await api.get(`/classrooms/${classroomId}/my-group`);
      await loadClassrooms();
    } catch (err) {
      console.error('暂未分组', err);
      setError('尚未分组，请等待教师分组');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-[#eef2f7]">
      <Nav name={user?.name} onLogout={logout} />
      <main className="mx-auto max-w-4xl px-4 pt-24">
        <h1 className="text-2xl font-bold text-ink-900">欢迎回来，{user?.name}</h1>
        <p className="mt-1 text-ink-500">输入教师提供的课堂码，加入课堂并进入沉浸式阅读讨论。</p>

        {/* 加入课堂 */}
        <div className="mt-6 rounded-2xl border border-white/60 bg-white p-6 shadow-soft">
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-ink-900">
            <Hash size={18} className="text-brand-500" /> 加入课堂
          </h2>
          <div className="flex gap-3">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && join()}
              placeholder="输入 6 位课堂码"
              maxLength={6}
              className="flex-1 rounded-xl border border-ink-900/10 bg-white px-4 py-3 text-lg font-semibold tracking-widest text-ink-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
            <button
              onClick={join}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl bg-brand-500 px-6 font-semibold text-white transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-70"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
              加入
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>

        {/* 我的课堂列表（仅显示本账号已加入的课堂） */}
        {fetching ? (
          <div className="mt-6 flex justify-center py-6 text-ink-500">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : (
          classrooms.map((c) => (
            <div
              key={c.id}
              className="mt-6 animate-fade-in-up rounded-2xl border border-white/60 bg-white p-6 shadow-soft"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-ink-500">我的课堂</p>
                  <h2 className="text-xl font-bold text-ink-900">{c.name}</h2>
                </div>
                {c.groupName ? (
                  <span className="rounded-full bg-teal-500/10 px-3 py-1 text-sm font-medium text-teal-500">
                    {c.groupName}
                  </span>
                ) : (
                  <button
                    onClick={() => refreshGroup(c.id)}
                    className="rounded-full bg-amber-500/10 px-3 py-1 text-sm font-medium text-amber-600 hover:bg-amber-500/20"
                  >
                    等待分组 · 点击刷新
                  </button>
                )}
              </div>

              {c.groupName ? (
                <button
                  onClick={() => navigate(`/reading/${c.id}`)}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-violet-500 py-3 font-semibold text-white shadow-glass transition-all hover:shadow-lg active:scale-[0.98]"
                >
                  <BookOpenText size={18} /> 进入阅读讨论室
                </button>
              ) : (
                <p className="mt-4 text-sm text-ink-500">教师尚未分组，分组后即可进入阅读讨论室。</p>
              )}
            </div>
          ))
        )}
        {!fetching && !classrooms.length && (
          <p className="mt-6 rounded-2xl border border-white/60 bg-white px-6 py-8 text-center text-sm text-ink-500 shadow-soft">
            还没有加入任何课堂，输入上方课堂码加入
          </p>
        )}
      </main>
    </div>
  );
}

function Nav({ name, onLogout }: { name?: string; onLogout: () => void }) {
  return (
    <nav className="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between border-b border-white/60 bg-white/70 px-6 backdrop-blur-md">
      <div className="flex items-center gap-2 font-bold text-ink-900">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-500 text-white">
          <BookOpenText size={18} />
        </div>
        智慧阅读
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-ink-500">{name} · 学生</span>
        <button onClick={onLogout} className="flex items-center gap-1 text-sm text-ink-500 hover:text-red-600">
          <LogOut size={16} /> 退出
        </button>
      </div>
    </nav>
  );
}
