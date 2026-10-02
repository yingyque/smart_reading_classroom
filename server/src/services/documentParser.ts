import fs from 'fs/promises';
import mammoth from 'mammoth';

// pdf-parse 的类型导入在 CommonJS 下用 require 更稳妥
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse');

export type SupportedFileType = 'pdf' | 'docx' | 'txt';

export function detectFileType(fileName: string): SupportedFileType | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.txt')) return 'txt';
  return null;
}

// 从文件抽取纯文本，供 AI 上下文与分析使用
export async function extractText(filePath: string, fileType: SupportedFileType): Promise<string> {
  if (fileType === 'pdf') {
    const buffer = await fs.readFile(filePath);
    const data = await pdfParse(buffer);
    return normalize(data.text);
  }
  if (fileType === 'docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return normalize(result.value);
  }
  // txt
  const raw = await fs.readFile(filePath, 'utf-8');
  return normalize(raw);
}

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
