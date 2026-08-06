// src/lib/demo/dataset.ts
//
// 【設計意図】
// ゲスト（サンプル閲覧）モード用の架空データ本体。実在の顧客名・PJ名・人名は一切使わない
// （架空の業務シナリオ：社内システム更新・展示会運営・マニュアル整備・新人研修・オフィス移転・
// 社内報リニューアル）。既存の docs/ やテストデータの実PJ名は参照していない。
//
// 【この2点は機械的にテストする（__tests__/dataset.test.ts）】
// 1. 全エンティティの id は "demo-" 接頭辞、group_id は DEMO_GROUP_ID（"grp-demo"）に統一する。
// 2. このファイルは動的import（../loadDemoDataset.ts の import("./dataset")）経由でのみ
//    読み込む。他のファイルから静的importしないこと（Section 19：ダウンロード量の最小化。
//    通常利用者はこのファイルを一切ダウンロードしない）。
//
// 日付は todayStr() 基準の相対オフセット（addDaysFromToday）で生成する。固定日付にすると
// 時間が経つと「全部期限超過」の不自然なデータになるため。

import { addDaysFromToday } from "../date";
import type {
  Member, Project, Task, Objective, KeyResult, TaskForce, ToDo, TaskDependency, Milestone,
} from "../localData/types";
import { DEMO_GROUP_ID, GUEST_ASSIGNED_TASK_IDS } from "./constants";
import type { DemoDataset } from "./types";

// ===== メンバー（5名。架空の氏名） =====

const M = {
  tamaki: "demo-member-1", // 佐藤 環
  riku:   "demo-member-2", // 鈴木 陸
  mei:    "demo-member-3", // 高橋 芽衣
  yuto:   "demo-member-4", // 田中 悠人
  sakura: "demo-member-5", // 中村 さくら
} as const;

function buildMembers(): Member[] {
  return [
    { id: M.tamaki, display_name: "佐藤 環",   short_name: "環",     initials: "ST", teams_account: "", color_bg: "#6366f1", color_text: "#ffffff", is_deleted: false, group_id: DEMO_GROUP_ID },
    { id: M.riku,   display_name: "鈴木 陸",   short_name: "陸",     initials: "SR", teams_account: "", color_bg: "#0ea5e9", color_text: "#ffffff", is_deleted: false, group_id: DEMO_GROUP_ID },
    { id: M.mei,    display_name: "高橋 芽衣", short_name: "芽衣",   initials: "TM", teams_account: "", color_bg: "#f59e0b", color_text: "#ffffff", is_deleted: false, group_id: DEMO_GROUP_ID },
    { id: M.yuto,   display_name: "田中 悠人", short_name: "悠人",   initials: "TY", teams_account: "", color_bg: "#10b981", color_text: "#ffffff", is_deleted: false, group_id: DEMO_GROUP_ID },
    { id: M.sakura, display_name: "中村 さくら", short_name: "さくら", initials: "NS", teams_account: "", color_bg: "#ec4899", color_text: "#ffffff", is_deleted: false, group_id: DEMO_GROUP_ID },
  ];
}

// ===== プロジェクト（6件。一般的な業務シナリオ） =====

const P = {
  system:   "demo-proj-1", // 社内システム更新プロジェクト
  expo:     "demo-proj-2", // 秋季展示会 出展準備
  manual:   "demo-proj-3", // 業務マニュアル整備プロジェクト
  training: "demo-proj-4", // 新人研修プログラム設計
  office:   "demo-proj-5", // オフィス移転プロジェクト（完了済）
  news:     "demo-proj-6", // 社内報リニューアル
} as const;

interface ProjectInput {
  id: string; name: string; purpose: string; contributionMemo?: string;
  owner: string; members: string[]; status: Project["status"]; color: string;
  start: number; end: number;
}

function mkProject(i: ProjectInput): Project {
  return {
    id: i.id,
    name: i.name,
    purpose: i.purpose,
    contribution_memo: i.contributionMemo ?? "",
    owner_member_id: i.owner,
    owner_member_ids: [i.owner],
    member_ids: i.members,
    status: i.status,
    color_tag: i.color,
    start_date: addDaysFromToday(i.start),
    end_date: addDaysFromToday(i.end),
    is_deleted: false,
    group_id: DEMO_GROUP_ID,
  };
}

