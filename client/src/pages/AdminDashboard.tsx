import { useEffect, useState } from 'react';
import {
  BookOpenText,
  Container as ContainerIcon,
  GraduationCap,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/cn';
import { Empty, LinkButton, MiniStat, StatCard, Td, Th } from '../components/admin/adminBits';
import { DetailShell } from '../components/admin/DetailShell';
import { TeacherDetail } from '../components/admin/TeacherDetail';
import { ClassroomDetail } from '../components/admin/ClassroomDetail';
import { StudentDetail } from '../components/admin/StudentDetail';
import type {
  ClassroomDetailData,
  ClassroomRow,
  DetailData,
  DetailRef,
  Overview,
  StudentDetailData,
  StudentRow,
  TeacherDetailData,
  TeacherRow,
  WorkspaceRow,
} from '../components/admin/types';

type Tab = 'teachers' | 'students' | 'classrooms';

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('teachers');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [classrooms, setClassrooms] = useState<ClassroomRow[]>([]);
  // 详情下钻：stack 记录 教师 → 课堂 → 学生 的层级，返回键逐层出栈
  const [stack, setStack] = useState<DetailRef[]>([]);
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');

  const loadAll = async () => {
    setLoading(true);
    setError('');
    try {
      const [o, t, s, c] = await Promise.all([
        api.get('/shimin/overview'),
        api.get('/shimin/teachers'),
        api.get('/shimin/students'),
        api.get('/shimin/classrooms'),
      ]);
      setOverview(o.data);
      setTeachers(t.data);
      setStudents(s.data);
      setClassrooms(c.data);
    } catch (err) {
      setError(errorOf(err, '加载数据失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const loadDetail = async (kind: DetailRef['kind'], id: string, verify = false) => {
    setDetailLoading(true);
    setError('');
    try {
      const path =
        kind === 'teacher'
          ? `/shimin/teachers/${id}`
          : kind === 'student'
            ? `/shimin/students/${id}`
            : `/shimin/classrooms/${id}${verify ? '?verify=1' : ''}`;
      const res = await api.get(path);
      setDetail(res.data as DetailData);
    } catch (err) {
      setError(errorOf(err, '加载详情失败'));
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  // 下钻：replace=true 时替换当前层（同层跳转），否则压栈
  const openDetail = (ref: DetailRef, replace = false) => {
    setStack((prev) => (replace ? [...prev.slice(0, -1), ref] : [...prev, ref]));
    loadDetail(ref.kind, ref.id);
  };

  const back = () => {
    const prev = stack[stack.length - 2];
    setStack((s) => s.slice(0, -1));
    if (prev) loadDetail(prev.kind, prev.id);
    else setDetail(null);
  };

  const openTeacher = (t: TeacherRow) =>
    openDetail({ kind: 'teacher', id: t.id, label: t.name });
  const openStudent = (id: string, label: string) =>
    openDetail({ kind: 'student', id, label });
  const openClassroom = (id: string, label: string) =>
    openDetail({ kind: 'classroom', id, label });

  const classroomData = detail && stack[stack.length - 1]?.kind === 'classroom'
    ? (detail as ClassroomDetailData)
    : null;

  const verifyRuntime = () => {
    const cur = stack[stack.length - 1];
    if (!cur) return;
    setBusy('verify');
    loadDetail(cur.kind, cur.id, true).finally(() => setBusy(null));
  };

  const toggleContainer = async (c: WorkspaceRow, pause: boolean) => {
    setBusy(c.id);
    try {
      await api.post(`/shimin/containers/${c.id}/${pause ? 'pause' : 'resume'}`);
      const cur = stack[stack.length - 1];
      if (cur) await loadDetail(cur.kind, cur.id);
    } catch (err) {
      setError(errorOf(err, '操作失败'));
    } finally {
      setBusy(null);
    }
  };

  // 删除是不可逆操作，需二次确认；学生下次提问会自动重建容器
  const deleteContainer = async (c: WorkspaceRow) => {
    if (!window.confirm(`确定删除 ${c.studentName} 的 AI 工作台（${c.containerName}）吗？\n容器会被销毁、记录一并删除，该学生下次提问时会自动重建。`)) {
      return;
    }
    setBusy(c.id);
    try {
      await api.delete(`/shimin/containers/${c.id}`);
      const cur = stack[stack.length - 1];
      if (cur) await loadDetail(cur.kind, cur.id);
      await loadAll();
    } catch (err) {
      setError(errorOf(err, '删除失败'));
    } finally {
      setBusy(null);
    }
  };

  // 重置教师/学生密码：留空则服务端随机生成，成功后把明文告知管理员转达给用户
  const resetPassword = async (id: string, name: string) => {
    const input = window.prompt(
      `重置 ${name} 的密码\n请输入新密码（至少 6 位），留空则由系统随机生成`,
      '',
    );
    if (input === null) return;
    setBusy(id);
    try {
      const res = await api.post(`/shimin/users/${id}/reset-password`, { password: input.trim() });
      window.alert(`${name} 的密码已重置为：${res.data.password}\n请及时告知该用户并提醒其修改。`);
    } catch (err) {
      setError(errorOf(err, '重置密码失败'));
    } finally {
      setBusy(null);
    }
  };

  const toggleAll = async (pause: boolean) => {
    if (!classroomData) return;
    setBusy('all');
    try {
      await api.post(`/shimin/classrooms/${classroomData.classroom.id}/pause-all`, { paused: pause });
      await loadDetail('classroom', classroomData.classroom.id);
    } catch (err) {
      setError(errorOf(err, '操作失败'));
    } finally {
      setBusy(null);
    }
  };

  const tabs: [Tab, string, JSX.Element][] = [
    ['teachers', '教师', <GraduationCap key="t" size={15} />],
    ['students', '学生', <Users key="s" size={15} />],
    ['classrooms', '课堂', <BookOpenText key="c" size={15} />],
  ];

  return (
    <div className="min-h-screen bg-[#f7f8fa]">
      <nav className="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between border-b border-ink-900/5 bg-white/80 px-6 backdrop-blur-md">
        <div className="flex items-center gap-2 font-bold text-ink-900">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-500 text-white">
            <ShieldCheck size={18} />
          </div>
          智慧阅读 · 管理员端
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-ink-500">{user?.name} · 管理员</span>
          <button
            onClick={logout}
            className="flex items-center gap-1 text-sm text-ink-500 hover:text-red-600"
          >
            <LogOut size={16} /> 退出
          </button>
        </div>
      </nav>

      <div className="mx-auto max-w-7xl space-y-6 px-4 pt-24 pb-10">
        {/* 概览 */}
        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard icon={<GraduationCap size={18} />} label="教师" value={overview?.teacherCount ?? 0} tone="brand" />
          <StatCard icon={<Users size={18} />} label="学生" value={overview?.studentCount ?? 0} tone="teal" />
          <StatCard icon={<BookOpenText size={18} />} label="课堂" value={overview?.classroomCount ?? 0} tone="violet" />
          <StatCard icon={<ContainerIcon size={18} />} label="AI 容器" value={overview?.containers.total ?? 0} tone="ink" />
        </section>

        <section className="rounded-2xl border border-ink-900/5 bg-white p-6 shadow-soft">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold text-ink-900">
              <ContainerIcon size={18} className="text-violet-500" /> 容器总览
            </h2>
            <button
              onClick={loadAll}
              className="flex items-center gap-1 rounded-lg border border-ink-900/10 px-3 py-1.5 text-xs text-ink-500 transition hover:border-brand-500 hover:text-brand-600"
            >
              <RefreshCw size={13} /> 刷新
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <MiniStat label="容器总数" value={overview?.containers.total ?? 0} color="text-violet-600" bg="bg-violet-500/5" />
            <MiniStat label="运行中" value={overview?.containers.running ?? 0} color="text-emerald-600" bg="bg-emerald-500/5" />
            <MiniStat label="已暂停" value={overview?.containers.paused ?? 0} color="text-amber-600" bg="bg-amber-500/5" />
            <MiniStat label="待启动" value={overview?.containers.created ?? 0} color="text-ink-500" bg="bg-ink-900/5" />
            <MiniStat label="已激活 Key" value={overview?.containers.keyActivated ?? 0} color="text-brand-600" bg="bg-brand-500/5" />
          </div>
          <p className="mt-3 text-xs text-ink-500">
            容器与课堂中的学生一一对应（加入课堂即创建）。点教师/学生/课堂可查看详情；课堂详情里可管理容器并核对 Docker 实际情况。
          </p>
        </section>

        {error && <p className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

        {/* 详情面板：与列表互斥展示 */}
        {detail && stack.length > 0 ? (
          <DetailShell stack={stack} loading={detailLoading} onBack={back}>
            {!detailLoading && stack[stack.length - 1].kind === 'teacher' && (
              <TeacherDetail
                data={detail as TeacherDetailData}
                onOpenClassroom={openClassroom}
                onOpenStudent={openStudent}
                onResetPassword={resetPassword}
                busy={busy}
              />
            )}
            {!detailLoading && classroomData && (
              <ClassroomDetail
                data={classroomData}
                busy={busy}
                onVerify={verifyRuntime}
                onToggleContainer={toggleContainer}
                onToggleAll={toggleAll}
                onDeleteContainer={deleteContainer}
                onOpenStudent={openStudent}
              />
            )}
            {!detailLoading && stack[stack.length - 1].kind === 'student' && (
              <StudentDetail
                data={detail as StudentDetailData}
                onOpenClassroom={openClassroom}
                onResetPassword={resetPassword}
                busy={busy}
              />
            )}
          </DetailShell>
        ) : (
          <>
            <div className="flex gap-2">
              {tabs.map(([key, label, icon]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-all',
                    tab === key
                      ? 'bg-white text-brand-600 shadow-soft'
                      : 'text-ink-500 hover:bg-white/60 hover:text-ink-900',
                  )}
                >
                  {icon} {label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="flex items-center justify-center rounded-2xl border border-ink-900/5 bg-white py-16 text-ink-500 shadow-soft">
                <Loader2 className="mr-2 animate-spin" size={18} /> 加载中…
              </div>
            ) : (
              <>
                {tab === 'teachers' && (
                  <section className="overflow-hidden rounded-2xl border border-ink-900/5 bg-white shadow-soft">
                    <table className="w-full text-sm">
                      <thead className="bg-ink-900/[0.03] text-xs text-ink-500">
                        <tr>
                          <Th>教师</Th>
                          <Th>邮箱</Th>
                          <Th center>课堂数</Th>
                          <Th center>容器 总/运行/暂停</Th>
                          <Th center>已激活 Key</Th>
                          <Th>注册时间</Th>
                          <Th />
                        </tr>
                      </thead>
                      <tbody>
                        {teachers.map((t) => (
                          <tr
                            key={t.id}
                            onClick={() => openTeacher(t)}
                            className="cursor-pointer border-t border-ink-900/5 transition hover:bg-brand-500/[0.04]"
                          >
                            <Td>
                              <span className="font-medium text-ink-900">{t.name}</span>
                            </Td>
                            <Td>
                              <span className="text-ink-500">{t.email}</span>
                            </Td>
                            <Td center>{t.classroomCount}</Td>
                            <Td center>
                              {t.containers.total} /{' '}
                              <span className="text-emerald-600">{t.containers.running}</span> /{' '}
                              <span className="text-amber-600">{t.containers.paused}</span>
                            </Td>
                            <Td center>{t.containers.keyActivated}</Td>
                            <Td>
                              <span className="text-xs text-ink-500">
                                {new Date(t.createdAt).toLocaleDateString('zh-CN')}
                              </span>
                            </Td>
                            <td className="px-4 py-3 text-right">
                              <span className="flex justify-end gap-3">
                                <LinkButton
                                  onClick={() => resetPassword(t.id, t.name)}
                                  disabled={busy === t.id}
                                >
                                  重置密码
                                </LinkButton>
                                <LinkButton onClick={() => openTeacher(t)}>查看详情</LinkButton>
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!teachers.length && <Empty>还没有教师账号</Empty>}
                  </section>
                )}

                {tab === 'students' && (
                  <section className="overflow-hidden rounded-2xl border border-ink-900/5 bg-white shadow-soft">
                    <table className="w-full text-sm">
                      <thead className="bg-ink-900/[0.03] text-xs text-ink-500">
                        <tr>
                          <Th>学生</Th>
                          <Th>邮箱</Th>
                          <Th center>加入课堂</Th>
                          <Th center>容器 总/运行/暂停</Th>
                          <Th center>AI Key</Th>
                          <Th>注册时间</Th>
                          <Th />
                        </tr>
                      </thead>
                      <tbody>
                        {students.map((s) => (
                          <tr key={s.id} className="border-t border-ink-900/5">
                            <Td>
                              <span className="font-medium text-ink-900">{s.name}</span>
                            </Td>
                            <Td>
                              <span className="text-ink-500">{s.email}</span>
                            </Td>
                            <Td center>{s.classroomCount}</Td>
                            <Td center>
                              {s.containers.total} /{' '}
                              <span className="text-emerald-600">{s.containers.running}</span> /{' '}
                              <span className="text-amber-600">{s.containers.paused}</span>
                            </Td>
                            <Td center>
                              <span className={s.keyActivated ? 'text-emerald-600' : 'text-ink-500'}>
                                {s.keyActivated ? '已激活' : '未激活'}
                              </span>
                            </Td>
                            <Td>
                              <span className="text-xs text-ink-500">
                                {new Date(s.createdAt).toLocaleDateString('zh-CN')}
                              </span>
                            </Td>
                            <td className="px-4 py-3 text-right">
                              <span className="flex justify-end gap-3">
                                <LinkButton
                                  onClick={() => resetPassword(s.id, s.name)}
                                  disabled={busy === s.id}
                                >
                                  重置密码
                                </LinkButton>
                                <LinkButton onClick={() => openStudent(s.id, s.name)} disabled={!s.classroomCount}>
                                  查看详情
                                </LinkButton>
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!students.length && <Empty>还没有学生账号</Empty>}
                  </section>
                )}

                {tab === 'classrooms' && (
                  <section className="overflow-hidden rounded-2xl border border-ink-900/5 bg-white shadow-soft">
                    <table className="w-full text-sm">
                      <thead className="bg-ink-900/[0.03] text-xs text-ink-500">
                        <tr>
                          <Th>课堂</Th>
                          <Th>课堂码</Th>
                          <Th>任课教师</Th>
                          <Th center>组数</Th>
                          <Th center>文献</Th>
                          <Th center>容器 总/运行/暂停</Th>
                          <Th center>已激活 Key</Th>
                          <Th />
                        </tr>
                      </thead>
                      <tbody>
                        {classrooms.map((c) => (
                          <tr
                            key={c.id}
                            onClick={() => openClassroom(c.id, c.name)}
                            className="cursor-pointer border-t border-ink-900/5 transition hover:bg-brand-500/[0.04]"
                          >
                            <Td>
                              <span className="font-medium text-ink-900">{c.name}</span>
                            </Td>
                            <Td>
                              <span className="font-mono text-xs text-ink-500">{c.code}</span>
                            </Td>
                            <Td>
                              <span className="text-ink-500">{c.teacher.name}</span>
                            </Td>
                            <Td center>{c.groupCountActual}</Td>
                            <Td center>{c.documentCount}</Td>
                            <Td center>
                              {c.containers.total} /{' '}
                              <span className="text-emerald-600">{c.containers.running}</span> /{' '}
                              <span className="text-amber-600">{c.containers.paused}</span>
                            </Td>
                            <Td center>{c.containers.keyActivated}</Td>
                            <td className="px-4 py-3 text-right">
                              <LinkButton onClick={() => openClassroom(c.id, c.name)}>查看详情</LinkButton>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!classrooms.length && <Empty>还没有课堂</Empty>}
                  </section>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function errorOf(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;
}
