import { prisma } from '../lib/prisma';
import {
  AnalyticsResult,
  GroupCompareItem,
  InteractionLink,
  InteractionLogItem,
  InteractionNode,
  PersonalProfileItem,
  QuestionLogItem,
  TimelineItem,
  WordCloudItem,
} from '../types';

// 中文分词：@node-rs/jieba（napi-rs 预编译二进制，兼容容器 GLIBC 2.36）。
// 原用 nodejieba 的预编译产物要求 GLIBC_2.38，在 Debian 12 容器内调用时才抛错，
// 降级为按标点切分后中文整句会进词云。若该模块加载/调用失败，仍退化为简易分词保证可运行。
let jiebaCut: ((text: string) => string[]) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Jieba } = require('@node-rs/jieba');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { dict } = require('@node-rs/jieba/dict');
  const jieba = Jieba.withDict(dict);
  jiebaCut = (text: string) => jieba.cut(text, false);
} catch (err) {
  console.warn('[analytics] @node-rs/jieba 不可用，词云将使用简易分词:', (err as Error).message);
}

// 中英文停用词（精简常用集）
const STOPWORDS = new Set([
  '的','了','和','是','我','你','他','她','它','我们','你们','他们','这','那','有','在','就','都','而','及','与','着','或','一个','没有','我们','这个','那个','这些','那些','不','也','很','但','还','被','把','对','让','给','到','能','会','可以','这样','那样','什么','怎么','如果','因为','所以','但是','可能','觉得','感觉','就是','还是','这种','一些','知道','大家','老师','同学','问题','觉得',
  'the','a','an','is','are','was','were','be','to','of','and','or','in','on','at','for','with','as','by','that','this','these','those','it','i','you','he','she','we','they','my','your','so','but','not','do','does','did','can','will','would','about','what','how','if','because',
]);

function tokenize(text: string): string[] {
  const words = tokenizeRaw(text);
  return words
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 1 && !STOPWORDS.has(w) && !/^[\d\W_]+$/.test(w));
}

