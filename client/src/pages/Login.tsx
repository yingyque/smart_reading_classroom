import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpenText, GraduationCap, Users, Loader2, Eye, EyeOff } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Role } from '../types';
import { cn } from '../lib/cn';

export default function Login() {
  const navigate = useNavigate();
  const { setAuth } = useAuth();
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [role, setRole] = useState<Role>('STUDENT');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const submit = async () => {
    setError('');
    if (mode === 'forgot') {
      if (!email.trim()) {
        setError('请填写邮箱');
        return;
      }
      setLoading(true);
      try {
        await api.post('/auth/forgot-password', { email: email.trim() });
        setForgotSent(true);
      } catch (err: any) {
        console.error('忘记密码失败', err);
        setError(err.response?.data?.error || '操作失败，请重试');
      } finally {
        setLoading(false);
      }
      return;
    }
    if (!email || !password || (mode === 'register' && !name)) {
      setError('请填写完整信息');
      return;
    }
    setLoading(true);
    const url = mode === 'login' ? '/auth/login' : '/auth/register';
    const body = mode === 'login' ? { email, password } : { name, email, password, role };
    try {
      const res = await api.post(url, body);
      setAuth(res.data.token, res.data.user);
      const role = res.data.user.role;
      navigate(role === 'ADMIN' ? '/shimin' : role === 'TEACHER' ? '/teacher' : '/student');
    } catch (err: any) {
      console.error('认证失败', err);
      setError(err.response?.data?.error || '操作失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const backToLogin = () => {
    setMode('login');
    setForgotSent(false);
    setError('');
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      {/* 背景装饰 */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-50 via-white to-[#eef2f7]" />
      <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-96 w-96 rounded-full bg-violet-500/20 blur-3xl" />

      <div className="relative z-10 grid w-full max-w-5xl gap-8 md:grid-cols-2">
        {/* 品牌介绍 */}
        <div className="hidden flex-col justify-center md:flex">
          <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-500 text-white shadow-glass">
            <BookOpenText size={28} />
          </div>
          <h1 className="text-4xl font-bold leading-tight text-ink-900">
            智慧阅读
            <span className="block text-2xl font-semibold text-brand-600">研究生课堂文献协作平台</span>
          </h1>
          <p className="mt-4 max-w-md text-ink-500">
            沉浸式阅读文献，与小组成员和 AI 实时讨论。完整记录学生之间与学生与 AI 的对话，自动生成词云、互动可视化与学习画像。
          </p>
          <ul className="mt-6 space-y-2 text-sm text-ink-500">
            <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-brand-500" />左读右聊，边读边讨论</li>
            <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-teal-500" />系统随机分组，自动均衡</li>
            <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-violet-500" />对话数据可视化与个人画像</li>
          </ul>
        </div>

        {/* 表单卡片 */}
        <div className="glass animate-fade-in-up rounded-3xl border border-white/60 p-8 shadow-glass">
          {mode !== 'forgot' && (
            <div className="mb-6 flex rounded-xl bg-ink-900/5 p-1">
              {(['login', 'register'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    'flex-1 rounded-lg py-2 text-sm font-semibold transition-all',
                    mode === m ? 'bg-white text-brand-600 shadow-soft' : 'text-ink-500 hover:text-ink-900',
                  )}
                >
                  {m === 'login' ? '登录' : '注册'}
                </button>
              ))}
            </div>
          )}

          {mode === 'register' && (
            <div className="mb-4 grid grid-cols-2 gap-3">
              <button
                onClick={() => setRole('STUDENT')}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition-all',
                  role === 'STUDENT'
                    ? 'border-brand-500 bg-brand-50 text-brand-600'
                    : 'border-ink-900/10 text-ink-500 hover:border-brand-500/40',
                )}
              >
                <Users size={18} /> 学生
              </button>
              <button
                onClick={() => setRole('TEACHER')}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition-all',
                  role === 'TEACHER'
                    ? 'border-brand-500 bg-brand-50 text-brand-600'
                    : 'border-ink-900/10 text-ink-500 hover:border-brand-500/40',
                )}
              >
                <GraduationCap size={18} /> 教师
              </button>
            </div>
          )}

          {mode === 'forgot' && (
            <p className="mb-3 text-sm text-ink-500">输入注册邮箱，系统会把一个随机新密码发送到该邮箱。</p>
          )}

          <div className="space-y-3">
            {mode === 'register' && (
              <Field label="姓名">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="请输入姓名"
                  className="w-full border-0 bg-transparent text-ink-900 outline-none placeholder:text-ink-500/50"
                />
              </Field>
            )}
            <Field label="邮箱">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder="you@example.com"
                className="w-full border-0 bg-transparent text-ink-900 outline-none placeholder:text-ink-500/50"
              />
            </Field>
            {mode !== 'forgot' && (
              <Field label="密码">
              <div className="flex items-center gap-2">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                  placeholder="请输入密码"
                  className="w-full border-0 bg-transparent text-ink-900 outline-none placeholder:text-ink-500/50"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  title={showPwd ? '隐藏密码' : '查看明文'}
                  className="shrink-0 rounded-lg p-1 text-ink-500 transition-colors hover:bg-ink-900/5 hover:text-ink-900"
                >
                  {showPwd ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              </Field>
            )}
          </div>

          {mode === 'forgot' && forgotSent && (
            <p className="mt-3 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700">
              新密码已发送到 {email.trim()}，请登录邮箱查收后再登录。
            </p>
          )}
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

          <button
            onClick={submit}
            disabled={loading}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-violet-500 py-3 font-semibold text-white shadow-glass transition-all hover:shadow-lg active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            {mode === 'forgot' ? '发送新密码' : mode === 'login' ? '登录' : '注册并进入'}
          </button>

          {mode === 'forgot' ? (
            <button
              type="button"
              onClick={backToLogin}
              className="mt-3 w-full text-center text-sm text-ink-500 transition-colors hover:text-brand-600"
            >
              返回登录
            </button>
          ) : mode === 'login' ? (
            <button
              type="button"
              onClick={() => {
                setMode('forgot');
                setForgotSent(false);
                setError('');
              }}
              className="mt-4 w-full text-center text-sm text-ink-500 transition-colors hover:text-brand-600"
            >
              忘记密码？
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block rounded-xl border border-ink-900/10 bg-white/60 px-4 py-2.5 transition-all focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
      <span className="mb-0.5 block text-xs font-medium text-ink-500">{label}</span>
      {children}
    </label>
  );
}
