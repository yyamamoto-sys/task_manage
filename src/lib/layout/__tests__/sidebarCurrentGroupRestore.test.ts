// src/lib/layout/__tests__/sidebarCurrentGroupRestore.test.ts
import { describe, it, expect } from "vitest";
import { resolveRestoredCurrentGroupId } from "../sidebarCurrentGroupRestore";

// loadStoredSidebarGroupId/saveSidebarGroupId は localStorage 依存
// （vitest.config.ts が environment: "node" のため未検証。
// src/lib/chunkSizeGate.ts と同じ方針）。ここでは判定の純粋関数のみ検証する。

describe("resolveRestoredCurrentGroupId", () => {
  it("保存値なし → ホーム部署", () => {
    expect(resolveRestoredCurrentGroupId(null, "grp-egg", ["grp-egg", "grp-aid"])).toBe("grp-egg");
  });

  it("保存値が今もアクセス可 → 保存値をそのまま復元する", () => {
    expect(resolveRestoredCurrentGroupId("grp-aid", "grp-egg", ["grp-egg", "grp-aid"])).toBe("grp-aid");
  });

  it("保存値にアクセスできなくなっている（兼務が外れた等） → ホーム部署にフォールバック", () => {
    expect(resolveRestoredCurrentGroupId("grp-aid", "grp-egg", ["grp-egg"])).toBe("grp-egg");
  });

  it("保存値の部署自体が存在しない（削除済み・アクセス可能一覧から消えている） → ホーム部署", () => {
    expect(resolveRestoredCurrentGroupId("grp-deleted", "grp-egg", ["grp-egg"])).toBe("grp-egg");
  });

  it("別メンバーIDの保存値しかない場合（呼び出し側でstoredGroupIdがnullになる）→ ホーム部署", () => {
    // メンバーIDごとのキー分離はloadStoredSidebarGroupId側の責務。この関数はstoredGroupIdが
    // nullで渡ってきた前提でホーム部署へ落ちることだけを保証する。
    expect(resolveRestoredCurrentGroupId(null, "grp-egg", ["grp-egg", "grp-aid"])).toBe("grp-egg");
  });

  it("ホーム部署がnullの場合、保存値が無効ならnullを返す（既存のsetCurrentGroupId(null)呼び出しと同じ挙動）", () => {
    expect(resolveRestoredCurrentGroupId("grp-aid", null, ["grp-egg"])).toBeNull();
  });

  it("ホーム部署がnullでも保存値が有効ならそちらを復元する", () => {
    expect(resolveRestoredCurrentGroupId("grp-aid", null, ["grp-aid"])).toBe("grp-aid");
  });

  it("招待受諾者（招待用部署のみがアクセス可能一覧）でも保存値が一致すれば復元する", () => {
    expect(resolveRestoredCurrentGroupId("grp-invite-proj1", "grp-invite-proj1", ["grp-invite-proj1"])).toBe("grp-invite-proj1");
  });
});
