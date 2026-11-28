import { useState } from 'react';
import { Loader2, Settings, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { CHAT_FONT_SIZES, getChatFontSize, setChatFontSize, type ChatFontSize } from '../lib/chatFont';

/** 设置弹窗：修改姓名（保存后全局生效，无需重新登录）、修改密码（需校验原密码）、聊天文字大小 */
export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { user, updateUser } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [chatFont, setChatFont] = useState<ChatFontSize>(getChatFontSize);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdError, setPwdError] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdDone, setPwdDone] = useState(false);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('姓名不能为空');
      return;
    }
    if (trimmed.length > 30) {
      setError('姓名不能超过 30 个字符');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await api.patch('/auth/profile', { name: trimmed });
      updateUser({ name: res.data.name });
      onClose();
    } catch (err: any) {
      console.error('保存失败', err);
      setError(err.response?.data?.error || '保存失败，请稍后再试');
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    setPwdError('');
    setPwdDone(false);
    if (!oldPwd || !newPwd || !confirmPwd) {
      setPwdError('请填写完整');
      return;
    }
    if (newPwd.length < 6) {
      setPwdError('新密码至少 6 位');
      return;
    }
    if (newPwd !== confirmPwd) {
      setPwdError('两次输入的新密码不一致');
      return;
    }
    setPwdSaving(true);
    try {
      await api.patch('/auth/password', { oldPassword: oldPwd, newPassword: newPwd });
      setOldPwd('');
      setNewPwd('');
      setConfirmPwd('');
      setPwdDone(true);
    } catch (err: any) {
      console.error('密码修改失败', err);
      setPwdError(err.response?.data?.error || '密码修改失败，请稍后再试');
    } finally {
      setPwdSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/30 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold text-ink-900">
            <Settings size={18} className="text-brand-500" /> 设置
          </h3>
          <button onClick={onClose} className="rounded-lg p-1 text-ink-500 hover:bg-ink-900/5">
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-700">姓名</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              maxLength={30}
              autoFocus
              className="w-full rounded-xl border border-ink-900/10 bg-white px-4 py-2.5 text-ink-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
            <p className="mt-1 text-xs text-ink-500">修改后对课堂、讨论和同组成员名单立即生效</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-700">邮箱</label>
            <input
              value={user?.email || ''}
              disabled
              className="w-full cursor-not-allowed rounded-xl border border-ink-900/10 bg-ink-900/5 px-4 py-2.5 text-sm text-ink-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-700">聊天文字大小</label>
            <div className="flex gap-2">
              {CHAT_FONT_SIZES.map((s) => (
                <button
                  key={s.key}
                  onClick={() => {
                    setChatFontSize(s.key);
                    setChatFont(s.key);
                  }}
                  className={
                    'flex-1 rounded-xl border px-3 py-2 transition-all ' +
                    (chatFont === s.key
                      ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700'
                      : 'border-ink-900/10 text-ink-700 hover:bg-ink-900/5')
                  }
                  style={{ fontSize: s.px }}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-ink-500">仅影响聊天消息与输入框文字，立即生效</p>
          </div>
        </div>

        <div className="mt-5 border-t border-ink-900/10 pt-4">
          <label className="mb-1 block text-sm font-medium text-ink-700">修改密码</label>
          <div className="space-y-2">
            <input
              type="password"
              placeholder="原密码"
              value={oldPwd}
              onChange={(e) => setOldPwd(e.target.value)}
              className="w-full rounded-xl border border-ink-900/10 bg-white px-4 py-2.5 text-ink-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
            <input
              type="password"
              placeholder="新密码（至少 6 位）"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              className="w-full rounded-xl border border-ink-900/10 bg-white px-4 py-2.5 text-ink-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
            <input
              type="password"
              placeholder="确认新密码"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && changePassword()}
              className="w-full rounded-xl border border-ink-900/10 bg-white px-4 py-2.5 text-ink-900 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          {pwdError && <p className="mt-2 text-sm text-red-600">{pwdError}</p>}
          {pwdDone && !pwdError && <p className="mt-2 text-sm text-green-600">密码已修改</p>}
          <div className="mt-3 flex justify-end">
            <button
              onClick={changePassword}
              disabled={pwdSaving}
              className="flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-70"
            >
              {pwdSaving && <Loader2 size={15} className="animate-spin" />}
              修改密码
            </button>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-ink-900/10 px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-900/5"
          >
            取消
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-2 text-sm font-semibold text-white transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-70"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
