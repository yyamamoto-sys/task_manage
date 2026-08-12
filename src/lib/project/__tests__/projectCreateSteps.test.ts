import { describe, it, expect } from "vitest";
import { resolveSteps, canGoNext, defaultDateStrategy, stepLabel, type CanGoNextState } from "../projectCreateSteps";

describe("resolveSteps", () => {
  it("まっさらな新規作成は2ステップ（作成方法→名前をつけて作成）", () => {
    expect(resolveSteps("blank")).toEqual(["method", "finalize"]);
  });

  it("他PJから引き継ぐは5ステップ", () => {
    expect(resolveSteps("inherit")).toEqual(["method", "schedule", "tasks", "members", "finalize"]);
  });
});

describe("stepLabel", () => {
  it("各ステップIDに対応する日本語ラベルを返す", () => {
    expect(stepLabel("method")).toBe("作成方法・引継ぎ元PJ");
    expect(stepLabel("schedule")).toBe("日程の引き継ぎ方");
    expect(stepLabel("finalize")).toBe("名前をつけて作成");
  });
});

describe("defaultDateStrategy", () => {
  it("引き継ぎ元PJにマイルストーンがあれば「スケジュール間隔を引き継ぐ」を既定にする", () => {
    expect(defaultDateStrategy(true)).toBe("keep_interval");
  });

  it("引き継ぎ元PJにマイルストーンが無ければ「日付を引き継がない」を既定にする", () => {
    expect(defaultDateStrategy(false)).toBe("no_dates");
  });
});

describe("canGoNext", () => {
  const base: CanGoNextState = {
    mode: "blank",
    originProjectId: "",
    dateStrategy: "no_dates",
    anchorMilestoneId: null,
    newAnchorDate: "",
  };

  it("method：まっさらな新規作成は引き継ぎ元PJ未選択でも次へ進める", () => {
    expect(canGoNext("method", { ...base, mode: "blank" })).toBe(true);
  });

  it("method：他PJから引き継ぐは引き継ぎ元PJが未選択だと次へ進めない", () => {
    expect(canGoNext("method", { ...base, mode: "inherit", originProjectId: "" })).toBe(false);
  });

  it("method：他PJから引き継ぐは引き継ぎ元PJを選べば次へ進める", () => {
    expect(canGoNext("method", { ...base, mode: "inherit", originProjectId: "p1" })).toBe(true);
  });

  it("schedule：「日付を引き継がない」は基準未設定でも次へ進める", () => {
    expect(canGoNext("schedule", { ...base, mode: "inherit", dateStrategy: "no_dates" })).toBe(true);
  });

  it("schedule：「スケジュール間隔を引き継ぐ」は基準マイルストーン・新日付の両方が無いと次へ進めない", () => {
    expect(canGoNext("schedule", {
      ...base, mode: "inherit", dateStrategy: "keep_interval", anchorMilestoneId: null, newAnchorDate: "",
    })).toBe(false);
  });

  it("schedule：基準マイルストーンのみでは次へ進めない（新日付が必須）", () => {
    expect(canGoNext("schedule", {
      ...base, mode: "inherit", dateStrategy: "keep_interval", anchorMilestoneId: "m1", newAnchorDate: "",
    })).toBe(false);
  });

  it("schedule：新日付のみでは次へ進めない（基準マイルストーンが必須）", () => {
    expect(canGoNext("schedule", {
      ...base, mode: "inherit", dateStrategy: "keep_interval", anchorMilestoneId: null, newAnchorDate: "2027-07-27",
    })).toBe(false);
  });

  it("schedule：基準マイルストーン・新日付の両方が揃えば次へ進める", () => {
    expect(canGoNext("schedule", {
      ...base, mode: "inherit", dateStrategy: "keep_interval", anchorMilestoneId: "m1", newAnchorDate: "2027-07-27",
    })).toBe(true);
  });

  it("tasks・members・finalizeは常に次へ進める（インポート0件でも許可）", () => {
    expect(canGoNext("tasks", base)).toBe(true);
    expect(canGoNext("members", base)).toBe(true);
    expect(canGoNext("finalize", base)).toBe(true);
  });
});
