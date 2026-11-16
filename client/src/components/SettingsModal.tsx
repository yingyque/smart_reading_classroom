import { useState } from 'react';
import { Loader2, Settings, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

/** 设置弹窗：修改姓名（保存后全局生效，无需重新登录） */
export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { user, updateUser } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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
