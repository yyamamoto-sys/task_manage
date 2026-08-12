import { describe, it, expect } from "vitest";
import {
  computeInheritOffsetDays,
  shiftDateByOffset,
  computeInheritedTaskDates,
  computeInheritedMilestoneDate,
} from "../inheritTaskDates";

describe("computeInheritOffsetDays", () => {
  it("元日付→新日付の符号付き差分（暦日）を返す（新しい方が後ろ＝正）", () => {
    expect(computeInheritOffsetDays("2026-01-01", "2026-03-01")).toBe(59);
  });

  it("新しい方が前でも符号付きで返す（負のオフセット）", () => {
    expect(computeInheritOffsetDays("2026-03-01", "2026-01-01")).toBe(-59);
  });

  it("元日付が無ければ null", () => {
    expect(computeInheritOffsetDays(null, "2026-03-01")).toBeNull();
  });

  it("新日付が無ければ null", () => {
    expect(computeInheritOffsetDays("2026-01-01", null)).toBeNull();
  });
});

describe("shiftDateByOffset", () => {
  it("正のオフセットを加算する", () => {
    expect(shiftDateByOffset("2026-01-01", 10)).toBe("2026-01-11");
  });

  it("負のオフセットも加算する（前倒し）", () => {
    expect(shiftDateByOffset("2026-01-11", -10)).toBe("2026-01-01");
  });

  it("オフセット0は同じ日付を返す", () => {
    expect(shiftDateByOffset("2026-01-01", 0)).toBe("2026-01-01");
  });

  it("日付が無ければ null のまま", () => {
    expect(shiftDateByOffset(null, 10)).toBeNull();
  });

  it("月をまたぐオフセットでも正しく計算できる", () => {
    expect(shiftDateByOffset("2026-01-28", 6)).toBe("2026-02-03");
  });

  it("年をまたぐオフセットでも正しく計算できる", () => {
    expect(shiftDateByOffset("2026-12-28", 6)).toBe("2027-01-03");
  });

  it("うるう年の2/29を含む区間でも正しく計算できる（2028年はうるう年）", () => {
    expect(shiftDateByOffset("2028-02-27", 3)).toBe("2028-03-01");
  });

  it("うるう年の2/29自体をオフセット計算できる", () => {
    expect(shiftDateByOffset("2028-02-29", 1)).toBe("2028-03-01");
  });
});

describe("computeInheritedTaskDates", () => {
  it("基準より後のタスク（正のオフセット）は両方の日付を同じだけ後ろにずらす", () => {
    const result = computeInheritedTaskDates({
      offsetDays: 5, // フォーラム当日基準・引継ぎ先が5日後ろにずれたケース
      startDate: "2026-06-01",
      dueDate: "2026-06-03",
    });
    expect(result).toEqual({ start_date: "2026-06-06", due_date: "2026-06-08" });
  });

  it("基準より前のタスク（負のオフセット＝『N日前』タスク）も同じ規則でずらす", () => {
    // 例：フォーラム実施5日前のタスクは、引継ぎ先でも新フォーラム日の5日前になる
    const result = computeInheritedTaskDates({
      offsetDays: -3,
      startDate: null,
      dueDate: "2026-06-01", // 元フォーラム日の5日前 = 6/1（元フォーラム日6/6と仮定）
    });
    expect(result.due_date).toBe("2026-05-29");
  });

  it("基準当日のタスク（オフセットが基準日そのもの＝0日差）は基準の新日付と同じになる", () => {
    const result = computeInheritedTaskDates({
      offsetDays: 0,
      startDate: "2026-06-06",
      dueDate: "2026-06-06",
    });
    expect(result).toEqual({ start_date: "2026-06-06", due_date: "2026-06-06" });
  });

  it("開始日のみ設定されているタスクは開始日だけ移動し、期日は null のまま", () => {
    const result = computeInheritedTaskDates({
      offsetDays: 10,
      startDate: "2026-01-01",
      dueDate: null,
    });
    expect(result).toEqual({ start_date: "2026-01-11", due_date: null });
  });

  it("期日のみ設定されているタスクは期日だけ移動し、開始日は null のまま", () => {
    const result = computeInheritedTaskDates({
      offsetDays: 10,
      startDate: null,
      dueDate: "2026-01-01",
    });
    expect(result).toEqual({ start_date: null, due_date: "2026-01-11" });
  });

  it("両方無いタスクは両方 null のまま", () => {
    const result = computeInheritedTaskDates({ offsetDays: 10, startDate: null, dueDate: null });
    expect(result).toEqual({ start_date: null, due_date: null });
  });

  it("offsetDays が null（『日付を引き継がない』選択時）は日付があっても両方 null にする", () => {
    const result = computeInheritedTaskDates({
      offsetDays: null,
      startDate: "2026-01-01",
      dueDate: "2026-01-10",
    });
    expect(result).toEqual({ start_date: null, due_date: null });
  });

  it("月をまたぐオフセットでも作業期間（日数差）が保持される", () => {
    const result = computeInheritedTaskDates({
      offsetDays: 40,
      startDate: "2026-01-20",
      dueDate: "2026-01-25",
    });
    expect(result).toEqual({ start_date: "2026-03-01", due_date: "2026-03-06" });
    // 元の作業期間は5日（1/20〜1/25）。移動後も3/1〜3/6で5日のまま保持される
  });

  it("年をまたぐオフセットでも正しく計算できる", () => {
    const result = computeInheritedTaskDates({
      offsetDays: 10,
      startDate: "2026-12-28",
      dueDate: "2026-12-30",
    });
    expect(result).toEqual({ start_date: "2027-01-07", due_date: "2027-01-09" });
  });

  it("うるう年をまたぐ区間（2028年2/29を含む）でも正しく計算できる", () => {
    const result = computeInheritedTaskDates({
      offsetDays: 5,
      startDate: "2028-02-26",
      dueDate: "2028-03-02",
    });
    expect(result).toEqual({ start_date: "2028-03-02", due_date: "2028-03-07" });
  });
});

