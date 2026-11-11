// 架空データのみ。実在の人物・会社・数値とは無関係。
import { addDays, TODAY } from "./logic";
import type { Checkpoint, Member, OkrItem, Pj, Quarter, SelfReport, Synergy, Task, TaskStatus, Team, TeamMemo } from "./types";

// 暦年ベースの仮の定義：下期＝7〜12月、3Q＝7〜9月（終了）、4Q＝10〜12月（今期）
export const PERIOD_NAME = "2026年 下期";
export const PERIOD_RANGE = "2026年7月〜12月";
/** 半期の目標・KRを確定した日 */
export const LOCKED_AT = "2026-07-01";
export const CURRENT_QUARTER: Quarter = "4Q";
export const QUARTER_INFO: Record<Quarter, { range: string; lockedAt: string; ended: boolean }> = {
  "3Q": { range: "7月〜9月", lockedAt: "2026-07-01", ended: true },
  "4Q": { range: "10月〜12月", lockedAt: "2026-10-01", ended: false },
};

export const teams: Team[] = [
  { id: "ta", name: "チームA", checkinWeekday: 2 },
  { id: "tb", name: "チームB", checkinWeekday: 4 },
];

export const members: Member[] = [
  { id: "m1", name: "佐藤 美咲", isManager: true, teamId: "ta", color: "#3d4f8a" },
  { id: "m2", name: "鈴木 健", isManager: false, teamId: "ta", color: "#2f6b3c" },
  { id: "m3", name: "高橋 彩", isManager: false, teamId: "ta", color: "#a54338" },
  { id: "m4", name: "田中 悠", isManager: false, teamId: "tb", color: "#8a5d10" },
  { id: "m5", name: "伊藤 蓮", isManager: false, teamId: "tb", color: "#4d4690" },
  { id: "m6", name: "渡辺 結", isManager: false, teamId: "tb", color: "#2a7f8f" },
];

export const okrItems: OkrItem[] = [
  { id: "obj", kind: "objective", parentId: null, label: "目標", text: "地域と企業が一緒に動く「共創の輪」を広げる" },
  { id: "kr1", kind: "kr", parentId: "obj", label: "KR1", text: "共創パートナー企業を30社にする" },
  { id: "kr2", kind: "kr", parentId: "obj", label: "KR2", text: "地域拠点の稼働率を80%にする" },
  { id: "kr3", kind: "kr", parentId: "obj", label: "KR3", text: "社内の定型業務を月20時間減らす" },
  { id: "tf11", kind: "tf", parentId: "kr1", label: "TF1-1", text: "新規開拓の進め方を仕組みにする", quarters: ["3Q", "4Q"], leaderId: "m2" },
  { id: "tf12", kind: "tf", parentId: "kr1", label: "TF1-2", text: "既存のお客様との関係を深める", quarters: ["3Q", "4Q"], leaderId: "m3" },
  { id: "tf21", kind: "tf", parentId: "kr2", label: "TF2-1", text: "拠点の予約までの流れを分かりやすくする", quarters: ["3Q", "4Q"], leaderId: "m5" },
  { id: "tf22", kind: "tf", parentId: "kr2", label: "TF2-2", text: "運営ボランティアを確保する", quarters: ["3Q", "4Q"], leaderId: "m4" },
  { id: "tf31", kind: "tf", parentId: "kr3", label: "TF3-1", text: "定型レポートを自動化する", quarters: ["3Q", "4Q"], leaderId: "m3" },
  { id: "tf32", kind: "tf", parentId: "kr3", label: "TF3-2", text: "社内の情報共有を一本化する", quarters: ["3Q", "4Q"], leaderId: "m6" },
  { id: "tf33", kind: "tf", parentId: "kr3", label: "TF3-3", text: "AI活用の相談窓口をつくる", quarters: ["4Q"], leaderId: "m1" },
];

/** Kintone の PDF から読んだ体のデータ。確定案と2か所だけ文言が違う（どちらも今期のTF） */
export const kintoneTexts: Record<string, string> = Object.fromEntries(okrItems.map((i) => [i.id, i.text]));
kintoneTexts.tf22 = "運営ボランティアを継続的に確保する";
kintoneTexts.tf33 = "AIの相談窓口をつくる";

