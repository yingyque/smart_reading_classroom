import { useEffect, useRef, useState } from 'react';
import { Loader2, FileText, AlertTriangle, ExternalLink, RotateCw } from 'lucide-react';
import { api, getToken } from '../lib/api';
import { API_PREFIX } from '../lib/config';
import { DocumentDetail } from '../types';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// pdf.js 用 Web Worker 渲染，所有设备（含手机/微信内置浏览器）都能显示
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export default function DocumentViewer({ docId }: { docId: string | null }) {
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [pdf, setPdf] = useState<{ data: ArrayBuffer; fallbackUrl: string } | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

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
          ) :           pdf ? (
            <PdfPages
              key={reloadKey}
              data={pdf.data}
              fallbackUrl={pdf.fallbackUrl}
              onRetry={() => setReloadKey((k) => k + 1)}
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

// pdf.js 渲染：占位 div + IntersectionObserver 懒渲染进入视口的页面，控制内存
function PdfPages({
  data,
  fallbackUrl,
  onRetry,
}: {
  data: ArrayBuffer;
  fallbackUrl: string;
  onRetry: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

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

        const renderPage = async (idx: number) => {
          if (cancelled || !pdf) return;
          const holder = holders[idx];
          if (!holder.isConnected || holder.dataset.rendered === '1') return;
          holder.dataset.rendered = '1';
          const page = await pdf.getPage(idx + 1);
          if (cancelled) return;
          const width = holder.clientWidth || container.clientWidth;
          const scale = (width / page.getViewport({ scale: 1 }).width) * dpr;
          const viewport = page.getViewport({ scale });
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
      pdf?.destroy();
      container.replaceChildren();
    };
  }, [data]);

  if (renderError) {
    return <PdfError message={renderError} onRetry={onRetry} fallbackUrl={fallbackUrl} />;
  }

  return (
    <div className="relative">
      {progress && progress.done < progress.total && (
        <div className="sticky top-2 z-10 mx-auto w-fit rounded-full bg-ink-900/80 px-3 py-1 text-xs text-white">
          已渲染 {progress.done}/{progress.total} 页
        </div>
      )}
      <div ref={containerRef} className="mx-auto max-w-[900px] px-2 py-3" />
    </div>
  );
}
