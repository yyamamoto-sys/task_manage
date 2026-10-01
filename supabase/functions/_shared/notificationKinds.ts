// supabase/functions/_shared/notificationKinds.ts
//
// 通知の種類のレジストリ（v3.129・唯一の定義）。Edge Function（push-reminders）とフロント
// （src/lib/notifications/notificationKinds.ts が相対 import して表示名・アイコンを足す）の両方が
// このファイルを読む。Deno・npm・DOM に依存しない純粋な定義と関数だけを置く。
//
// 種類を足す手順は CLAUDE.md Section 67。SQL（log_client_error 等）にも既定値を直書きしている箇所が
// あり、src/lib/notifications/__tests__/notificationKinds.test.ts がマイグレの文面と照合する。

export type NotificationChannel = "inapp" | "push";
export type NotificationAudience = "all" | "super_admin";

export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ["inapp", "push"];

export interface NotificationKindDef {
  id: string;
  audience: NotificationAudience;
  /** そのチャネルで届ける仕組みがあるか（false のチャネルは設定画面に出さず、常にオフ扱い） */
  supported: Record<NotificationChannel, boolean>;
  /** 本人が未設定のときの値 */
  defaults: Record<NotificationChannel, boolean>;
  /** in_app_notifications.kind のどの値がこの種類か（ベルの見分けに使う） */
  inAppKind?: string;
  /** v3.128 の列（種類ごとの全体スイッチ）。旧画面が書き換えても効くよう、オンの条件に含める */
  legacyColumn?: "notify_overdue" | "notify_due_today";
}

export const NOTIFICATION_KINDS: readonly NotificationKindDef[] = [
  {
    id: "deadline_overdue",
    audience: "all",
    supported: { inapp: true, push: true },
    defaults: { inapp: true, push: true },
    inAppKind: "deadline_digest",
    legacyColumn: "notify_overdue",
  },
  {
    id: "deadline_due_today",
    audience: "all",
    supported: { inapp: true, push: true },
    defaults: { inapp: true, push: true },
    inAppKind: "deadline_digest",
    legacyColumn: "notify_due_today",
  },
  {
    // メンションはタブを開いている間にブラウザが出す通知のみ（アプリ内通知の行は作らない）
    id: "mention",
    audience: "all",
    supported: { inapp: false, push: true },
    defaults: { inapp: false, push: true },
  },
  {
    id: "client_error",
    audience: "super_admin",
    supported: { inapp: true, push: true },
    defaults: { inapp: true, push: true },
    inAppKind: "client_error",
  },
];

export type NotificationKindId = "deadline_overdue" | "deadline_due_today" | "mention" | "client_error";

/** レジストリに無い in_app_notifications.kind のうち、管理者向けのもの（v3.128 で列だけ用意したバックアップ通知） */
const ADMIN_ONLY_UNREGISTERED_IN_APP_KINDS = new Set(["backup_failure", "backup_weekly_summary"]);

export type KindChannels = Record<string, Partial<Record<NotificationChannel, boolean>>>;

export interface KindPrefsLike {
  inapp_enabled: boolean;
  push_enabled: boolean;
  notify_overdue?: boolean | null;
  notify_due_today?: boolean | null;
  kind_channels?: KindChannels | null;
}

/** notification_prefs の行が無い人の値（v3.128 の既定値と同じ） */
export const DEFAULT_KIND_PREFS: KindPrefsLike = {
  inapp_enabled: true,
  push_enabled: false,
  notify_overdue: true,
  notify_due_today: true,
  kind_channels: {},
};

export function findKind(id: string): NotificationKindDef | undefined {
  return NOTIFICATION_KINDS.find((k) => k.id === id);
}

/** その人の設定画面に出す種類（管理者向けは super_admin にだけ） */
export function kindsVisibleTo(isSuperAdmin: boolean): NotificationKindDef[] {
  return NOTIFICATION_KINDS.filter((k) => k.audience === "all" || isSuperAdmin);
}

/** in_app_notifications.kind → 対象。未知の値は全員向けとして扱う */
export function audienceOfInAppKind(kind: string): NotificationAudience {
  const def = NOTIFICATION_KINDS.find((k) => k.inAppKind === kind);
  if (def) return def.audience;
  return ADMIN_ONLY_UNREGISTERED_IN_APP_KINDS.has(kind) ? "super_admin" : "all";
}

/** jsonb の値を検証して取り込む（壊れた値・余計なキーは捨てる） */
export function sanitizeKindChannels(raw: unknown): KindChannels {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: KindChannels = {};
  for (const def of NOTIFICATION_KINDS) {
    const v = (raw as Record<string, unknown>)[def.id];
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const entry: Partial<Record<NotificationChannel, boolean>> = {};
    for (const ch of NOTIFICATION_CHANNELS) {
      const b = (v as Record<string, unknown>)[ch];
      if (typeof b === "boolean") entry[ch] = b;
    }
    if (Object.keys(entry).length > 0) out[def.id] = entry;
  }
  return out;
}

/** 種類×チャネルの個別設定（全体スイッチ・旧列を含まない）。未設定なら既定値 */
export function kindChannelSetting(prefs: KindPrefsLike | undefined, kindId: string, channel: NotificationChannel): boolean {
  const def = findKind(kindId);
  if (!def || !def.supported[channel]) return false;
  const v = (prefs ?? DEFAULT_KIND_PREFS).kind_channels?.[kindId]?.[channel];
  return typeof v === "boolean" ? v : def.defaults[channel];
}

/**
 * この種類をこのチャネルで届けるか。
 * ＝ チャネルの全体スイッチ（inapp_enabled / push_enabled）AND 種類×チャネルの設定
 *   AND（期限の2種類のみ）v3.128 の列 notify_overdue / notify_due_today。
 * 旧列を条件に残すのは、再読み込み前の旧画面が旧列だけを書き換えても効くようにするため。
 * 新画面は種類の設定を変えるたびに旧列も「どちらかのチャネルがオンか」で書き直す（buildKindChannelPatch）。
 */
export function isKindEnabled(prefs: KindPrefsLike | undefined, kindId: string, channel: NotificationChannel): boolean {
  const p = prefs ?? DEFAULT_KIND_PREFS;
  const def = findKind(kindId);
  if (!def || !def.supported[channel]) return false;
  const master = channel === "inapp" ? p.inapp_enabled : p.push_enabled;
  if (!master) return false;
  if (def.legacyColumn && p[def.legacyColumn] === false) return false;
  return kindChannelSetting(p, kindId, channel);
}

/**
 * 種類×チャネルを1つ変えたときに保存する差分。kind_channels を丸ごと作り直し、
 * 期限の2種類は旧列も「どちらかのチャネルがオンか」に揃える。
 */
export function buildKindChannelPatch(
  prefs: KindPrefsLike, kindId: string, channel: NotificationChannel, value: boolean,
): { kind_channels: KindChannels; notify_overdue?: boolean; notify_due_today?: boolean } {
  const current = sanitizeKindChannels(prefs.kind_channels);
  const nextEntry = { ...(current[kindId] ?? {}), [channel]: value };
  const kind_channels: KindChannels = { ...current, [kindId]: nextEntry };
  const def = findKind(kindId);
  if (!def?.legacyColumn) return { kind_channels };
  const next = { ...prefs, kind_channels };
  const anyOn = NOTIFICATION_CHANNELS.some((ch) => def.supported[ch] && kindChannelSetting(next, kindId, ch));
  return { kind_channels, [def.legacyColumn]: anyOn };
}
