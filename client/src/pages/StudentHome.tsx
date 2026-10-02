import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpenText, LogOut, Users, ArrowRight, Loader2, Hash } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Group } from '../types';

interface JoinedClass {
  classroom: { id: string; name: string };
  group: Group | null;
  message?: string;
}

export default function StudentHome() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [code, setCode] = useState('');
  const [joined, setJoined] = useState<JoinedClass | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 读取上次加入的课堂
  useEffect(() => {
    const saved = localStorage.getItem('student:lastClass');
    if (saved) {
      try {
        setJoined(JSON.parse(saved));
      } catch {
        // 旧数据结构损坏时清除，避免渲染崩溃
        localStorage.removeItem('student:lastClass');
      }
    }
  }, []);

  const join = async () => {
    setError('');
    if (!code.trim()) return;
    setLoading(true);
    try {
      const res = await api.post('/classrooms/join', { code: code.trim() });
      setJoined(res.data);
      localStorage.setItem('student:lastClass', JSON.stringify(res.data));
    } catch (err: any) {
      console.error('加入失败', err);
      setError(err.response?.data?.error || '加入失败');
    } finally {
      setLoading(false);
    }
  };

  const refreshGroup = async () => {
    if (!joined) return;
    try {
      const res = await api.get(`/classrooms/${joined.classroom.id}/my-group`);
      const next = { ...joined, group: res.data };
      setJoined(next);
      localStorage.setItem('student:lastClass', JSON.stringify(next));
    } catch (err) {
      console.error('暂未分组', err);
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

        {/* 已加入信息 */}
        {joined && (
          <div className="mt-6 animate-fade-in-up rounded-2xl border border-white/60 bg-white p-6 shadow-soft">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-ink-500">当前课堂</p>
                <h2 className="text-xl font-bold text-ink-900">{joined.classroom.name}</h2>
              </div>
              {joined.group ? (
                <span className="rounded-full bg-teal-500/10 px-3 py-1 text-sm font-medium text-teal-500">
                  {joined.group.name}
                </span>
              ) : (
                <button
                  onClick={refreshGroup}
                  className="rounded-full bg-amber-500/10 px-3 py-1 text-sm font-medium text-amber-600 hover:bg-amber-500/20"
                >
                  等待分组 · 点击刷新
                </button>
              )}
            </div>

            {joined.group && (
              <>
                <div className="mt-4 flex items-center gap-2 text-sm text-ink-500">
                  <Users size={16} /> 小组成员（{joined.group.members?.length ?? 0} 人）
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(joined.group.members ?? []).map((m) => (
                    <span
                      key={m.userId}
                      className="rounded-lg bg-ink-900/5 px-3 py-1 text-sm text-ink-900"
                    >
                      {m.user.name}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => navigate(`/reading/${joined.classroom.id}`)}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-violet-500 py-3 font-semibold text-white shadow-glass transition-all hover:shadow-lg active:scale-[0.98]"
                >
                  <BookOpenText size={18} /> 进入阅读讨论室
                </button>
              </>
            )}
          </div>
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
