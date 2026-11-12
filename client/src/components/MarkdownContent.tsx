import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// AI 回复的 Markdown 渲染（react-markdown 默认不渲染原始 HTML，无 XSS 风险）
// 从 DiscussionPanel 抽取为共享组件：学生讨论面板与教师端问答详情共用同一套样式
const mdComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mb-2 text-base font-bold">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1.5 mt-3 text-[15px] font-bold">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-bold">{children}</h3>,
  ul: ({ children }) => <ul className="mb-2 list-disc pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal pl-4">{children}</ol>,
  li: ({ children }) => <li className="mb-0.5">{children}</li>,
  // 代码块：白底浅边框（原深灰底会被学生误认为"图片加载失败"的灰框）
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-lg border border-ink-900/10 bg-white p-2.5 text-xs [&_code]:bg-transparent [&_code]:px-0 [&_code]:py-0 [&_code]:text-[inherit] [&_code]:text-ink-900">
      {children}
    </pre>
  ),
  code: ({ children }) => <code className="rounded bg-ink-900/10 px-1 py-0.5 font-mono text-[13px]">{children}</code>,
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-ink-900/15 bg-ink-900/5 px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-ink-900/15 px-2 py-1">{children}</td>,
  blockquote: ({ children }) => <blockquote className="mb-2 border-l-2 border-violet-400 pl-2 text-ink-500">{children}</blockquote>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="break-all text-violet-600 underline underline-offset-2">
      {children}
    </a>
  ),
  hr: () => <hr className="my-2 border-ink-900/10" />,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
};

export default function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
      {content}
    </ReactMarkdown>
  );
}
