import { describe, it, expect } from "vitest";
import { stripAliasIds, splitAliasRefs, normalizeAlias } from "../displayText";

const names: Record<string, string> = {
  task_001: "見積書を作る",
  task_002: "契約書の確認",
  pj_001: "新商品PJ",
};
const resolve = (a: string) => names[a];

describe("stripAliasIds", () => {
  it("名前の直後の半角括弧は括弧ごと消す", () => {
    expect(stripAliasIds("見積書を作る(task_001)を急ぎましょう", resolve)).toBe("見積書を作るを急ぎましょう");
  });

  it("全角括弧・括弧前の空白も消す", () => {
    expect(stripAliasIds("見積書を作る（task_001）が遅れています", resolve)).toBe("見積書を作るが遅れています");
    expect(stripAliasIds("見積書を作る (task_001) が遅れています", resolve)).toBe("見積書を作る が遅れています");
  });

  it("連続する参照をそれぞれ消す", () => {
    expect(stripAliasIds("見積書を作る(task_001)と契約書の確認(task_002)", resolve)).toBe("見積書を作ると契約書の確認");
  });

  it("1つの括弧に複数の識別記号があっても消す", () => {
    expect(stripAliasIds("この2件(task_001, task_002)は連動します", resolve)).toBe("この2件は連動します");
  });

  it("裸の識別記号は対応するタスク名に置き換える", () => {
    expect(stripAliasIds("task_002 を先に確認してください", resolve)).toBe("契約書の確認 を先に確認してください");
    expect(stripAliasIds("pj_001 の状況", resolve)).toBe("新商品PJ の状況");
  });

  it("文頭・句読点直後の括弧書きは名前なしの参照として名前にする", () => {
    expect(stripAliasIds("(task_001)が遅れています", resolve)).toBe("見積書を作るが遅れています");
    expect(stripAliasIds("対象：（task_002）", resolve)).toBe("対象：契約書の確認");
    expect(stripAliasIds("1行目\n(task_001)", resolve)).toBe("1行目\n見積書を作る");
  });

  it("解決できない識別記号は消さず自然な語にする", () => {
    expect(stripAliasIds("task_999 が詰まっています", resolve)).toBe("該当タスク が詰まっています");
    expect(stripAliasIds("pj_999 の件", resolve)).toBe("該当プロジェクト の件");
    expect(stripAliasIds("kr_001 と tf_002 と o_001", resolve)).toBe("該当KR と 該当TF と 該当Objective");
    expect(stripAliasIds("名前を引けない(task_999)です", resolve)).toBe("名前を引けないです");
  });

  it("resolver が無くても識別記号は残らない", () => {
    expect(stripAliasIds("タスクA(task_001)と task_002")).toBe("タスクAと 該当タスク");
  });

  it("識別記号を含まない文はそのまま", () => {
    const t = "KR1のタスクを整理します。(来週まで)・task 1 は別物です。";
    expect(stripAliasIds(t, resolve)).toBe(t);
    expect(stripAliasIds("", resolve)).toBe("");
  });

  it("別の英数字の一部は識別記号とみなさない", () => {
    expect(stripAliasIds("subtask_001x と mytask_001", resolve)).toBe("subtask_001x と mytask_001");
  });
});

describe("splitAliasRefs", () => {
  it("名前の末尾が一致するときはその名前をリンク対象の参照にする", () => {
    const segs = splitAliasRefs("まず見積書を作る(task_001)をやる", resolve);
    expect(segs).toEqual([
      { kind: "text", text: "まず" },
      { kind: "ref", text: "見積書を作る", alias: "task_001", resolved: true },
      { kind: "text", text: "をやる" },
    ]);
  });

  it("裸の参照は resolved の有無を持つ", () => {
    const segs = splitAliasRefs("task_001 と task_999", resolve);
    expect(segs.filter(s => s.kind === "ref")).toEqual([
      { kind: "ref", text: "見積書を作る", alias: "task_001", resolved: true },
      { kind: "ref", text: "該当タスク", alias: "task_999", resolved: false },
    ]);
  });
});

describe("normalizeAlias", () => {
  it("表記ゆれを payloadBuilder の形式に揃える", () => {
    expect(normalizeAlias("task9")).toBe("task_009");
    expect(normalizeAlias("TASK_001")).toBe("task_001");
    expect(normalizeAlias("pj_12")).toBe("pj_012");
  });
});
