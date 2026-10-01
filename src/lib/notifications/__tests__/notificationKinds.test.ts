// src/lib/notifications/__tests__/notificationKinds.test.ts
//
// 通知の種類のレジストリ（v3.129）。既定値・見せる相手・判定（全体スイッチ×種類×旧列）・保存する差分・
// 未読バッジの表記、そしてマイグレの SQL に直書きした既定値・種類の一覧がレジストリと食い違っていないこと。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ADMIN_IN_APP_KINDS, ALL_IN_APP_KINDS, DEFAULT_KIND_PREFS, NOTIFICATION_KINDS, NOTIFICATION_KIND_ICON,
  audienceOfInAppKind, buildKindChannelPatch, findKind, formatBadgeCount, isKindEnabled, kindChannelChecked,
  kindChannelSetting, kindsVisibleTo, sanitizeKindChannels, type KindPrefsLike,
} from "../notificationKinds";
import { DEFAULT_NOTIFICATION_PREFS, prefsFromRow } from "../../reminder/notificationPrefs";
import { layoutJa } from "../../../i18n/layout.ja";

const ROOT = join(__dirname, "..", "..", "..", "..");
const MIGRATION = readFileSync(join(ROOT, "supabase/migrations/20261001c_notify_v2_client_errors.sql"), "utf8");

const prefs = (p: Partial<KindPrefsLike> = {}): KindPrefsLike => ({
  inapp_enabled: true, push_enabled: true, notify_overdue: true, notify_due_today: true, kind_channels: {}, ...p,
});

describe("レジストリの定義", () => {
  it("今回の4種類：全員向け3つ＋super_admin 向け1つ", () => {
    expect(NOTIFICATION_KINDS.map(k => [k.id, k.audience])).toEqual([
      ["deadline_overdue", "all"], ["deadline_due_today", "all"], ["mention", "all"], ["client_error", "super_admin"],
    ]);
  });

  it("id は重複せず、全種類にアイコンと表示名・説明（日本語）がある", () => {
    const ids = NOTIFICATION_KINDS.map(k => k.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(NOTIFICATION_KIND_ICON[id as keyof typeof NOTIFICATION_KIND_ICON], id).toBeTruthy();
      expect(layoutJa[`layout.notifyKind.${id}.label` as keyof typeof layoutJa], id).toBeTruthy();
      expect(layoutJa[`layout.notifyKind.${id}.desc` as keyof typeof layoutJa], id).toBeTruthy();
    }
  });

  it("対応していないチャネルは既定でもオフ（メンションはアプリ内に行を作らない）", () => {
    for (const k of NOTIFICATION_KINDS) {
      for (const ch of ["inapp", "push"] as const) if (!k.supported[ch]) expect(k.defaults[ch], `${k.id}.${ch}`).toBe(false);
    }
    expect(findKind("mention")?.supported.inapp).toBe(false);
  });

  it("行が無い人の既定値は v3.128 と同じ（アプリ内オン・Windowsオフ）", () => {
    expect(DEFAULT_KIND_PREFS).toMatchObject({ inapp_enabled: true, push_enabled: false, notify_overdue: true, notify_due_today: true });
    expect(DEFAULT_NOTIFICATION_PREFS.kind_channels).toEqual({});
    expect(isKindEnabled(undefined, "deadline_overdue", "inapp")).toBe(true);
    expect(isKindEnabled(undefined, "deadline_overdue", "push")).toBe(false);
    expect(isKindEnabled(undefined, "client_error", "inapp")).toBe(true);
  });
});

