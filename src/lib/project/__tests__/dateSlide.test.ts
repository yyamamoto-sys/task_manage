import { describe, it, expect } from "vitest";
import { computeSlidedDate } from "../dateSlide";

describe("computeSlidedDate", () => {
  it("元PJ開始日からの相対日数を保ったまま新PJ開始日にスライドする（正のオフセット）", () => {
    const result = computeSlidedDate({
      originStartDate: "2026-01-01",
      newStartDate: "2026-03-01",
      originalDate: "2026-01-04", // 元PJ開始日の3日後
    });
    expect(result).toBe("2026-03-04"); // 新PJ開始日の3日後
  });

  it("タスクの日付がPJ開始日より前でも同じオフセットで平行移動する（負のオフセット）", () => {
    const result = computeSlidedDate({
      originStartDate: "2026-01-10",
      newStartDate: "2026-03-01",
      originalDate: "2026-01-05", // 元PJ開始日の5日前
    });
    expect(result).toBe("2026-02-24"); // 新PJ開始日の5日前
  });

  it("同日（オフセット0）はそのまま新PJ開始日になる", () => {
    const result = computeSlidedDate({
      originStartDate: "2026-01-01",
      newStartDate: "2026-03-01",
      originalDate: "2026-01-01",
    });
    expect(result).toBe("2026-03-01");
  });

  it("元タスクに日付が無ければ null のまま", () => {
    const result = computeSlidedDate({
      originStartDate: "2026-01-01",
      newStartDate: "2026-03-01",
      originalDate: null,
    });
    expect(result).toBeNull();
  });

  it("元PJに開始日が無ければスライドせず元の日付をそのまま返す", () => {
    const result = computeSlidedDate({
      originStartDate: null,
      newStartDate: "2026-03-01",
      originalDate: "2026-01-04",
    });
    expect(result).toBe("2026-01-04");
  });

  it("開始日・期日の両方をスライドすると作業期間（日数差）が保持される", () => {
    const newStart = computeSlidedDate({
      originStartDate: "2026-01-01",
      newStartDate: "2026-05-10",
      originalDate: "2026-01-06",
    });
    const newDue = computeSlidedDate({
      originStartDate: "2026-01-01",
      newStartDate: "2026-05-10",
      originalDate: "2026-01-10",
    });
    expect(newStart).toBe("2026-05-15");
    expect(newDue).toBe("2026-05-19");
    // 元の作業期間は 10-06=4日。新しい日付でも 19-15=4日で一致する
  });

  it("月をまたぐオフセットでも正しく計算できる", () => {
    const result = computeSlidedDate({
      originStartDate: "2026-01-28",
      newStartDate: "2026-06-25",
      originalDate: "2026-02-03", // 元PJ開始日の6日後
    });
    expect(result).toBe("2026-07-01"); // 新PJ開始日の6日後（月またぎ）
  });
});
