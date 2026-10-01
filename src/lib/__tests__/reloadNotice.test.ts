// src/lib/__tests__/reloadNotice.test.ts
//
// 【設計意図】
// compareVersions（数値比較。"3.9" < "3.10" を文字列比較の罠に落ちずに判定できるか）と
// shouldShowReloadNotice（「サーバーのversionが新しいだけでは出さない」「minClientVersionが
// 実行中の版より新しいときだけ出す」「取得失敗（null）では出さない」）を検証する。

import { describe, expect, it } from "vitest";
import { compareVersions, shouldShowReloadNotice } from "../reloadNotice";

describe("compareVersions：セグメントごとの数値比較", () => {
  it("\"3.9\" は \"3.10\" より古い（文字列比較なら逆転する罠を回避できる）", () => {
    expect(compareVersions("3.9", "3.10")).toBeLessThan(0);
    expect(compareVersions("3.10", "3.9")).toBeGreaterThan(0);
  });

  it("同値は0を返す", () => {
    expect(compareVersions("3.125", "3.125")).toBe(0);
    expect(compareVersions("3.0", "3.0.0")).toBe(0); // 末尾セグメント省略は0として扱う
  });

  it("桁数が違っても正しく比較する", () => {
    expect(compareVersions("3.9.1", "3.9")).toBeGreaterThan(0);
    expect(compareVersions("4.0", "3.125")).toBeGreaterThan(0);
  });

  it("不正な値（数値化できないセグメント）は例外を投げず0として扱う", () => {
    expect(() => compareVersions("abc", "3.0")).not.toThrow();
    expect(compareVersions("abc", "3.0")).toBeLessThan(0); // "abc"→[0] 扱いのため3.0より古い
    expect(compareVersions("", "")).toBe(0);
    expect(compareVersions("3.x", "3.0")).toBe(0); // "x"→0 扱いのため3.0と同値
  });
});

describe("shouldShowReloadNotice：バナーを出すかどうかの唯一の判定", () => {
  it("minClientVersionが実行中の版より新しければ出す", () => {
    expect(shouldShowReloadNotice("3.124", "3.125")).toBe(true);
  });

  it("minClientVersionが実行中の版と同じなら出さない", () => {
    expect(shouldShowReloadNotice("3.125", "3.125")).toBe(false);
  });

  it("minClientVersionが実行中の版以下（version自体は新しくても）なら出さない", () => {
    // サーバーのversionが新しいだけでは出さない、という念押し要件：
    // version自体は見ず、minClientVersionとの比較だけで判定することを確認する。
    expect(shouldShowReloadNotice("3.125", "3.100")).toBe(false);
    expect(shouldShowReloadNotice("3.200", "3.125")).toBe(false);
  });

  it("取得失敗（null）では出さない", () => {
    expect(shouldShowReloadNotice("3.100", null)).toBe(false);
  });
});
