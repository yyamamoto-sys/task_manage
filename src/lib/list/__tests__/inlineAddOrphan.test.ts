import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reassignOrphanDrafts, type InlineDraft } from "../inlineAdd";
import { UNSECTIONED_KEY } from "../../section/sections";
import type { ProjectSection } from "../../localData/types";

const sec = (id: string, projectId: string, isDeleted = false) => ({ id, project_id: projectId, is_deleted: isDeleted }) as unknown as ProjectSection;
const draft = (name: string): InlineDraft => ({ name, assigneeIds: ["u"], startDate: "", dueDate: "" });

describe("reassignOrphanDrafts（M75）", () => {
  it("削除されたグループ宛ての名前入り下書きは同じPJの未分類へ付け替える", () => {
    const sections = [sec("s1", "p", true), sec("s2", "p")];
    const r = reassignOrphanDrafts({ "project:P§s1": draft("資料作成") }, sections);
    expect(r.changed).toBe(true);
    expect(r.drafts["project:P§s1"]).toBeUndefined();
    expect(r.drafts[`project:P§${UNSECTIONED_KEY}`]?.name).toBe("資料作成");
  });
  it("PJに生きたグループが残らないなら、グループ無しの行（接頭辞のみ）へ付け替える", () => {
    const r = reassignOrphanDrafts({ "project:P§s1": draft("x") }, [sec("s1", "p", true)]);
    expect(r.drafts["project:P"]?.name).toBe("x");
  });
  it("生きているグループ・未分類・グループ無しの下書きは触らない（参照も同じ）", () => {
    const drafts = { "project:P§s2": draft("a"), [`project:P§${UNSECTIONED_KEY}`]: draft("b"), "assignee:A": draft("c") };
    const r = reassignOrphanDrafts(drafts, [sec("s2", "p")]);
    expect(r.changed).toBe(false);
    expect(r.drafts).toBe(drafts);
  });
  it("空の下書きは付け替えず捨てる", () => {
    const r = reassignOrphanDrafts({ "project:P§s1": draft("  ") }, [sec("s1", "p", true), sec("s2", "p")]);
    expect(r.changed).toBe(true);
    expect(Object.keys(r.drafts)).toHaveLength(0);
  });
  it("付け替え先に名前入りの下書きが既にあれば、そちらを残し捨てた名前を返す", () => {
    const k = `project:P§${UNSECTIONED_KEY}`;
    const r = reassignOrphanDrafts({ "project:P§s1": draft("消える"), [k]: draft("残る") }, [sec("s1", "p", true), sec("s2", "p")]);
    expect(r.drafts[k]?.name).toBe("残る");
    expect(r.droppedNames).toEqual(["消える"]);
  });
  it("一覧から消えたグループ（記録なし）でも未分類へ付け替える", () => {
    const r = reassignOrphanDrafts({ "project:P§gone": draft("x") }, [sec("s2", "p")]);
    expect(r.drafts[`project:P§${UNSECTIONED_KEY}`]?.name).toBe("x");
  });
});

describe("useListInlineAdd の配線", () => {
  it("projectSections を受け取り reassignOrphanDrafts を呼ぶ", () => {
    const src = readFileSync(resolve(__dirname, "../../../components/list/useListInlineAdd.ts"), "utf-8");
    expect(src).toContain("reassignOrphanDrafts(");
    const lv = readFileSync(resolve(__dirname, "../../../components/list/ListView.tsx"), "utf-8");
    expect(lv).toMatch(/saveTask, projectSections,/);
  });
});
