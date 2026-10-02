import { useEffect, useRef } from 'react';
import { WordCloudItem } from '../../types';

const COLORS = ['#2563EB', '#1C7977', '#7C3AED', '#1d4ed8', '#0ea5e9', '#9333ea'];

// 轻量级螺旋布局词云（Canvas 实现，无外部依赖）
export default function WordCloudPanel({ words }: { words: WordCloudItem[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !words.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const max = words[0]?.value || 1;
    const min = words[words.length - 1]?.value || 1;
    const placed: { x: number; y: number; w: number; h: number }[] = [];

    const list = words.slice(0, 60);
    list.forEach((word, i) => {
      const ratio = (word.value - min) / (max - min || 1);
      const fontSize = 14 + ratio * 40;
      ctx.font = `${Math.round(fontSize)}px "Noto Sans SC", sans-serif`;
      const metrics = ctx.measureText(word.text);
      const w = metrics.width;
      const h = fontSize;

      // 阿基米德螺旋寻找不重叠位置
      let angle = 0;
      let placedOk = false;
      let x = W / 2;
      let y = H / 2;
      for (let step = 0; step < 400; step++) {
        angle += 0.3;
        const radius = 4 * angle;
        x = W / 2 + radius * Math.cos(angle) - w / 2;
        y = H / 2 + radius * Math.sin(angle);
        const box = { x, y: y - h, w, h };
        const overlap = placed.some(
          (p) => box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y,
        );
        if (!overlap && x > 0 && x + w < W && y - h > 0 && y < H) {
          placedOk = true;
          break;
        }
      }
      if (!placedOk) return;
      placed.push({ x, y: y - h, w, h });
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.fillText(word.text, x, y);
    });
  }, [words]);

  if (!words.length) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-500">暂无讨论内容</div>;
  }

  return <canvas ref={canvasRef} className="h-full w-full" />;
}
