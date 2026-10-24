import { BookOpenText, GraduationCap, Users } from 'lucide-react';
import { Empty, Field, LinkButton, MiniStat, SectionCard, Td, Th } from './adminBits';
import type { TeacherDetailData } from './types';

export function TeacherDetail({
  data,
  onOpenClassroom,
  onOpenStudent,
  onResetPassword,
  busy,
}: {
  data: TeacherDetailData;
  onOpenClassroom: (id: string, label: string) => void;
  onOpenStudent: (id: string, label: string) => void;
  onResetPassword: (id: string, name: string) => void;
  busy: string | null;
}) {
  const totals = data.classrooms.reduce(
    (acc, c) => ({
      total: acc.total + c.containers.total,
      running: acc.running + c.containers.running,
      paused: acc.paused + c.containers.paused,
      keyActivated: acc.keyActivated + c.containers.keyActivated,
    }),
    { total: 0, running: 0, paused: 0, keyActivated: 0 },
  );

  return (
    <div className="space-y-4">
      <SectionCard
        title={data.teacher.name}
        icon={<GraduationCap size={16} className="text-brand-500" />}
        action={
          <LinkButton
            onClick={() => onResetPassword(data.teacher.id, data.teacher.name)}
            disabled={busy === data.teacher.id}
          >
            重置密码
          </LinkButton>
        }
      >
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="邮箱" value={data.teacher.email} />
          <Field label="注册时间" value={new Date(data.teacher.createdAt).toLocaleString('zh-CN')} />
          <Field label="课堂数" value={data.classrooms.length} />
          <Field label="学生数（去重）" value={data.students.length} />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <MiniStat label="容器总数" value={totals.total} color="text-violet-600" bg="bg-violet-500/5" />
          <MiniStat label="运行中" value={totals.running} color="text-emerald-600" bg="bg-emerald-500/5" />
          <MiniStat label="已暂停" value={totals.paused} color="text-amber-600" bg="bg-amber-500/5" />
          <MiniStat label="已激活 Key" value={totals.keyActivated} color="text-brand-600" bg="bg-brand-500/5" />
        </div>
      </SectionCard>

      <SectionCard
        title="名下课堂"
        icon={<BookOpenText size={16} className="text-violet-500" />}
      >
        <table className="w-full text-sm">
          <thead className="bg-ink-900/[0.03] text-xs text-ink-500">
            <tr>
              <Th>课堂</Th>
              <Th>课堂码</Th>
              <Th center>小组</Th>
              <Th center>学生</Th>
              <Th center>文献</Th>
              <Th center>容器 总/运行/暂停</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.classrooms.map((c) => (
              <tr key={c.id} className="border-t border-ink-900/5">
                <Td>{c.name}</Td>
                <Td>
                  <span className="font-mono text-xs text-ink-500">{c.code}</span>
                </Td>
                <Td center>{c.groupCount}</Td>
                <Td center>{c.studentCount}</Td>
                <Td center>{c.documentCount}</Td>
                <Td center>
                  {c.containers.total} / <span className="text-emerald-600">{c.containers.running}</span> /{' '}
                  <span className="text-amber-600">{c.containers.paused}</span>
                </Td>
                <td className="px-4 py-3 text-right">
                  <LinkButton onClick={() => onOpenClassroom(c.id, c.name)}>查看详情</LinkButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.classrooms.length && <Empty>该教师还没有创建课堂</Empty>}
      </SectionCard>

      <SectionCard title="课堂学生（跨课堂去重）" icon={<Users size={16} className="text-teal-500" />}>
        <table className="w-full text-sm">
          <thead className="bg-ink-900/[0.03] text-xs text-ink-500">
            <tr>
              <Th>学生</Th>
              <Th>邮箱</Th>
              <Th>所属课堂</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.students.map((s) => (
              <tr key={s.id} className="border-t border-ink-900/5">
                <Td>
                  <span className="font-medium text-ink-900">{s.name}</span>
                </Td>
                <Td>
                  <span className="text-ink-500">{s.email}</span>
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {s.classrooms.map((c) => (
                      <span key={c.id} className="rounded-md bg-ink-900/5 px-2 py-0.5 text-xs text-ink-600">
                        {c.name}
                      </span>
                    ))}
                  </div>
                </Td>
                <td className="px-4 py-3 text-right">
                  <LinkButton onClick={() => onOpenStudent(s.id, s.name)}>查看详情</LinkButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.students.length && <Empty>这些课堂里还没有学生加入</Empty>}
      </SectionCard>
    </div>
  );
}
