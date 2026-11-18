// 人ごとの状態（つなぎ先の変更・提案の採否・「どう役立つか」・個人OKRのつなぎ・振り返り・今週やる）。
// 「本人」＝いま見ている人。すべて利用者IDごとに分け、他の人の分は読まない・書かない。
import { overridesInit, personalLinksInit, picksInit, userRecordsInit } from "./dataset";
import { answerKey, howKey, isAssignee } from "./logic";
import type { ClaimStatus, KrAnswer, OutcomeNote, Task } from "./types";

export interface UserState {
  /** つなぎ先を選んだ仕事（仕事ID → KR IDの集合）。空＝どのKRにもつながない */
  overrides: Record<string, string[]>;
  /** AIの提案の採否（仕事×KR。proposalKey） */
  proposals: Record<string, "taken" | "skipped">;
  /** どう役立つか（仕事×KR → 一言） */
  how: Record<string, string>;
  personalLinks: { personalId: string; krId: string }[];
  /** 週の振り返りの答え（週×KR） */
  answers: Record<string, KrAnswer>;
  /** 「今週やる」と選んだ仕事（週の月曜 → 仕事ID） */
  picks: Record<string, string[]>;
  /** 資料の記述と自分の仕事の結びつき（claimKey → 答え）。AIが推定して届けたもの。本人の答えは本人の分だけに持つ */
  claims: Record<string, ClaimStatus>;
}

export type UserStates = Record<string, UserState>;

export const emptyUser = (): UserState => ({ overrides: {}, proposals: {}, how: {}, personalLinks: [], answers: {}, picks: {}, claims: {} });

export function userOf(s: UserStates, id: string): UserState {
  return s[id] ?? emptyUser();
}

export function initialUserStates(weekStart: string): UserStates {
  const out: UserStates = {};
  for (const id of new Set([...Object.keys(personalLinksInit), ...Object.keys(picksInit), ...Object.keys(overridesInit), ...Object.keys(userRecordsInit)])) {
    const r = userRecordsInit[id] ?? {};
    out[id] = {
      ...emptyUser(),
      personalLinks: personalLinksInit[id] ?? [],
      picks: picksInit[id] ? { [weekStart]: picksInit[id] } : {},
      overrides: { ...(overridesInit[id] ?? {}) },
      how: { ...(r.how ?? {}) },
      proposals: { ...(r.proposals ?? {}) },
      answers: { ...(r.answers ?? {}) },
      claims: { ...(r.claims ?? {}) },
    };
  }
  return out;
}

function patch(s: UserStates, id: string, fn: (u: UserState) => UserState): UserStates {
  const cur = userOf(s, id);
  const next = fn(cur);
  return next === cur ? s : { ...s, [id]: next };
}

/** 本人の状態を保存するときの、項目 → 表の名前（保存に失敗した表を利用者に知らせる・戻すときの対応） */
export const USER_TABLE_LABEL = {
  overrides: "仕事のつなぎ先",
  proposals: "提案の採否",
  how: "どう役立つか",
  personalLinks: "個人OKRの矢印",
  answers: "振り返りの答え",
  picks: "今週やる仕事",
  claims: "結びつきへの答え",
} as const satisfies Record<keyof UserState, string>;

export type UserField = keyof typeof USER_TABLE_LABEL;
export const USER_FIELDS = Object.keys(USER_TABLE_LABEL) as UserField[];

/** 表の名前 → 項目（失敗した表の名前から、戻す項目を決める） */
export function fieldsOfLabels(labels: string[]): UserField[] {
  return USER_FIELDS.filter((f) => labels.includes(USER_TABLE_LABEL[f]));
}

/**
 * 保存に失敗した項目を、保存済みの状態に戻す。つなぎ先は仕事1件1行で全員分に分かれているので全員分を戻し、
 * それ以外は本人の分だけ戻す
 */
