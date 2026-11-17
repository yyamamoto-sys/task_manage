// OKRモード（地図）の記録の Supabase 実装（段階2）。表は supabase/migrations/20261117_okr_map_records.sql。
// 読み込みは fetchAllRows（Section 61）、KRの定めの保存は saveWithLock（Section 5）。物理削除はしない（Section 4）。
// ゲストでは使わない（OkrDashboardView がゲストのときは memoryRepository を渡す。Section 23）。
// 行 → 画面の形への組み立ては純粋関数 buildRecords に分けてある（テストはこちらを確かめる）。
import { supabase } from "../../../lib/supabase/client";
import { fetchAllRows, type FetchAllRowsResult } from "../../../lib/supabase/fetchAllRows";
import { ConflictError, saveWithLock } from "../../../lib/supabase/store";
import { readingOf } from "./checkinAi";
import { answerKey, howKey } from "./logic";
import type { History } from "./reach";
import { emptyRecords, KrDefConflictError, type ConfirmSave, type HintDef, type OkrMapLoadArgs, type OkrMapRecords, type OkrMapRepository, type UserRecord } from "./repository";
import type {
  AssessEntry,
  BasisItem,
  Checkin,
  ClaimStatus,
  Decision,
  Effect,
  KrBands,
  KrDef,
  KrRecord,
  Learning,
  LearningKind,
  Match,
  OutcomeLink,
  PastWeek,
  PersonalOkr,
  Resource,
  Source,
} from "./types";
import { claimKey, type UserState } from "./userState";

// ---------- 行の型 ----------

export interface KrDefRow {
  id: string;
  kr_id: string;
  bands: Record<string, unknown> | null;
  evidence: string;
  hint_unit: string | null;
  hint_start: number | string | null;
  hint_target: number | string | null;
  hint_direction: "up" | "down" | null;
  updated_at: string;
}
export interface CheckinRow {
  id: string;
  checkin_date: string;
  title: string;
  confirmed_by: string | null;
}
export interface AssessmentRow {
  id: string;
  checkin_id: string;
  kr_id: string;
  resource_id: string | null;
  value: number | null;
  summary: string;
  basis: unknown;
  source: unknown;
  hint_value: number | string | null;
}
export interface LearningRow {
  id: string;
  checkin_id: string;
  kr_id: string;
  resource_id: string | null;
  kind: LearningKind;
  body: string;
  source: unknown;
}
export interface DecisionRow {
  id: string;
  checkin_id: string;
  resource_id: string | null;
  kind: "決定" | "宿題";
  body: string;
  owner_member_id: string | null;
  kr_ids: string[] | null;
  source: unknown;
}
export interface NoteRow {
  id: string;
  kr_id: string;
  note_key: string;
  change_text: string;
  excerpt: string;
  sources: unknown;
  links: unknown;
}
export interface ClaimRow {
  note_id: string;
  task_id: string;
  member_id: string;
  status: ClaimStatus;
}
export interface TaskLinkRow {
  task_id: string;
  kr_ids: string[] | null;
  updated_by: string;
}
export interface HowRow {
  task_id: string;
  kr_id: string;
  body: string;
}
export interface ProposalRow {
  task_id: string;
  kr_id: string;
  choice: "taken" | "skipped";
}
export interface PersonalLinkRow {
  personal_kr_id: string;
  kr_id: string;
  /** 外した矢印も読む（行があれば、個人OKR画面の紐づけ key_result_id を初期値にしない） */
  is_deleted?: boolean;
}
export interface ResourceRow {
  id: string;
  checkin_id: string;
  file_name: string;
  kind: string;
  reading: unknown;
}
export interface AnswerRow {
  week_start: string;
  kr_id: string;
  effect: Effect | null;
  match_answer: Match | null;
}
export interface PickRow {
  task_id: string;
}
export interface LockRow {
  locked_on: string;
}
export interface PersonalKrRow {
  id: string;
  label: string;
  member_id: string;
  /** 個人OKR画面の取込でついた KR への紐づけ。矢印の行が無いときの初期値（表示だけ） */
  key_result_id?: string | null;
}

export interface LoadedRows {
  defs: KrDefRow[];
  checkins: CheckinRow[];
  assessments: AssessmentRow[];
  learnings: LearningRow[];
  decisions: DecisionRow[];
  notes: NoteRow[];
  claims: ClaimRow[];
  links: TaskLinkRow[];
  how: HowRow[];
  proposals: ProposalRow[];
  personalLinks: PersonalLinkRow[];
  answers: AnswerRow[];
  picks: PickRow[];
  lock: LockRow | null;
  personalKrs: PersonalKrRow[];
  resources?: ResourceRow[];
}