describe("computeInheritedMilestoneDate", () => {
  it("オフセットがあれば移動する", () => {
    expect(computeInheritedMilestoneDate({ offsetDays: 30, date: "2026-06-06" })).toBe("2026-07-06");
  });

  it("offsetDays が null（『日付を引き継がない』選択時）は元の日付をそのまま返す（NOT NULL列のため消せない）", () => {
    expect(computeInheritedMilestoneDate({ offsetDays: null, date: "2026-06-06" })).toBe("2026-06-06");
  });
});

// 旧 dateSlide.ts（computeSlidedDate。v3.56以前・撤去済み）が返していた結果と、
// 「元PJ開始日→新PJ開始日」の相対日数を保つ計算を、汎用の基準（アンカー）オフセット計算
// （computeInheritOffsetDays→computeInheritedTaskDates）で再現した結果が一致することを
// 固定する回帰テスト。この関数自体は「基準が何か（マイルストーンかPJ開始日か）」を
// 意識しない汎用計算のため、UI側の選択肢（v3.58で「元PJの開始日を基準にする」を既定化→
// v3.59で山本さんの指示によりUIの選択肢としては撤去・選択肢は「スケジュール間隔を引き継ぐ」
// 「日付を引き継がない」の2つに整理）が変わっても、この関数レベルの回帰テストとしては
// 引き続き有効なため残す（CLAUDE.md Section 8参照）。
describe("旧 dateSlide.ts(computeSlidedDate) との互換性（関数レベルの回帰テスト。UI選択肢としてはv3.59で撤去済み）", () => {
  /** 旧 computeSlidedDate(originStartDate, newStartDate, originalDate) と同じ計算を、
   *  新しい「オフセット計算→適用」の2段階で再現するテスト用ヘルパー */
  function slideViaOffset(originStartDate: string, newStartDate: string, originalDate: string): string | null {
    const offsetDays = computeInheritOffsetDays(originStartDate, newStartDate);
    return computeInheritedTaskDates({ offsetDays, startDate: originalDate, dueDate: null }).start_date;
  }

  it("元PJ開始日からの相対日数を保ったまま新PJ開始日にスライドする（正のオフセット）", () => {
    expect(slideViaOffset("2026-01-01", "2026-03-01", "2026-01-04")).toBe("2026-03-04"); // 元PJ開始日の3日後→新PJ開始日の3日後
  });

  it("タスクの日付がPJ開始日より前でも同じオフセットで平行移動する（負のオフセット）", () => {
    expect(slideViaOffset("2026-01-10", "2026-03-01", "2026-01-05")).toBe("2026-02-24"); // 元PJ開始日の5日前→新PJ開始日の5日前
  });

  it("同日（オフセット0）はそのまま新PJ開始日になる", () => {
    expect(slideViaOffset("2026-01-01", "2026-03-01", "2026-01-01")).toBe("2026-03-01");
  });

  it("元タスクに日付が無ければ null のまま", () => {
    const offsetDays = computeInheritOffsetDays("2026-01-01", "2026-03-01");
    const result = computeInheritedTaskDates({ offsetDays, startDate: null, dueDate: null });
    expect(result).toEqual({ start_date: null, due_date: null });
  });

  it("開始日・期日の両方をスライドすると作業期間（日数差）が保持される", () => {
    const offsetDays = computeInheritOffsetDays("2026-01-01", "2026-05-10");
    const result = computeInheritedTaskDates({ offsetDays, startDate: "2026-01-06", dueDate: "2026-01-10" });
    expect(result).toEqual({ start_date: "2026-05-15", due_date: "2026-05-19" });
    // 元の作業期間は 10-06=4日。新しい日付でも 19-15=4日で一致する
  });

  it("月をまたぐオフセットでも正しく計算できる", () => {
    expect(slideViaOffset("2026-01-28", "2026-06-25", "2026-02-03")).toBe("2026-07-01"); // 元PJ開始日の6日後（月またぎ）→新PJ開始日の6日後
  });
});
