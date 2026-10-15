// src/lib/feedback/browserInfo.ts
//
// スナップショットに付けるブラウザの要約（v3.157）。生の UserAgent 全文は送らない
// （ブラウザ名・メジャー版・OS の列挙値だけ。バージョンの細かい数字や拡張機能の痕跡を送らないため）。

export type BrowserName = "Edge" | "Chrome" | "Firefox" | "Safari" | "Opera" | "Other";
export type OsName = "Windows" | "macOS" | "iOS" | "Android" | "ChromeOS" | "Linux" | "Other";

export interface BrowserInfo {
  browser: BrowserName;
  /** メジャー版（取れなければ null） */
  major: number | null;
  os: OsName;
}

function major(ua: string, re: RegExp): number | null {
  const m = re.exec(ua);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function parseUserAgent(ua: string | null | undefined): BrowserInfo {
  const s = typeof ua === "string" ? ua : "";
  // 判定の順序が重要：Edge・Opera は Chrome を、Chrome は Safari を名乗る
  let browser: BrowserName = "Other";
  let ver: number | null = null;
  if (/\bEdg(?:e|A|iOS)?\/(\d+)/.test(s)) { browser = "Edge"; ver = major(s, /\bEdg(?:e|A|iOS)?\/(\d+)/); }
  else if (/\bOPR\/(\d+)/.test(s)) { browser = "Opera"; ver = major(s, /\bOPR\/(\d+)/); }
  else if (/\b(?:Chrome|CriOS)\/(\d+)/.test(s)) { browser = "Chrome"; ver = major(s, /\b(?:Chrome|CriOS)\/(\d+)/); }
  else if (/\b(?:Firefox|FxiOS)\/(\d+)/.test(s)) { browser = "Firefox"; ver = major(s, /\b(?:Firefox|FxiOS)\/(\d+)/); }
  else if (/\bSafari\//.test(s) && /\bVersion\/(\d+)/.test(s)) { browser = "Safari"; ver = major(s, /\bVersion\/(\d+)/); }

  let os: OsName = "Other";
  if (/\bWindows NT\b/.test(s)) os = "Windows";
  else if (/\b(?:iPhone|iPad|iPod)\b/.test(s)) os = "iOS";
  else if (/\bAndroid\b/.test(s)) os = "Android";
  else if (/\bCrOS\b/.test(s)) os = "ChromeOS";
  else if (/\bMac OS X\b|\bMacintosh\b/.test(s)) os = "macOS";
  else if (/\bLinux\b/.test(s)) os = "Linux";

  return { browser, major: ver, os };
}
