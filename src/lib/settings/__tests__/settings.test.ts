import { describe, it, expect } from "vitest";
import { KEYS, LS_KEY } from "../../localData/localStore";
import type { Member } from "../../localData/types";
import { DISPLAY_SETTING_KEYS, selectDisplayKeysToRemove, resetDisplaySettings } from "../displaySettingsReset";
import { buildProfileUpdate } from "../profileUpdate";
import { adminsOfGroup, buildSettingsSections, canAccessAdminSection } from "../settingsSections";

// 初期化で絶対に消してはいけないキー（認証・データ・承認の記憶・どの画面にいるか）
const PROTECTED_KEYS = [
  "sb-abcdefgh-auth-token",
  "sb-abcdefgh-auth-token-code-verifier",
  KEYS.THEME,
  KEYS.LANG,
  KEYS.CURRENT_USER,
  KEYS.WIZARD_COMPLETED,
  KEYS.VIEW_MODE,
  KEYS.APP_MODE,
  KEYS.OKR_MODE_INTRO_APPROVED,
  KEYS.PENDING_PROJECT_INVITE,
  KEYS.ERROR_HISTORY,
  KEYS.SCHEMA_VERSION,
  KEYS.LOADING_TIPS_CACHE,
  KEYS.GUEST_AI_USAGE_TODAY,
  LS_KEY.consultationHistory("m1"),
  LS_KEY.deadlineNotified("m1"),
  LS_KEY.chunkDownloadApproved("AdminView"),
  LS_KEY.sidebarCurrentGroup("m1"),
  LS_KEY.krWhySummary("kr1"),
  LS_KEY.quarterPlan("kr1", "2026Q4"),
  "tour_completed_v1",
  "cal_note_text",
  "structure_org_v2",
];

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(k: string) { return this.map.get(k) ?? null; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  removeItem(k: string) { this.map.delete(k); }
  setItem(k: string, v: string) { this.map.set(k, v); }
}

describe("表示の設定の初期化（ホワイトリスト）", () => {
  it("認証トークン（sb-*）を対象に含まない", () => {
    expect(DISPLAY_SETTING_KEYS.some(k => k.startsWith("sb-"))).toBe(false);
  });

  it("保護すべきキーをひとつも対象に含まない", () => {
    for (const k of PROTECTED_KEYS) expect(DISPLAY_SETTING_KEYS).not.toContain(k);
    expect(selectDisplayKeysToRemove(PROTECTED_KEYS)).toEqual([]);
  });

  it("表示の設定（サイドバー・一覧・ガント・カレンダー・パネル幅）は対象に含む", () => {
    for (const k of [KEYS.SIDEBAR_WIDTH, KEYS.SIDEBAR_COLLAPSED, KEYS.LIST_VIEW_SETTINGS, KEYS.GANTT_ZOOM,
      KEYS.CAL_VIEW_MODE, KEYS.TASK_SIDE_PANEL_WIDTH, KEYS.ADMIN_FONT_SIZE]) {
      expect(DISPLAY_SETTING_KEYS).toContain(k);
    }
  });

  it("実際の Storage から対象だけを消し、それ以外は残す", () => {
    const s = new MemoryStorage();
    for (const k of PROTECTED_KEYS) s.setItem(k, "keep");
    s.setItem(KEYS.SIDEBAR_WIDTH, "300");
    s.setItem(KEYS.LIST_VIEW_SETTINGS, "{\"density\":\"detailed\"}");
    const removed = resetDisplaySettings(s);
    expect(removed.sort()).toEqual([KEYS.LIST_VIEW_SETTINGS, KEYS.SIDEBAR_WIDTH].sort());
    for (const k of PROTECTED_KEYS) expect(s.getItem(k)).toBe("keep");
    expect(s.getItem(KEYS.SIDEBAR_WIDTH)).toBeNull();
  });
});