export function revertUserFields(cur: UserStates, saved: UserStates, fields: UserField[], viewerId: string): UserStates {
  if (fields.length === 0) return cur;
  let out = cur;
  if (fields.includes("overrides")) {
    for (const id of new Set([...Object.keys(cur), ...Object.keys(saved)])) out = patch(out, id, (u) => ({ ...u, overrides: { ...userOf(saved, id).overrides } }));
  }
  const own = fields.filter((f) => f !== "overrides");
  if (own.length > 0) {
    const from = userOf(saved, viewerId);
    out = patch(out, viewerId, (u) => {
      const next: UserState = { ...u };
      for (const f of own) (next as Record<UserField, unknown>)[f] = from[f];
      return next;
    });
  }
  return out;
}

/** 全員分のつなぎ先の変更をまとめたもの（図は全員の仕事を描くので、全員分を使う） */
export function mergedOverrides(s: UserStates): Record<string, string[]> {
  return Object.assign({}, ...Object.values(s).map((u) => u.overrides));
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((k) => b.includes(k));

/** 提案の持ち方：仕事×KR（候補が複数あるとき、1件ずつ採る・見送る） */
export const proposalKey = (taskId: string, krId: string) => `${taskId}|${krId}`;

/**
 * つなぎ先を選び直す（krIds＝選んだKRの集合。空配列＝どのKRにもつながない）／もとに戻す（krIds を渡さない）。担当者本人だけが変えられる。
 * defaultKrs はその仕事の既定のつなぎ先（もとに戻すと、これになる）。
 * つなぎ先から外れたKRの「どう役立つか」と、採った提案の記録だけを消す（残したKRの答えは消さない）
 */
export function setOverride(s: UserStates, userId: string, task: Task, krIds: string[] | undefined, defaultKrs: string[]): UserStates {
  if (!isAssignee(task, userId)) return s;
  // つなぎ先は仕事1件につき1つ（保存も1行）。副担当が選び直したら、他の担当者の手元の分は外す
  const current = mergedOverrides(s)[task.id];
  let base = s;
  for (const [id, u] of Object.entries(s)) {
    if (id === userId || u.overrides[task.id] === undefined) continue;
    const overrides = { ...u.overrides };
    delete overrides[task.id];
    base = { ...base, [id]: { ...u, overrides } };
  }
  return patch(base, userId, (u) => {
    const before = current ?? defaultKrs;
    const after = krIds ?? defaultKrs;
    if (krIds === undefined ? u.overrides[task.id] === undefined : u.overrides[task.id] !== undefined && sameSet(u.overrides[task.id], krIds)) return u;
    const overrides = { ...u.overrides };
    if (krIds) overrides[task.id] = [...new Set(krIds)];
    else delete overrides[task.id];
    const gone = (key: string) => before.includes(key.split("|")[1]) && !after.includes(key.split("|")[1]);
    const how = Object.fromEntries(Object.entries(u.how).filter(([k]) => !(k.startsWith(`${task.id}|`) && gone(k))));
    const proposals = Object.fromEntries(Object.entries(u.proposals).filter(([k, v]) => !(k.startsWith(`${task.id}|`) && v === "taken" && !after.includes(k.split("|")[1]))));
    return { ...u, overrides, how, proposals };
  });
}

/** AIの提案を1件採る＝いまのつなぎ先に足して（置き換えない）、採った記録を残す */
export function takeProposal(s: UserStates, userId: string, task: Task, krId: string, currentKrs: string[], defaultKrs: string[]): UserStates {
  if (!isAssignee(task, userId)) return s;
  const moved = setOverride(s, userId, task, [...currentKrs.filter((k) => k !== krId), krId], defaultKrs);
  return patch(moved, userId, (u) => {
    const proposals = { ...u.proposals, [proposalKey(task.id, krId)]: "taken" as const };
    return { ...u, proposals };
  });
}

export function setProposal(s: UserStates, userId: string, taskId: string, krId: string, v: "skipped" | undefined): UserStates {
  return patch(s, userId, (u) => {
    const proposals = { ...u.proposals };
    const key = proposalKey(taskId, krId);
    if (v) proposals[key] = v;
    else delete proposals[key];
    return { ...u, proposals };
  });
}

export function setHow(s: UserStates, userId: string, taskId: string, krId: string, text: string | undefined): UserStates {
  return patch(s, userId, (u) => {
    const how = { ...u.how };
    if (text) how[howKey(taskId, krId)] = text;
    else delete how[howKey(taskId, krId)];
    return { ...u, how };
  });
}

export function toggleLink(s: UserStates, userId: string, personalId: string, krId: string): UserStates {
  return patch(s, userId, (u) => ({
    ...u,
    personalLinks: u.personalLinks.some((l) => l.personalId === personalId && l.krId === krId)
      ? u.personalLinks.filter((l) => !(l.personalId === personalId && l.krId === krId))
      : [...u.personalLinks, { personalId, krId }],
  }));
}

export function setAnswer(s: UserStates, userId: string, weekStart: string, krId: string, p: KrAnswer): UserStates {
  const key = answerKey(weekStart, krId);
  return patch(s, userId, (u) => ({ ...u, answers: { ...u.answers, [key]: { ...u.answers[key], ...p } } }));
}

/** 「今週やる」の印を付け外しする。本人の仕事だけ */
export function togglePick(s: UserStates, userId: string, weekStart: string, task: Task): UserStates {
  if (!isAssignee(task, userId)) return s;
  return patch(s, userId, (u) => {
    const cur = u.picks[weekStart] ?? [];
    return { ...u, picks: { ...u.picks, [weekStart]: cur.includes(task.id) ? cur.filter((x) => x !== task.id) : [...cur, task.id] } };
  });
}

export const claimKey = (noteKey: string, taskId: string) => `${noteKey}|${taskId}`;

/** 仕事の担当者全員（主担当が先頭） */
export const assigneesOf = (t: Task): string[] => [...new Set([t.assigneeId, ...(t.assigneeIds ?? [])])];

/**
 * 確定した成果の記述の結びつきを、仕事の担当者本人へ「確かめてください」として届ける。
 * すでに答えがあるものは上書きしない（同じ資料をもう一度確定しても、答えは消えない）
 */
export function deliverClaims(s: UserStates, notes: OutcomeNote[], tasks: Task[]): UserStates {
  let out = s;
  for (const n of notes) {
    for (const l of n.links) {
      const t = tasks.find((x) => x.id === l.taskId);
      if (!t) continue;
      const key = claimKey(n.key, t.id);
      for (const who of assigneesOf(t)) out = patch(out, who, (u) => (u.claims[key] ? u : { ...u, claims: { ...u.claims, [key]: "pending" } }));
    }
  }
  return out;
}

/** 結びつきへの答え（そのとおり／違う）。担当者本人だけが、自分に届いたものについて答えられる */
export function answerClaim(s: UserStates, userId: string, task: Task, noteKey: string, v: "yes" | "no"): UserStates {
  if (!isAssignee(task, userId)) return s;
  const key = claimKey(noteKey, task.id);
  return patch(s, userId, (u) => (!u.claims[key] || u.claims[key] === v ? u : { ...u, claims: { ...u.claims, [key]: v } }));
}

export interface ConfirmedLink {
  note: OutcomeNote;
  task: Task;
}

/** 「そのとおり」と答えられた結びつき（全員に見える。担当者のだれか1人が答えればよい）。未回答と「違う」は含めない */
export function confirmedLinks(s: UserStates, notes: OutcomeNote[], tasks: Task[]): ConfirmedLink[] {
  const out: ConfirmedLink[] = [];
  for (const n of notes) {
    for (const l of n.links) {
      const t = tasks.find((x) => x.id === l.taskId);
      if (t && assigneesOf(t).some((who) => userOf(s, who).claims[claimKey(n.key, t.id)] === "yes")) out.push({ note: n, task: t });
    }
  }
  return out;
}

/** 本人にまだ答えていない結びつきが何件あるか */
export function pendingClaimCount(u: UserState): number {
  return Object.values(u.claims).filter((v) => v === "pending").length;
}

/**
 * 保存に渡す、本人の状態の前後。つなぎ先は仕事1件1行なので、全員分を足し合わせたもので比べる
 * （副担当が既定に戻したとき、変化が他の担当者の分にだけ現れても拾えるように）
 */
export function viewerChange(prev: UserStates, next: UserStates, viewerId: string): [UserState, UserState] {
  return [
    { ...userOf(prev, viewerId), overrides: mergedOverrides(prev) },
    { ...userOf(next, viewerId), overrides: mergedOverrides(next) },
  ];
}
