// src/lib/admin/__tests__/resolveAdminGroupId.test.ts
import { describe, expect, it } from "vitest";
import { resolveAdminGroupId } from "../resolveAdminGroupId";

describe("resolveAdminGroupId", () => {
  it("currentGroupIdがアクセス可能な部署に含まれる場合はそのまま採用する", () => {
    expect(resolveAdminGroupId("grp-egg", ["grp-egg", "grp-aid"])).toBe("grp-egg");
  });

  it("currentGroupIdがnullでもアクセス可能な部署が1件だけなら一意に決まるので採用する", () => {
    expect(resolveAdminGroupId(null, ["grp-egg"])).toBe("grp-egg");
  });

  it("currentGroupIdがアクセス可能な部署の外を指していても、1件しか選べないなら救う", () => {
    // 例：ホーム部署変更直後などcurrentGroupIdが古い値を指している一瞬でも、
    // アクセス可能な部署が1つに絞れているなら安全に補正できる。
    expect(resolveAdminGroupId("grp-stale", ["grp-egg"])).toBe("grp-egg");
  });

  it("currentGroupIdがnullでアクセス可能な部署が2件以上ある場合はnullを返す（全部見せない）", () => {
    expect(resolveAdminGroupId(null, ["grp-egg", "grp-aid"])).toBeNull();
  });

  it("currentGroupIdがアクセス可能な部署の外を指し、他に2件以上ある場合もnullを返す", () => {
    expect(resolveAdminGroupId("grp-other", ["grp-egg", "grp-aid"])).toBeNull();
  });

  it("アクセス可能な部署が1件も無い場合はnullを返す", () => {
    expect(resolveAdminGroupId("grp-egg", [])).toBeNull();
    expect(resolveAdminGroupId(null, [])).toBeNull();
  });

  it("空文字は「未確定」と同義に扱う（誤って全件表示のトリガーにしない）", () => {
    expect(resolveAdminGroupId("", ["grp-egg", "grp-aid"])).toBeNull();
    expect(resolveAdminGroupId("", ["grp-egg"])).toBe("grp-egg");
  });
});