export const pjsInit: Pj[] = [
  { id: "p1", name: "パートナー向け提案資料の刷新", tfIds: ["tf11"] },
  { id: "p2", name: "展示会のお礼とフォロー", tfIds: ["tf11", "tf12"] },
  { id: "p3", name: "既存のお客様ヒアリング", tfIds: ["tf12"] },
  { id: "p4", name: "拠点の予約サイト改修", tfIds: ["tf21"] },
  { id: "p5", name: "ボランティア募集キャンペーン", tfIds: ["tf22"] },
  { id: "p6", name: "月次レポートの自動化", tfIds: ["tf31"] },
  { id: "p7", name: "社内ナレッジの整理", tfIds: ["tf32", "tf22"] },
  { id: "p8", name: "社内交流イベントの運営", tfIds: [] },
];

type Row = [string, string, string, number, TaskStatus, number];
// [PJ, タイトル, 担当, 期日（今日からの日数）, 状態, 最終更新（何日前）]
const rows: Row[] = [
  ["p1", "提案資料の骨子を決める", "m2", -6, "完了", 25],
  ["p1", "事例ページの原稿を集める", "m3", -2, "進行中", 9],
  ["p1", "デザインの初稿を作る", "m2", 0, "進行中", 2],
  ["p1", "社内レビューを受ける", "m1", 5, "未着手", 12],
  ["p1", "価格表を最新にする", "m3", 2, "進行中", 1],
  ["p1", "提案資料の英語版を作る", "m2", 14, "未着手", 20],
  ["p1", "ロゴ使用ルールを確認する", "m1", -9, "完了", 16],
  ["p1", "資料の配布先リストを整える", "m3", 3, "進行中", 4],
  ["p2", "お礼メールの文面を作る", "m1", -8, "完了", 12],
  ["p2", "名刺情報を入力する", "m4", -5, "完了", 6],
  ["p2", "商談の候補先を絞る", "m4", 1, "進行中", 0],
  ["p2", "フォロー訪問の日程を押さえる", "m5", 2, "進行中", 3],
  ["p2", "訪問用の資料を準備する", "m5", -1, "未着手", 8],
  ["p2", "展示会アンケートを集計する", "m6", -12, "完了", 20],
  ["p2", "アンケート結果を共有する", "m6", 0, "進行中", 1],
  ["p2", "反応の良かった先に再連絡する", "m4", 6, "未着手", 5],
  ["p3", "ヒアリング項目を決める", "m1", -14, "完了", 27],
  ["p3", "対象のお客様を10社選ぶ", "m3", -7, "完了", 14],
  ["p3", "1〜3社目のヒアリングを行う", "m3", -3, "完了", 4],
  ["p3", "4〜6社目のヒアリングを行う", "m2", 0, "進行中", 2],
  ["p3", "7〜10社目のヒアリングを行う", "m2", 7, "未着手", 10],
  ["p3", "ヒアリング内容を整理する", "m1", 8, "未着手", 15],
  ["p3", "お礼状を送る", "m3", -1, "進行中", 7],
  ["p4", "現行サイトの課題を洗い出す", "m5", -18, "完了", 24],
  ["p4", "新しい画面案を作る", "m6", -4, "完了", 11],
  ["p4", "画面案を現場に見てもらう", "m6", 1, "進行中", 2],
  ["p4", "予約フォームを作り直す", "m5", 2, "進行中", 0],
  ["p4", "確認メールの文面を直す", "m4", -2, "未着手", 9],
  ["p4", "公開前の動作確認をする", "m5", 12, "未着手", 18],
  ["p4", "利用案内ページを更新する", "m6", 4, "未着手", 6],
  ["p4", "旧サイトからの案内を整える", "m4", 9, "未着手", 13],
  ["p5", "募集チラシを作る", "m6", -10, "完了", 19],
  ["p5", "募集の掲載先を決める", "m4", -6, "完了", 13],
  ["p5", "説明会の会場を押さえる", "m5", -3, "完了", 3],
  ["p5", "説明会の案内を配る", "m4", 1, "進行中", 1],
  ["p5", "応募者への返信を行う", "m5", 0, "進行中", 0],
  ["p5", "説明会の当日運営を準備する", "m6", 2, "未着手", 8],
  ["p5", "過去の参加者に声をかける", "m4", -4, "進行中", 10],
  ["p5", "活動のQ&Aをまとめる", "m6", 11, "未着手", 14],
  ["p6", "対象のレポートを洗い出す", "m2", -15, "完了", 26],
  ["p6", "集計の手順を書き出す", "m2", -9, "完了", 17],
  ["p6", "自動化の試作を作る", "m3", -2, "進行中", 1],
  ["p6", "試作の結果を確認する", "m1", 3, "未着手", 6],
  ["p6", "月次レポートを1本、自動で作る", "m2", 0, "進行中", 0],
  ["p6", "使い方メモを書く", "m3", 10, "未着手", 11],
  ["p6", "営業部の週次集計を置き換える", "m1", 15, "未着手", 19],
  ["p6", "エラー時の連絡先を決める", "m2", 1, "未着手", 3],
  ["p7", "資料の置き場所を決める", "m4", -20, "完了", 22],
  ["p7", "古い資料を洗い出す", "m5", -11, "完了", 17],
  ["p7", "フォルダの名前ルールを決める", "m6", -5, "進行中", 12],
  ["p7", "よくある質問を集める", "m5", -3, "進行中", 15],
  ["p7", "整理した資料を移す", "m4", 4, "未着手", 9],
  ["p7", "ルールを全員に説明する", "m1", 9, "未着手", 14],
  ["p7", "検索しやすい目次を作る", "m6", 2, "未着手", 8],
  ["p8", "年末交流会の日程を決める", "m3", -2, "進行中", 5],
  ["p8", "会場の候補を3つ挙げる", "m3", 3, "未着手", 2],
  ["p8", "予算案を出す", "m1", 5, "未着手", 7],
  ["p8", "案内文を作る", "m5", 7, "未着手", 6],
  ["p8", "出欠を集める", "m5", 14, "未着手", 4],
  ["p8", "当日の役割を決める", "m4", 18, "未着手", 3],
  ["p3", "ヒアリング結果の速報を出す", "m1", 2, "進行中", 1],
  ["p6", "共有フォルダの権限を整える", "m3", -1, "進行中", 8],
];

