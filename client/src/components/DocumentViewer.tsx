import { useEffect, useRef, useState } from 'react';
import { Loader2, FileText, AlertTriangle, ExternalLink, RotateCw, Search, X, ChevronUp, ChevronDown, Trash2, Underline, Download } from 'lucide-react';
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
  yellow: 'pdf-hl-yellow',
  green: 'pdf-hl-green',
  blue: 'pdf-hl-blue',
  pink: 'pdf-hl-pink',
  purple: 'pdf-hl-purple',
};

// 色板顺序 + 中文名 + 按钮展示色（与 .pdf-hl-* 同色的浅色系）
const HL_COLORS = [
  { key: 'yellow', title: '浅黄', swatch: 'rgba(253,224,71,.3)' },
  { key: 'green', title: '浅绿', swatch: 'rgba(134,239,172,.3)' },
  { key: 'blue', title: '浅蓝', swatch: 'rgba(147,197,253,.3)' },
  { key: 'pink', title: '粉红', swatch: 'rgba(249,168,212,.3)' },
  { key: 'purple', title: '浅紫', swatch: 'rgba(216,180,254,.3)' },
] as const;

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

  // 拉取当前文献的标注笔记（只取本人的 highlight/underline 类型）
  useEffect(() => {
    if (!docId) {
      setHighlights([]);
      return;
    }
    api
      .get(`/notes/${classroomId}/mine`)
      .then((res) =>
        setHighlights(
          // 组员标注在笔记面板互见即可；PDF 页面上只画本人的（避免无法区分归属）
          (res.data as NoteItem[]).filter(
            (n) =>
              (n.kind === 'highlight' || n.kind === 'underline') &&
              n.documentId === docId &&
              n.mine !== false,
          ),
        ),
      )
      .catch((err) => console.error('加载标注失败', err));
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

  // 选中文本 → 选色高亮 / 划线 → 保存为标注笔记（评论可在笔记面板后补）
  const saveHighlight = async (sel: SelectionPopup, kind: 'highlight' | 'underline', color: string | null) => {
    try {
      await api.post(`/notes/${classroomId}`, {
        kind,
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
      console.error('保存标注失败', err);
      alert(err.response?.data?.error || '保存标注失败');
      return false;
    }
  };

  // 取消标注：删除对应的标注笔记
  const removeHighlight = async (noteId: string) => {
    try {
      await api.delete(`/notes/${classroomId}/${noteId}`);
      onNotesChanged?.();
      return true;
    } catch (err: any) {
      console.error('取消标注失败', err);
      alert(err.response?.data?.error || '取消标注失败');
      return false;
    }
  };

  // 下载文献原文件：PDF 复用已拉取的 blob；其他格式（或 PDF 尚未加载完）现拉 raw 接口
  const [downloading, setDownloading] = useState(false);
  const downloadFile = async () => {
    if (!docId || !doc || downloading) return;
    setDownloading(true);
    let url = '';
    let needRevoke = false;
    try {
      if (pdf?.fallbackUrl) {
        url = pdf.fallbackUrl;
      } else {
        const r = await fetch(`${API_PREFIX}/documents/doc/${docId}/raw`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        url = URL.createObjectURL(await r.blob());
        needRevoke = true;
      }
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.fileName || doc.title;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      console.error('下载文献失败', err);
      alert('下载失败，请重试');
    } finally {
      if (needRevoke) setTimeout(() => URL.revokeObjectURL(url!), 30_000);
      setDownloading(false);
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
      <div className="flex items-start justify-between gap-3 border-b border-ink-900/5 px-6 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-bold text-ink-900">{doc.title}</h2>
          <p className="truncate text-xs text-ink-500">
            {doc.fileType.toUpperCase()} · {doc.fileName}
          </p>
        </div>
        <button
          onClick={() => void downloadFile()}
          disabled={downloading}
          title="下载原文件"
          className="flex shrink-0 items-center gap-1 rounded-lg border border-ink-900/10 px-2.5 py-1.5 text-xs text-ink-500 transition-colors hover:border-brand-500 hover:text-brand-600 disabled:opacity-40"
        >
          {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          下载
        </button>
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
              onRemoveHighlight={removeHighlight}
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
  onHighlight: (sel: SelectionPopup, kind: 'highlight' | 'underline', color: string | null) => Promise<boolean>;
  onRemoveHighlight: (noteId: string) => Promise<boolean>;
}

// pdf.js 渲染：占位 div + IntersectionObserver 懒渲染进入视口的页面，控制内存。
// 每页渲染 canvas（图像）+ TextLayer（透明文字层，支持选中/查找）+ 高亮/查找覆盖层。
function PdfPages({ data, fallbackUrl, onRetry, highlights, onHighlight, onRemoveHighlight }: PdfPagesProps) {
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

  // ---- 取消标注状态：点击已保存的高亮/划线矩形后弹出 ----
  const [removePopup, setRemovePopup] = useState<{
    x: number;
    y: number;
    noteId: string;
    quote: string;
    kind: 'highlight' | 'underline';
  } | null>(null);
  const [removing, setRemoving] = useState(false);

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
        // 划线：透明框只画底部红线；高亮：整块半透明底色
        const cls =
          hl.kind === 'underline'
            ? 'pdf-underline-rect'
            : `pdf-highlight-rect ${HL_COLOR_CLASS[hl.color || 'yellow'] ?? HL_COLOR_CLASS.yellow}`;
        for (const r of rects) {
          const div = document.createElement('div');
          // 定位规则（absolute/pointer-events）在 .pdf-highlight-rect / .pdf-underline-rect
          div.className = cls;
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
    let resizeObserver: ResizeObserver | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
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

        // 容器宽度变化（左右分栏拖拽、窗口缩放）：防抖后按新宽度重渲染已渲染的页。
        // 否则画布被 CSS 拉伸、文字层仍按旧宽度定位，选中/查找会与画布错位
        let lastWidth = container.clientWidth;
        resizeObserver = new ResizeObserver(() => {
          const w = container.clientWidth;
          if (w === lastWidth) return;
          lastWidth = w;
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
            if (cancelled) return;
            for (const h of holders) {
              if (h.dataset.rendered !== '1') continue;
              h.dataset.rendered = '0';
              h.replaceChildren();
              h.style.backgroundColor = '#f3f4f6';
              const idx = Number(h.dataset.pageIdx);
              if (!Number.isNaN(idx)) void renderPage(idx);
            }
          }, 300);
        });
        resizeObserver.observe(container);
      } catch (err) {
        if (!cancelled) setRenderError(`PDF 渲染失败（${(err as Error).message}）`);
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      resizeObserver?.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
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
      // 跨页选区修复：引用文字若取整个选区会包含后面页的内容，而高亮矩形只落在起始页，
      // 导致笔记文字与高亮区域不对应。这里把选区收敛到起始页末尾（Range 边界按文档序，
      // 无论拖选方向，起始页永远是 range 的 start 一侧），保证两者一致。
      let effectiveRange = range;
      const endEl =
        range.endContainer.nodeType === Node.TEXT_NODE
          ? range.endContainer.parentElement
          : (range.endContainer as HTMLElement);
      const endHolder = endEl?.closest('[data-page-idx]') as HTMLDivElement | null;
      if (endHolder && endHolder !== holder) {
        const lastText = lastTextNodeIn(holder);
        if (!lastText) {
          setSelPopup(null);
          return;
        }
        effectiveRange = range.cloneRange();
        effectiveRange.setEnd(lastText, lastText.length);
      }
      const quote = effectiveRange.toString().replace(/\s+/g, ' ').trim();
      if (!quote) {
        setSelPopup(null);
        return;
      }
      // 选区矩形：归一化到所在页容器（只保留落在锚点页内的矩形）
      const holderRect = holder.getBoundingClientRect();
      const clientRects = Array.from(effectiveRange.getClientRects());
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
    const onScroll = () => {
      setSelPopup(null);
      setRemovePopup(null);
    };
    container.addEventListener('scroll', onScroll, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelPopup(null);
        setRemovePopup(null);
      }
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
    const ok = await onHighlight(selPopup, 'highlight', color);
    setSaving(false);
    if (ok) {
      window.getSelection()?.removeAllRanges();
      setSelPopup(null);
    }
  };

  // 点击划线按钮：保存划线笔记
  const pickUnderline = async () => {
    if (!selPopup || saving) return;
    setSaving(true);
    const ok = await onHighlight(selPopup, 'underline', null);
    setSaving(false);
    if (ok) {
      window.getSelection()?.removeAllRanges();
      setSelPopup(null);
    }
  };

  // ---- 点击已保存的高亮 → 弹「取消高亮」----
  // 高亮覆盖层本身 pointer-events:none（不挡文字选中），这里用坐标命中检测代替
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const holder = target.closest('[data-page-idx]') as HTMLDivElement | null;
      if (!holder || !container.contains(holder)) {
        setRemovePopup(null);
        return;
      }
      // 拖选文字结束时也会触发 click，此时视为选词而非点击高亮
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) {
        setRemovePopup(null);
        return;
      }
      const holderRect = holder.getBoundingClientRect();
      const nx = (e.clientX - holderRect.left) / holderRect.width;
      const ny = (e.clientY - holderRect.top) / holderRect.height;
      const pageNum = Number(holder.dataset.pageIdx) + 1;
      // 后画的在高亮层更靠上，命中多条时取最后一条
      let hit: NoteItem | null = null;
      for (const hl of highlightsRef.current) {
        if (hl.page !== pageNum) continue;
        let rects: NormRect[] = null as unknown as NormRect[];
        try {
          rects = JSON.parse(hl.rects || '[]');
        } catch {
          continue;
        }
        if (rects.some((r) => nx >= r.x && nx <= r.x + r.w && ny >= r.y && ny <= r.y + r.h)) {
          hit = hl;
        }
      }
      if (!hit) {
        setRemovePopup(null);
        return;
      }
      setRemovePopup({
        x: Math.min(e.clientX, window.innerWidth - 200),
        y: Math.min(e.clientY + 8, window.innerHeight - 60),
        noteId: hit.id,
        quote: (hit.quote || '').replace(/\s+/g, ' ').slice(0, 60),
        kind: hit.kind === 'underline' ? 'underline' : 'highlight',
      });
    };

    container.addEventListener('click', onClick);
    return () => container.removeEventListener('click', onClick);
  }, []);

  // 确认取消高亮：删除笔记后由外部刷新高亮列表
  const confirmRemove = async () => {
    if (!removePopup || removing) return;
    setRemoving(true);
    const ok = await onRemoveHighlight(removePopup.noteId);
    setRemoving(false);
    if (ok) setRemovePopup(null);
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
          <span className="text-xs text-ink-500">标注</span>
          {HL_COLORS.map((c) => (
            <button
              key={c.key}
              disabled={saving}
              onClick={() => void pickColor(c.key)}
              title={c.title}
              className="h-5 w-5 rounded-full border border-ink-900/10 transition-transform hover:scale-110 active:scale-95 disabled:opacity-40"
              style={{ background: c.swatch }}
            />
          ))}
          <span className="mx-0.5 h-5 w-px bg-ink-900/10" />
          <button
            disabled={saving}
            onClick={() => void pickUnderline()}
            title="划线（下划线）"
            className="flex h-5 w-5 items-center justify-center rounded-full border border-ink-900/10 text-red-500 transition-transform hover:scale-110 active:scale-95 disabled:opacity-40"
          >
            <Underline size={13} strokeWidth={2.5} />
          </button>
          {saving && <Loader2 size={12} className="animate-spin text-ink-400" />}
        </div>
      )}

      {/* 点击已有高亮后的取消弹窗 */}
      {removePopup && (
        <div
          className="fixed z-50 flex items-center gap-2 rounded-xl border border-ink-900/10 bg-white px-2.5 py-2 shadow-lg"
          style={{ left: removePopup.x, top: removePopup.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <span className="max-w-[150px] truncate text-xs text-ink-500" title={removePopup.quote}>
            {removePopup.quote}
          </span>
          <button
            onClick={() => void confirmRemove()}
            disabled={removing}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-red-50 px-2 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-100 disabled:opacity-40"
          >
            {removing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            {removePopup.kind === 'underline' ? '取消划线' : '取消高亮'}
          </button>
          <button
            onClick={() => setRemovePopup(null)}
            className="shrink-0 rounded p-0.5 text-ink-400 hover:text-ink-900"
            title="关闭"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// 页容器内的最后一个文本节点（跨页选区收敛到起始页时用）
function lastTextNodeIn(root: Element): Text | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  while (walker.nextNode()) last = walker.currentNode as Text;
  return last;
}