describe("見せる相手", () => {
  it("super_admin 以外には管理者向けの種類を出さない", () => {
    expect(kindsVisibleTo(false).map(k => k.id)).not.toContain("client_error");
    expect(kindsVisibleTo(false).every(k => k.audience === "all")).toBe(true);
    expect(kindsVisibleTo(true).map(k => k.id)).toContain("client_error");
  });

  it("ベルの見分け：client_error とバックアップ通知は管理者向け、期限は全員向け、未知は全員向け", () => {
    expect(audienceOfInAppKind("client_error")).toBe("super_admin");
    expect(audienceOfInAppKind("backup_failure")).toBe("super_admin");
    expect(audienceOfInAppKind("deadline_digest")).toBe("all");
    expect(audienceOfInAppKind("something_new")).toBe("all");
    expect(ADMIN_IN_APP_KINDS).toEqual(["backup_failure", "backup_weekly_summary", "client_error"]);
  });
});

describe("判定（全体スイッチ AND 種類×チャネル AND 旧列）", () => {
  it("全体スイッチがオフのチャネルは、種類がオンでも届かない", () => {
    expect(isKindEnabled(prefs({ push_enabled: false }), "client_error", "push")).toBe(false);
    expect(isKindEnabled(prefs({ inapp_enabled: false }), "deadline_overdue", "inapp")).toBe(false);
  });

  it("種類×チャネルを個別に外せる（片方のチャネルだけ）", () => {
    const p = prefs({ kind_channels: { deadline_overdue: { push: false } } });
    expect(isKindEnabled(p, "deadline_overdue", "push")).toBe(false);
    expect(isKindEnabled(p, "deadline_overdue", "inapp")).toBe(true);
  });

  it("旧列（v3.128 の notify_overdue）がオフなら、旧画面から外した場合も効く", () => {
    expect(isKindEnabled(prefs({ notify_overdue: false }), "deadline_overdue", "inapp")).toBe(false);
    expect(isKindEnabled(prefs({ notify_overdue: false }), "deadline_due_today", "inapp")).toBe(true);
  });

  it("対応していないチャネル・未知の種類は常にオフ", () => {
    expect(isKindEnabled(prefs(), "mention", "inapp")).toBe(false);
    expect(isKindEnabled(prefs(), "unknown", "push")).toBe(false);
  });

  it("🔴 設定画面のチェックボックスの見た目（kindChannelChecked）は旧列も反映し、isKindEnabled（全体スイッチ以外）と一致する（独立レビュー指摘・軽）", () => {
    // 旧列（notify_overdue）がオフ・kind_channels に個別設定が無い：isKindEnabled は false。
    // 修正前の表示（kindChannelSetting 単体）はここで true のままズレていた
    const p = prefs({ notify_overdue: false });
    expect(kindChannelChecked(p, "deadline_overdue", "inapp")).toBe(false);
    expect(isKindEnabled(p, "deadline_overdue", "inapp")).toBe(false);

    // 旧列はオンのまま・種類×チャネルだけ個別に外した場合は従来どおり反映する
    const p2 = prefs({ kind_channels: { deadline_overdue: { inapp: false } } });
    expect(kindChannelChecked(p2, "deadline_overdue", "inapp")).toBe(false);
    expect(kindChannelChecked(p2, "deadline_overdue", "push")).toBe(true);

    // 旧列を持たない種類（client_error）は旧列の影響を受けない
    expect(kindChannelChecked(prefs(), "client_error", "inapp")).toBe(true);
  });
});