// ---------- 行 → 画面の形（純粋関数） ----------

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

function asSource(v: unknown): Source | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return typeof o.doc === "string" ? { doc: o.doc, page: typeof o.page === "string" ? o.page : "" } : null;
}

function asSources(v: unknown): Source[] {
  return Array.isArray(v) ? v.map(asSource).filter((s): s is Source => s !== null) : [];
}

function asBasis(v: unknown): BasisItem[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): BasisItem[] => {
    if (!x || typeof x !== "object") return [];
    const o = x as Record<string, unknown>;
    const status = o.status === "確認できた" || o.status === "一部" || o.status === "まだ" ? o.status : "まだ";
    return typeof o.requirement === "string" ? [{ requirement: o.requirement, status, quote: typeof o.quote === "string" ? o.quote : "" }] : [];
  });
}

function asLinks(v: unknown): OutcomeLink[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): OutcomeLink[] => {
    if (!x || typeof x !== "object") return [];
    const o = x as Record<string, unknown>;
    return typeof o.taskId === "string" ? [{ taskId: o.taskId, reason: typeof o.reason === "string" ? o.reason : "" }] : [];
  });
}

/** 段の基準文。60・70・80 は必ず持たせ（空文）、90・100 は文があるときだけ */
export function asBands(v: Record<string, unknown> | null): KrBands {
  const s = (k: string) => (v && typeof v[k] === "string" ? (v[k] as string) : "");
  const out: KrBands = { 60: s("60"), 70: s("70"), 80: s("80") };
  if (s("90")) out[90] = s("90");
  if (s("100")) out[100] = s("100");
  return out;
}

export function hintDefOf(r: KrDefRow): HintDef | null {
  const start = num(r.hint_start);
  const target = num(r.hint_target);
  if (!r.hint_unit || start === null || target === null || !r.hint_direction) return null;
  return { unit: r.hint_unit, start, target, direction: r.hint_direction };
}

const byDate = <T extends { date: string }>(a: T, b: T) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

const objList = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)) : []);
const strOf = (v: unknown) => (typeof v === "string" ? v : "");

/** okr_resources の行 → 資料1件の読み取り結果。地図に無い KR の分は捨てる（壊れた値も落とす） */
export function resourceOf(row: ResourceRow, kr: Set<string>): Resource {
  const r = row.reading && typeof row.reading === "object" ? (row.reading as Record<string, unknown>) : {};
  const src = (v: unknown): Source => asSource(v) ?? { doc: row.file_name, page: "" };
  return {
    id: row.id,
    name: row.file_name,
    kind: row.kind,
    checkinId: row.checkin_id,
    drafts: objList(r.drafts).flatMap((d) => {
      const value = num(d.value as number | string | null);
      return kr.has(strOf(d.krId)) && value !== null ? [{ krId: strOf(d.krId), value, source: src(d.source) }] : [];
    }),
    assessments: objList(r.assessments).flatMap((a) => {
      const as = a.assessment && typeof a.assessment === "object" ? (a.assessment as Record<string, unknown>) : null;
      const value = as ? num(as.value as number | string | null) : null;
      return kr.has(strOf(a.krId)) && as && value !== null ? [{ krId: strOf(a.krId), assessment: { value, basis: asBasis(as.basis), summary: strOf(as.summary) }, source: src(a.source) }] : [];
    }),
    learnings: objList(r.learnings).flatMap((l) =>
      kr.has(strOf(l.krId)) && (l.kind === "分かったこと" || l.kind === "次に試すこと") && strOf(l.text) ? [{ krId: strOf(l.krId), kind: l.kind as LearningKind, text: strOf(l.text), source: src(l.source) }] : [],
    ),
    notes: objList(r.notes).flatMap((n) =>
      kr.has(strOf(n.krId)) && strOf(n.key) ? [{ key: strOf(n.key), krId: strOf(n.krId), change: strOf(n.change), excerpt: strOf(n.excerpt), source: src(n.source), links: asLinks(n.links) }] : [],
    ),
    decisions: objList(r.decisions).flatMap((d) =>
      (d.kind === "決定" || d.kind === "宿題") && strOf(d.text)
        ? [
            {
              kind: d.kind as "決定" | "宿題",
              text: strOf(d.text),
              ownerId: typeof d.ownerId === "string" && d.ownerId ? d.ownerId : null,
              source: src(d.source),
              krIds: (Array.isArray(d.krIds) ? d.krIds : []).filter((k): k is string => typeof k === "string" && kr.has(k)),
            },
          ]
        : [],
    ),
  };
}

