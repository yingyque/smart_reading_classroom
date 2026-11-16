import { useEffect, useRef, useState } from 'react';
import { Loader2, FileText, AlertTriangle, ExternalLink, RotateCw, Search, X, ChevronUp, ChevronDown } from 'lucide-react';
import { api, getToken } from '../lib/api';
import { API_PREFIX } from '../lib/config';
import { DocumentDetail, NoteItem } from '../types';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// pdf.js 用 Web Worker 渲染，所有设备（含手机/微信内置浏览器）都能显示
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// 高亮颜色 → CSS 类名（index.css 中的 .pdf-hl-*）
const HL_COLOR_CLASS: Record<string, string> = {
  blue: 'pdf-hl-blue',
  green: 'pdf-hl-green',
  yellow: 'pdf-hl-yellow',
};

// 归一化矩形（0~1，相对页面）
interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 选中文本后弹出的高亮色板参数
interface SelectionPopup {
  x: number; // 弹窗固定定位（viewport 坐标）
  y: number;
  quote: string;
  page: number;
  rects: NormRect[];
}

// 查找命中：页码 + 归一化矩形
interface SearchHit {
  page: number;
  rects: NormRect[];
}

interface ViewerProps {
  docId: string | null;
  classroomId: string;
  /** 外部笔记变化（如删除）时递增，触发重新拉取高亮 */
  notesVersion: number;
  /** 高亮保存成功后通知外部（NotePanel 刷新） */
  onNotesChanged?: () => void;
}

export default function DocumentViewer({ docId, classroomId, notesVersion, onNotesChanged }: ViewerProps) {
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [pdf, setPdf] = useState<{ data: ArrayBuffer; fallbackUrl: string } | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [highlights, setHighlights] = useState<NoteItem[]>([]);

  useEffect(() => {
    if (!docId) {
      setDoc(null);
      return;
    }
    setLoading(true);
    api
      .get(`/documents/doc/${docId}`)
      .then((res) => setDoc(res.data))
      .catch((err) => console.error('加载文献失败', err))
      .finally(() => setLoading(false));
  }, [docId]);

  // 拉取当前文献的高亮笔记（只取本人 highlight 类型）
  useEffect(() => {
    if (!docId) {
      setHighlights([]);
      return;
    }
    api
      .get(`/notes/${classroomId}/mine`)
      .then((res) =>
        setHighlights(
          // 组员高亮在笔记面板互见即可；PDF 页面上只画本人的（避免无法区分归属）
          (res.data as NoteItem[]).filter(
            (n) => n.kind === 'highlight' && n.documentId === docId && n.mine !== false,
          ),
        ),
      )
      .catch((err) => console.error('加载高亮失败', err));
  }, [classroomId, docId, notesVersion]);

  // PDF 需带 token：下载为 ArrayBuffer 交给 pdf.js 渲染；同时保留 blob URL 供「新窗口打开」兜底
  useEffect(() => {
    let revoked = '';
    let cancelled = false;
    setPdf(null);
    setPdfError('');
    if (doc?.fileType === 'pdf' && docId) {
      setPdfLoading(true);
      fetch(`${API_PREFIX}/documents/doc/${docId}/raw`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.blob();
        })
        .then(async (blob) => {
          const fallbackUrl = URL.createObjectURL(blob);
          revoked = fallbackUrl;
          const data = await blob.arrayBuffer();
          if (!cancelled) setPdf({ data, fallbackUrl });
        })
        .catch((err) => {
          if (!cancelled) setPdfError(`PDF 加载失败（${(err as Error).message}），请重试`);
        })
        .finally(() => {
          if (!cancelled) setPdfLoading(false);
        });
    }
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [doc?.fileType, docId, reloadKey]);

  // 选中文本 → 选色 → 保存为高亮笔记（评论可在笔记面板后补）
  const saveHighlight = async (sel: SelectionPopup, color: string) => {
    try {
      await api.post(`/notes/${classroomId}`, {
        kind: 'highlight',
        documentId: docId,
        content: '',
        quote: sel.quote,
        page: sel.page,
        rects: JSON.stringify(sel.rects),
        color,
      });
      onNotesChanged?.();
      return true;
    } catch (err: any) {
      console.error('保存高亮失败', err);
      alert(err.response?.data?.error || '保存高亮失败');
      return false;
    }
  };

  if (!docId) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-ink-500">
        <FileText size={40} className="mb-3 opacity-40" />
        <p>请选择一篇文献开始阅读</p>
      </div>
    );
  }

  if (loading || !doc) {
    return (
      <div className="flex h-full items-center justify-center text-ink-500">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-ink-900/5 px-6 py-4">
        <h2 className="text-lg font-bold text-ink-900">{doc.title}</h2>
        <p className="text-xs text-ink-500">
          {doc.fileType.toUpperCase()} · {doc.fileName}
        </p>
      </div>
      <div className="flex-1 overflow-auto">
        {doc.fileType === 'pdf' ? (
          pdfError ? (
            <PdfError
              message={pdfError}
              onRetry={() => setReloadKey((k) => k + 1)}
              fallbackUrl={pdf?.fallbackUrl}
            />
          ) : pdf ? (
            <PdfPages
              key={reloadKey}
              data={pdf.data}
              fallbackUrl={pdf.fallbackUrl}
              onRetry={() => setReloadKey((k) => k + 1)}
              highlights={highlights}
              onHighlight={saveHighlight}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-ink-500">
              <Loader2 className="animate-spin" />
            </div>
          )
        ) : (
          <article className="prose prose-slate mx-auto max-w-3xl whitespace-pre-wrap px-8 py-6 text-[15px] leading-7 text-ink-900">
            {doc.content || '（文献内容为空或未能解析）'}
          </article>
        )}
      </div>
    </div>
  );
}

