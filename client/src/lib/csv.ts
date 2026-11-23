// CSV 导出公共工具：字段转义 + 下载（带 BOM，保证 Excel 打开中文不乱码）
// 供分析看板（教师）与学习笔记面板（学生）共用

// 字段转义：引号包裹，内部引号翻倍，换行保留（Excel 可正确解析）
export function csvCell(v: string): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

// 本地日期串 YYYY-MM-DD（导出文件名用；toISOString 取的是 UTC 日期，北京时间 0-8 点会差一天）
export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 组装 CSV 并触发下载
export function saveCsv(filename: string, lines: string[]): void {
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
