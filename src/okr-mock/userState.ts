// 人ごとの状態（つなぎ先の変更・提案の採否・「どう効くか」・個人OKRのつなぎ・振り返り・今週やる）。
// 「本人」＝いま見ている人。すべて利用者IDごとに分け、他の人の分は読まない・書かない。
import { personalLinksInit, picksInit } from "./fixtures";
import { answerKey, howKey } from "./logic";
import type { KrAnswer, Task } from "./types";

export interface UserState {
  /** つなぎ先を変えた仕事（仕事ID → KR ID） */
  overrides: Record<string, string>;
  /** AIの提案の採否（仕事ID） */
  proposals: Record<string, "taken" | "skipped">;
  /** どう効くか（仕事×KR → 一言） */
  how: Record<string, string>;
  personalLinks: { personalId: string; krId: string }[];
  /** 週の振り返りの答え（週×KR） */
  answers: Record<string, KrAnswer>;
  /** 「今週やる」と選んだ仕事（週の月曜 → 仕事ID） */
  picks: Record<string, string[]>;
}

export type UserStates = Record<string, UserState>;

export const emptyUser = (): UserState => ({ overrides: {}, proposals: {}, how: {}, personalLinks: [], answers: {}, picks: {} });

export function userOf(s: UserStates, id: string): UserState {
  return s[id] ?? emptyUser();
}

export function initialUserStates(weekStart: string): UserStates {
  const out: UserStates = {};
  for (const id of new Set([...Object.keys(personalLinksInit), ...Object.keys(picksInit)])) {
    out[id] = { ...emptyUser(), personalLinks: personalLinksInit[id] ?? [], picks: picksInit[id] ? { [weekStart]: picksInit[id] } : {} };
  }
  return out;
}

function patch(s: UserStates, id: string, fn: (u: UserState) => UserState): UserStates {
  const cur = userOf(s, id);
  const next = fn(cur);
  return next === cur ? s : { ...s, [id]: next };
}

/** 全員分のつなぎ先の変更をまとめたもの（図は全員の仕事を描くので、全員分を使う） */
export function mergedOverrides(s: UserStates): Record<string, string> {
  return Object.assign({}, ...Object.values(s).map((u) => u.overrides));
}

/**
 * つなぎ先を変える／もとに戻す（krId を渡さない）。担当者本人だけが変えられる。
 * つなぎ先が変わると、その仕事の「どう効くか」は消す。もとに戻すと、採った提案の記録も戻す
 */
export function setOverride(s: UserStates, userId: string, task: Task, krId: string | undefined): UserStates {
  if (task.assigneeId !== userId) return s;
  return patch(s, userId, (u) => {
    if (u.overrides[task.id] === krId) return u;
    const overrides = { ...u.overrides };
    if (krId) overrides[task.id] = krId;
    else delete overrides[task.id];
    const how = Object.fromEntries(Object.entries(u.how).filter(([k]) => !k.startsWith(`${task.id}|`)));
    const proposals = { ...u.proposals };
    if (!krId && proposals[task.id] === "taken") delete proposals[task.id];
    return { ...u, overrides, how, proposals };
  });
}

/** AIの提案を採る＝つなぎ先を変えて、採った記録を残す */
export function takeProposal(s: UserStates, userId: string, task: Task, krId: string): UserStates {
  if (task.assigneeId !== userId) return s;
  const moved = setOverride(s, userId, task, krId);
  return patch(moved, userId, (u) => ({ ...u, proposals: { ...u.proposals, [task.id]: "taken" } }));
}

export function setProposal(s: UserStates, userId: string, taskId: string, v: "skipped" | undefined): UserStates {
  return patch(s, userId, (u) => {
    const proposals = { ...u.proposals };
    if (v) proposals[taskId] = v;
    else delete proposals[taskId];
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