/** 読んだ行を、画面が読む記録の形に組み立てる。krIds にない KR の行は捨てる */
export function buildRecords(rows: LoadedRows, args: Pick<OkrMapLoadArgs, "krIds" | "viewerId" | "weekStart">): OkrMapRecords {
  const { krIds, viewerId, weekStart } = args;
  const out = emptyRecords(krIds);
  const kr = new Set(krIds);
  const allCheckins: Checkin[] = rows.checkins.map((c) => ({ id: c.id, date: c.checkin_date, title: c.title })).sort(byDate);
  const dateOf = new Map(allCheckins.map((c) => [c.id, c.date]));
  // 資料を読ませただけで何も確定していない回は「回」に数えない（最新の回の日付・未更新の判定を動かさない）
  const used = new Set([...rows.assessments, ...rows.learnings, ...rows.decisions].map((x) => x.checkin_id));
  const confirmed = new Set(rows.checkins.filter((c) => c.confirmed_by).map((c) => c.id));
  out.checkins = allCheckins.filter((c) => confirmed.has(c.id) || used.has(c.id));
  out.openCheckins = allCheckins.filter((c) => !confirmed.has(c.id) && !used.has(c.id));
  out.resources = (rows.resources ?? []).filter((r) => dateOf.has(r.checkin_id)).map((r) => resourceOf(r, kr));
  out.confirmedBy = Object.fromEntries(rows.checkins.filter((c) => c.confirmed_by).map((c) => [c.id, c.confirmed_by as string]));

  const hintDefs = new Map<string, HintDef>();
  for (const d of rows.defs) {
    if (!kr.has(d.kr_id)) continue;
    out.krDefs[d.kr_id] = { bands: asBands(d.bands), evidence: d.evidence ?? "" };
    const h = hintDefOf(d);
    if (h) hintDefs.set(d.kr_id, h);
  }

  // 見立て（資料ごと）と、回ごとの手がかりの値
  const assess: Record<string, AssessEntry[]> = {};
  const hintPts: Record<string, { date: string; value: number; source: Source | null }[]> = {};
  const touched: Record<string, { date: string; source: Source | null }[]> = {};
  for (const a of rows.assessments) {
    const date = dateOf.get(a.checkin_id);
    if (!kr.has(a.kr_id) || !date) continue;
    const source = asSource(a.source);
    (touched[a.kr_id] ??= []).push({ date, source });
    if (a.value !== null && a.resource_id) {
      (assess[a.kr_id] ??= []).push({
        checkinId: a.checkin_id,
        date,
        resourceId: a.resource_id,
        assessment: { value: a.value, basis: asBasis(a.basis), summary: a.summary ?? "" },
        source,
      });
    }
    const hv = num(a.hint_value);
    if (hv !== null && !a.resource_id) (hintPts[a.kr_id] ??= []).push({ date, value: hv, source });
  }
  for (const k of Object.keys(assess)) assess[k].sort(byDate);
  out.assess = assess;
  const history: History = {};
  for (const [k, pts] of Object.entries(hintPts)) history[k] = pts.sort(byDate).map((p) => ({ date: p.date, value: p.value }));
  out.history = history;

  for (const k of krIds) {
    const dates = [...new Set((touched[k] ?? []).map((t) => t.date))].sort();
    const pts = (hintPts[k] ?? []).slice().sort(byDate);
    const last = dates[dates.length - 1] ?? "";
    const lastHint = pts[pts.length - 1];
    const lastTouch = (touched[k] ?? []).filter((t) => t.date === last && t.source)[0];
    const rec: KrRecord = { krId: k, updatedAt: last, prevAt: dates[dates.length - 2] ?? "", source: (lastHint?.date === last ? lastHint.source : null) ?? lastTouch?.source ?? null };
    const h = hintDefs.get(k);
    if (h) rec.hint = { ...h, value: lastHint?.value ?? h.start, prev: pts[pts.length - 2]?.value ?? h.start };
    out.records[k] = rec;
  }

  out.learnings = rows.learnings
    .filter((l) => kr.has(l.kr_id) && dateOf.has(l.checkin_id))
    .map((l): Learning => ({ id: l.id, checkinId: l.checkin_id, resourceId: l.resource_id ?? "", krId: l.kr_id, kind: l.kind, text: l.body, source: asSource(l.source) ?? { doc: "", page: "" } }));
  out.decisions = rows.decisions
    .filter((d) => dateOf.has(d.checkin_id))
    .map((d): Decision => {
      const dec: Decision = { id: d.id, checkinId: d.checkin_id, kind: d.kind, text: d.body, ownerId: d.owner_member_id, source: asSource(d.source) ?? { doc: "", page: "" }, krIds: (d.kr_ids ?? []).filter((k) => kr.has(k)) };
      if (d.resource_id) dec.resourceId = d.resource_id;
      return dec;
    });

  const notes = rows.notes.filter((n) => kr.has(n.kr_id));
  out.outcomeNotes = notes.map((n) => ({ key: n.note_key, krId: n.kr_id, change: n.change_text, excerpt: n.excerpt, sources: asSources(n.sources), links: asLinks(n.links) }));
  const keyOfNote = new Map(notes.map((n) => [n.id, n.note_key]));

  const users: Record<string, UserRecord> = {};
  const user = (id: string) => (users[id] ??= {});
  for (const c of rows.claims) {
    const key = keyOfNote.get(c.note_id);
    if (!key) continue;
    // 他の人の行は yes だけが届く（RLS）。念のためここでも本人以外は yes だけ使う
    if (c.member_id !== viewerId && c.status !== "yes") continue;
    const u = user(c.member_id);
    u.claims = { ...(u.claims ?? {}), [claimKey(key, c.task_id)]: c.status };
  }
  const me = user(viewerId);
  me.how = Object.fromEntries(rows.how.filter((h) => h.body).map((h) => [howKey(h.task_id, h.kr_id), h.body]));
  me.proposals = Object.fromEntries(rows.proposals.map((p) => [`${p.task_id}|${p.kr_id}`, p.choice]));
  me.answers = Object.fromEntries(
    rows.answers.filter((a) => a.week_start === weekStart).map((a) => [answerKey(a.week_start, a.kr_id), { ...(a.effect ? { effect: a.effect } : {}), ...(a.match_answer ? { match: a.match_answer } : {}) }]),
  );
  out.userRecords = users;

  const past = new Map<string, PastWeek>();
  for (const a of rows.answers) {
    if (a.week_start >= weekStart || !a.effect || !kr.has(a.kr_id)) continue;
    const w = past.get(a.week_start) ?? { weekStart: a.week_start, answers: {} };
    w.answers[a.kr_id] = { effect: a.effect, ...(a.match_answer ? { match: a.match_answer } : {}), view: "" };
    past.set(a.week_start, w);
  }
  out.pastWeeks = past.size > 0 ? { [viewerId]: [...past.values()].sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1)) } : {};

  // つなぎ先は仕事1件1行。最後に選び直した人の分として持つ（どの担当者の分に入っていても図は全員分を足して使う）
  const overrides: Record<string, Record<string, string[]>> = {};
  for (const l of rows.links) (overrides[l.updated_by || viewerId] ??= {})[l.task_id] = (l.kr_ids ?? []).filter((k) => kr.has(k));
  out.overrides = overrides;
  // 矢印の行が1つも無い個人OKR（外した行も含めて）は、個人OKR画面の紐づけ（key_result_id）を初期値として見せる。
  // 書き込みは本人が矢印を操作したときだけ（diffUser がその個人OKRの矢印をまとめて書く）
  const touchedPersonal = new Set(rows.personalLinks.map((l) => l.personal_kr_id));
  out.personalLinks = {
    [viewerId]: [
      ...rows.personalLinks.filter((l) => !l.is_deleted && kr.has(l.kr_id)).map((l) => ({ personalId: l.personal_kr_id, krId: l.kr_id })),
      ...rows.personalKrs.filter((p) => !touchedPersonal.has(p.id) && p.key_result_id && kr.has(p.key_result_id)).map((p) => ({ personalId: p.id, krId: p.key_result_id as string })),
    ],
  };
  out.picks = rows.picks.length > 0 ? { [viewerId]: rows.picks.map((p) => p.task_id) } : {};
  out.personalOkrs = rows.personalKrs.map((p): PersonalOkr => ({ id: p.id, ownerId: p.member_id, text: p.label }));
  out.lock = rows.lock ? { locked: true, lockedAt: rows.lock.locked_on } : { locked: false, lockedAt: null };
  return out;
}

