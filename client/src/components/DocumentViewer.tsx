import { useEffect, useState } from 'react';
import { Loader2, FileText } from 'lucide-react';
import { api, getToken } from '../lib/api';
import { API_PREFIX } from '../lib/config';
import { DocumentDetail } from '../types';

export default function DocumentViewer({ docId }: { docId: string | null }) {
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string>('');
  const [loading, setLoading] = useState(false);

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

  // PDF 需带 token，下载为 blob 后用 object URL 渲染
  useEffect(() => {
    let revoked = '';
    if (doc?.fileType === 'pdf' && docId) {
      fetch(`${API_PREFIX}/documents/doc/${docId}/raw`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      })
        .then((r) => r.blob())
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          revoked = url;
          setPdfUrl(url);
        })
        .catch((err) => console.error('加载 PDF 失败', err));
    }
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [doc, docId]);

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
          pdfUrl ? (
            <iframe title={doc.title} src={pdfUrl} className="h-full w-full" />
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
