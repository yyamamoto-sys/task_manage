// 段階3のレビュー指摘（91-4）：マイグレーションの守りと、確定の保存物・答えの差分・長い資料の案内。
// DB には触れない（SQL の文面と純粋関数を確かめる）。RLS が実際に何を拒否するかは s91 91-4 の表と、適用後の確認ブロック。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LONG_RESOURCE_CHARS, longResourceNotice, withSplitHint } from "../checkinAi";
import { confirmPayloadOf, diffUser } from "../supabaseRepository";
import * as U from "../userState";

const mig = readFileSync(join(process.cwd(), "supabase", "migrations", "20261117_okr_map_records.sql"), "utf-8");
const schema = readFileSync(join(process.cwd(), "supabase", "schema.sql"), "utf-8");
/** $tag$ 〜 $tag$ の本文 */
const body = (sql: string, tag: string) => {
  const open = sql.indexOf(`AS $${tag}$`);
  const close = sql.indexOf(`$${tag}$;`, open);
  if (open < 0 || close < 0) throw new Error(`${tag} が見つかりません`);
  return sql.slice(open, close);
};
// コメント行は除いて照合する（Section 59）
const code = (s: string) => s.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

describe("マイグレーションの守り（91-4）", () => {
  it("1. claims は答え以外の列（成果の記述・仕事・担当者・部署）を画面から変えられない", () => {
    const g = code(body(mig, "fn_okr_claims_guard"));
    for (const col of ["note_id", "task_id", "member_id", "group_id"]) expect(g).toContain(`NEW.${col} IS DISTINCT FROM OLD.${col}`);
    expect(g).toMatch(/RAISE EXCEPTION/);
    expect(code(mig)).toMatch(/CREATE TRIGGER trg_okr_outcome_claims_guard BEFORE UPDATE ON public\.okr_outcome_claims/);
  });

  it("2. okr_task_assignee_ids は呼んだ人の部署の仕事（かスーパー管理者）だけを返す", () => {
    const f = code(body(mig, "fn_okr_task_assignee_ids"));
    expect(f).toContain("t.group_ids && (SELECT public.current_member_group_ids())");
    expect(f).toContain("(SELECT public.current_member_is_super_admin())");
  });

  it("3. KR の部署が変わったら KR を持つ4表と claims が追随する。回の部署は画面から変えられない", () => {
    const f = code(body(mig, "fn_okr_cascade_kr_group"));
    for (const t of ["okr_kr_defs", "okr_kr_assessments", "okr_learnings", "okr_outcome_notes", "okr_outcome_claims"]) expect(f).toContain(`UPDATE public.${t}`);
    expect(code(mig)).toMatch(/CREATE TRIGGER trg_key_results_cascade_okr_map AFTER UPDATE ON public\.key_results/);
    expect(code(body(mig, "fn_okr_checkins_guard"))).toContain("NEW.group_id IS DISTINCT FROM OLD.group_id");
  });

  it("4. 見立て・学び・決定事項は、回と同じ部署の KR だけ（入れたとき・付け替えたとき）", () => {
    expect(code(body(mig, "fn_okr_check_kr_in_checkin"))).toMatch(/v_kr IS DISTINCT FROM v_ci/);
    expect(code(body(mig, "fn_okr_check_decision_krs"))).toMatch(/unnest\(NEW\.kr_ids\)/);
    expect(mig).toMatch(/ARRAY\['okr_kr_assessments', 'okr_learnings', 'okr_outcome_notes'\] LOOP\s+EXECUTE format\('DROP TRIGGER IF EXISTS trg_%s_check[\s\S]{0,200}okr_check_kr_in_checkin/);
    expect(code(mig)).toMatch(/CREATE TRIGGER trg_okr_decisions_check BEFORE INSERT OR UPDATE ON public\.okr_decisions/);
  });

  it("5. 確認ブロックは権限ごとに AND で見る（'SELECT,INSERT,UPDATE' とまとめない）", () => {
    expect(mig).not.toMatch(/has_table_privilege\([^)]*'SELECT,INSERT/);
    for (const p of ["SELECT", "INSERT", "UPDATE"]) expect(mig).toContain(`has_table_privilege('authenticated', 'public.' || t, '${p}')`);
  });

  it("6. 冒頭に「未適用の前提・再適用時は表を作り直す」がある", () => {
    expect(mig.slice(0, 3000)).toContain("未適用の前提");
    expect(mig.slice(0, 3000)).toContain("DROP TABLE IF EXISTS public.okr_outcome_claims");
  });

  it("11. 15本すべてに、書いた本人を入れるトリガー（updated_by を current_member_id で上書き）", () => {
    const loop = mig.slice(mig.indexOf("DO $okr_updated_at_triggers$"), mig.indexOf("$okr_updated_at_triggers$;"));
    expect(loop.match(/'okr_[a-z_]+'/g)).toHaveLength(15);
    expect(loop).toContain("EXECUTE FUNCTION public.okr_stamp_member()");
    expect(code(body(mig, "fn_okr_stamp_member"))).toContain("NEW.updated_by := v_me");
  });

  it("7・10. 確定の保存は SECURITY INVOKER の RPC 1本。成果の記述は最初の回・原文を上書きせず、出典と仕事を DB で和集合", () => {
    const head = mig.slice(mig.indexOf("CREATE OR REPLACE FUNCTION public.okr_confirm_checkin"), mig.indexOf("AS $fn_okr_confirm_checkin$"));
    expect(head).toContain("SECURITY INVOKER");
    expect(head).not.toContain("SECURITY DEFINER");
    const f = code(body(mig, "fn_okr_confirm_checkin"));
    const onConflict = f.slice(f.indexOf("ON CONFLICT (kr_id, note_key) DO UPDATE"), f.indexOf("RETURNING n.id"));
    expect(onConflict).toContain("public.okr_jsonb_union(n.sources, EXCLUDED.sources, NULL)");
    expect(onConflict).toContain("public.okr_jsonb_union(n.links, EXCLUDED.links, 'taskId')");
    for (const col of ["checkin_id", "change_text", "excerpt"]) expect(onConflict).not.toContain(`${col} =`);
    expect(mig).toMatch(/GRANT EXECUTE ON FUNCTION public\.okr_confirm_checkin\(jsonb\) TO authenticated/);
  });

  it("schema.sql は 0)〜4b) をマイグレーションと同じ文面で持つ", () => {
    const start = "-- 0) 判定用のヘルパー";
    const end = "\n-- ------------------------------------------------------------\n-- 5) GRANT";
    const part = mig.slice(mig.indexOf(start), mig.indexOf(end)).trimEnd();
    expect(part.length).toBeGreaterThan(10000);
    expect(schema).toContain(part);
  });
});

describe("確定の保存物（RPC に渡す形）", () => {
  it("結びつきには成果の記述の KR を付ける（(kr_id, note_key) で行を引くため）。KR の分からない結びつきは送らない", () => {
    const p = confirmPayloadOf({
      groupId: "g1",
      viewerId: "u1",
      checkin: { id: "c1", date: "2026-11-17", title: "回" },
      resourceIds: ["r1"],
      assessments: [{ krId: "k1", entry: { checkinId: "c1", date: "2026-11-17", resourceId: "r1", assessment: { value: 63, basis: [], summary: "s" }, source: { doc: "a", page: "" } } }],
      hintValues: { k2: { value: 5, source: null } },
      learnings: [{ id: "l", checkinId: "c1", resourceId: "", krId: "k1", kind: "分かったこと", text: "t", source: { doc: "a", page: "" } }],
      decisions: [],
      notes: [{ key: "n1", krId: "k1", change: "", excerpt: "", sources: [], links: [] }],
      claims: [
        { noteKey: "n1", taskId: "t1", memberId: "u1" },
        { noteKey: "nX", taskId: "t1", memberId: "u1" },
      ],
    });
    expect(p.hint_kr_ids).toEqual(["k2"]);
    expect(p.assessments.map((a) => [a.kr_id, a.resource_id, a.value, a.hint_value])).toEqual([
      ["k1", "r1", 63, null],
      ["k2", null, null, 5],
    ]);
    expect(p.learnings[0].resource_id).toBeNull();
    expect(p.claims).toEqual([{ kr_id: "k1", note_key: "n1", task_id: "t1", member_id: "u1" }]);
  });
});

describe("結びつきへの答えの差分", () => {
  const base = U.emptyUser();
  it("届いたばかり（無い → pending）は書かない。答えた・答えを pending に戻したは書く", () => {
    expect(diffUser(base, { ...base, claims: { "n|t1": "pending" } }).claims).toEqual([]);
    expect(diffUser({ ...base, claims: { "n|t1": "pending" } }, { ...base, claims: { "n|t1": "no" } }).claims).toEqual([{ noteKey: "n", taskId: "t1", status: "no" }]);
    expect(diffUser({ ...base, claims: { "n|t1": "yes" } }, { ...base, claims: { "n|t1": "pending" } }).claims).toEqual([{ noteKey: "n", taskId: "t1", status: "pending" }]);
  });
});

describe("長い資料の案内（Edge の実行時間の上限への備え）", () => {
  it("目安を超えると分けて読ませる案内を出す。先頭だけ読んだ注記も出す", () => {
    expect(longResourceNotice("a.txt", 100)).toBeNull();
    expect(longResourceNotice("a.txt", LONG_RESOURCE_CHARS + 1)).toContain("分けて読ませてください");
    expect(longResourceNotice("a.pptx", 100, "大きい資料のため先頭だけを読みました")).toBe("a.pptx：大きい資料のため先頭だけを読みました");
  });
  it("時間切れらしいエラーには分ける案内を添える（他のエラーはそのまま）", () => {
    expect(withSplitHint("a.txt を読めませんでした（546 WORKER_RESOURCE_LIMIT）")).toContain("前半と後半");
    expect(withSplitHint("a.txt を読めませんでした（permission denied）")).toBe("a.txt を読めませんでした（permission denied）");
  });
});

/** 関数の本文（AS $fn_x$ 〜 $fn_x$）の中の IF／ELSIF の条件（THEN まで）。END IF と CREATE … IF NOT EXISTS は含めない */
function ifConditions(sql: string): string[] {
  const bodies = [...sql.matchAll(/AS \$(fn_[a-z_]+)\$([\s\S]*?)\$\1\$/g)].map((m) => m[2]);
  const src = bodies.length > 0 ? bodies.join("\n") : sql;
  return [...code(src).matchAll(/(?<!END )\b(?:IF|ELSIF)\b([\s\S]*?)\bTHEN\b/g)].map((m) => m[1]);
}
/**
 * 1つの条件の式に「表の名前の判定」と NEW／OLD の列を混ぜると、列の無い表で式の準備が失敗する。
 * TG_OP の判定と OLD の列を混ぜると、INSERT で OLD を読むことになる
 */
function badTriggerConditions(sql: string): string[] {
  return ifConditions(sql).filter((c) => (/TG_TABLE_NAME/.test(c) && /\b(NEW|OLD)\./.test(c)) || (/TG_OP/.test(c) && /\bOLD\./.test(c)));
}

describe("最終点検の指摘（91-6）", () => {
  it("M1：トリガー関数の IF の条件に、表の名前・TG_OP の判定と列の読み取りを混ぜない（混ぜると15本すべての書き込みが失敗する）", () => {
    expect(badTriggerConditions(mig)).toEqual([]);
    // 検査が効いていること（直す前の書き方は落ちる）
    expect(badTriggerConditions("IF TG_TABLE_NAME = 'okr_checkins' AND NEW.confirmed_by IS NOT NULL THEN")).toHaveLength(1);
    expect(badTriggerConditions("IF TG_OP = 'UPDATE' AND NEW.kr_id IS NOT DISTINCT FROM OLD.kr_id THEN")).toHaveLength(1);
    expect(badTriggerConditions("IF TG_TABLE_NAME = 'okr_checkins' THEN\n IF NEW.confirmed_by IS NOT NULL THEN")).toEqual([]);
  });

  it("M3・M8・M4：確定は回ごとに直列・取り消し済みの回は例外・同じ記述は1つにまとめ、取り消し済みは復活させない", () => {
    const f = code(body(mig, "fn_okr_confirm_checkin"));
    expect(f).toContain("pg_advisory_xact_lock(hashtext('okr_confirm_checkin:' || v_ci::text))");
    expect(f).toMatch(/c\.id = v_ci AND c\.is_deleted\) THEN\s+RAISE EXCEPTION/);
    expect(f).toContain("SELECT DISTINCT ON (x ->> 'kr_id', x ->> 'note_key')");
    expect(f).toContain("WHERE n.is_deleted = false");
    expect(f).not.toMatch(/is_deleted = false, deleted_at = NULL/);
    expect(f.indexOf("pg_advisory_xact_lock")).toBeLessThan(f.indexOf("INSERT INTO public.okr_checkins"));
  });

  it("M6・M7・M9：成果の記述にも部署の一致・claims は仕事の部署に記述の部署が含まれること・取り消した人は必ず本人", () => {
    expect(mig).toContain("'okr_kr_assessments', 'okr_learnings', 'okr_outcome_notes'] LOOP");
    expect(code(mig)).toMatch(/okr_outcome_claims_insert[\s\S]{0,400}public\.task_group_ids\(task_id\) @> ARRAY\[group_id\]/);
    const s = code(body(mig, "fn_okr_stamp_member"));
    expect(s).toMatch(/ELSIF NEW\.is_deleted AND NOT OLD\.is_deleted THEN\s+NEW\.deleted_by := v_me;/);
    expect(s).toMatch(/ELSIF NEW\.is_deleted AND OLD\.is_deleted THEN\s+NEW\.deleted_by := OLD\.deleted_by;/);
  });
});
