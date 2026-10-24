import { GraduationCap, Users } from 'lucide-react';
import { Empty, Field, LinkButton, MiniStat, SectionCard, StatusDot, Td, Th } from './adminBits';
import type { StudentDetailData } from './types';

export function StudentDetail({
  data,
  onOpenClassroom,
  onResetPassword,
  busy,
}: {
  data: StudentDetailData;
  onOpenClassroom: (id: string, label: string) => void;
  onResetPassword: (id: string, name: string) => void;
  busy: string | null;
}) {
  return (
    <div className="space-y-4">
      <SectionCard
        title={data.student.name}
        icon={<Users size={16} className="text-teal-500" />}
        action={
          <LinkButton
            onClick={() => onResetPassword(data.student.id, data.student.name)}
            disabled={busy === data.student.id}
          >
            重置密码
          </LinkButton>
        }
      >
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="邮箱" value={data.student.email} />
          <Field label="注册时间" value={new Date(data.student.createdAt).toLocaleString('zh-CN')} />
          <Field
            label="AI Key"
            value={
              <span className={data.student.keyActivated ? 'text-emerald-600' : 'text-ink-500'}>
                {data.student.keyActivated ? '已激活' : '未激活'}
              </span>
            }
          />
          <Field
            label="最近活跃"
            value={
              data.lastActiveAt ? new Date(data.lastActiveAt).toLocaleString('zh-CN') : '尚无使用记录'
            }
          />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <MiniStat label="加入课堂" value={data.classrooms.length} color="text-violet-600" bg="bg-violet-500/5" />
          <MiniStat
            label="运行中的容器"
            value={data.classrooms.filter((c) => c.container?.status === 'RUNNING').length}
            color="text-emerald-600"
            bg="bg-emerald-500/5"
          />
          <MiniStat label="AI 提问" value={data.aiQuestions} color="text-brand-600" bg="bg-brand-500/5" />
          <MiniStat label="组内发言" value={data.peerMessages} color="text-teal-600" bg="bg-teal-500/5" />
        </div>
      </SectionCard>

      <SectionCard
        title="加入的课堂"
        icon={<GraduationCap size={16} className="text-brand-500" />}
      >
        <table className="w-full text-sm">
          <thead className="bg-ink-900/[0.03] text-xs text-ink-500">
            <tr>
              <Th>课堂</Th>
              <Th>课堂码</Th>
              <Th>任课教师</Th>
              <Th>所属小组</Th>
              <Th center>容器状态</Th>
              <Th center>最近活跃</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.classrooms.map((c) => (
              <tr key={c.id} className="border-t border-ink-900/5">
                <Td>
                  <span className="font-medium text-ink-900">{c.name}</span>
                </Td>
                <Td>
                  <span className="font-mono text-xs text-ink-500">{c.code}</span>
                </Td>
                <Td>
                  <span className="text-ink-500">{c.teacherName}</span>
                </Td>
                <Td>
                  {c.groupName ?? <span className="text-xs text-ink-500">未分组</span>}
                </Td>
                <td className="px-4 py-3">
                  {c.container ? (
                    <div className="flex justify-center">
                      <StatusDot status={c.container.status} />
                    </div>
                  ) : (
                    <span className="block text-center text-xs text-ink-500">无容器</span>
                  )}
                </td>
                <Td center>
                  <span className="text-xs text-ink-500">
                    {c.container
                      ? new Date(c.container.lastActiveAt).toLocaleString('zh-CN', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'}
                  </span>
                </Td>
                <td className="px-4 py-3 text-right">
                  <LinkButton onClick={() => onOpenClassroom(c.id, c.name)}>查看课堂</LinkButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.classrooms.length && <Empty>该学生还没有加入任何课堂</Empty>}
      </SectionCard>
    </div>
  );
}