/** 3Qは終了済み。3Qの構成（TF3-3が無い）を読み取り専用で見せるための項目 */
export const okrItems3Q: OkrItem[] = okrItems.filter((i) => i.kind !== "tf" || (i.quarters ?? []).includes("3Q"));

// 「つながり」の検出に使う相手・対象と前提（タイトルで指す。タイトルは一意）
const subjects: Record<string, string> = {
  "フォロー訪問の日程を押さえる": "北里フーズ",
  "画面案を現場に見てもらう": "北里フーズ",
  "活動のQ&Aをまとめる": "よくある質問集",
  "よくある質問を集める": "よくある質問集",
};
const dependsOnTitle: Record<string, string[]> = {
  "利用案内ページを更新する": ["ヒアリング結果の速報を出す"],
  "過去の参加者に声をかける": ["名刺情報を入力する"],
};

export const tasks: Task[] = rows.map(([pjId, title, assigneeId, due, status, ago], i) => ({
  id: `t${i + 1}`,
  pjId,
  title,
  assigneeId,
  due: addDays(TODAY, due),
  status,
  updated: addDays(TODAY, -ago),
  subject: subjects[title],
}));
for (const t of tasks) {
  const deps = dependsOnTitle[t.title];
  if (deps) t.dependsOn = deps.map((d) => tasks.find((x) => x.title === d)!.id);
}

const idOfTitle = (title: string) => tasks.find((t) => t.title === title)!.id;

/** (c) 重複：モックでは固定の例（実際にはAIが提案する想定） */
export const fixedSynergies: Synergy[] = [
  {
    id: "dup:thanks-reply",
    type: "duplicate",
    krIds: ["kr1", "kr2"],
    taskIds: [idOfTitle("お礼状を送る"), idOfTitle("応募者への返信を行う")],
    summary: "どちらも「お礼や返信の文面づくり」です。文面のひな形を共通にできるかもしれません。",
    fixed: true,
  },
  {
    id: "dup:guide-doc",
    type: "duplicate",
    krIds: ["kr2", "kr3"],
    taskIds: [idOfTitle("利用案内ページを更新する"), idOfTitle("使い方メモを書く")],
    summary: "どちらも「利用者向けの案内文書づくり」です。書き方の型や置き場所を揃えられるかもしれません。",
    fixed: true,
  },
];

