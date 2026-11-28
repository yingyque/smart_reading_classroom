// 共享类型定义：角色、消息、分析结果结构

export type Role = 'ADMIN' | 'TEACHER' | 'STUDENT';

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

// 被引用消息的快照（随引用消息落库，展示时不依赖原消息存在）
export interface MessageQuote {
  id: string;
  senderName: string;
  content: string;
  hasImage: boolean;
  /** 被引用消息为文档附件时的原始文件名（旧快照无此字段） */
  fileName?: string | null;
}

// 单个聊天附件（服务端已校验存储名，防路径穿越）
export interface ChatAttachment {
  /** 服务端存储名（uploads/chat/ 下） */
  path: string;
  /** 用户侧原始文件名（气泡展示用） */
  origName: string | null;
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
  filePath: string | null;
  /** 附件原始文件名（无附件时为 null） */
  fileOrigName: string | null;
  /** 附件列表（服务端已归一化：新消息读 attachments 列，旧消息由 filePath 回退；无附件为空数组） */
  attachments: ChatAttachment[];
  quote: MessageQuote | null;
  /** 撤回时间（null=未撤回）；撤回后 content/filePath 已清空 */
  recalledAt: string | null;
  createdAt: string;
}

// Socket.IO 事件负载
export interface JoinGroupPayload {
  groupId: string;
}

// 消息被引用时对原作者的提醒（发到其私有房间 user:<id>）
export interface QuoteNotifyPayload {
  /** 引用产生的新消息 id */
  messageId: string;
  /** 被引用的原消息 id（前端跳转定位用） */
  quotedMessageId: string;
  groupId: string;
  classroomId: string;
  /** 引用者姓名 */
  fromName: string;
  /** 被引用内容摘要 */
  snippet: string;
}

export interface SendPeerMessagePayload {
  groupId: string;
  documentId: string | null;
  content: string;
  filePath?: string | null;
  /** 附件原始文件名（随 filePath 一起校验存储） */
  fileOrigName?: string | null;
  /** 多附件数组（新客户端；优先于 filePath，两者都没有时回退 filePath） */
  files?: { path: string; origName?: string | null }[] | null;
  /** 引用的消息 id（须为同小组的 PEER 消息） */
  quoteId?: string | null;
}

export interface SendAiMessagePayload {
  groupId: string;
  documentId: string | null;
  content: string;
  filePath?: string | null;
  fileOrigName?: string | null;
  /** 多附件数组（新客户端；优先于 filePath，两者都没有时回退 filePath） */
  files?: { path: string; origName?: string | null }[] | null;
}

// 撤回自己的小组消息（仅 PEER，2 分钟内）
export interface RecallMessagePayload {
  messageId: string;
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
  notes: number; // 组内学生的笔记总数（含普通笔记/高亮/划线）
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

export interface QuestionLogItem {
  id: string;
  senderId: string;
  senderName: string;
  groupName: string;
  documentTitle: string | null;
  content: string;
  createdAt: Date;
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
  createdAt: Date;
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
  questions: QuestionLogItem[];
  interactions: InteractionLogItem[];
}
