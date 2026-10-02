import { prisma } from '../lib/prisma';
import {
  AnalyticsResult,
  GroupCompareItem,
  InteractionLink,
  InteractionNode,
  PersonalProfileItem,
  TimelineItem,
  WordCloudItem,
} from '../types';

// nodejieba 为可选依赖：若原生模块安装失败，退化为简单分词，保证平台可运行
let jieba: { cut: (text: string) => string[] } | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  jieba = require('nodejieba');
} catch (err) {
  console.warn('[analytics] nodejieba 不可用，词云将使用简易分词:', (err as Error).message);
}

// 中英文停用词（精简常用集）
const STOPWORDS = new Set([
  '的','了','和','是','我','你','他','她','它','我们','你们','他们','这','那','有','在','就','都','而','及','与','着','或','一个','没有','我们','这个','那个','这些','那些','不','也','很','但','还','被','把','对','让','给','到','能','会','可以','这样','那样','什么','怎么','如果','因为','所以','但是','可能','觉得','感觉','就是','还是','这种','一些','知道','大家','老师','同学','问题','觉得',
  'the','a','an','is','are','was','were','be','to','of','and','or','in','on','at','for','with','as','by','that','this','these','those','it','i','you','he','she','we','they','my','your','so','but','not','do','does','did','can','will','would','about','what','how','if','because',
]);

function tokenize(text: string): string[] {
  const words = jieba ? jieba.cut(text) : text.split(/[\s，。！？、；：,.!?;:()\[\]{}"'\n\r]+/);
  return words
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 1 && !STOPWORDS.has(w) && !/^[\d\W_]+$/.test(w));
}

export async function buildAnalytics(classroomId: string): Promise<AnalyticsResult> {
  const [messages, groups] = await Promise.all([
    prisma.message.findMany({
      where: { classroomId },
      include: { sender: true, group: true },
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
