// 地図の画面が読むデータの置き場。
// モックでは各部品が fixtures（架空データ）の定数を直接 import していた。本番では同じ名前を
// ここから import し、MockProvider が描画のたびに setActiveData() で中身を差し替える（ES モジュールの
// export let は読み手から常に最新の値が見える）。部品の呼び出し箇所（約100か所）を書き換えずに
// 実データへ切り替えるための形で、地図は同時に1つしか描かない前提に立つ。
import { krStyleAt } from "./palette";
import type { OkrMapLock, OkrMapRecords, UserRecord } from "./repository";
import type { History } from "./reach";
import type { AiCandidate, AssessEntry, Checkin, Decision, KintoneRow, KrBands, KrDef, KrRecord, Learning, Member, OkrItem, PastWeek, PersonalOkr, Pj, Quarter, Resource, Task } from "./types";

export interface QuarterInfo {
  quarter: Quarter;
  /** 例：10月〜12月 */
  range: string;
  ended: boolean;
}

/** 本番の表から作る部分（adapter.ts が作る） */
export interface OkrMapCore {
  /** 表示部署（記録の保存先）。部署が無いときは null */
  groupId: string | null;
  today: string;
  /** 今週の月曜 */
  weekStart: string;
  periodName: string;
  periodStart: string;
  periodEnd: string;
  currentQuarter: QuarterInfo;
  /** 同じ半期の前の四半期（あれば）。O・KRの取り込みの画面で読み取り専用で見せる */
  prevQuarter: { info: QuarterInfo; items: OkrItem[] } | null;
  members: Member[];
  /** O・KR・今期のTF */
  items: OkrItem[];
  pjs: Pj[];
  tasks: Task[];
  /** 本人（ログイン中の人） */
  viewerId: string;
  objectiveWhy: string;
}

export interface OkrMapData extends OkrMapCore, OkrMapRecords {
  /** 次に資料を確定したときに加わる回 */
  nextCheckin: Checkin;
  /** 架空データで動かすとき（テスト）だけ true。デモ用の操作を出す */
  demo?: boolean;
  /** 利用の広がりを確かめるテストで「一部のPJだけ登録」に使うPJ */
  reachPjIds?: string[];
  /** 記録を読み直した回数（本番）。変わったら、読み直した記録を画面の状態に足し込む（地図を作り直さない） */
  recordsGen?: number;
}

/** 図に出すPJの名前（PJに属さない個人の仕事は1つのまとまりにする） */
export const PERSONAL_NAME = "個人の仕事（PJなし）";
/** 本人の分を帯の中で見せる色（KRの色とも、他の人の色とも重ならない） */
export const MINE_COLOR = "#c2338a";

export let TODAY = "";
export let WEEK_START = "";
export let PERIOD_NAME = "";
export let PERIOD_START = "";
export let PERIOD_END = "";
export let CURRENT_QUARTER: QuarterInfo = { quarter: "1Q", range: "", ended: false };
export let PREV_QUARTER: OkrMapCore["prevQuarter"] = null;
export let LOCK: OkrMapLock = { locked: false, lockedAt: null };
export let members: Member[] = [];
export let okrItems: OkrItem[] = [];
export let pjsInit: Pj[] = [];
export let tasks: Task[] = [];
export let DEFAULT_VIEWER = "";
export let OBJECTIVE_WHY = "";
export let krDefs: Record<string, KrDef> = {};
export let krBands: Record<string, KrBands> = {};
export let recordsInit: Record<string, KrRecord> = {};
export let historyInit: History = {};
export let assessInit: Record<string, AssessEntry[]> = {};
export let learningsInit: Learning[] = [];
export let checkinsInit: Checkin[] = [];
export let decisionsInit: Decision[] = [];
export let resources: Resource[] = [];
export let nextCheckin: Checkin = { id: "next", date: "", title: "" };
export let kintoneRows: KintoneRow[] | null = null;
export let pastWeeks: Record<string, PastWeek[]> = {};
export let overridesInit: Record<string, Record<string, string[]>> = {};
export let personalLinksInit: Record<string, { personalId: string; krId: string }[]> = {};
export let picksInit: Record<string, string[]> = {};
export let userRecordsInit: Record<string, UserRecord> = {};
export let personalOkrs: PersonalOkr[] = [];
export let aiCandidates: Record<string, AiCandidate[]> = {};
export let howOptions: Record<string, string[]> = {};
export let DEMO = false;
export let REACH_PJ_IDS: string[] = [];

let krOrder: string[] = [];
let active: OkrMapData | null = null;

/** KRの並び順から、色と模様の番号を決める */
export function krStyle(krId: string): { color: string; pattern: number } {
  return krStyleAt(Math.max(0, krOrder.indexOf(krId)));
}

export function activeData(): OkrMapData | null {
  return active;
}

export function setActiveData(d: OkrMapData): void {
  if (active === d) return;
  active = d;
  TODAY = d.today;
  WEEK_START = d.weekStart;
  PERIOD_NAME = d.periodName;
  PERIOD_START = d.periodStart;
  PERIOD_END = d.periodEnd;
  CURRENT_QUARTER = d.currentQuarter;
  PREV_QUARTER = d.prevQuarter;
  LOCK = d.lock;
  members = d.members;
  okrItems = d.items;
  pjsInit = d.pjs;
  tasks = d.tasks;
  DEFAULT_VIEWER = d.viewerId;
  OBJECTIVE_WHY = d.objectiveWhy;
  krDefs = d.krDefs;
  krBands = Object.fromEntries(Object.entries(d.krDefs).map(([k, v]) => [k, v.bands]));
  recordsInit = d.records;
  historyInit = d.history;
  assessInit = d.assess;
  learningsInit = d.learnings;
  checkinsInit = d.checkins;
  decisionsInit = d.decisions;
  resources = d.resources;
  nextCheckin = d.nextCheckin;
  kintoneRows = d.kintoneRows;
  pastWeeks = d.pastWeeks;
  overridesInit = d.overrides;
  personalLinksInit = d.personalLinks;
  picksInit = d.picks;
  userRecordsInit = d.userRecords ?? {};
  personalOkrs = d.personalOkrs;
  aiCandidates = d.aiCandidates;
  howOptions = d.howOptions;
  DEMO = d.demo === true;
  REACH_PJ_IDS = d.reachPjIds ?? [];
  krOrder = d.items.filter((i) => i.kind === "kr").map((i) => i.id);
}
