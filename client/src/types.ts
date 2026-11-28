export type Role = 'ADMIN' | 'TEACHER' | 'STUDENT';
export type MessageType = 'PEER' | 'AI';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

// 被引用消息的快照（服务端随引用消息落库并返回）
export interface MessageQuote {
  id: string;
  senderName: string;
  content: string;
  hasImage: boolean;
  /** 被引用消息为文档附件时的原始文件名（旧快照无此字段） */
  fileName?: string | null;
}

// 消息被引用时收到的提醒（服务端 quote:notify 事件）
export interface QuoteNotify {
  messageId: string;
  quotedMessageId: string;
  groupId: string;
  classroomId: string;
  fromName: string;
  snippet: string;
}

export interface ChatMessage {
  id: string;
  type: MessageType;
  classroomId: string;
  groupId: string;
  documentId: string | null;
  senderId: string;
  senderName: string;
  isAiReply: boolean;
  content: string;
  filePath: string | null;
  /** 附件原始文件名（无附件时为 null） */
  fileOrigName: string | null;
  quote: MessageQuote | null;
  /** 撤回时间（null=未撤回）；撤回后 content/filePath 为空 */
  recalledAt: string | null;
  createdAt: string;
}

export interface Classroom {
  id: string;
  name: string;
  code: string;
  groupCount: number;
  createdAt: string;
  _count?: { groups: number; documents: number };
}

export interface GroupMemberLite {
  id: string;
  userId: string;
  user: { id: string; name: string };
}

export interface Group {
  id: string;
  name: string;
  classroomId: string;
  members: GroupMemberLite[];
}

export interface DocumentLite {
  id: string;
  title: string;
  fileType: string;
  fileName?: string;
  createdAt: string;
}

export interface DocumentDetail extends DocumentLite {
  content: string;
}

// 学生学习笔记（学生端视角：本人 + 组内互见）
export interface NoteItem {
  id: string;
  /** 作者 id（组内互见后区分归属） */
  userId?: string;
  studentName?: string;
  /** 是否本人笔记（本人可编辑删除，组员只读） */
  mine?: boolean;
  documentId: string | null;
  documentTitle: string | null;
  content: string;
  kind?: 'text' | 'highlight' | 'underline';
  quote?: string | null;
  page?: number | null;
  rects?: string | null;
  color?: string | null;
  createdAt: string;
  updatedAt: string;
}

// 教师端查看的学生笔记（分析看板用）
export interface NoteLogItem extends NoteItem {
  userId: string;
  studentName: string;
}

export interface WordCloudItem {
  text: string;
  value: number;
}

export interface GroupCompareItem {
  groupId: string;
  name: string;
  peer: number;
  ai: number;
  active: number;
  memberCount: number;
  notes: number;
}

export interface PersonalProfileItem {
  userId: string;
  name: string;
  groupName: string;
  peer: number;
  ai: number;
}

export interface TimelineItem {
  time: string;
  peer: number;
  ai: number;
}

export interface QuestionLogItem {
  id: string;
  senderId: string;
  senderName: string;
  groupName: string;
  documentTitle: string | null;
  content: string;
  createdAt: string;
  /** 与该提问配对的 AI 回复内容（未收到回复时为 null） */
  aiReply: string | null;
}

// 小组互动记录（学生间聊天原文）；提问记录额外携带配对的 AI 回复，两者结构不再相同
export interface InteractionLogItem {
  id: string;
  senderId: string;
  senderName: string;
  groupName: string;
  documentTitle: string | null;
  content: string;
  createdAt: string;
}

export interface AnalyticsResult {
  peerMessageCount: number;
  aiUsageCount: number;
  activeGroupCount: number;
  participantCount: number;
  wordCloud: WordCloudItem[];
  groupCompare: GroupCompareItem[];
  personalProfiles: PersonalProfileItem[];
  timeline: TimelineItem[];
  network: {
    nodes: { id: string; name: string; group: string; value: number }[];
    links: { source: string; target: string; value: number }[];
  };
  questions: QuestionLogItem[];
  interactions: InteractionLogItem[];
}
