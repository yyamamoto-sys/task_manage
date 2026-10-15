// src/lib/feedback/__tests__/feedbackMigration.test.ts
//
// v3.157：app_feedback のマイグレーション（20261015b）の文面を、画面側の定数・レジストリ・schema.sql と照合する。
// SQL を実際の Postgres で走らせる環境が無いため、守りたい性質（RLS は SELECT のみ・SECURITY DEFINER の作法・上限の数値・
// 許可リスト・既定値の一致）を SQL の文面で固定する。コメントを除去してから走査する（Section 59）。
// pglast による構文の検査は別途手元で実施（報告に記載）。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FEEDBACK_ADMIN_MEMO_MAX, FEEDBACK_ALL_KINDS, FEEDBACK_COMMENT_DB_MAX, FEEDBACK_LIMIT_PER_DAY, FEEDBACK_LIMIT_PER_HOUR,
  FEEDBACK_SNAPSHOT_MAX_BYTES, FEEDBACK_STATUSES,
} from "../constants";
import { SNAPSHOT_TOP_LEVEL_KEYS } from "../snapshot";
import { findKind } from "../../notifications/notificationKinds";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../../../");
const MIG_NAME = "20261015b_app_feedback.sql";
const RAW = fs.readFileSync(path.join(ROOT, "supabase/migrations", MIG_NAME), "utf8");
const CRON_RAW = fs.readFileSync(path.join(ROOT, "supabase/migrations/20261015c_schedule_app_feedback_cleanup.sql"), "utf8");
const SCHEMA = fs.readFileSync(path.join(ROOT, "supabase/schema.sql"), "utf8");

function stripSqlComments(sql: string): string {
  return sql.split("\n").map(l => {
    const i = l.indexOf("--");
    return i === -1 ? l : l.slice(0, i);
  }).join("\n");
}
const SQL = stripSqlComments(RAW);

/** 関数の本体（CREATE OR REPLACE FUNCTION から REVOKE の手前まで）を名前で取り出す */
function fnBlock(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const rest = sql.slice(start);
  const end = rest.indexOf("REVOKE ALL ON FUNCTION");
  return end === -1 ? rest : rest.slice(0, end);
}

