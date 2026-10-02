// 共享类型定义：角色、消息、分析结果结构

export type Role = 'TEACHER' | 'STUDENT';

export type MessageType = 'PEER' | 'AI';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface JwtPayload {
  id: string;
  role: Role;
}

// 实时聊天消息（落库后广播的形态）
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

// Socket.IO 事件负载
export interface JoinGroupPayload {
  groupId: string;
}

export interface SendPeerMessagePayload {
  groupId: string;
  documentId: string | null;
  content: string;
}

export interface SendAiMessagePayload {
  groupId: string;
  documentId: string | null;
  content: string;
}

// 分析聚合返回结构
export interface WordCloudItem {
  text: string;
  value: number;
}

export interface GroupCompareItem {
  groupId: string;
  name: string;
  peer: number;
  ai: number;
  active: number; // 活跃成员数
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

export interface InteractionNode {
  id: string;
  name: string;
  group: string;
  value: number;
}

export interface InteractionLink {
  source: string;
  target: string;
  value: number;
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
    nodes: InteractionNode[];
    links: InteractionLink[];
  };
}
