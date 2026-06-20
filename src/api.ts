import * as https from "https";
import { CursorAuth, UsageInfo } from "./types";

type Logger = (msg: string) => void;

const BASE = "https://cursor.com";

interface HttpResponse {
  status: number;
  body: string;
}

/** 极简 HTTPS GET，自动跟随 301/302/307/308 重定向（最多 5 次）。 */
function httpGet(url: string, cookie: string, redirectsLeft = 5): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "GET",
        headers: {
          Cookie: cookie,
          Accept: "*/*",
          "User-Agent": "cursor-usage-extension",
          Referer: `${BASE}/dashboard/usage`,
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;
        if ([301, 302, 307, 308].includes(status) && location && redirectsLeft > 0) {
          res.resume();
          const next = new URL(location, url).toString();
          resolve(httpGet(next, cookie, redirectsLeft - 1));
          return;
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status, body: data }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function parseJson(body: string): any {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** 构造多种可能的 Cookie，逐个尝试以适配不同账号形态。 */
function cookieCandidates(auth: CursorAuth): string[] {
  const list: string[] = [];
  if (auth.sub) {
    list.push(`WorkosCursorSessionToken=${encodeURIComponent(`${auth.sub}::${auth.token}`)}`);
  }
  if (auth.userId && auth.userId !== auth.sub) {
    list.push(`WorkosCursorSessionToken=${encodeURIComponent(`${auth.userId}::${auth.token}`)}`);
  }
  list.push(`WorkosCursorSessionToken=${auth.token}`);
  return list;
}

/** 用 /api/auth/me 验证哪种 Cookie 有效。 */
async function resolveCookie(auth: CursorAuth, log: Logger): Promise<string | undefined> {
  for (const cookie of cookieCandidates(auth)) {
    try {
      const res = await httpGet(`${BASE}/api/auth/me`, cookie);
      log(`/api/auth/me -> ${res.status}`);
      if (res.status === 200) {
        const me = parseJson(res.body);
        if (me && (me.email || me.sub)) log(`登录账号: ${me.email ?? me.sub}`);
        return cookie;
      }
    } catch (err) {
      log(`/api/auth/me 异常: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return undefined;
}

function parseDate(s?: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

/**
 * 美元额度模型：/api/usage-summary（dashboard「Your monthly usage」同源）。
 * 返回中 individualUsage.overall 的 used/limit/remaining 单位为「美分」。
 */
async function fetchUsageSummary(cookie: string, log: Logger): Promise<UsageInfo | undefined> {
  const res = await httpGet(`${BASE}/api/usage-summary`, cookie);
  log(`/api/usage-summary -> ${res.status}`);
  if (res.status !== 200) {
    log(`/api/usage-summary 非 200: ${res.body.slice(0, 300)}`);
    return undefined;
  }
  const data = parseJson(res.body);
  if (!data) {
    log(`/api/usage-summary 无法解析: ${res.body.slice(0, 300)}`);
    return undefined;
  }
  log(`/api/usage-summary 原始响应: ${JSON.stringify(data).slice(0, 600)}`);

  const overall = data?.individualUsage?.overall;
  if (!overall || typeof overall.used !== "number") {
    log("usage-summary 中无 individualUsage.overall.used，跳过美元模式。");
    return undefined;
  }

  const used = overall.used / 100;
  const hasLimit =
    data.isUnlimited !== true && typeof overall.limit === "number" && overall.limit > 0;
  const limit = hasLimit ? overall.limit / 100 : null;

  return {
    used,
    limit,
    unit: "usd",
    itemName: "monthly usage",
    resetDate: parseDate(data.billingCycleEnd),
  };
}

function computeResetDate(startOfMonth?: string): Date | undefined {
  const d = parseDate(startOfMonth);
  if (!d) return undefined;
  d.setMonth(d.getMonth() + 1);
  return d;
}

/**
 * 请求（次数）模型：/api/usage。
 * 返回形如 { "gpt-4": { numRequests, maxRequestUsage }, "startOfMonth": "..." }
 */
async function fetchUsageRequests(
  cookie: string,
  auth: CursorAuth,
  model: string,
  log: Logger
): Promise<UsageInfo | undefined> {
  const userParam = encodeURIComponent(auth.userId || auth.sub);
  const res = await httpGet(`${BASE}/api/usage?user=${userParam}`, cookie);
  log(`/api/usage -> ${res.status}`);
  if (res.status !== 200) {
    log(`/api/usage 非 200: ${res.body.slice(0, 300)}`);
    return undefined;
  }
  const data = parseJson(res.body);
  if (!data) {
    log(`/api/usage 无法解析: ${res.body.slice(0, 300)}`);
    return undefined;
  }
  log(`/api/usage 原始响应: ${JSON.stringify(data).slice(0, 600)}`);

  const pick = (key: string) => {
    const e = data[key];
    if (e && typeof e.numRequests === "number") {
      return {
        used: e.numRequests as number,
        limit: typeof e.maxRequestUsage === "number" ? e.maxRequestUsage : null,
        itemName: key,
      };
    }
    return undefined;
  };

  let chosen = pick(model);
  if (!chosen || chosen.limit == null) {
    for (const key of Object.keys(data)) {
      const c = pick(key);
      if (c && c.limit != null) {
        chosen = c;
        break;
      }
    }
  }
  if (!chosen) chosen = pick(model);
  if (!chosen) return undefined;

  return {
    used: chosen.used,
    limit: chosen.limit,
    unit: "requests",
    itemName: chosen.itemName,
    resetDate: computeResetDate(data.startOfMonth),
  };
}

export type UsageMode = "auto" | "dollars" | "requests";

/** 拉取并归一化用量信息。 */
export async function fetchUsage(
  auth: CursorAuth,
  mode: UsageMode,
  model: string,
  log: Logger
): Promise<UsageInfo | undefined> {
  const cookie = await resolveCookie(auth, log);
  if (!cookie) {
    log("没有可用的 Cookie，凭证可能已过期，请在 Cursor 中重新登录。");
    return undefined;
  }

  let info: UsageInfo | undefined;
  try {
    if (mode === "dollars") {
      info = await fetchUsageSummary(cookie, log);
    } else if (mode === "requests") {
      info = await fetchUsageRequests(cookie, auth, model, log);
    } else {
      // auto：优先美元额度；没有有限额度时回退请求模型。
      info = await fetchUsageSummary(cookie, log);
      if (!info || info.limit == null) {
        const reqInfo = await fetchUsageRequests(cookie, auth, model, log);
        if (reqInfo && reqInfo.limit != null) info = reqInfo;
        else info = info ?? reqInfo;
      }
    }
  } catch (err) {
    log(`用量请求异常: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }

  if (!info) {
    log("未能识别任何用量数据，请用「查看日志」把原始响应发给开发者以适配。");
    return undefined;
  }

  info.label = auth.membershipType;
  info.email = auth.email;
  return info;
}