describe("マイグレーションの構造", () => {
  it("BEGIN／COMMIT で囲み、先頭に想定クエリ名を書き、確認は COMMIT の後の DO ブロック1本（RAISE EXCEPTION で結果を出す）", () => {
    expect(RAW.startsWith("-- 想定クエリ名：")).toBe(true);
    const begin = SQL.indexOf("BEGIN;");
    const commit = SQL.indexOf("COMMIT;");
    expect(begin).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(begin);
    const after = SQL.slice(commit);
    expect((after.match(/\bDO \$/g) ?? []).length).toBe(1);
    expect(after).toContain("RAISE EXCEPTION");
    expect(after).not.toMatch(/^\s*SELECT .*FROM information_schema/m);
  });

  it("MIN_CLIENT_VERSION を上げない前提：既存の列・表・関数を壊す文（DROP COLUMN／DROP TABLE／既存関数の再定義）がない", () => {
    expect(SQL).not.toMatch(/DROP COLUMN/i);
    expect(SQL).not.toMatch(/DROP TABLE/i);
    const created = [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map(m => m[1]).sort();
    expect(created).toEqual(["cleanup_app_feedback", "list_my_feedback", "sanitize_feedback_json", "submit_feedback", "update_feedback_memo", "update_feedback_status"]);
  });
});

describe("表の CHECK は画面側の定数と一致する", () => {
  it("種類・状態・スナップショットの状態の一覧", () => {
    const kinds = /kind\s+text NOT NULL DEFAULT 'unspecified' CHECK \(kind IN \(([^)]*)\)\)/.exec(SQL);
    expect(kinds).not.toBeNull();
    expect((kinds as RegExpExecArray)[1].split(",").map(s => s.trim().replace(/'/g, ""))).toEqual([...FEEDBACK_ALL_KINDS]);
    const status = /status\s+text NOT NULL DEFAULT 'new' CHECK \(status IN \(([^)]*)\)\)/.exec(SQL);
    expect(status).not.toBeNull();
    expect((status as RegExpExecArray)[1].split(",").map(s => s.trim().replace(/'/g, ""))).toEqual([...FEEDBACK_STATUSES]);
    expect(SQL).toContain("CHECK (snapshot_state IN ('attached', 'off', 'too_large', 'purged'))");
  });

  it("本文は1〜2000字・メモは2000字まで・返信は200字まで（段階3用）", () => {
    expect(SQL).toContain(`CHECK (char_length(comment) BETWEEN 1 AND ${FEEDBACK_COMMENT_DB_MAX})`);
    expect(SQL).toContain(`char_length(admin_memo) <= ${FEEDBACK_ADMIN_MEMO_MAX}`);
    expect(SQL).toContain("char_length(reply_text) <= 200");
  });
});

describe("RLS：SELECT は super_admin のみ・書き込みのポリシーは作らない", () => {
  it("ポリシーは SELECT の1本だけ。(SELECT …) で包む（Section 39）", () => {
    expect(SQL).toContain("ALTER TABLE public.app_feedback ENABLE ROW LEVEL SECURITY");
    const policies = [...SQL.matchAll(/CREATE POLICY "([^"]+)" ON public\.app_feedback\s+FOR (\w+)/g)];
    expect(policies.map(m => [m[1], m[2]])).toEqual([["app_feedback_read_super_admin", "SELECT"]]);
    expect(SQL).toContain("USING (COALESCE((SELECT public.current_member_is_super_admin()), false))");
    expect(SQL).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)\b/);
  });
});

describe("SECURITY DEFINER の作法", () => {
  const DEFINERS = ["submit_feedback", "update_feedback_status", "update_feedback_memo", "list_my_feedback", "cleanup_app_feedback"];
  it.each(DEFINERS)("%s：SECURITY DEFINER・SET search_path = ''・PUBLIC と anon から REVOKE", (name) => {
    const block = fnBlock(SQL, name);
    expect(block).toContain("SECURITY DEFINER");
    expect(block).toContain("SET search_path = ''");
    expect(SQL).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC;`));
    expect(SQL).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM anon;`));
  });

  it("画面から呼べるのは submit／update×2／list の4つだけ（authenticated に GRANT）。cleanup・sanitize は authenticated からも REVOKE", () => {
    const grants = [...SQL.matchAll(/GRANT EXECUTE ON FUNCTION public\.(\w+)\(/g)].map(m => m[1]).sort();
    expect(grants).toEqual(["list_my_feedback", "submit_feedback", "update_feedback_memo", "update_feedback_status"]);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.cleanup_app_feedback\(\) FROM authenticated;/);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.sanitize_feedback_json\(jsonb, integer\) FROM authenticated;/);
  });

  it("状態・メモの更新は super_admin 以外を例外で拒否する（黙って0件にしない）", () => {
    for (const name of ["update_feedback_status", "update_feedback_memo"]) {
      const block = fnBlock(SQL, name);
      expect(block).toContain("NOT COALESCE(public.current_member_is_super_admin(), false)");
      expect(block).toContain("RAISE EXCEPTION");
    }
  });

  it("list_my_feedback は admin_memo・スナップショットを返さない（本人に見せない）", () => {
    const block = fnBlock(SQL, "list_my_feedback");
    expect(block).not.toContain("admin_memo");
    expect(block).not.toContain("snapshot");
    expect(block).toContain("f.member_id = (SELECT public.current_member_id())");
  });
});

