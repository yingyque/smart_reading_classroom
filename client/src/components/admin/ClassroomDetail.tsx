import {
  BookOpenText,
  Container as ContainerIcon,
  FileText,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Users,
} from 'lucide-react';
import { Empty, Field, LinkButton, MiniStat, SectionCard, StatusDot, Td, Th } from './adminBits';
import type { ClassroomDetailData, WorkspaceRow } from './types';

export function ClassroomDetail({
  data,
  busy,
  onVerify,
  onToggleContainer,
  onToggleAll,
  onDeleteContainer,
  onOpenStudent,
}: {
  data: ClassroomDetailData;
  busy: string | null;
  onVerify: () => void;
  onToggleContainer: (c: WorkspaceRow, pause: boolean) => void;
  onToggleAll: (pause: boolean) => void;
  onDeleteContainer: (c: WorkspaceRow) => void;
  onOpenStudent: (id: string, label: string) => void;
}) {
  const a = data.analytics;
  return (
    <div className="space-y-4">
      <SectionCard title={data.classroom.name} icon={<BookOpenText size={16} className="text-violet-500" />}>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="课堂码" value={<span className="font-mono">{data.classroom.code}</span>} />
          <Field
            label="任课教师"
            value={`${data.classroom.teacher.name}（${data.classroom.teacher.email}）`}
          />
          <Field label="创建时间" value={new Date(data.classroom.createdAt).toLocaleString('zh-CN')} />
          <Field label="学生 / 小组 / 文献" value={`${data.studentCount} / ${data.groups.length} / ${data.documents.length}`} />
        </div>
      </SectionCard>

      <SectionCard title="AI 活跃统计" icon={<Users size={16} className="text-teal-500" />}>
        {!a ? (
          <Empty>暂无统计（该课堂还没有消息记录）</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MiniStat label="组内发言" value={a.peerMessageCount} color="text-brand-600" bg="bg-brand-500/5" />
            <MiniStat label="AI 提问" value={a.aiUsageCount} color="text-violet-600" bg="bg-violet-500/5" />
            <MiniStat label="活跃小组" value={a.activeGroupCount} color="text-emerald-600" bg="bg-emerald-500/5" />
            <MiniStat label="活跃学生" value={a.participantCount} color="text-teal-600" bg="bg-teal-500/5" />
          </div>
        )}
      </SectionCard>

      <SectionCard title="小组与成员" icon={<Users size={16} className="text-brand-500" />}>
        {!data.groups.length ? (
          <Empty>该课堂还没有分组</Empty>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data.groups.map((g) => (
              <div key={g.id} className="rounded-xl border border-ink-900/5 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-ink-900">{g.name}</span>
                  <span className="text-xs text-ink-500">{g.members.length} 人</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {g.members.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => onOpenStudent(m.id, m.name)}
                      className="flex items-center gap-1.5 rounded-lg bg-ink-900/5 px-2.5 py-1 text-xs text-ink-700 transition hover:bg-brand-500/10 hover:text-brand-600"
                    >
                      {m.name}
                      <span className={m.keyActivated ? 'text-emerald-600' : 'text-ink-400'}>
                        {m.keyActivated ? 'Key✓' : 'Key✗'}
                      </span>
                    </button>
                  ))}
                  {!g.members.length && <span className="text-xs text-ink-500">暂无成员</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="文献" icon={<FileText size={16} className="text-ink-500" />}>
        {!data.documents.length ? (
          <Empty>还没有上传文献</Empty>
        ) : (
          <div className="space-y-2">
            {data.documents.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-900/5 px-4 py-2"
              >
                <span className="text-sm text-ink-900">{d.title}</span>
                <span className="text-xs text-ink-500">
                  {d.fileType.toUpperCase()} · {new Date(d.createdAt).toLocaleDateString('zh-CN')}
                </span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title={`AI 工作台容器（${data.containers.length}）`}
        icon={<ContainerIcon size={16} className="text-violet-500" />}
        action={
          <div className="flex flex-wrap gap-2">
            <button
              onClick={onVerify}
              disabled={busy !== null}
              className="flex items-center gap-1 rounded-lg border border-ink-900/10 px-3 py-1.5 text-xs text-ink-500 transition hover:border-brand-500 hover:text-brand-600 disabled:opacity-50"
            >
              {busy === 'verify' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              核对真实状态
            </button>
            <button
              onClick={() => onToggleAll(false)}
              disabled={busy !== null}
              className="flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
            >
              <Play size={13} /> 全部开启
            </button>
            <button
              onClick={() => onToggleAll(true)}
              disabled={busy !== null}
              className="flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
            >
              <Pause size={13} /> 全部暂停
            </button>
          </div>
        }
      >
        {data.verifiedAt && (
          <p className="mb-3 text-xs text-ink-500">
            已于 {new Date(data.verifiedAt).toLocaleString('zh-CN')} 核对 Docker 真实状态
          </p>
        )}
        <table className="w-full text-sm">
          <thead className="bg-ink-900/[0.03] text-xs text-ink-500">
            <tr>
              <Th>学生</Th>
              <Th>容器</Th>
              <Th center>状态</Th>
              <Th center>Key</Th>
              <Th center>Docker</Th>
              <Th center>最近活跃</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.containers.map((c) => {
              const rt = data.runtime?.[c.containerName];
              return (
                <tr key={c.id} className="border-t border-ink-900/5">
                  <Td>
                    <div className="font-medium text-ink-900">{c.studentName}</div>
                    <div className="text-xs text-ink-500">{c.studentEmail}</div>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs text-ink-500">{c.containerName}</span>
                  </Td>
                  <td className="px-4 py-3">
                    <div className="flex justify-center">
                      <StatusDot status={c.status} />
                    </div>
                  </td>
                  <Td center>
                    <span className={c.keyActivated ? 'text-emerald-600' : 'text-ink-500'}>
                      {c.keyActivated ? '已激活' : '未激活'}
                    </span>
                  </Td>
                  <Td center>
                    {rt ? (
                      <span className={rt.running ? 'text-emerald-600' : 'text-amber-600'}>{rt.state}</span>
                    ) : (
                      <span className="text-ink-500/50">未核对</span>
                    )}
                  </Td>
                  <Td center>
                    <span className="text-xs text-ink-500">
                      {new Date(c.lastActiveAt).toLocaleString('zh-CN', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </Td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      {c.status === 'RUNNING' ? (
                        <LinkButton onClick={() => onToggleContainer(c, true)} disabled={busy !== null}>
                          {busy === c.id ? '处理中…' : '暂停'}
                        </LinkButton>
                      ) : (
                        <LinkButton onClick={() => onToggleContainer(c, false)} disabled={busy !== null}>
                          {busy === c.id ? '处理中…' : '开启'}
                        </LinkButton>
                      )}
                      <button
                        onClick={() => onDeleteContainer(c)}
                        disabled={busy !== null}
                        className="text-xs text-red-500 hover:underline disabled:text-ink-500/50 disabled:no-underline"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!data.containers.length && <Empty>该课堂还没有学生加入</Empty>}
      </SectionCard>
    </div>
  );
}
