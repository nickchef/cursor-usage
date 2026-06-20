import * as vscode from "vscode";
import { readCursorAuth } from "./auth";
import { fetchUsage, UsageMode } from "./api";
import { UsageStatusBar } from "./statusBar";

let statusBar: UsageStatusBar | undefined;
let output: vscode.OutputChannel;
let timer: ReturnType<typeof setInterval> | undefined;
let refreshing = false;

function cfg() {
  return vscode.workspace.getConfiguration("cursorUsage");
}

function log(msg: string): void {
  const ts = new Date().toLocaleTimeString();
  output.appendLine(`[${ts}] ${msg}`);
}

async function refresh(extensionPath: string): Promise<void> {
  if (!statusBar || refreshing) return;
  refreshing = true;
  try {
    statusBar.showLoading();

    const c = cfg();
    const auth = await readCursorAuth(
      extensionPath,
      c.get<string>("token", ""),
      c.get<string>("dbPath", ""),
      log
    );
    if (!auth) {
      statusBar.showError("未读取到登录凭证。请确认已登录 Cursor，或在设置中手动填写 token。");
      return;
    }

    const info = await fetchUsage(
      auth,
      c.get<UsageMode>("mode", "auto"),
      c.get<string>("model", "gpt-4"),
      log
    );
    if (!info) {
      statusBar.showError("获取用量失败，凭证可能已过期或接口已变更。点开「查看日志」了解详情。");
      return;
    }

    statusBar.render(
      info,
      c.get<number>("barWidth", 10),
      c.get<number>("warnThreshold", 90),
      new Date()
    );
  } catch (err) {
    log(`刷新异常: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    statusBar?.showError("刷新时发生异常，详见日志。");
  } finally {
    refreshing = false;
  }
}

function restartTimer(extensionPath: string): void {
  if (timer) clearInterval(timer);
  const seconds = Math.max(10, cfg().get<number>("refreshInterval", 60));
  timer = setInterval(() => void refresh(extensionPath), seconds * 1000);
}

function rebuildStatusBar(): void {
  statusBar?.dispose();
  const c = cfg();
  statusBar = new UsageStatusBar(
    c.get<"left" | "right">("alignment", "right"),
    c.get<number>("priority", 100)
  );
}

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("Cursor Usage");
  context.subscriptions.push(output);

  rebuildStatusBar();
  context.subscriptions.push({ dispose: () => statusBar?.dispose() });

  const extensionPath = context.extensionPath;

  context.subscriptions.push(
    vscode.commands.registerCommand("cursorUsage.refresh", () => refresh(extensionPath)),
    vscode.commands.registerCommand("cursorUsage.showOutput", () => output.show()),
    vscode.commands.registerCommand("cursorUsage.openDashboard", () =>
      vscode.env.openExternal(vscode.Uri.parse("https://www.cursor.com/settings"))
    )
  );

  // 配置变化时重建状态栏 / 重置定时器并立即刷新。
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("cursorUsage")) return;
      if (
        e.affectsConfiguration("cursorUsage.alignment") ||
        e.affectsConfiguration("cursorUsage.priority")
      ) {
        rebuildStatusBar();
      }
      restartTimer(extensionPath);
      void refresh(extensionPath);
    })
  );

  context.subscriptions.push({ dispose: () => timer && clearInterval(timer) });

  restartTimer(extensionPath);
  void refresh(extensionPath);
}

export function deactivate(): void {
  if (timer) clearInterval(timer);
  statusBar?.dispose();
}