function buildProjects(): Project[] {
  return [
    mkProject({
      id: P.system, name: "社内システム更新プロジェクト",
      purpose: "老朽化した基幹システムを刷新し、入力ミスと二重登録を減らす",
      contributionMemo: "業務効率化KRの中核プロジェクト",
      owner: M.tamaki, members: [M.tamaki, M.riku, M.mei], status: "active",
      color: "#6366f1", start: -60, end: 90,
    }),
    mkProject({
      id: P.expo, name: "秋季展示会 出展準備",
      purpose: "自社ブースの出展を計画的に準備し、当日の運営品質を高める",
      contributionMemo: "対外接点強化KRに貢献",
      owner: M.mei, members: [M.mei, M.riku, M.yuto], status: "active",
      color: "#f59e0b", start: -20, end: 40,
    }),
    mkProject({
      id: P.manual, name: "業務マニュアル整備プロジェクト",
      purpose: "属人化した業務手順を文書化し、引継ぎコストを下げる",
      contributionMemo: "業務マニュアル整備率KRに貢献",
      owner: M.yuto, members: [M.yuto, M.sakura], status: "active",
      color: "#10b981", start: -40, end: 20,
    }),
    mkProject({
      id: P.training, name: "新人研修プログラム設計",
      purpose: "来期入社メンバー向けの研修カリキュラムを設計する",
      contributionMemo: "業務マニュアル整備率KRに貢献",
      owner: M.sakura, members: [M.sakura, M.tamaki], status: "active",
      color: "#ec4899", start: -10, end: 75,
    }),
    mkProject({
      id: P.office, name: "オフィス移転プロジェクト",
      purpose: "本社移転に伴う座席・備品・ネットワークの移行を完了させる",
      owner: M.riku, members: [M.riku, M.tamaki, M.mei, M.yuto, M.sakura], status: "completed",
      color: "#8b5cf6", start: -120, end: -10,
    }),
    mkProject({
      id: P.news, name: "社内報リニューアル",
      purpose: "月次社内報のフォーマットを見直し、読了率を上げる",
      owner: M.tamaki, members: [M.tamaki, M.sakura], status: "active",
      color: "#14b8a6", start: -5, end: 50,
    }),
  ];
}

// ===== OKR（Objective 1件 → KR 3件 → TF 4件 → ToDo 5件） =====

const OBJ_ID = "demo-obj-1";
const KR = { errorRate: "demo-kr-1", expoLeads: "demo-kr-2", manualCoverage: "demo-kr-3" } as const;
const TF = { system: "demo-tf-1", expo: "demo-tf-2", manual: "demo-tf-3", training: "demo-tf-4" } as const;
const TODO = {
  currentIssues: "demo-todo-1", newRequirements: "demo-todo-2",
  boothLayout: "demo-todo-3", manualTemplate: "demo-todo-4", trainingOutline: "demo-todo-5",
} as const;

function buildObjective(): Objective {
  return {
    id: OBJ_ID,
    title: "サンプル事業部 2026年度下期目標",
    purpose: "全社の業務効率化と対外接点の強化を進める（サンプルデータです）",
    background: "これはゲスト向けサンプルデータです。実際の会議・決定内容ではありません。",
    period: "2026年度下期",
    is_current: true,
    group_id: DEMO_GROUP_ID,
  };
}

function buildKeyResults(): KeyResult[] {
  return [
    { id: KR.errorRate,      objective_id: OBJ_ID, title: "基幹システムの入力エラー率を50%削減する", is_deleted: false },
    { id: KR.expoLeads,      objective_id: OBJ_ID, title: "展示会経由の商談数を前年比1.5倍にする",       is_deleted: false },
    { id: KR.manualCoverage, objective_id: OBJ_ID, title: "全部署の業務マニュアル整備率を80%にする",     is_deleted: false },
  ];
}

