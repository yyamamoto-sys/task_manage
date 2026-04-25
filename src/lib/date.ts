// src/lib/date.ts
// 日付操作ユーティリティ。全Viewで共有する。

/** 今日の日付を YYYY-MM-DD 形式で返す */
export function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

/** 文字列・null から Date を安全に生成する。無効な値は null を返す */
export function toDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  d.setHours(0, 0, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

/** Date を YYYY-MM-DD 形式の文字列に変換する */
export function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** Date に n 日加算して新しい Date を返す */
export function addDays(base: Date, n: number): Date {
  const r = new Date(base);
  r.setDate(r.getDate() + n);
  return r;
}

/** 今日から n 日後の日付を YYYY-MM-DD 形式で返す */
export function addDaysFromToday(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

/** 2つの日付の差（日数）を返す。b - a の符号 */
export function diffDays(a: Date | string, b: Date | string): number {
  const da = typeof a === "string" ? new Date(a) : a;
  const db = typeof b === "string" ? new Date(b) : b;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

/** 今日から指定日付までの日数差を返す（過去は負値） */
export function diffDaysFromToday(s: string): number {
  return diffDays(todayStr(), s);
}

/** Date を「YYYY年M月」形式に変換する */
export function formatYM(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

/** 日付文字列を「M/D」形式に変換する */
export function formatMD(s: string): string {
  const d = new Date(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** start〜end の全日付を配列で返す（両端含む） */
export function getDaysInRange(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  let cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const endN = new Date(end);
  endN.setHours(0, 0, 0, 0);
  while (cur <= endN) {
    days.push(new Date(cur));
    cur = addDays(cur, 1);
  }
  return days;
}
