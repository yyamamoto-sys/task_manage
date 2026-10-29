import { describe, it, expect } from "vitest";
import { buildProjectRowMenuItems } from "../projectRowMenu";

describe("buildProjectRowMenuItems", () => {
  it("ゲストでもPJ編集は開放済み（canGuestEdit経由・非ゲストと同じ項目になる）", () => {
    const guestItems = buildProjectRowMenuItems({ project: { status: "active" }, canEdit: true, isGuest: true });
    // WBSの取込はゲストには出さない（v3.189）
    expect(guestItems.map(i => i.id)).toEqual(["settings", "copyLink", "complete", "archive"]);
  });

  it("編集権限が無い場合：設定のみ", () => {
    const items = buildProjectRowMenuItems({ project: { status: "active" }, canEdit: false, isGuest: false });
    expect(items.map(i => i.id)).toEqual(["settings", "copyLink"]);
  });

  it("編集権限があり status=active：設定＋WBSを取り込む＋完了にする＋アーカイブ", () => {
    const items = buildProjectRowMenuItems({ project: { status: "active" }, canEdit: true, isGuest: false });
    expect(items.map(i => i.id)).toEqual(["settings", "copyLink", "importWbs", "complete", "archive"]);
  });

  it("編集権限があり status=completed：設定＋activeに戻す（complete/archiveは出さない）", () => {
    const items = buildProjectRowMenuItems({ project: { status: "completed" }, canEdit: true, isGuest: false });
    expect(items.map(i => i.id)).toEqual(["settings", "copyLink", "restore"]);
  });

  it("編集権限があり status=archived：設定＋activeに戻す", () => {
    const items = buildProjectRowMenuItems({ project: { status: "archived" }, canEdit: true, isGuest: false });
    expect(items.map(i => i.id)).toEqual(["settings", "copyLink", "restore"]);
  });
});