function buildTaskForces(): TaskForce[] {
  return [
    { id: TF.system,   kr_id: KR.errorRate,      tf_number: "1", name: "基幹システム更新TF", leader_member_id: M.tamaki, is_deleted: false },
    { id: TF.expo,     kr_id: KR.expoLeads,      tf_number: "1", name: "展示会運営TF",       leader_member_id: M.mei,    is_deleted: false },
    { id: TF.manual,   kr_id: KR.manualCoverage, tf_number: "1", name: "マニュアル整備TF",   leader_member_id: M.yuto,   is_deleted: false },
    { id: TF.training, kr_id: KR.manualCoverage, tf_number: "2", name: "新人研修TF",         leader_member_id: M.sakura, is_deleted: false },
  ];
}

function buildToDos(): ToDo[] {
  return [
    { id: TODO.currentIssues,    tf_id: TF.system,   title: "現行システムの課題を洗い出す",     due_date: addDaysFromToday(-20), memo: "", is_deleted: false },
    { id: TODO.newRequirements,  tf_id: TF.system,   title: "新システムの要件を確定する",       due_date: addDaysFromToday(10),  memo: "", is_deleted: false },
    { id: TODO.boothLayout,      tf_id: TF.expo,     title: "出展ブースのレイアウトを決める",   due_date: addDaysFromToday(15),  memo: "", is_deleted: false },
    { id: TODO.manualTemplate,   tf_id: TF.manual,   title: "マニュアルのテンプレートを統一する", due_date: addDaysFromToday(5),   memo: "", is_deleted: false },
    { id: TODO.trainingOutline,  tf_id: TF.training, title: "研修カリキュラムの骨子を作る",     due_date: addDaysFromToday(20),  memo: "", is_deleted: false },
  ];
}

// ===== タスク =====

interface TaskInput {
  id: string; name: string; projectId: string | null; assignee: string;
  status: Task["status"]; priority?: Task["priority"];
  start?: number | null; due?: number | null;
  estimatedHours?: number | null; tags?: string[]; comment?: string;
  parentId?: string | null; todoIds?: string[];
  baselineStart?: number | null; baselineDue?: number | null;
}

function mkTask(i: TaskInput): Task {
  return {
    id: i.id,
    name: i.name,
    project_id: i.projectId,
    todo_ids: i.todoIds ?? [],
    assignee_member_id: i.assignee,
    assignee_member_ids: [i.assignee],
    status: i.status,
    priority: i.priority ?? "mid",
    start_date: i.start != null ? addDaysFromToday(i.start) : null,
    due_date: i.due != null ? addDaysFromToday(i.due) : null,
    estimated_hours: i.estimatedHours ?? null,
    comment: i.comment ?? "",
    is_deleted: false,
    group_id: DEMO_GROUP_ID,
    parent_task_id: i.parentId ?? null,
    tags: i.tags ?? [],
    baseline_start_date: i.baselineStart != null ? addDaysFromToday(i.baselineStart) : null,
    baseline_due_date: i.baselineDue != null ? addDaysFromToday(i.baselineDue) : null,
  };
}

/** 依存関係の連鎖ノード（デザイン→開発→テスト→本稼働準備）用の固定id */
const T_DESIGN = "demo-task-3";
const T_DEV = "demo-task-4";
const T_TEST = "demo-task-5";
const T_GOLIVE = "demo-task-6";
const T_REQ = "demo-task-1";
const T_REQDEF = "demo-task-2";