describe("保存する差分（buildKindChannelPatch）", () => {
  it("期限の種類は、どちらかのチャネルがオンかで旧列も揃える", () => {
    const off = buildKindChannelPatch(prefs({ kind_channels: { deadline_overdue: { push: false } } }), "deadline_overdue", "inapp", false);
    expect(off).toEqual({ kind_channels: { deadline_overdue: { push: false, inapp: false } }, notify_overdue: false });
    const on = buildKindChannelPatch(prefs({ notify_overdue: false, kind_channels: { deadline_overdue: { inapp: false, push: false } } }), "deadline_overdue", "push", true);
    expect(on.notify_overdue).toBe(true);
  });

  it("期限以外の種類は旧列に触らない・他の種類の設定を壊さない", () => {
    const p = buildKindChannelPatch(prefs({ kind_channels: { deadline_overdue: { push: false } } }), "client_error", "push", false);
    expect(p).toEqual({ kind_channels: { deadline_overdue: { push: false }, client_error: { push: false } } });
  });

  it("jsonb の壊れた値・余計なキーは捨てて読む", () => {
    expect(sanitizeKindChannels(null)).toEqual({});
    expect(sanitizeKindChannels([1])).toEqual({});
    expect(sanitizeKindChannels({ client_error: { push: "yes", inapp: false }, evil: { push: true } })).toEqual({ client_error: { inapp: false } });
    expect(prefsFromRow({ kind_channels: { mention: { push: false } } } as never).kind_channels).toEqual({ mention: { push: false } });
    expect(kindChannelSetting(prefs({ kind_channels: { client_error: { push: false } } }), "client_error", "push")).toBe(false);
  });

  it("🔴 kind_channels に不正な値（文字列・数値）が入っていても例外にならず既定値にフォールバックする（独立レビュー指摘・中）", () => {
    const broken = prefs({ kind_channels: { client_error: { inapp: "yes" as unknown as boolean } } });
    expect(() => kindChannelSetting(broken, "client_error", "inapp")).not.toThrow();
    expect(kindChannelSetting(broken, "client_error", "inapp")).toBe(true); // 既定値（client_error.inapp=true）
    expect(() => isKindEnabled(broken, "client_error", "inapp")).not.toThrow();
  });
});

describe("未読バッジ（formatBadgeCount）", () => {
  it("0 は出さず、1〜99 はそのまま、100 以上は 99+", () => {
    expect(formatBadgeCount(0)).toBe("");
    expect(formatBadgeCount(-3)).toBe("");
    expect(formatBadgeCount(1)).toBe("1");
    expect(formatBadgeCount(99)).toBe("99");
    expect(formatBadgeCount(100)).toBe("99+");
    expect(formatBadgeCount(12345)).toBe("99+");
    expect(formatBadgeCount(Number.NaN)).toBe("");
  });
});

describe("マイグレの SQL とレジストリの一致", () => {
  it("in_app_notifications の CHECK 制約の種類が ALL_IN_APP_KINDS と同じ", () => {
    const m = /in_app_notifications_kind_check\s+CHECK \(kind IN \(([^)]*)\)\)/.exec(MIGRATION);
    expect(m).not.toBeNull();
    const kinds = (m as RegExpExecArray)[1].split(",").map(s => s.trim().replace(/'/g, ""));
    expect(kinds).toEqual([...ALL_IN_APP_KINDS]);
  });

  it("log_client_error のアプリ内通知の既定値（行・キーが無い人はオン）がレジストリと同じ", () => {
    expect(findKind("client_error")?.defaults.inapp).toBe(true);
    expect(DEFAULT_KIND_PREFS.inapp_enabled).toBe(true);
    expect(MIGRATION).toContain("COALESCE(np.inapp_enabled, true)");
    // 🔴 ::boolean キャストは壊れた値で例外になりうるため使わない（独立レビュー指摘・中）。
    // jsonb のまま 'false'::jsonb と比較し、それ以外（キー無し・不正値）はオンとして扱う
    expect(MIGRATION).not.toContain("->> 'inapp')::boolean");
    expect(MIGRATION).toContain("COALESCE(np.kind_channels #> '{client_error,inapp}', 'true'::jsonb) <> 'false'::jsonb");
  });

  it("旧列からの移行は、外していた種類だけを両チャネルともオフで移す（既にある値は触らない）", () => {
    expect(MIGRATION).toMatch(/'deadline_overdue', jsonb_build_object\('inapp', false, 'push', false\)\)\s+WHERE notify_overdue = false AND NOT \(kind_channels \? 'deadline_overdue'\)/);
    expect(MIGRATION).toMatch(/'deadline_due_today', jsonb_build_object\('inapp', false, 'push', false\)\)\s+WHERE notify_due_today = false AND NOT \(kind_channels \? 'deadline_due_today'\)/);
  });
});
