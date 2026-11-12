export type Role = 'ADMIN' | 'TEACHER' | 'STUDENT';
export type MessageType = 'PEER' | 'AI';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
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
