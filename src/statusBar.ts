import * as vscode from "vscode";
import { UsageInfo } from "./types";

const FILLED = "▰";
const EMPTY = "▱";

function renderBar(pct: number, width: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  return FILLED.repeat(filled) + EMPTY.repeat(Math.max(0, width - filled));
}

function usedStr(used: number, unit: "usd" | "requests"): string {
  return unit === "usd" ? `$${used.toFixed(2)}` : `${used} 次`;
}

function formatValue(used: number, limit: number | null, unit: "usd" | "requests"): string {
  const u = usedStr(used, unit);
  if (limit == null) return `${u} · 不限量`;
  return unit === "usd" ? `$${used.toFixed(2)}/$${limit.toFixed(2)}` : `${used}/${limit}`;
}

function formatDate(d?: Date): string {
  if (!d) return "未知";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export class UsageStatusBar {
  private item: vscode.StatusBarItem;

  constructor(alignment: "left" | "right", priority: number) {
    this.item = vscode.window.createStatusBarItem(
      alignment === "left"
        ? vscode.StatusBarAlignment.Left
        : vscode.StatusBarAlignment.Right,
      priority
    );
    this.item.command = "cursorUsage.refresh";
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }

  showLoading(): void {
    this.item.text = "$(sync~spin) Cursor 用量…";
    this.item.tooltip = "正在获取 Cursor 用量";
    this.item.backgroundColor = undefined;
  }

  showError(message: string): void {
    this.item.text = "$(alert) Cursor 用量不可用";
    this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;
    md.appendMarkdown(`**Cursor 用量获取失败**\n\n${message}\n\n`);
    md.appendMarkdown(`[查看日志](command:cursorUsage.showOutput) · `);
    md.appendMarkdown(`[重试](command:cursorUsage.refresh) · `);
    md.appendMarkdown(`[打开 Dashboard](command:cursorUsage.openDashboard)`);
    this.item.tooltip = md;
  }

  render(info: UsageInfo, barWidth: number, warnThreshold: number, updatedAt: Date): void {
    const hasLimit = info.limit != null && info.limit > 0;
    const pct = hasLimit ? (info.used / (info.limit as number)) * 100 : 0;
    const value = formatValue(info.used, info.limit, info.unit);

    if (hasLimit) {
      this.item.text = `$(pulse) ${renderBar(pct, barWidth)} ${Math.round(pct)}%  ${value}`;
    } else {
      this.item.text = `$(pulse) ${value}`;
    }

    this.item.backgroundColor =
      hasLimit && pct >= warnThreshold
        ? new vscode.ThemeColor("statusBarItem.warningBackground")
        : undefined;

    const remaining =
      hasLimit
        ? info.unit === "usd"
          ? `$${((info.limit as number) - info.used).toFixed(2)}`
          : String((info.limit as number) - info.used)
        : "不限量";

    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;
    md.appendMarkdown(`**Cursor Plan 用量**\n\n`);
    md.appendMarkdown(`| | |\n|---|---|\n`);
    if (info.label) md.appendMarkdown(`| 套餐 | \`${info.label}\` |\n`);
    if (info.email) md.appendMarkdown(`| 账号 | ${info.email} |\n`);
    if (info.itemName) md.appendMarkdown(`| 项目 | ${info.itemName} |\n`);
    md.appendMarkdown(`| 已用 | ${usedStr(info.used, info.unit)} |\n`);
    md.appendMarkdown(`| 剩余 | ${remaining} |\n`);
    if (hasLimit) {
      md.appendMarkdown(
        `| 额度 | ${info.unit === "usd" ? `$${(info.limit as number).toFixed(2)}` : info.limit} |\n`
      );
      md.appendMarkdown(`| 进度 | ${renderBar(pct, barWidth)} ${Math.round(pct)}% |\n`);
    }
    md.appendMarkdown(`| 重置 | ${formatDate(info.resetDate)} |\n`);
    md.appendMarkdown(`| 更新 | ${updatedAt.toLocaleTimeString()} |\n`);
    md.appendMarkdown(`\n[刷新](command:cursorUsage.refresh) · `);
    md.appendMarkdown(`[Dashboard](command:cursorUsage.openDashboard) · `);
    md.appendMarkdown(`[日志](command:cursorUsage.showOutput)`);
    this.item.tooltip = md;
  }
}