// ---------- 差分（純粋関数） ----------

const sameSet = (a: string[] | undefined, b: string[] | undefined) => !!a && !!b && a.length === b.length && a.every((x) => b.includes(x));
const splitFirst = (key: string): [string, string] => {
  const i = key.indexOf("|");
  return [key.slice(0, i), key.slice(i + 1)];
};
const splitLast = (key: string): [string, string] => {
  const i = key.lastIndexOf("|");
  return [key.slice(0, i), key.slice(i + 1)];
};

export interface UserDiff {
  links: { taskId: string; krIds: string[] | null }[];
  proposals: { taskId: string; krId: string; choice: "taken" | "skipped"; deleted: boolean }[];
  how: { taskId: string; krId: string; body: string; deleted: boolean }[];
  personalLinks: { personalId: string; krId: string; deleted: boolean }[];
  answers: { weekStart: string; krId: string; effect: Effect | null; match: Match | null }[];
  picks: { weekStart: string; taskId: string; deleted: boolean }[];
  claims: { noteKey: string; taskId: string; status: "yes" | "no" }[];
}

/** 本人の状態の before → after から、書くべき行を出す。links の krIds=null は「既定に戻す」 */
export function diffUser(b: UserState, a: UserState): UserDiff {
  const d: UserDiff = { links: [], proposals: [], how: [], personalLinks: [], answers: [], picks: [], claims: [] };
  for (const t of new Set([...Object.keys(b.overrides), ...Object.keys(a.overrides)])) {
    const x = b.overrides[t];
    const y = a.overrides[t];
    if (x === undefined && y === undefined) continue;
    if (y === undefined) d.links.push({ taskId: t, krIds: null });
    else if (!sameSet(x, y)) d.links.push({ taskId: t, krIds: [...y] });
  }
  for (const k of new Set([...Object.keys(b.proposals), ...Object.keys(a.proposals)])) {
    if (b.proposals[k] === a.proposals[k]) continue;
    const [taskId, krId] = splitFirst(k);
    const v = a.proposals[k];
    d.proposals.push(v ? { taskId, krId, choice: v, deleted: false } : { taskId, krId, choice: b.proposals[k], deleted: true });
  }
  for (const k of new Set([...Object.keys(b.how), ...Object.keys(a.how)])) {
    if (b.how[k] === a.how[k]) continue;
    const [taskId, krId] = splitFirst(k);
    d.how.push({ taskId, krId, body: a.how[k] ?? "", deleted: a.how[k] === undefined });
  }
  const lk = (l: { personalId: string; krId: string }) => `${l.personalId}|${l.krId}`;
  const bl = new Set(b.personalLinks.map(lk));
  const al = new Set(a.personalLinks.map(lk));
  for (const l of a.personalLinks) if (!bl.has(lk(l))) d.personalLinks.push({ ...l, deleted: false });
  for (const l of b.personalLinks) if (!al.has(lk(l))) d.personalLinks.push({ ...l, deleted: true });
  // 触った個人OKRは、残した矢印も書く（key_result_id 由来の初期値は行が無いので、書かないと開き直したときに消える）
  const touched = new Set(d.personalLinks.map((l) => l.personalId));
  for (const l of a.personalLinks) if (touched.has(l.personalId) && bl.has(lk(l))) d.personalLinks.push({ ...l, deleted: false });
  for (const k of new Set([...Object.keys(b.answers), ...Object.keys(a.answers)])) {
    const x = b.answers[k];
    const y = a.answers[k];
    if (x?.effect === y?.effect && x?.match === y?.match) continue;
    const [weekStart, krId] = splitFirst(k);
    d.answers.push({ weekStart, krId, effect: y?.effect ?? null, match: y?.match ?? null });
  }
  for (const w of new Set([...Object.keys(b.picks), ...Object.keys(a.picks)])) {
    const x = b.picks[w] ?? [];
    const y = a.picks[w] ?? [];
    for (const t of y) if (!x.includes(t)) d.picks.push({ weekStart: w, taskId: t, deleted: false });
    for (const t of x) if (!y.includes(t)) d.picks.push({ weekStart: w, taskId: t, deleted: true });
  }
  for (const k of Object.keys(a.claims)) {
    const v = a.claims[k];
    if (v === b.claims[k] || v === "pending") continue;
    const [noteKey, taskId] = splitLast(k);
    d.claims.push({ noteKey, taskId, status: v });
  }
  return d;
}

