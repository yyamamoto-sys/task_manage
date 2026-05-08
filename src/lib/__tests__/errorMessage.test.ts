import { describe, it, expect } from "vitest";
import { getErrorMessage, formatErrorForUser } from "../errorMessage";

describe("getErrorMessage（内部用途）", () => {
  it("Error インスタンスは message を返す", () => {
    expect(getErrorMessage(new Error("壊れた"))).toBe("壊れた");
  });

  it("プレーンオブジェクトは message プロパティを返す", () => {
    expect(getErrorMessage({ message: "x" })).toBe("x");
  });

  it("プリミティブは String() で返す", () => {
    expect(getErrorMessage("文字列")).toBe("文字列");
    expect(getErrorMessage(42)).toBe("42");
    expect(getErrorMessage(null)).toBe("null");
  });
});

describe("formatErrorForUser（ユーザー向け表示）", () => {
  it("prefix とエラーコードを両方含める（Supabase PostgrestError 想定）", () => {
    const err = Object.assign(new Error('column "summary" does not exist'), {
      code: "42703",
      details: 'column "summary" does not exist in relation "kr_sessions"',
      hint: "Perhaps you meant to reference the column \"summary\".",
    });
    const result = formatErrorForUser("保存に失敗しました", err);
    expect(result).toContain("保存に失敗しました");
    expect(result).toContain("[42703]");
    expect(result).toContain('column "summary" does not exist');
    expect(result).toContain("ヒント:");
  });

  it("CHECK 制約違反（23514）でも codes が出る", () => {
    const err = Object.assign(new Error("new row violates check constraint"), {
      code: "23514",
    });
    const result = formatErrorForUser("保存に失敗しました", err);
    expect(result).toBe("保存に失敗しました [23514] new row violates check constraint");
  });

  it("プレーンオブジェクトのエラーでも code を取り出す", () => {
    const result = formatErrorForUser("失敗", { code: "PGRST116", message: "Not Found" });
    expect(result).toContain("[PGRST116]");
    expect(result).toContain("Not Found");
  });

  it("コードがなければ prefix と message だけになる", () => {
    const result = formatErrorForUser("ダウンロードに失敗しました", new Error("network error"));
    expect(result).toBe("ダウンロードに失敗しました network error");
  });

  it("details が message と同じなら重複表示しない", () => {
    const err = Object.assign(new Error("X"), { code: "C1", details: "X" });
    const result = formatErrorForUser("失敗", err);
    expect(result).toBe("失敗 [C1] X");
    expect(result.indexOf("X")).toBe(result.lastIndexOf("X"));
  });

  it("プリミティブを渡しても落ちない", () => {
    expect(formatErrorForUser("失敗", "文字列エラー")).toBe("失敗 文字列エラー");
    expect(formatErrorForUser("失敗", null)).toBe("失敗 null");
    expect(formatErrorForUser("失敗", undefined)).toBe("失敗 undefined");
  });

  it("prefix が空でも動く", () => {
    expect(formatErrorForUser("", new Error("x"))).toBe("x");
  });
});
