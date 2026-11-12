// 人ごとの状態（つなぎ先の変更・提案の採否・「どう効くか」・個人OKRのつなぎ・振り返り・今週やる）。
// 「本人」＝いま見ている人。すべて利用者IDごとに分け、他の人の分は読まない・書かない。
import { overridesInit, personalLinksInit, picksInit } from "./fixtures";
import { answerKey, howKey } from "./logic";
import type { ClaimStatus, KrAnswer, OutcomeNote, Task } from "./types";

export interface UserState {
  /** つなぎ先を選んだ仕事（仕事ID → KR IDの集合）。空＝どのKRにもつながない */
  overrides: Record<string, string[]>;
  /** AIの提案の採否（仕事×KR。proposalKey） */
  proposals: Record<string, "taken" | "skipped">;
  /** どう効くか（仕事×KR → 一言） */
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
  for (const id of new Set([...Object.keys(personalLinksInit), ...Object.keys(picksInit), ...Object.keys(overridesInit)])) {
    out[id] = { ...emptyUser(), personalLinks: personalLinksInit[id] ?? [], picks: picksInit[id] ? { [weekStart]: picksInit[id] } : {}, overrides: { ...(overridesInit[id] ?? {}) } };
  }
  return out;
}

function patch(s: UserStates, id: string, fn: (u: UserState) => UserState): UserStates {
  const cur = userOf(s, id);
  const next = fn(cur);
  return next === cur ? s : { ...s, [id]: next };
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
 * つなぎ先から外れたKRの「どう効くか」と、採った提案の記録だけを消す（残したKRの答えは消さない）
 */
export function setOverride(s: UserStates, userId: string, task: Task, krIds: string[] | undefined, defaultKrs: string[]): UserStates {
  if (task.assigneeId !== userId) return s;
  return patch(s, userId, (u) => {
    const before = u.overrides[task.id] ?? defaultKrs;
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
  if (task.assigneeId !== userId) return s;
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
  if (task.assigneeId !== userId) return s;
  return patch(s, userId, (u) => {
    const cur = u.picks[weekStart] ?? [];
    return { ...u, picks: { ...u.picks, [weekStart]: cur.includes(task.id) ? cur.filter((x) => x !== task.id) : [...cur, task.id] } };
  });
}

export const claimKey = (noteKey: string, taskId: string) => `${noteKey}|${taskId}`;

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
      out = patch(out, t.assigneeId, (u) => (u.claims[key] ? u : { ...u, claims: { ...u.claims, [key]: "pending" } }));
    }
  }
  return out;
}

/** 結びつきへの答え（そのとおり／違う）。担当者本人だけが、自分に届いたものについて答えられる */
export function answerClaim(s: UserStates, userId: string, task: Task, noteKey: string, v: "yes" | "no"): UserStates {
  if (task.assigneeId !== userId) return s;
  const key = claimKey(noteKey, task.id);
  return patch(s, userId, (u) => (!u.claims[key] || u.claims[key] === v ? u : { ...u, claims: { ...u.claims, [key]: v } }));
}

export interface ConfirmedLink {
  note: OutcomeNote;
  task: Task;
}

/** 「そのとおり」と答えられた結びつき（全員に見える）。未回答と「違う」は含めない */
export function confirmedLinks(s: UserStates, notes: OutcomeNote[], tasks: Task[]): ConfirmedLink[] {
  const out: ConfirmedLink[] = [];
  for (const n of notes) {
    for (const l of n.links) {
      const t = tasks.find((x) => x.id === l.taskId);
      if (t && userOf(s, t.assigneeId).claims[claimKey(n.key, t.id)] === "yes") out.push({ note: n, task: t });
    }
  }
  return out;
}

/** 本人にまだ答えていない結びつきが何件あるか */
export function pendingClaimCount(u: UserState): number {
  return Object.values(u.claims).filter((v) => v === "pending").length;
}