function buildTasks(): Task[] {
  const tasks: Task[] = [
    // ----- PJ1: 社内システム更新（依存関係チェーン＋ベースライン差分） -----
    mkTask({ id: T_REQ, name: "現行システムの課題整理", projectId: P.system, assignee: M.tamaki, status: "done", priority: "high", start: -55, due: -35, tags: ["要件定義"], todoIds: [TODO.currentIssues] }),
    mkTask({ id: T_REQDEF, name: "新システム要件定義", projectId: P.system, assignee: M.tamaki, status: "done", priority: "high", start: -34, due: -20, tags: ["要件定義"], todoIds: [TODO.newRequirements] }),
    mkTask({ id: "demo-task-2a", name: "画面要件のヒアリング", projectId: P.system, assignee: M.riku, status: "done", priority: "mid", start: -34, due: -28, parentId: T_REQDEF }),
    mkTask({ id: "demo-task-2b", name: "データ移行要件の整理", projectId: P.system, assignee: M.mei, status: "done", priority: "mid", start: -30, due: -20, parentId: T_REQDEF }),
    // 当初計画（baseline）より遅延しているタスク：本来 -19〜-5 に終わる予定が +10 まで延びた
    mkTask({ id: T_DESIGN, name: "新システム設計", projectId: P.system, assignee: M.tamaki, status: "in_progress", priority: "high", start: -15, due: 10, tags: ["設計"], baselineStart: -19, baselineDue: -5 }),
    mkTask({ id: T_DEV, name: "開発・実装", projectId: P.system, assignee: M.riku, status: "todo", priority: "high", start: 11, due: 35, tags: ["開発"] }),
    mkTask({ id: T_TEST, name: "テスト", projectId: P.system, assignee: M.mei, status: "todo", priority: "mid", start: 36, due: 55, tags: ["テスト"] }),
    mkTask({ id: T_GOLIVE, name: "本稼働準備", projectId: P.system, assignee: M.tamaki, status: "todo", priority: "mid", start: 56, due: 74 }),
    mkTask({ id: "demo-task-7", name: "旧システム向け手順書作成", projectId: P.system, assignee: M.riku, status: "cancelled", priority: "low", start: -10, due: 10, comment: "方針転換のため中止", tags: ["文書化"] }),
    mkTask({ id: "demo-task-8", name: "ベンダーとの契約更新", projectId: P.system, assignee: M.tamaki, status: "on_hold", priority: "mid", start: 0, due: 20, comment: "予算承認待ちのため一時保留" }),
    mkTask({ id: "demo-task-9", name: "移行データのバックアップ検証", projectId: P.system, assignee: M.mei, status: "todo", priority: "low", start: 20, due: 40 }),

    // ----- PJ2: 秋季展示会（鈴木 陸の過負荷帯を意図的に作る） -----
    mkTask({ id: "demo-task-10", name: "出展コンセプト決定", projectId: P.expo, assignee: M.mei, status: "done", priority: "high", start: -18, due: -10 }),
    mkTask({ id: "demo-task-11", name: "ブースレイアウト決定", projectId: P.expo, assignee: M.mei, status: "in_progress", priority: "high", start: -5, due: 5, todoIds: [TODO.boothLayout] }),
    mkTask({ id: "demo-task-12", name: "配布資料デザイン", projectId: P.expo, assignee: M.riku, status: "in_progress", priority: "mid", start: -2, due: 5, tags: ["展示会"] }),
    mkTask({ id: "demo-task-13", name: "配布資料印刷手配", projectId: P.expo, assignee: M.riku, status: "todo", priority: "mid", start: -1, due: 6, tags: ["展示会"] }),
    mkTask({ id: "demo-task-14", name: "デモ機材準備", projectId: P.expo, assignee: M.riku, status: "todo", priority: "mid", start: -1, due: 7, tags: ["展示会"] }),
    mkTask({ id: "demo-task-15", name: "会場設営スケジュール調整", projectId: P.expo, assignee: M.riku, status: "todo", priority: "mid", start: 0, due: 6, tags: ["展示会"] }),
    mkTask({ id: "demo-task-16", name: "当日シフト表作成", projectId: P.expo, assignee: M.riku, status: "todo", priority: "low", start: 0, due: 8, tags: ["展示会"] }),
    mkTask({ id: "demo-task-17", name: "招待メール送付", projectId: P.expo, assignee: M.yuto, status: "todo", priority: "mid", start: 10, due: 20 }),
    mkTask({ id: "demo-task-18", name: "アンケート集計フォーム作成", projectId: P.expo, assignee: M.yuto, status: "todo", priority: "low", start: 20, due: 34 }),
    mkTask({ id: "demo-task-19", name: "展示会当日運営", projectId: P.expo, assignee: M.mei, status: "todo", priority: "high", start: 35, due: 35 }),
    mkTask({ id: "demo-task-20", name: "フォローアップ営業リスト作成", projectId: P.expo, assignee: M.mei, status: "todo", priority: "mid", start: 36, due: 40 }),

    // ----- PJ3: 業務マニュアル整備 -----
    mkTask({ id: "demo-task-21", name: "既存手順の聞き取り", projectId: P.manual, assignee: M.yuto, status: "done", priority: "mid", start: -38, due: -25 }),
    mkTask({ id: "demo-task-22", name: "テンプレート統一", projectId: P.manual, assignee: M.yuto, status: "in_progress", priority: "mid", start: -10, due: 5, todoIds: [TODO.manualTemplate] }),
    mkTask({ id: "demo-task-23", name: "総務部マニュアル作成", projectId: P.manual, assignee: M.sakura, status: "todo", priority: "mid", start: 0, due: 15, tags: ["文書化"] }),
    mkTask({ id: "demo-task-24", name: "営業部マニュアル作成", projectId: P.manual, assignee: M.sakura, status: "todo", priority: "mid", start: 5, due: 20, tags: ["文書化"] }),
    mkTask({ id: "demo-task-25", name: "特定顧客向けマニュアル追加", projectId: P.manual, assignee: M.yuto, status: "on_hold", priority: "low", start: 0, due: 30, comment: "対象との契約確定待ちのため保留" }),
    mkTask({ id: "demo-task-26", name: "マニュアル公開・周知", projectId: P.manual, assignee: M.yuto, status: "todo", priority: "low", start: 16, due: 20 }),
    // 期限超過（今日より前が期日で、まだ動いている）タスクをあえて残す
    mkTask({ id: "demo-task-27", name: "旧マニュアルの棚卸し", projectId: P.manual, assignee: M.yuto, status: "todo", priority: "mid", start: -10, due: -3, tags: ["文書化"] }),

    // ----- PJ4: 新人研修プログラム設計 -----
    mkTask({ id: "demo-task-28", name: "研修カリキュラム骨子作成", projectId: P.training, assignee: M.sakura, status: "in_progress", priority: "high", start: -8, due: 5, todoIds: [TODO.trainingOutline] }),
    mkTask({ id: "demo-task-29", name: "研修コンテンツのドラフト作成", projectId: null, assignee: M.sakura, status: "todo", priority: "mid", start: 6, due: 25, todoIds: [TODO.trainingOutline] }),
    mkTask({ id: "demo-task-30", name: "講師アサイン", projectId: P.training, assignee: M.tamaki, status: "todo", priority: "mid", start: 6, due: 20 }),
    mkTask({ id: "demo-task-31", name: "研修会場の予約", projectId: P.training, assignee: M.sakura, status: "done", priority: "low", start: -9, due: -3 }),

    // ----- PJ5: オフィス移転（完了済PJ・タスクも大半done） -----
    mkTask({ id: "demo-task-32", name: "新オフィス座席表作成", projectId: P.office, assignee: M.riku, status: "done", priority: "mid", start: -118, due: -100 }),
    mkTask({ id: "demo-task-33", name: "備品リスト確定", projectId: P.office, assignee: M.tamaki, status: "done", priority: "mid", start: -110, due: -80 }),
    mkTask({ id: "demo-task-34", name: "ネットワーク移設", projectId: P.office, assignee: M.mei, status: "done", priority: "high", start: -60, due: -30 }),
    mkTask({ id: "demo-task-35", name: "移転完了報告", projectId: P.office, assignee: M.riku, status: "done", priority: "low", start: -15, due: -10 }),

    // ----- PJ6: 社内報リニューアル -----
    mkTask({ id: "demo-task-36", name: "新フォーマット案作成", projectId: P.news, assignee: M.tamaki, status: "in_progress", priority: "mid", start: -3, due: 7 }),
    // 期限超過その2（別メンバー・別PJでも発生させる）
    mkTask({ id: "demo-task-37", name: "旧フォーマットの課題整理", projectId: P.news, assignee: M.sakura, status: "in_progress", priority: "mid", start: -8, due: -2 }),
    mkTask({ id: "demo-task-38", name: "読者アンケート実施", projectId: P.news, assignee: M.sakura, status: "todo", priority: "low", start: 8, due: 25 }),
    mkTask({ id: "demo-task-39", name: "初号リリース", projectId: P.news, assignee: M.tamaki, status: "todo", priority: "mid", start: 26, due: 45 }),

    // ----- ゲスト自身の担当タスク（マイページ既定ウィジェットを空にしないため。
    //       assignee はここでは他メンバーの placeholder。実際の "ゲスト担当" への
    //       差し替えはランタイム専用の guestPersona.ts が行う（dataset.ts の
    //       出力自体は "demo-" 接頭辞のみで完結させる。id は constants.ts の
    //       GUEST_ASSIGNED_TASK_IDS と一致させ、guestPersona.ts が拾えるようにする） -----
    mkTask({ id: GUEST_ASSIGNED_TASK_IDS[0], name: "社内報の原稿レビュー", projectId: P.news, assignee: M.tamaki, status: "todo", priority: "mid", start: 0, due: 1, estimatedHours: 2 }),
    mkTask({ id: GUEST_ASSIGNED_TASK_IDS[1], name: "システム移行の進捗確認", projectId: P.system, assignee: M.tamaki, status: "in_progress", priority: "mid", start: -1, due: 3, estimatedHours: 3 }),
    mkTask({ id: GUEST_ASSIGNED_TASK_IDS[2], name: "マニュアルの用語チェック", projectId: P.manual, assignee: M.tamaki, status: "todo", priority: "low", start: 2, due: 6, estimatedHours: 1.5 }),
  ];

  // ----- フィラータスク（総件数を60件前後に揃えるための汎用タスク） -----
  const fillerNames = [
    "議事録の作成", "週次報告の整理", "関係部署への共有", "資料の校正",
    "進捗確認ミーティング", "備品の手配", "データ集計", "レビュー会の準備",
    "フォーマット確認", "問い合わせ対応", "バックアップ確認", "次工程の準備",
    "見積の確認", "社内周知文の作成", "議事メモの共有", "チェックリスト更新",
    "関係者ヒアリング", "資料の最終確認",
  ];
  const fillerProjects = [P.system, P.expo, P.manual, P.training, P.office, P.news];
  const fillerMembers = [M.tamaki, M.riku, M.mei, M.yuto, M.sakura];
  const fillerStatuses: Task["status"][] = ["todo", "in_progress", "done", "todo", "in_progress", "done", "on_hold"];
  const fillerPriorities: Task["priority"][] = ["high", "mid", "low"];
  const fillerTags = ["連絡", "確認", "資料"];

  for (let i = 0; i < fillerNames.length; i++) {
    const dueOffset = -25 + i * 5; // -25 日 〜 +60 日まで広く分布させる
    tasks.push(mkTask({
      id: `demo-task-f${i + 1}`,
      name: fillerNames[i],
      projectId: fillerProjects[i % fillerProjects.length],
      assignee: fillerMembers[(i + 2) % fillerMembers.length],
      status: fillerStatuses[i % fillerStatuses.length],
      priority: fillerPriorities[i % fillerPriorities.length],
      start: dueOffset - 4,
      due: dueOffset,
      tags: [fillerTags[i % fillerTags.length]],
    }));
  }

  return tasks;
}