describe("submit_feedback：乱用対策・伏せ字・スナップショットの検証", () => {
  const block = fnBlock(SQL, "submit_feedback");

  it("本人は current_member_id() で決める（匿名・ゲスト・未登録は例外）。引数に送信者がない", () => {
    expect(block).toContain("v_member     text := public.current_member_id()");
    expect(block).toMatch(/IF v_member IS NULL THEN\s+RAISE EXCEPTION/);
    const args = /CREATE OR REPLACE FUNCTION public\.submit_feedback\(([\s\S]*?)\)\s*RETURNS/.exec(SQL);
    expect(args?.[1]).not.toMatch(/member/);
  });

  it("上限の数値が画面側の定数と同じ：1時間3件・24時間10件・同一本文は1分", () => {
    expect(block).toContain(`IF v_hour >= ${FEEDBACK_LIMIT_PER_HOUR} THEN`);
    expect(block).toContain(`IF v_day >= ${FEEDBACK_LIMIT_PER_DAY} THEN`);
    expect(block).toContain("f.created_at > now() - interval '1 minute' AND f.comment = v_comment");
    expect(block).toContain("f.created_at > now() - interval '1 hour'");
    expect(block).toContain("f.created_at > now() - interval '24 hours'");
    expect(block).toContain("RETURN 'throttled'");
    expect(block).toContain("RETURN 'limited_hour'");
    expect(block).toContain("RETURN 'limited_day'");
  });

  it("件数を数える前に同じ人のアドバイザリロックを取る（Section 68 の教訓）", () => {
    const lock = block.indexOf("pg_advisory_xact_lock(hashtext('app_feedback:' || v_member))");
    const count = block.indexOf("count(*) FILTER");
    expect(lock).toBeGreaterThan(-1);
    expect(count).toBeGreaterThan(lock);
  });

  it("スナップショット：整形後16KBまで・生64KBまで。16KB超は NULL にして too_large（本文は残す）", () => {
    expect(block).toContain(`octet_length(v_snap::text) > ${FEEDBACK_SNAPSHOT_MAX_BYTES}`);
    expect(block).toContain("octet_length(v_in_snap::text) > 65536");
    expect(block).toMatch(/v_snap := NULL;\s+v_state := 'too_large';/);
    // 'off'（本人がオフ）のときは、スナップショットが送られてきても保存しない
    expect(block).toContain("p_snapshot_state = 'attached' AND v_in_snap IS NOT NULL");
  });

  it("最上位のキーの許可リストが画面側（SNAPSHOT_TOP_LEVEL_KEYS）と同じ", () => {
    const m = /e\.key = ANY \(ARRAY\[([\s\S]*?)\]\)/.exec(block);
    expect(m).not.toBeNull();
    const keys = (m as RegExpExecArray)[1].split(",").map(s => s.trim().replace(/'/g, ""));
    expect([...keys].sort()).toEqual([...SNAPSHOT_TOP_LEVEL_KEYS].sort());
  });

  it("本文・画面名・経路は伏せ字（redact_client_error_text）を通す。本文は正規表現の前に長さを確認する", () => {
    expect(block).toContain("v_comment := public.redact_client_error_text(v_comment, 2000)");
    expect(block).toContain("public.redact_client_error_text(left(coalesce(p_screen, ''), 120), 60)");
    const lenCheck = block.indexOf("char_length(v_comment) > 2000");
    const redact = block.indexOf("v_comment := public.redact_client_error_text");
    expect(lenCheck).toBeGreaterThan(-1);
    expect(redact).toBeGreaterThan(lenCheck);
  });

  it("送信時の表示部署は本人のアクセス範囲内だけ採る（範囲外はホーム部署）", () => {
    expect(block).toContain("v_group = ANY (public.current_member_group_ids())");
    expect(block).toContain("SELECT m.group_id INTO v_group FROM public.members m WHERE m.id = v_member");
  });
});

describe("sanitize_feedback_json：再帰の整形", () => {
  const block = fnBlock(SQL, "sanitize_feedback_json");
  it("キーは英数字と _ のみ・40キー・配列10要素・文字列は redact を通して200字で切る", () => {
    expect(block).toContain("'^[A-Za-z][A-Za-z0-9_]{0,31}$'");
    expect(block).toContain("EXIT WHEN v_n > 40");
    expect(block).toContain("LIMIT 10");
    expect(block).toContain("public.redact_client_error_text(left(p_val #>> '{}', 200), 120)");
    expect(block).toContain("IF p_depth <= 0 THEN");
  });
});

describe("super_admin へのベル通知はレジストリの既定値と一致する", () => {
  const block = fnBlock(SQL, "submit_feedback");
  it("kind は 'feedback'・クリック先は /?open=admin-feedback・アプリ内の既定オン（行が無い人も・キーが無い人も）", () => {
    const def = findKind("feedback");
    expect(def?.audience).toBe("super_admin");
    expect(def?.defaults.inapp).toBe(true);
    expect(def?.supported.push).toBe(false);
    expect(def?.inAppKind).toBe("feedback");
    expect(block).toContain("'feedback',");
    expect(block).toContain("'/?open=admin-feedback'");
    expect(block).toContain("COALESCE(np.inapp_enabled, true)");
    expect(block).toContain("COALESCE(np.kind_channels #> '{feedback,inapp}', 'true'::jsonb) <> 'false'::jsonb");
    expect(block).not.toContain("::boolean");
  });
  it("通知は送信と同じ関数（＝同じトランザクション）の中で作る。本文の先頭80字まで", () => {
    expect(block).toMatch(/INSERT INTO public\.app_feedback[\s\S]*INSERT INTO public\.in_app_notifications/);
    expect(block).toContain("left(regexp_replace(v_comment");
    expect(block).toContain(", 80)");
  });
});

describe("保持期間の処理", () => {
  const block = fnBlock(SQL, "cleanup_app_feedback");
  it("スナップショットは90日で NULL（本文は残す）。対応済み・見送りだけ、状態変更から180日で削除。新規・対応中は消さない", () => {
    expect(block).toMatch(/UPDATE public\.app_feedback\s+SET snapshot = NULL[\s\S]*created_at < now\(\) - interval '90 days'/);
    expect(block).toContain("snapshot_state = 'purged'");
    expect(block).toMatch(/DELETE FROM public\.app_feedback\s+WHERE status IN \('done', 'wontfix'\)/);
    expect(block).toContain("coalesce(status_changed_at, created_at) < now() - interval '180 days'");
  });
  it("pg_cron の登録は別ファイル（プレースホルダー無し）で、毎日 cleanup_app_feedback() を呼ぶ", () => {
    const cron = stripSqlComments(CRON_RAW);
    expect(cron).toContain("select public.cleanup_app_feedback();");
    expect(cron).toContain("'cleanup-app-feedback'");
    expect(cron).not.toMatch(/YOUR_|<[A-Z_]+>|PLACEHOLDER/);
  });
});

describe("in_app_notifications の CHECK と schema.sql の同期", () => {
  it("kind の CHECK に feedback を含む（ALL_IN_APP_KINDS との一致は notificationKinds.test）", () => {
    expect(SQL).toMatch(/in_app_notifications_kind_check\s+CHECK \(kind IN \([^)]*'feedback'\)\)/);
  });
  it("schema.sql に表・RLS・関数・CHECK が同期されている", () => {
    expect(SCHEMA).toContain("CREATE TABLE IF NOT EXISTS public.app_feedback");
    expect(SCHEMA).toContain('CREATE POLICY "app_feedback_read_super_admin"');
    for (const name of ["submit_feedback", "update_feedback_status", "update_feedback_memo", "list_my_feedback", "cleanup_app_feedback", "sanitize_feedback_json"]) {
      expect(SCHEMA, name).toContain(`CREATE OR REPLACE FUNCTION public.${name}(`);
    }
    expect(SCHEMA).toMatch(/kind\s+text NOT NULL CHECK \(kind IN \([^)]*'admin_message_ack', 'feedback'\)\)/);
  });
});