// 今週（11/6〜11/10）の自己申告。TF3-2だけ前の週のまま
export const selfReportsInit: Record<string, SelfReport> = {
  tf11: { level: "順調", note: "提案資料の初稿は予定どおり。英語版は後ろ倒しにする。", date: "2026-11-07" },
  tf12: { level: "注意", note: "ヒアリングが1社遅れている。お礼状の発送も溜まり気味。", date: "2026-11-09" },
  tf21: { level: "順調", note: "予約フォームの作り直しに着手済み。", date: "2026-11-06" },
  tf22: { level: "相談したい", note: "説明会の会場が押さえきれていない。人手の配分を相談したい。", date: "2026-11-09" },
  tf31: { level: "順調", note: "試作が動いた。次は結果の確認。", date: "2026-11-08" },
  tf32: { level: "注意", note: "ルール案がまだ出せていない。", date: "2026-11-02" },
  tf33: { level: "順調", note: "窓口の運用案を作り始めた。", date: "2026-11-10" },
};

// 月初のチェックポイント。10月・11月分があり、12月は未取込
export const checkpointsInit: Checkpoint[] = [
  { tfId: "tf11", month: "2026-10", text: "展示会のフォロー先を10社に絞る。提案資料の骨子を固める。" },
  { tfId: "tf11", month: "2026-11", text: "提案資料の初稿を出す。フォロー訪問を5件入れる。" },
  { tfId: "tf12", month: "2026-10", text: "ヒアリング対象を10社選ぶ。" },
  { tfId: "tf12", month: "2026-11", text: "10社のヒアリングを終え、内容を整理する。" },
  { tfId: "tf21", month: "2026-10", text: "現行サイトの課題を洗い出し、画面案を作る。" },
  { tfId: "tf21", month: "2026-11", text: "予約フォームを作り直し、公開前の確認まで進める。" },
  { tfId: "tf22", month: "2026-10", text: "募集チラシと掲載先を決める。" },
  { tfId: "tf22", month: "2026-11", text: "説明会を開き、応募者への返信を終える。" },
  { tfId: "tf31", month: "2026-10", text: "自動化の対象レポートを洗い出す。" },
  { tfId: "tf31", month: "2026-11", text: "月次レポートを1本、自動で作れる状態にする。" },
  { tfId: "tf32", month: "2026-10", text: "資料の置き場所を決める。" },
  { tfId: "tf32", month: "2026-11", text: "名前のルールを決め、資料を移し始める。" },
  { tfId: "tf33", month: "2026-10", text: "相談窓口の対象と体制を決める。" },
  { tfId: "tf33", month: "2026-11", text: "窓口の運用案を作り、試験的に1件受ける。" },
];

/** モックで「今月のチェックポイントを取り込む」を押したときに入る12月分 */
export const checkpointsDec: Checkpoint[] = [
  { tfId: "tf11", month: "2026-12", text: "新規開拓の進め方を1枚にまとめ、チームで共有する。" },
  { tfId: "tf12", month: "2026-12", text: "ヒアリングの結果をもとに、関係を深める施策を2つ決める。" },
  { tfId: "tf21", month: "2026-12", text: "新しい予約サイトを公開する。" },
  { tfId: "tf22", month: "2026-12", text: "確保したボランティアの活動を始める。" },
  { tfId: "tf31", month: "2026-12", text: "営業部の週次集計を置き換える。" },
  { tfId: "tf32", month: "2026-12", text: "資料の移行を終え、全員に説明する。" },
  { tfId: "tf33", month: "2026-12", text: "窓口の利用状況を振り返り、改善点を決める。" },
];

export const lastMemos: Record<string, TeamMemo> = {
  ta: {
    date: "2026-11-03",
    byKr: {
      kr1: "提案資料は11月中旬までに初稿を出す。事例の原稿集めは高橋さんが先行する。",
      kr2: "チームAの担当は少ないため、様子を見る。",
      kr3: "月次レポート1本の自動化を今月の目標にする。",
    },
  },
  tb: {
    date: "2026-11-05",
    byKr: {
      kr1: "展示会の反応が良かった先を絞って再連絡する。",
      kr2: "予約フォームの作り直しを優先する。説明会の日程を早めに確定する。",
      kr3: "ナレッジ整理は進みが遅い。ルール案を先に出してから資料を移す。",
    },
  },
};
