import { spawn } from 'child_process';
import path from 'path';

// agently-cli 本地二进制：容器内为 /app/node_modules/.bin/agently-cli（本地开发为 server/node_modules/.bin）
const CLI_PATH = path.resolve(__dirname, '../../node_modules/.bin/agently-cli');
const SEND_TIMEOUT_MS = 30000;

/**
 * 通过 Agent 邮箱（agently-cli）发送纯文本邮件。
 *
 * 凭据：docker-compose 把宿主机 `agently-cli auth login` 产生的两个凭据目录
 * （~/.agently-cli 与 ~/.local/share/agently-cli）按原路径挂载进容器，
 * 并设置 AGENTLY_WORKSPACE=codebuddy 使容器内 CLI 与宿主机使用同一份授权。
 *
 * --confirmed 免除两阶段确认：忘记密码场景收件人是发起请求的用户本人邮箱，
 * 属于用户明确授权的自动化发信。
 */
export async function sendMail(opts: { to: string; subject: string; body: string }): Promise<void> {
  const args = [
    'message', '+send',
    '--to', opts.to,
    '--subject', opts.subject,
    '--body', opts.body,
    '--body-format', 'plain',
    '--confirmed',
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(CLI_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('邮件发送超时'));
    }, SEND_TIMEOUT_MS);

    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      // 错误文案在 stdout 的 JSON envelope error.message 里，取不到时用 stderr 兜底
      let message = '';
      try {
        const parsed = JSON.parse(stdout);
        message = parsed?.error?.message || '';
      } catch {
        /* 非 JSON 输出，忽略 */
      }
      reject(new Error(message || stderr.trim() || `agently-cli 退出码 ${code}`));
    });
  });
}
