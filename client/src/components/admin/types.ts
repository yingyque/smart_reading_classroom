// 管理员端详情面板用到的类型（与 server/src/routes/admin.ts 的返回体一一对应）
import type { AnalyticsResult } from '../../types';

export interface ContainerStats {
  total: number;
  running: number;
  paused: number;
  created: number;
  keyActivated: number;
}

export interface SimpleContainerStats {
  total: number;
  running: number;
  paused: number;
}

export interface Overview {
  teacherCount: number;
  studentCount: number;
  classroomCount: number;
  containers: ContainerStats;
}

export interface TeacherRow {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  classroomCount: number;
  containers: ContainerStats;
}

export interface StudentRow {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  keyActivated: boolean;
  classroomCount: number;
  containers: SimpleContainerStats;
}

export interface ClassroomRow {
  id: string;
  name: string;
  code: string;
  groupCount: number;
  groupCountActual: number;
  documentCount: number;
  createdAt: string;
  teacher: { id: string; name: string; email: string };
  containers: ContainerStats;
}

export interface WorkspaceRow {
  id: string;
  studentName: string;
  studentEmail: string;
  containerName: string;
  status: string;
  keyActivated: boolean;
  lastActiveAt: string;
  createdAt: string;
}

export interface ContainerRuntime {
  exists: boolean;
  running: boolean;
  state: string;
}

export interface TeacherDetailData {
  teacher: { id: string; name: string; email: string; createdAt: string };
  classrooms: {
    id: string;
    name: string;
    code: string;
    createdAt: string;
    groupCount: number;
    documentCount: number;
    studentCount: number;
    containers: ContainerStats;
  }[];
  students: { id: string; name: string; email: string; classrooms: { id: string; name: string }[] }[];
}

export interface ClassroomDetailData {
  classroom: {
    id: string;
    name: string;
    code: string;
    groupCount: number;
    createdAt: string;
    teacher: { id: string; name: string; email: string };
  };
  groups: { id: string; name: string; members: { id: string; name: string; email: string; keyActivated: boolean }[] }[];
  documents: { id: string; title: string; fileType: string; createdAt: string }[];
  containers: WorkspaceRow[];
  studentCount: number;
  analytics: AnalyticsResult | null;
  runtime?: Record<string, ContainerRuntime>;
  verifiedAt?: string;
}

export interface StudentDetailData {
  student: { id: string; name: string; email: string; createdAt: string; keyActivated: boolean };
  classrooms: {
    id: string;
    name: string;
    code: string;
    teacherName: string;
    groupName: string | null;
    container: {
      workspaceId: string;
      containerName: string;
      status: string;
      keyActivated: boolean;
      lastActiveAt: string;
    } | null;
  }[];
  lastActiveAt: string | null;
  aiQuestions: number;
  peerMessages: number;
}

export type DetailData = TeacherDetailData | ClassroomDetailData | StudentDetailData;

// 详情下钻栈（教师 → 课堂 → 学生），label 用于面包屑
export interface DetailRef {
  kind: 'teacher' | 'student' | 'classroom';
  id: string;
  label: string;
}
