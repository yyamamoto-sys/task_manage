import { describe, it, expect } from "vitest";
import type { Project } from "../../localData/types";
import { buildProjectTargetOptions, projectTargetLabel, ALL_PJ_VALUE, MULTI_PJ_VALUE } from "../projectTargetOptions";

const pj = (id: string, status: Project["status"], name = id): Project =>
  ({ id, name, status, color_tag: "#123456", is_deleted: false } as Project);

describe("対象PJプルダウンの選択肢", () => {
  it("先頭は「すべてのPJ」。アーカイブ済みは出さず、完了PJは「（完了）」付きで出す", () => {
    const opts = buildProjectTargetOptions([pj("a", "active", "進行中"), pj("c", "completed", "終わった"), pj("x", "archived")]);
    expect(opts.map(o => [o.value, o.label])).toEqual([
      [ALL_PJ_VALUE, "すべてのPJ"],
      ["a", "進行中"],
      ["c", "終わった（完了）"],
    ]);
    expect(opts[1].color).toBe("#123456");
  });
  it("PJ名は省略しない（10字を超える名前もそのまま）", () => {
    expect(projectTargetLabel({ name: "とても長いプロジェクト名の例ですよ", status: "active" })).toBe("とても長いプロジェクト名の例ですよ");
  });
  it("KRで複数PJに絞り込み中の表示専用の選択肢は2件以上のときだけ出る", () => {
    expect(buildProjectTargetOptions([pj("a", "active")], { multiCount: 1 }).some(o => o.value === MULTI_PJ_VALUE)).toBe(false);
    expect(buildProjectTargetOptions([pj("a", "active")], { multiCount: 3 }).find(o => o.value === MULTI_PJ_VALUE)?.label).toContain("3PJ");
  });
});
