import { describe, it, expect } from "vitest";
import { buildProjectRowMenuItems } from "../projectRowMenu";

describe("buildProjectRowMenuItems", () => {
  it("ゲストでもPJ編集は開放済み（canGuestEdit経由・非ゲストと同じ項目になる）", () => {
    const guestItems = buildProjectRowMenuItems({ project: { status: "active" }, canEdit: true, isGuest: true });
    expect(guestItems.map(i => i.id)).toEqual(["settings", "complete", "archive"]);
  });

  it("編集権限が無い場合：設定のみ", () => {
    const items = buildProjectRowMenuItems({ project: { status: "active" }, canEdit: false, isGuest: false });
    expect(items.map(i => i.id)).toEqual(["settings"]);
  });

  it("編集権限があり status=active：設定＋完了にする＋アーカイブ", () => {
    const items = buildProjectRowMenuItems({ project: { status: "active" }, canEdit: true, isGuest: false });
    expect(items.map(i => i.id)).toEqual(["settings", "complete", "archive"]);
  });

  it("編集権限があり status=completed：設定＋activeに戻す（complete/archiveは出さない）", () => {
    const items = buildProjectRowMenuItems({ project: { status: "completed" }, canEdit: true, isGuest: false });
    expect(items.map(i => i.id)).toEqual(["settings", "restore"]);
  });

  it("編集権限があり status=archived：設定＋activeに戻す", () => {
    const items = buildProjectRowMenuItems({ project: { status: "archived" }, canEdit: true, isGuest: false });
    expect(items.map(i => i.id)).toEqual(["settings", "restore"]);
  });
});
