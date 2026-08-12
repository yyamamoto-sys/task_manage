import { describe, it, expect } from "vitest";
import type { Member } from "../../localData/types";
import { canEditProjectBasicInfo } from "../projectEditPermission";

function mk(id: string, opts: Partial<Member> = {}): Member {
  return {
    id, display_name: id, short_name: id, initials: id.slice(0, 2),
    teams_account: "", color_bg: "#fff", color_text: "#000", is_deleted: false,
    ...opts,
  };
}

describe("canEditProjectBasicInfo", () => {
  it("部署管理者(is_admin)は編集可", () => {
    const admin = mk("m-admin", { is_admin: true });
    const other = mk("m-other");
    expect(canEditProjectBasicInfo([admin, other], other)).toBe(false);
    expect(canEditProjectBasicInfo([admin, other], admin)).toBe(true);
  });

  it("全社スーパー管理者(is_super_admin)は部署のadmin状態に関わらず編集可", () => {
    const admin = mk("m-admin", { is_admin: true });
    const superAdmin = mk("m-super", { is_super_admin: true });
    expect(canEditProjectBasicInfo([admin, superAdmin], superAdmin)).toBe(true);
  });

  it("ブートストラップ：部署内にis_admin=trueのアクティブメンバーが1人もいなければ全員可", () => {
    const memberA = mk("m-a");
    const memberB = mk("m-b");
    expect(canEditProjectBasicInfo([memberA, memberB], memberA)).toBe(true);
  });

  it("is_admin=trueだが論理削除済みのメンバーはブートストラップ判定に含めない（＝いない扱い）", () => {
    const deletedAdmin = mk("m-deleted-admin", { is_admin: true, is_deleted: true });
    const other = mk("m-other");
    expect(canEditProjectBasicInfo([deletedAdmin, other], other)).toBe(true);
  });

  it("admin/super_adminどちらでもない一般メンバーは、部署内に有効なadminがいれば編集不可", () => {
    const admin = mk("m-admin", { is_admin: true });
    const general = mk("m-general");
    expect(canEditProjectBasicInfo([admin, general], general)).toBe(false);
  });
});
