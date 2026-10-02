import ReactECharts from 'echarts-for-react';
import { AnalyticsResult } from '../../types';

const GROUP_COLORS = ['#2563EB', '#1C7977', '#7C3AED', '#D97706', '#16A34A', '#DC2626', '#0ea5e9', '#9333ea'];

export default function InteractionNetwork({ network }: { network: AnalyticsResult['network'] }) {
  if (!network.nodes.length) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-500">暂无互动数据</div>;
  }

  // 为每个小组分配一个类目与颜色
  const groupNames = Array.from(new Set(network.nodes.map((n) => n.group)));
  const categories = groupNames.map((name, i) => ({
    name,
    itemStyle: { color: GROUP_COLORS[i % GROUP_COLORS.length] },
  }));

  const option = {
    tooltip: {
      formatter: (p: { dataType: string; data: { name?: string; value?: number; group?: string } }) =>
        p.dataType === 'node'
          ? `${p.data.name}<br/>${p.data.group} · 发言 ${p.data.value} 次`
          : '',
    },
    legend: [
      {
        data: groupNames,
        bottom: 0,
        textStyle: { color: '#5F696E', fontSize: 11 },
      },
    ],
    series: [
      {
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        categories,
        label: { show: true, position: 'right', fontSize: 11, color: '#1F2937' },
        force: { repulsion: 120, edgeLength: 60, gravity: 0.1 },
        lineStyle: { color: '#cbd5e1', curveness: 0.1, opacity: 0.6 },
        emphasis: { focus: 'adjacency', lineStyle: { width: 2 } },
        data: network.nodes.map((n) => ({
          id: n.id,
          name: n.name,
          group: n.group,
          value: n.value,
          symbolSize: Math.min(12 + n.value * 4, 48),
          category: groupNames.indexOf(n.group),
        })),
        links: network.links.map((l) => ({ source: l.source, target: l.target })),
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge />;
}
