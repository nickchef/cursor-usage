import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import initSqlJs, { SqlJsStatic } from "sql.js";
import { CursorAuth } from "./types";

type Logger = (msg: string) => void;

let sqlPromise: Promise<SqlJsStatic> | undefined;

/** 初始化 sql.js（WASM），只做一次。 */
function getSql(extensionPath: string): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: (file: string) =>
        path.join(extensionPath, "node_modules", "sql.js", "dist", file),
    });
  }
  return sqlPromise;
}

/** 按平台探测 Cursor 的 state.vscdb 路径。 */
function detectDbPath(): string | undefined {
  const home = os.homedir();
  let base: string;
  if (process.platform === "win32") {
    base = process.env.APPDATA || path.join(home, "AppData", "Roaming");
  } else if (process.platform === "darwin") {
    base = path.join(home, "Library", "Application Support");
  } else {
    base = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  }

  const candidates = [
    path.join(base, "Cursor", "User", "globalStorage", "state.vscdb"),
    path.join(base, "cursor", "User", "globalStorage", "state.vscdb"),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

/** 解析 JWT 的 payload，取出 sub。 */
function decodeSub(token: string): string {
  try {
    const part = token.split(".")[1];
    if (!part) return "";
    const json = Buffer.from(part, "base64url").toString("utf8");
    const payload = JSON.parse(json);
    return typeof payload.sub === "string" ? payload.sub : "";
  } catch {
    return "";
  }
}

function buildAuth(token: string, email?: string, membershipType?: string): CursorAuth {
  const sub = decodeSub(token);
  const userId = sub.includes("|") ? sub.split("|").pop()! : sub;
  return { token, sub, userId, email, membershipType };
}

/**
 * 读取 Cursor 登录凭证。
 * 优先用手动 token；否则从 state.vscdb 自动读取。
 */
export async function readCursorAuth(
  extensionPath: string,
  manualToken: string,
  dbPathOverride: string,
  log: Logger
): Promise<CursorAuth | undefined> {
  // 1) 手动 token
  if (manualToken.trim()) {
    let token = manualToken.trim();
    // 兼容直接粘贴 WorkosCursorSessionToken（形如 userId%3A%3A<jwt>）的情况
    const decoded = decodeURIComponent(token);
    if (decoded.includes("::")) {
      token = decoded.split("::").pop()!;
    }
    log("使用手动配置的 token。");
    return buildAuth(token);
  }

  // 2) 自动从数据库读取
  const dbPath =
    dbPathOverride.trim() && fs.existsSync(dbPathOverride.trim())
      ? dbPathOverride.trim()
      : detectDbPath();

  if (!dbPath) {
    log("未找到 Cursor 的 state.vscdb，请确认已安装并登录 Cursor，或在设置中手动指定路径。");
    return undefined;
  }
  log(`读取数据库: ${dbPath}`);

  try {
    const SQL = await getSql(extensionPath);
    const bytes = fs.readFileSync(dbPath);
    const db = new SQL.Database(bytes);
    try {
      const keys = [
        "cursorAuth/accessToken",
        "cursorAuth/cachedEmail",
        "cursorAuth/stripeMembershipType",
      ];
      const inClause = keys.map((k) => `'${k}'`).join(",");
      const result = db.exec(
        `SELECT key, value FROM ItemTable WHERE key IN (${inClause})`
      );

      const map = new Map<string, string>();
      if (result.length) {
        for (const row of result[0].values) {
          map.set(String(row[0]), row[1] == null ? "" : String(row[1]));
        }
      }

      const token = map.get("cursorAuth/accessToken");
      if (!token) {
        log("数据库中没有 cursorAuth/accessToken，可能尚未登录。");
        return undefined;
      }
      log("已从数据库读取到 accessToken。");
      return buildAuth(
        token,
        map.get("cursorAuth/cachedEmail"),
        map.get("cursorAuth/stripeMembershipType")
      );
    } finally {
      db.close();
    }
  } catch (err) {
    log(`读取数据库失败: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}