// 加载失败的兜底：重试 + 新窗口打开（交给系统 PDF 阅读器）
function PdfError({
  message,
  onRetry,
  fallbackUrl,
}: {
  message: string;
  onRetry: () => void;
  fallbackUrl?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <AlertTriangle size={32} className="text-amber-500" />
      <p className="text-sm text-ink-500">{message}</p>
      <div className="flex gap-3">
        <button
          onClick={onRetry}
          className="flex items-center gap-1 rounded-lg bg-brand-500 px-4 py-2 text-sm text-white hover:bg-brand-600"
        >
          <RotateCw size={14} /> 重试
        </button>
        {fallbackUrl && (
          <a
            href={fallbackUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded-lg border border-ink-900/10 px-4 py-2 text-sm text-ink-500 hover:border-brand-500 hover:text-brand-600"
          >
            <ExternalLink size={14} /> 新窗口打开
          </a>
        )}
      </div>
    </div>
  );
}

interface PdfPagesProps {
  data: ArrayBuffer;
  fallbackUrl: string;
  onRetry: () => void;
  highlights: NoteItem[];
  onHighlight: (sel: SelectionPopup, color: string) => Promise<boolean>;
}

// pdf.js 渲染：占位 div + IntersectionObserver 懒渲染进入视口的页面，控制内存。
// 每页渲染 canvas（图像）+ TextLayer（透明文字层，支持选中/查找）+ 高亮/查找覆盖层。
function PdfPages({ data, fallbackUrl, onRetry, highlights, onHighlight }: PdfPagesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // ---- 查找状态 ----
  const [searchInput, setSearchInput] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [activeHit, setActiveHit] = useState(-1);
  const [searching, setSearching] = useState(false);

  // ---- 选中高亮状态 ----
  const [selPopup, setSelPopup] = useState<SelectionPopup | null>(null);
  const [saving, setSaving] = useState(false);

  // 供事件处理器读取最新值的 ref
  const highlightsRef = useRef(highlights);
  highlightsRef.current = highlights;
  const hitsRef = useRef(hits);
  hitsRef.current = hits;
  const activeHitRef = useRef(activeHit);
  activeHitRef.current = activeHit;

  // 命令式创建的页面容器与文字层（React 外管理）
  const holdersRef = useRef<HTMLDivElement[]>([]);
  const textLayersRef = useRef<(InstanceType<typeof pdfjs.TextLayer> | null)[]>([]);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);

  // 把某页的高亮 + 查找命中画到覆盖层（归一化矩形 → 百分比定位，窗口缩放自适应）
  const rebuildOverlays = () => {
    holdersRef.current.forEach((holder, idx) => {
      if (!holder || holder.dataset.rendered !== '1') return;
      let layer = holder.querySelector(':scope > .hl-layer') as HTMLDivElement | null;
      if (!layer) {
        layer = document.createElement('div');
        layer.className = 'hl-layer';
        layer.style.position = 'absolute';
        layer.style.inset = '0';
        layer.style.zIndex = '1';
        layer.style.pointerEvents = 'none';
        holder.appendChild(layer);
      }
      layer.replaceChildren();
      const pageNum = idx + 1;
      // 已保存的高亮笔记
      for (const hl of highlightsRef.current) {
        if (hl.page !== pageNum) continue;
        let rects: NormRect[] = null as unknown as NormRect[];
        try {
          rects = JSON.parse(hl.rects || '[]');
        } catch {
          continue;
        }
        const cls = HL_COLOR_CLASS[hl.color || 'yellow'] ?? HL_COLOR_CLASS.yellow;
        for (const r of rects) {
          const div = document.createElement('div');
          // 定位规则（absolute/pointer-events/mix-blend-mode）在 .pdf-highlight-rect，颜色类只管背景色
          div.className = `pdf-highlight-rect ${cls}`;
          div.style.left = `${r.x * 100}%`;
          div.style.top = `${r.y * 100}%`;
          div.style.width = `${r.w * 100}%`;
          div.style.height = `${r.h * 100}%`;
          layer.appendChild(div);
        }
      }
      // 查找命中（当前项加深）
      hitsRef.current.forEach((hit, hitIdx) => {
        if (hit.page !== pageNum) return;
        for (const r of hit.rects) {
          const div = document.createElement('div');
          div.className = 'pdf-search-hit';
          if (hitIdx === activeHitRef.current) {
            div.style.background = 'rgba(255, 152, 0, 0.65)';
          }
          div.style.left = `${r.x * 100}%`;
          div.style.top = `${r.y * 100}%`;
          div.style.width = `${r.w * 100}%`;
          div.style.height = `${r.h * 100}%`;
          layer.appendChild(div);
        }
      });
    });
  };

  // 高亮 / 查找结果变化时重绘覆盖层
  useEffect(() => {
    rebuildOverlays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlights, hits, activeHit]);

  // ---- PDF 加载 + 懒渲染 ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let observer: IntersectionObserver | null = null;
    let pdf: PDFDocumentProxy | null = null;

    (async () => {
      try {
        pdf = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return;
        pdfRef.current = pdf;
        const total = pdf.numPages;
        setProgress({ done: 0, total });

        // 用第一页的宽高比给所有页占位，避免滚动时跳动
        const p1 = await pdf.getPage(1);
        const vp1 = p1.getViewport({ scale: 1 });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        const holders: HTMLDivElement[] = [];
        for (let i = 0; i < total; i++) {
          const holder = document.createElement('div');
          holder.style.width = '100%';
          holder.style.aspectRatio = `${vp1.width} / ${vp1.height}`;
          holder.style.position = 'relative';
          holder.style.backgroundColor = '#f3f4f6';
          holder.dataset.pageIdx = String(i);
          container.appendChild(holder);
          holders.push(holder);
        }
        holdersRef.current = holders;
        textLayersRef.current = new Array(total).fill(null);
        rebuildOverlays();

        const renderPage = async (idx: number) => {
          if (cancelled || !pdf) return;
          const holder = holders[idx];
          if (!holder.isConnected || holder.dataset.rendered === '1') return;
          holder.dataset.rendered = '1';
          const page = await pdf.getPage(idx + 1);
          if (cancelled) return;
          const width = holder.clientWidth || container.clientWidth;
          const scale1 = page.getViewport({ scale: 1 });
          const cssScale = width / scale1.width; // CSS 缩放比（文字层用）
          const viewport = page.getViewport({ scale: cssScale * dpr }); // 设备像素（canvas 用）
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.position = 'absolute';
          canvas.style.inset = '0';
          canvas.style.width = '100%';
          canvas.style.height = '100%';
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
          holder.replaceChildren(canvas);
          holder.style.backgroundColor = 'white';

          // 透明文字层：支持选中/查找。--scale-factor 必须由应用设置（pdf.js 不代管）
          const cssViewport = page.getViewport({ scale: cssScale });
          const textLayerDiv = document.createElement('div');
          textLayerDiv.className = 'textLayer';
          textLayerDiv.style.setProperty('--scale-factor', String(cssScale));
          const textLayer = new pdfjs.TextLayer({
            textContentSource: page.streamTextContent(),
            container: textLayerDiv,
            viewport: cssViewport,
          });
          textLayersRef.current[idx] = textLayer;
          holder.appendChild(textLayerDiv);
          try {
            await textLayer.render();
          } catch {
            /* 取消或失败时文字层缺失，画布仍可阅读 */
          }
          if (cancelled) return;
          rebuildOverlays();
          setProgress((p) => (p ? { done: p.done + 1, total: p.total } : p));
        };

        // 只渲染进入视口（含 400px 预载区）的页面，长文献不会把内存打爆
        observer = new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (e.isIntersecting) {
                observer?.unobserve(e.target);
                const idx = Number((e.target as HTMLDivElement).dataset.pageIdx);
                if (!Number.isNaN(idx)) void renderPage(idx);
              }
            }
          },
          { rootMargin: '400px 0px' },
        );
        holders.forEach((h) => observer?.observe(h));
      } catch (err) {
        if (!cancelled) setRenderError(`PDF 渲染失败（${(err as Error).message}）`);
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      textLayersRef.current.forEach((tl) => tl?.cancel());
      pdf?.destroy();
      pdfRef.current = null;
      holdersRef.current = [];
      textLayersRef.current = [];
      container.replaceChildren();
    };
  }, [data]);

  // ---- 查找 ----
  const runSearch = async () => {
    const pdf = pdfRef.current;
    const query = searchInput.trim().toLowerCase();
    if (!pdf || !query) {
      setHits([]);
      setActiveHit(-1);
      return;
    }
    setSearching(true);
    try {
      const found: SearchHit[] = [];
      for (let p = 1; p <= pdf.numPages && found.length < 500; p++) {
        const page = await pdf.getPage(p);
        const tc = await page.getTextContent();
        const vp = page.getViewport({ scale: 1 });
        // 拼接整页文本，记录每个 item 的起始偏移与几何信息
        let text = '';
        const items: { str: string; start: number; x: number; y: number; w: number; h: number }[] = [];
        for (const it of tc.items) {
          if (!('str' in it) || typeof it.str !== 'string') continue;
          const tx = pdfjs.Util.transform(vp.transform, it.transform);
          const fontHeight = Math.hypot(tx[2], tx[3]) || 10;
          items.push({
            str: it.str,
            start: text.length,
            x: tx[4],
            y: tx[5] - fontHeight * 0.85, // 基线上移近似行顶
            w: it.width || 0,
            h: fontHeight,
          });
          text += it.str;
        }
        const lower = text.toLowerCase();
        let from = 0;
        while (found.length < 500) {
          const at = lower.indexOf(query, from);
          if (at === -1) break;
          from = at + query.length;
          // 命中区间 [at, at+len) 拆到各 item 上，生成矩形
          const end = at + query.length;
          const rects: NormRect[] = [];
          for (const item of items) {
            const itemEnd = item.start + item.str.length;
            if (itemEnd <= at || item.start >= end || !item.str.length) continue;
            const c0 = Math.max(0, at - item.start);
            const c1 = Math.min(item.str.length, end - item.start);
            const per = item.w / item.str.length;
            const x = item.x + c0 * per;
            const w = (c1 - c0) * per;
            rects.push({
              x: clamp01(x / vp.width),
              y: clamp01(item.y / vp.height),
              w: clamp01(w / vp.width),
              h: clamp01(item.h / vp.height),
            });
          }
          if (rects.length) found.push({ page: p, rects });
        }
      }
      setHits(found);
      setActiveHit(found.length ? 0 : -1);
      if (found.length) scrollToHit(found[0].page);
    } finally {
      setSearching(false);
    }
  };

  const scrollToHit = (page: number) => {
    const holder = holdersRef.current[page - 1];
    holder?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const gotoHit = (dir: 1 | -1) => {
    if (!hits.length) return;
    const next = (activeHit + dir + hits.length) % hits.length;
    setActiveHit(next);
    scrollToHit(hits[next].page);
  };

  const clearSearch = () => {
    setSearchInput('');
    setHits([]);
    setActiveHit(-1);
  };

  // ---- 选中文字 → 弹色板 ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let timer: ReturnType<typeof setTimeout>;

    const evaluate = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setSelPopup(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const anchorEl =
        range.startContainer.nodeType === Node.TEXT_NODE
          ? range.startContainer.parentElement
          : (range.startContainer as HTMLElement);
      const holder = anchorEl?.closest('[data-page-idx]') as HTMLDivElement | null;
      if (!holder || !container.contains(holder)) {
        setSelPopup(null);
        return;
      }
      const quote = sel.toString().replace(/\s+/g, ' ').trim();
      if (!quote) {
        setSelPopup(null);
        return;
      }
      // 选区矩形：归一化到所在页容器（只保留落在锚点页内的矩形）
      const holderRect = holder.getBoundingClientRect();
      const clientRects = Array.from(range.getClientRects());
      const rects: NormRect[] = [];
      for (const r of clientRects) {
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (
          cx < holderRect.left ||
          cx > holderRect.right ||
          cy < holderRect.top ||
          cy > holderRect.bottom ||
          r.width <= 0
        ) {
          continue;
        }
        rects.push({
          x: clamp01((r.left - holderRect.left) / holderRect.width),
          y: clamp01((r.top - holderRect.top) / holderRect.height),
          w: clamp01(r.width / holderRect.width),
          h: clamp01(r.height / holderRect.height),
        });
      }
      if (!rects.length) {
        setSelPopup(null);
        return;
      }
      const last = clientRects[clientRects.length - 1];
      setSelPopup({
        x: Math.min(last.right, window.innerWidth - 150),
        y: Math.min(last.bottom + 8, window.innerHeight - 60),
        quote: quote.slice(0, 2000),
        page: Number(holder.dataset.pageIdx) + 1,
        rects,
      });
    };

    // selectionchange 触发很频繁（拖动中持续触发），防抖处理；鼠标与触屏长按都覆盖
    const onSelectionChange = () => {
      clearTimeout(timer);
      timer = setTimeout(evaluate, 250);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    const onScroll = () => setSelPopup(null);
    container.addEventListener('scroll', onScroll, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelPopup(null);
    };
    document.addEventListener('keydown', onKey);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', onSelectionChange);
      container.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // 点击色板：保存高亮笔记
  const pickColor = async (color: string) => {
    if (!selPopup || saving) return;
    setSaving(true);
    const ok = await onHighlight(selPopup, color);
    setSaving(false);
    if (ok) {
      window.getSelection()?.removeAllRanges();
      setSelPopup(null);
    }
  };

  if (renderError) {
    return <PdfError message={renderError} onRetry={onRetry} fallbackUrl={fallbackUrl} />;
  }

  return (
    <div className="relative">
      {/* 渲染进度 + 紧凑查找（放大镜图标 + 小输入框，放在已渲染旁边） */}
      <div className="sticky top-0 z-20 flex items-center justify-end gap-2 bg-white/95 px-3 py-1.5 backdrop-blur">
        {progress && progress.done < progress.total && (
          <span className="shrink-0 whitespace-nowrap text-xs text-ink-500">
            已渲染 {progress.done}/{progress.total} 页
          </span>
        )}
        <div className="flex w-40 items-center gap-1 rounded-full border border-ink-900/10 px-2 py-1 focus-within:border-brand-500">
          <Search size={13} className="shrink-0 text-ink-400" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void runSearch();
              }
              if (e.key === 'Escape') clearSearch();
            }}
            placeholder="查找文字"
            className="min-w-0 flex-1 bg-transparent text-xs text-ink-900 outline-none placeholder:text-ink-500/50"
          />
          {searchInput && (
            <button onClick={clearSearch} className="shrink-0 rounded p-0.5 text-ink-400 hover:text-ink-900">
              <X size={12} />
            </button>
          )}
        </div>
        {searching ? (
          <Loader2 size={14} className="shrink-0 animate-spin text-ink-400" />
        ) : hits.length ? (
          <>
            <span className="shrink-0 whitespace-nowrap text-xs text-ink-500">
              {activeHit + 1}/{hits.length} 处
            </span>
            <button
              onClick={() => gotoHit(-1)}
              className="shrink-0 rounded p-1 text-ink-500 hover:bg-ink-900/5"
              title="上一处"
            >
              <ChevronUp size={14} />
            </button>
            <button
              onClick={() => gotoHit(1)}
              className="shrink-0 rounded p-1 text-ink-500 hover:bg-ink-900/5"
              title="下一处"
            >
              <ChevronDown size={14} />
            </button>
          </>
        ) : null}
      </div>

      {/* 页面容器（1350 = 900×1.5，PDF 放大 1.5 倍；窄屏自动填满可用宽度） */}
      <div ref={containerRef} className="mx-auto max-w-[1350px] px-2 py-3" />

      {/* 选中文字后的高亮色板 */}
      {selPopup && (
        <div
          className="fixed z-50 flex items-center gap-2 rounded-xl border border-ink-900/10 bg-white px-2.5 py-2 shadow-lg"
          style={{ left: selPopup.x, top: selPopup.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <span className="text-xs text-ink-500">高亮</span>
          {(['blue', 'green', 'yellow'] as const).map((c) => (
            <button
              key={c}
              disabled={saving}
              onClick={() => void pickColor(c)}
              title={c === 'blue' ? '浅蓝' : c === 'green' ? '浅绿' : '浅黄'}
              className="h-5 w-5 rounded-full border border-ink-900/10 transition-transform hover:scale-110 active:scale-95 disabled:opacity-40"
              style={{
                background:
                  c === 'blue'
                    ? 'rgba(59,130,246,.45)'
                    : c === 'green'
                      ? 'rgba(34,197,94,.45)'
                      : 'rgba(234,179,8,.5)',
              }}
            />
          ))}
          {saving && <Loader2 size={12} className="animate-spin text-ink-400" />}
        </div>
      )}
    </div>
  );
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