// ---------- 入出力 ----------

async function must<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}

async function rows<Row>(p: Promise<FetchAllRowsResult<Row>>): Promise<Row[]> {
  const { data, error } = await p;
  if (error) throw error;
  return data ?? [];
}

/** PostgreSQL の一意制約違反（23505） */
export function isUniqueViolation(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: unknown }).code === "23505";
}

const deletedCols = (on: boolean, by: string) => (on ? { is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: by } : { is_deleted: false, deleted_at: null, deleted_by: null });

export function createSupabaseRepository(): OkrMapRepository {
  // 成果の記述の key → 行ID（claims を書くときに使う）。KR の定めの行ID と updated_at（楽観ロック）
  const noteIds = new Map<string, string>();
  const defMeta = new Map<string, { id: string; updatedAt: string }>();

  return {
    async load(args) {
      const { groupId, krIds, viewerId, year, quarter, weekStart } = args;
      if (!groupId || krIds.length === 0) return emptyRecords(krIds);
      const [defs, checkins, assessments, learnings, decisions, notes, links, how, proposals, personalLinks, answers, picks, personalKrs, lock] = await Promise.all([
        rows(fetchAllRows<KrDefRow>((o) => supabase.from("okr_kr_defs").select("id,kr_id,bands,evidence,hint_unit,hint_start,hint_target,hint_direction,updated_at", o).in("kr_id", krIds).eq("is_deleted", false), { label: "okr_kr_defs" })),
        rows(fetchAllRows<CheckinRow>((o) => supabase.from("okr_checkins").select("id,checkin_date,title,confirmed_by", o).eq("group_id", groupId).eq("is_deleted", false), { label: "okr_checkins" })),
        rows(fetchAllRows<AssessmentRow>((o) => supabase.from("okr_kr_assessments").select("id,checkin_id,kr_id,resource_id,value,summary,basis,source,hint_value", o).in("kr_id", krIds).eq("is_deleted", false), { label: "okr_kr_assessments" })),
        rows(fetchAllRows<LearningRow>((o) => supabase.from("okr_learnings").select("id,checkin_id,kr_id,resource_id,kind,body,source", o).in("kr_id", krIds).eq("is_deleted", false), { label: "okr_learnings" })),
        rows(fetchAllRows<DecisionRow>((o) => supabase.from("okr_decisions").select("id,checkin_id,resource_id,kind,body,owner_member_id,kr_ids,source", o).eq("group_id", groupId).eq("is_deleted", false), { label: "okr_decisions" })),
        rows(fetchAllRows<NoteRow>((o) => supabase.from("okr_outcome_notes").select("id,kr_id,note_key,change_text,excerpt,sources,links", o).in("kr_id", krIds).eq("is_deleted", false), { label: "okr_outcome_notes" })),
        rows(fetchAllRows<TaskLinkRow>((o) => supabase.from("okr_task_kr_links").select("id,task_id,kr_ids,updated_by", o).eq("is_deleted", false), { label: "okr_task_kr_links" })),
        rows(fetchAllRows<HowRow>((o) => supabase.from("okr_task_kr_how").select("id,task_id,kr_id,body", o).eq("member_id", viewerId).eq("is_deleted", false), { label: "okr_task_kr_how" })),
        rows(fetchAllRows<ProposalRow>((o) => supabase.from("okr_proposal_choices").select("id,task_id,kr_id,choice", o).eq("member_id", viewerId).eq("is_deleted", false), { label: "okr_proposal_choices" })),
        rows(fetchAllRows<PersonalLinkRow>((o) => supabase.from("okr_personal_kr_links").select("id,personal_kr_id,kr_id,is_deleted", o).eq("member_id", viewerId), { label: "okr_personal_kr_links" })),
        rows(fetchAllRows<AnswerRow>((o) => supabase.from("okr_weekly_answers").select("id,week_start,kr_id,effect,match_answer", o).eq("member_id", viewerId), { label: "okr_weekly_answers" })),
        rows(fetchAllRows<PickRow>((o) => supabase.from("okr_weekly_picks").select("id,task_id", o).eq("member_id", viewerId).eq("week_start", weekStart).eq("is_deleted", false), { label: "okr_weekly_picks" })),
        rows(fetchAllRows<PersonalKrRow>((o) => supabase.from("personal_krs").select("id,label,member_id,key_result_id", o).eq("member_id", viewerId).eq("fiscal_year", year).eq("quarter", quarter).eq("is_deleted", false).order("display_order"), { label: "personal_krs" })),
        must<LockRow>(supabase.from("okr_tf_locks").select("locked_on").eq("group_id", groupId).eq("fiscal_year", year).eq("quarter", quarter).eq("is_deleted", false).maybeSingle()),
      ]);
      const resources = await rows(
        fetchAllRows<ResourceRow>((o) => supabase.from("okr_resources").select("id,checkin_id,file_name,kind,reading", o).eq("group_id", groupId).eq("is_deleted", false), { label: "okr_resources" }),
      );
      const claims = notes.length === 0 ? [] : await rows(fetchAllRows<ClaimRow>((o) => supabase.from("okr_outcome_claims").select("id,note_id,task_id,member_id,status", o).in("note_id", notes.map((n) => n.id)), { label: "okr_outcome_claims" }));
      noteIds.clear();
      for (const n of notes) noteIds.set(n.note_key, n.id);
      defMeta.clear();
      for (const d of defs) defMeta.set(d.kr_id, { id: d.id, updatedAt: d.updated_at });
      return buildRecords({ defs, checkins, assessments, learnings, decisions, notes, claims, links, how, proposals, personalLinks, answers, picks, lock, personalKrs, resources }, args);
    },

    async saveUser(viewerId, before, after) {
      const d = diffUser(before, after);
      const by = viewerId;
      if (d.links.length > 0) {
        await must(
          supabase.from("okr_task_kr_links").upsert(
            d.links.map((l) => ({ task_id: l.taskId, kr_ids: l.krIds ?? [], updated_by: by, ...deletedCols(l.krIds === null, by) })),
            { onConflict: "task_id" },
          ),
        );
      }
      if (d.proposals.length > 0) {
        await must(
          supabase.from("okr_proposal_choices").upsert(
            d.proposals.map((p) => ({ member_id: viewerId, task_id: p.taskId, kr_id: p.krId, choice: p.choice, updated_by: by, ...deletedCols(p.deleted, by) })),
            { onConflict: "member_id,task_id,kr_id" },
          ),
        );
      }
      if (d.how.length > 0) {
        await must(
          supabase.from("okr_task_kr_how").upsert(
            d.how.map((h) => ({ member_id: viewerId, task_id: h.taskId, kr_id: h.krId, body: h.body, updated_by: by, ...deletedCols(h.deleted, by) })),
            { onConflict: "member_id,task_id,kr_id" },
          ),
        );
      }
      if (d.personalLinks.length > 0) {
        await must(
          supabase.from("okr_personal_kr_links").upsert(
            d.personalLinks.map((l) => ({ member_id: viewerId, personal_kr_id: l.personalId, kr_id: l.krId, updated_by: by, ...deletedCols(l.deleted, by) })),
            { onConflict: "member_id,personal_kr_id,kr_id" },
          ),
        );
      }
      if (d.answers.length > 0) {
        await must(
          supabase.from("okr_weekly_answers").upsert(
            d.answers.map((a) => ({ member_id: viewerId, week_start: a.weekStart, kr_id: a.krId, effect: a.effect, match_answer: a.match, updated_by: by })),
            { onConflict: "member_id,week_start,kr_id" },
          ),
        );
      }
      if (d.picks.length > 0) {
        await must(
          supabase.from("okr_weekly_picks").upsert(
            d.picks.map((p) => ({ member_id: viewerId, week_start: p.weekStart, task_id: p.taskId, updated_by: by, ...deletedCols(p.deleted, by) })),
            { onConflict: "member_id,week_start,task_id" },
          ),
        );
      }
      for (const c of d.claims) {
        const noteId = noteIds.get(c.noteKey);
        if (!noteId) continue;
        await must(
          supabase
            .from("okr_outcome_claims")
            .update({ status: c.status, answered_at: new Date().toISOString(), updated_by: by })
            .eq("note_id", noteId)
            .eq("task_id", c.taskId)
            .eq("member_id", viewerId),
        );
      }
    },

    async saveConfirm(c: ConfirmSave) {
      if (!c.groupId) throw new Error("部署が選ばれていないため、確定を保存できません");
      const by = c.viewerId;
      const now = new Date().toISOString();
      const ci = c.checkin.id;
      await must(
        supabase
          .from("okr_checkins")
          .upsert({ id: ci, group_id: c.groupId, checkin_date: c.checkin.date, title: c.checkin.title, confirmed_by: by, confirmed_at: now, updated_by: by }, { onConflict: "id" }),
      );
      // 同じ資料を確定し直したときは、その資料の分を取り消してから入れ直す（画面の足し合わせと同じ）
      if (c.resourceIds.length > 0) {
        for (const table of ["okr_kr_assessments", "okr_learnings", "okr_decisions"]) {
          await must(supabase.from(table).update(deletedCols(true, by)).eq("checkin_id", ci).in("resource_id", c.resourceIds).eq("is_deleted", false));
        }
      }
      const hintKrs = Object.keys(c.hintValues);
      if (hintKrs.length > 0) {
        await must(supabase.from("okr_kr_assessments").update(deletedCols(true, by)).eq("checkin_id", ci).in("kr_id", hintKrs).is("resource_id", null).eq("is_deleted", false));
      }
      const assessRows = [
        ...c.assessments.map(({ krId, entry }) => ({
          checkin_id: ci,
          kr_id: krId,
          resource_id: entry.resourceId,
          value: entry.assessment.value,
          summary: entry.assessment.summary,
          basis: entry.assessment.basis,
          source: entry.source,
          updated_by: by,
        })),
        ...hintKrs.map((krId) => ({ checkin_id: ci, kr_id: krId, resource_id: null, value: null, summary: "", basis: [], source: c.hintValues[krId].source, hint_value: c.hintValues[krId].value, updated_by: by })),
      ];
      if (assessRows.length > 0) await must(supabase.from("okr_kr_assessments").insert(assessRows));
      if (c.learnings.length > 0) {
        await must(
          supabase.from("okr_learnings").insert(c.learnings.map((l) => ({ checkin_id: ci, kr_id: l.krId, resource_id: l.resourceId || null, kind: l.kind, body: l.text, source: l.source, updated_by: by }))),
        );
      }
      if (c.decisions.length > 0) {
        await must(
          supabase
            .from("okr_decisions")
            .insert(c.decisions.map((x) => ({ checkin_id: ci, resource_id: x.resourceId ?? null, kind: x.kind, body: x.text, owner_member_id: x.ownerId, kr_ids: x.krIds, source: x.source, updated_by: by }))),
        );
      }
      if (c.notes.length > 0) {
        const saved = await must<{ id: string; note_key: string }[]>(
          supabase
            .from("okr_outcome_notes")
            .upsert(
              c.notes.map((n) => ({ kr_id: n.krId, note_key: n.key, checkin_id: ci, change_text: n.change, excerpt: n.excerpt, sources: n.sources, links: n.links, updated_by: by, is_deleted: false })),
              { onConflict: "kr_id,note_key" },
            )
            .select("id,note_key"),
        );
        for (const n of saved ?? []) noteIds.set(n.note_key, n.id);
      }
      const claimRows = c.claims.flatMap((x) => {
        const noteId = noteIds.get(x.noteKey);
        return noteId ? [{ note_id: noteId, task_id: x.taskId, member_id: x.memberId, status: "pending", updated_by: by }] : [];
      });
      if (claimRows.length > 0) {
        await must(supabase.from("okr_outcome_claims").upsert(claimRows, { onConflict: "note_id,task_id,member_id", ignoreDuplicates: true }));
      }
    },

    async saveResource({ groupId, viewerId, checkin, resource }) {
      if (!groupId) throw new Error("部署が選ばれていないため、資料の読み取り結果を保存できません");
      // 回がまだ無ければ未確定の回として作る（あれば何もしない。確定した人・日時は saveConfirm が書く）
      await must(
        supabase
          .from("okr_checkins")
          .upsert({ id: checkin.id, group_id: groupId, checkin_date: checkin.date, title: checkin.title, updated_by: viewerId }, { onConflict: "id", ignoreDuplicates: true }),
      );
      await must(
        supabase.from("okr_resources").insert({ id: resource.id, checkin_id: checkin.id, file_name: resource.name, kind: resource.kind, reading: readingOf(resource), updated_by: viewerId }),
      );
    },

    async saveLock(l) {
      if (!l.groupId) throw new Error("部署が選ばれていないため、確定を保存できません");
      await must(
        supabase.from("okr_tf_locks").upsert(
          {
            group_id: l.groupId,
            fiscal_year: l.year,
            quarter: l.quarter,
            locked_on: l.lockedOn,
            locked_by: l.viewerId,
            snapshot: l.snapshot.map((i) => ({ id: i.id, kind: i.kind, parentId: i.parentId, label: i.label, text: i.text })),
            updated_by: l.viewerId,
            ...deletedCols(false, l.viewerId),
          },
          { onConflict: "group_id,fiscal_year,quarter" },
        ),
      );
    },

    async saveKrDef(krId: string, def: KrDef, hint: HintDef | null, viewerId: string) {
      const meta = defMeta.get(krId);
      const row = {
        id: meta?.id ?? crypto.randomUUID(),
        kr_id: krId,
        bands: def.bands,
        evidence: def.evidence,
        hint_unit: hint?.unit ?? null,
        hint_start: hint?.start ?? null,
        hint_target: hint?.target ?? null,
        hint_direction: hint?.direction ?? null,
        updated_by: viewerId,
      };
      let updatedAt: string;
      try {
        updatedAt = await saveWithLock("okr_kr_defs", row, meta?.updatedAt);
      } catch (e) {
        // 2人がほぼ同時に初めて作った（kr_id の一意制約）・先に直された（楽観ロック）＝競合。読み直して最新を返す
        if (!isUniqueViolation(e) && !(e instanceof ConflictError)) throw e;
        const fresh = await must<KrDefRow>(
          supabase.from("okr_kr_defs").select("id,kr_id,bands,evidence,hint_unit,hint_start,hint_target,hint_direction,updated_at").eq("kr_id", krId).maybeSingle(),
        );
        if (!fresh) throw e;
        defMeta.set(krId, { id: fresh.id, updatedAt: fresh.updated_at });
        throw new KrDefConflictError(krId, { bands: asBands(fresh.bands), evidence: fresh.evidence ?? "" }, hintDefOf(fresh));
      }
      defMeta.set(krId, { id: row.id, updatedAt });
    },
  };
}
