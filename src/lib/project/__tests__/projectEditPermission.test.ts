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

// 🔴 v3.109（2026-09-17）で「管理者限定」から「同じ部署なら誰でも可」に変更した。
// 変更の理由・DB側のRLSとの関係は projectEditPermission.ts 冒頭のコメントを参照。
// このテストは「一般メンバーが編集できること」を固定する（以前は逆を固定していた）。
describe("canEditProjectBasicInfo", () => {
  it("一般メンバーも編集できる（v3.109で開放）", () => {
    const admin = mk("m-admin", { is_admin: true });
    const general = mk("m-general");
    expect(canEditProjectBasicInfo([admin, general], general)).toBe(true);
  });

  it("部署管理者は編集できる", () => {
    const admin = mk("m-admin", { is_admin: true });
    const other = mk("m-other");
    expect(canEditProjectBasicInfo([admin, other], admin)).toBe(true);
  });

  it("全社スーパー管理者は編集できる", () => {
    const admin = mk("m-admin", { is_admin: true });
    const superAdmin = mk("m-super", { is_super_admin: true });
    expect(canEditProjectBasicInfo([admin, superAdmin], superAdmin)).toBe(true);
  });

  it("部署にadminが1人もいなくても編集できる（旧ブートストラップ条件の後継）", () => {
    const memberA = mk("m-a");
    const memberB = mk("m-b");
    expect(canEditProjectBasicInfo([memberA, memberB], memberA)).toBe(true);
  });

  it("メンバー一覧が空でも編集できる（引数に依存しない）", () => {
    const solo = mk("m-solo");
    expect(canEditProjectBasicInfo([], solo)).toBe(true);
  });
});