function buildTaskDependencies(): TaskDependency[] {
  return [
    { id: "demo-dep-1", predecessor_task_id: T_REQDEF, successor_task_id: T_DESIGN, is_deleted: false, group_id: DEMO_GROUP_ID },
    { id: "demo-dep-2", predecessor_task_id: T_DESIGN,  successor_task_id: T_DEV,    is_deleted: false, group_id: DEMO_GROUP_ID },
    { id: "demo-dep-3", predecessor_task_id: T_DEV,     successor_task_id: T_TEST,   is_deleted: false, group_id: DEMO_GROUP_ID },
    { id: "demo-dep-4", predecessor_task_id: T_TEST,    successor_task_id: T_GOLIVE, is_deleted: false, group_id: DEMO_GROUP_ID },
  ];
}

function buildMilestones(): Milestone[] {
  return [
    { id: "demo-milestone-1", project_id: P.system, name: "要件定義完了", date: addDaysFromToday(-20), is_deleted: false },
    { id: "demo-milestone-2", project_id: P.system, name: "本稼働開始",   date: addDaysFromToday(75),  is_deleted: false },
    { id: "demo-milestone-3", project_id: P.expo,   name: "展示会当日",   date: addDaysFromToday(35),  is_deleted: false },
  ];
}

export function buildDemoDataset(): DemoDataset {
  return {
    members: buildMembers(),
    projects: buildProjects(),
    tasks: buildTasks(),
    objectives: [buildObjective()],
    keyResults: buildKeyResults(),
    taskForces: buildTaskForces(),
    todos: buildToDos(),
    taskDependencies: buildTaskDependencies(),
    milestones: buildMilestones(),
  };
}
