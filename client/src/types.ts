export type Role = 'TEACHER' | 'STUDENT';
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
}