function member(over: Partial<Member>): Member {
  return {
    id: "m1", display_name: "山本 勇気", short_name: "山本", initials: "山本", teams_account: "",
    email: "y@example.com", notify_pref: "browser", is_admin: false, is_super_admin: false,
    color_bg: "var(--avatar-1-bg)", color_text: "var(--avatar-1-text)", is_deleted: false,
    group_id: "grp-a", group_ids: ["grp-a"], updated_at: "2026-10-01T00:00:00Z", updated_by: "m1",
    ...over,
  };
}

describe("プロフィール保存で変わる列", () => {
  it("表示名・短縮名・色（＋表示名から決まる initials と updated_by）だけが変わる", () => {
    const self = member({});
    const next = buildProfileUpdate(self, {
      display_name: "  鈴木 花子 ", short_name: "花子",
      color: { bg: "var(--avatar-3-bg)", text: "var(--avatar-3-text)" },
    }, "m1x");
    const changed = (Object.keys(next) as (keyof Member)[]).filter(k => next[k] !== self[k]).sort();
    expect(changed).toEqual(["color_bg", "color_text", "display_name", "initials", "short_name", "updated_by"].sort());
    expect(next.display_name).toBe("鈴木 花子");
    expect(next.initials).toBe("鈴木");
  });

  it("権限・所属・メールは自分の行の値のまま送る", () => {
    const self = member({ is_admin: true, email: "a@example.com", group_ids: ["grp-a", "grp-b"] });
    const next = buildProfileUpdate(self, { display_name: "A", short_name: "", color: { bg: "x", text: "y" } }, "m1");
    expect(next.is_admin).toBe(true);
    expect(next.is_super_admin).toBe(false);
    expect(next.email).toBe("a@example.com");
    expect(next.group_id).toBe("grp-a");
    expect(next.group_ids).toEqual(["grp-a", "grp-b"]);
    expect(next.notify_pref).toBe("browser");
    expect(next.short_name).toBe("A");
  });

  it("全角スペース区切りの表示名でも短縮名・initials を正しく決める", () => {
    const next = buildProfileUpdate(member({}), { display_name: "田中　一郎", short_name: "", color: { bg: "x", text: "y" } }, "m1");
    expect(next.short_name).toBe("田中");
    expect(next.initials).toBe("田中");
  });
});

describe("設定ページの目次（管理の表示条件）", () => {
  const admin = member({ id: "a", is_admin: true });
  const plain = member({ id: "p" });
  const superAdmin = member({ id: "s", is_super_admin: true });

  it("一般メンバーには管理を出さない（部署に管理者がいるとき）", () => {
    expect(canAccessAdminSection(plain, [admin, plain])).toBe(false);
    expect(buildSettingsSections(false)).toEqual(["profile", "display", "notify", "help"]);
  });

  it("部署管理者・全社スーパー管理者には管理を出す", () => {
    expect(canAccessAdminSection(admin, [admin, plain])).toBe(true);
    expect(canAccessAdminSection(superAdmin, [admin, plain, superAdmin])).toBe(true);
    expect(buildSettingsSections(true)).toEqual(["profile", "display", "notify", "help", "admin"]);
  });

  it("管理者が1人もいない（ブートストラップ）なら全員に管理を出す。削除済みの管理者は数えない", () => {
    expect(canAccessAdminSection(plain, [plain])).toBe(true);
    expect(canAccessAdminSection(plain, [plain, member({ id: "d", is_admin: true, is_deleted: true })])).toBe(true);
  });

  it("自部署の管理者一覧は group_ids（無ければ group_id）で判定する", () => {
    const other = member({ id: "o", is_admin: true, group_id: "grp-b", group_ids: ["grp-b"] });
    const legacy = member({ id: "l", is_admin: true, group_id: "grp-a", group_ids: null });
    expect(adminsOfGroup([admin, plain, other, legacy], "grp-a").map(m => m.id)).toEqual(["a", "l"]);
    expect(adminsOfGroup([admin], null)).toEqual([]);
  });
});
