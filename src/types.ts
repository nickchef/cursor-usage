/** 归一化后的用量信息，供状态栏渲染使用。 */
export interface UsageInfo {
  /** 已用量（单位由 unit 决定）。 */
  used: number;
  /** 总额度；null 表示无上限（不限量套餐）。 */
  limit: number | null;
  /** 计量单位：美元 or 请求次数。 */
  unit: "usd" | "requests";
  /** 套餐名，例如 "pro" / "free"。 */
  label?: string;
  /** 账号邮箱，仅用于悬停展示。 */
  email?: string;
  /** 下次额度重置时间。 */
  resetDate?: Date;
  /** 该模型/项目的名字，例如 "gpt-4"。 */
  itemName?: string;
}

/** 从本地数据库读取到的 Cursor 登录凭证。 */
export interface CursorAuth {
  /** accessToken（JWT）。 */
  token: string;
  /** JWT 中的 sub 字段（原始值，可能形如 auth0|user_xxx）。 */
  sub: string;
  /** 提取出的 userId（sub 中 "|" 之后的部分）。 */
  userId: string;
  email?: string;
  membershipType?: string;
}