function tokenizeRaw(text: string): string[] {
  // 原生模块可能在调用时才暴露运行环境不兼容（如 GLIBC 版本过低），
  // 此时永久降级为简易分词，避免 buildAnalytics 整体失败
  if (jiebaCut) {
    try {
      return jiebaCut(text);
    } catch (err) {
      console.warn('[analytics] @node-rs/jieba 调用失败，已切换为简易分词:', (err as Error).message);
      jiebaCut = null;
    }
  }
  return text.split(/[\s，。！？、；：,.!?;:()\[\]{}"'\n\r]+/);
}

export async function buildAnalytics(classroomId: string): Promise<AnalyticsResult> {
  const [messages, groups] = await Promise.all([
    prisma.message.findMany({
      where: { classroomId },
      include: { sender: true, group: true, document: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.group.findMany({
      where: { classroomId },
      include: { members: { include: { user: true } } },
    }),
  ]);

  const peerMessages = messages.filter((m) => m.type === 'PEER' && !m.isAiReply);
  const aiMessages = messages.filter((m) => m.type === 'AI' && !m.isAiReply);

  // 词云：仅统计学生发出的内容（PEER + 向 AI 提问），排除 AI 回复
  const studentTexts = messages.filter((m) => !m.isAiReply).map((m) => m.content).join('\n');
  const wordCloud = buildWordCloud(studentTexts);

  // 时间线：按小时聚合
  const timeline = buildTimeline(peerMessages, aiMessages);

  // 小组对比与个人画像
  const groupCompare: GroupCompareItem[] = [];
  const personalProfiles: PersonalProfileItem[] = [];
  const activeUserIds = new Set<string>();

  for (const g of groups) {
    const gPeer = peerMessages.filter((m) => m.groupId === g.id);
    const gAi = aiMessages.filter((m) => m.groupId === g.id);
    const activeMembers = new Set<string>();

    for (const member of g.members) {
      const uPeer = gPeer.filter((m) => m.senderId === member.userId).length;
      const uAi = gAi.filter((m) => m.senderId === member.userId).length;
      if (uPeer + uAi > 0) {
        activeMembers.add(member.userId);
        activeUserIds.add(member.userId);
      }
      personalProfiles.push({
        userId: member.userId,
        name: member.user.name,
        groupName: g.name,
        peer: uPeer,
        ai: uAi,
      });
    }

    groupCompare.push({
      groupId: g.id,
      name: g.name,
      peer: gPeer.length,
      ai: gAi.length,
      active: activeMembers.size,
      memberCount: g.members.length,
    });
  }

  const network = buildNetwork(peerMessages, groups);

  // 提问与 AI 回复配对：消息按时间升序，同一学生同一小组内，
  // 每条 AI 回复归属其之前最近一条尚未配对的提问（单用户提问串行，一一对应）
  const replyByQuestion = new Map<string, string>();
  const pendingQuestion = new Map<string, string>(); // key: senderId:groupId -> 待配对提问 id
  for (const m of messages) {
    if (m.type !== 'AI') continue;
    const key = `${m.senderId}:${m.groupId}`;
    if (!m.isAiReply) {
      pendingQuestion.set(key, m.id);
    } else {
      const qId = pendingQuestion.get(key);
      if (qId) {
        replyByQuestion.set(qId, m.content);
        pendingQuestion.delete(key);
      }
    }
  }

  // 学生原始提问记录（向 AI 提问的原文 + 配对的 AI 回复），最新在前
  const questions: QuestionLogItem[] = aiMessages
    .map((m) => ({
      id: m.id,
      senderId: m.senderId,
      senderName: m.sender.name,
      groupName: m.group.name,
      documentTitle: m.document?.title ?? null,
      content: m.content,
      createdAt: m.createdAt,
      aiReply: replyByQuestion.get(m.id) ?? null,
    }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  // 小组互动记录（学生间聊天的原文），最新在前
  const interactions: InteractionLogItem[] = peerMessages
    .map((m) => ({
      id: m.id,
      senderId: m.senderId,
      senderName: m.sender.name,
      groupName: m.group.name,
      documentTitle: m.document?.title ?? null,
      content: m.content,
      createdAt: m.createdAt,
    }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return {
    peerMessageCount: peerMessages.length,
    aiUsageCount: aiMessages.length,
    activeGroupCount: groupCompare.filter((g) => g.peer + g.ai > 0).length,
    participantCount: activeUserIds.size,
    wordCloud,
    groupCompare,
    personalProfiles: personalProfiles.sort((a, b) => b.peer + b.ai - (a.peer + a.ai)),
    timeline,
    network,
    questions,
    interactions,
  };
}

function buildWordCloud(text: string): WordCloudItem[] {
  const freq = new Map<string, number>();
  for (const token of tokenize(text)) {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }
  return Array.from(freq.entries())
    .map(([t, v]) => ({ text: t, value: v }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 80);
}

function buildTimeline(peer: { createdAt: Date }[], ai: { createdAt: Date }[]): TimelineItem[] {
  const bucket = new Map<string, { peer: number; ai: number }>();
  const key = (d: Date) => {
    const dt = new Date(d);
    dt.setMinutes(0, 0, 0);
    return dt.toISOString().slice(0, 13).replace('T', ' ') + ':00';
  };
  for (const m of peer) {
    const k = key(m.createdAt);
    const b = bucket.get(k) ?? { peer: 0, ai: 0 };
    b.peer += 1;
    bucket.set(k, b);
  }
  for (const m of ai) {
    const k = key(m.createdAt);
    const b = bucket.get(k) ?? { peer: 0, ai: 0 };
    b.ai += 1;
    bucket.set(k, b);
  }
  return Array.from(bucket.entries())
    .map(([time, v]) => ({ time, peer: v.peer, ai: v.ai }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

// 小组内成员互动网络：同组学生之间建立连边，节点大小按发言量
function buildNetwork(
  peerMessages: { senderId: string; groupId: string }[],
  groups: { id: string; name: string; members: { userId: string; user: { name: string } }[] }[],
): { nodes: InteractionNode[]; links: InteractionLink[] } {
  const nodes: InteractionNode[] = [];
  const links: InteractionLink[] = [];
  const sendCount = new Map<string, number>();
  for (const m of peerMessages) {
    sendCount.set(m.senderId, (sendCount.get(m.senderId) ?? 0) + 1);
  }

  for (const g of groups) {
    const active = g.members.filter((mem) => (sendCount.get(mem.userId) ?? 0) > 0);
    for (const mem of active) {
      nodes.push({
        id: mem.userId,
        name: mem.user.name,
        group: g.name,
        value: sendCount.get(mem.userId) ?? 0,
      });
    }
    // 组内两两连边（无向，取一次）
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        links.push({ source: active[i].userId, target: active[j].userId, value: 1 });
      }
    }
  }
  return { nodes, links };
}
