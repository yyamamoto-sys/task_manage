// 架空データのみ。実在の人物・会社・数値とは無関係。
import { addDays, TODAY } from "./logic";
import type {
  AiCandidate,
  Checkin,
  Decision,
  KrRecord,
  Member,
  OkrItem,
  PastWeek,
  PersonalOkr,
  Pj,
  Quarter,
  Resource,
  Task,
  TaskStatus,
} from "./types";

// 暦年ベースの仮の定義：下期＝7〜12月、3Q＝7〜9月（終了）、4Q＝10〜12月（今期）
export const PERIOD_NAME = "2026年 下期";
export const PERIOD_RANGE = "2026年7月〜12月";
export const PERIOD_START = "2026-07-01";
/** 半期の目標・KRを確定した日 */
export const LOCKED_AT = "2026-07-01";
export const CURRENT_QUARTER: Quarter = "4Q";
export const QUARTER_INFO: Record<Quarter, { range: string; lockedAt: string; ended: boolean }> = {
  "3Q": { range: "7月〜9月", lockedAt: "2026-07-01", ended: true },
  "4Q": { range: "10月〜12月", lockedAt: "2026-10-01", ended: false },
};

export const members: Member[] = [
  { id: "m1", name: "佐藤 美咲", role: "GM", color: "#3d4f8a" },
  { id: "m2", name: "鈴木 健", role: "メンバー", color: "#2f6b3c" },
  { id: "m3", name: "高橋 彩", role: "メンバー", color: "#a54338" },
  { id: "m4", name: "田中 悠", role: "メンバー", color: "#8a5d10" },
  { id: "m5", name: "伊藤 蓮", role: "メンバー", color: "#4d4690" },
  { id: "m6", name: "渡辺 結", role: "メンバー", color: "#2a7f8f" },
];

/** 「誰として見るか」に出す3名（メンバー2名＋GM1名） */
export const VIEWER_IDS = ["m2", "m3", "m1"];
/** 本人にしか見えない情報（個人OKR・効きの積み上がり・振り返り・仕事のつなぎ）を持つ人。他の人に切り替えると見えない */
export const OWNER_ID = "m2";

export const okrItems: OkrItem[] = [
  { id: "obj", kind: "objective", parentId: null, label: "目標", text: "地域と企業が一緒に動く「共創の輪」を広げる" },
  { id: "kr1", kind: "kr", parentId: "obj", label: "KR1", text: "共創パートナー企業を30社にする" },
  { id: "kr2", kind: "kr", parentId: "obj", label: "KR2", text: "地域拠点の稼働率を80%にする" },
  { id: "kr3", kind: "kr", parentId: "obj", label: "KR3", text: "社内の定型業務を減らす（達成度で見る）" },
  { id: "tf11", kind: "tf", parentId: "kr1", label: "TF1-1", text: "新規開拓の進め方を仕組みにする", quarters: ["3Q", "4Q"], leaderId: "m2" },
  { id: "tf12", kind: "tf", parentId: "kr1", label: "TF1-2", text: "既存のお客様との関係を深める", quarters: ["3Q", "4Q"], leaderId: "m3" },
  { id: "tf21", kind: "tf", parentId: "kr2", label: "TF2-1", text: "拠点の予約までの流れを分かりやすくする", quarters: ["3Q", "4Q"], leaderId: "m5" },
  { id: "tf22", kind: "tf", parentId: "kr2", label: "TF2-2", text: "運営ボランティアを確保する", quarters: ["3Q", "4Q"], leaderId: "m4" },
  { id: "tf31", kind: "tf", parentId: "kr3", label: "TF3-1", text: "定型レポートを自動化する", quarters: ["3Q", "4Q"], leaderId: "m3" },
  { id: "tf32", kind: "tf", parentId: "kr3", label: "TF3-2", text: "社内の情報共有を一本化する", quarters: ["3Q", "4Q"], leaderId: "m6" },
  { id: "tf33", kind: "tf", parentId: "kr3", label: "TF3-3", text: "AI活用の相談窓口をつくる", quarters: ["4Q"], leaderId: "m1" },
];

/** KRを色で区別するための色（色の点・積み上がりグラフ・線で使う。色だけに頼らず名前も添える） */
export const KR_COLORS: Record<string, string> = { kr1: "#3b6fd4", kr2: "#1a9a6b", kr3: "#e0782a" };
/** 本人の分を帯の中で見せる色（KRの色とも、他の人の色とも重ならない） */
export const MINE_COLOR = "#c2338a";
export const PERIOD_END = "2026-12-31";

/** Kintone の PDF から読んだ体のデータ。確定案と2か所だけ文言が違う（どちらも今期のTF） */
export const kintoneTexts: Record<string, string> = Object.fromEntries(okrItems.map((i) => [i.id, i.text]));
kintoneTexts.tf22 = "運営ボランティアを継続的に確保する";
kintoneTexts.tf33 = "AIの相談窓口をつくる";

/** 3Qは終了済み。3Qの構成（TF3-3が無い）を読み取り専用で見せるための項目 */
export const okrItems3Q: OkrItem[] = okrItems.filter((i) => i.kind !== "tf" || (i.quarters ?? []).includes("3Q"));

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
  ["p8", "交流会の出し物を考える", "m2", 6, "未着手", 3],
  // 鈴木 健さん（本人）の、これまでに終えた仕事。対照表の「動きの間」と効きの積み上がりの見本
  ["p1", "提案の想定質問集を作る", "m2", -12, "完了", 10],
  ["p3", "ヒアリング対象の過去取引を確認する", "m2", -14, "完了", 14],
  ["p4", "予約画面の用語を揃える", "m2", -20, "完了", 22],
  ["p7", "フォルダ構成案を作る", "m2", -6, "完了", 6],
  ["p1", "提案資料の目的を整理する", "m2", -110, "完了", 118],
  ["p2", "展示会の出展準備を進める", "m2", -90, "完了", 95],
  ["p6", "レポートを棚卸しする", "m2", -75, "完了", 80],
  ["p4", "予約状況の現状を調べる", "m2", -65, "完了", 70],
  ["p3", "ヒアリング計画を立てる", "m2", -48, "完了", 52],
  ["p7", "資料の保管ルールを調べる", "m2", -40, "完了", 45],
  ["p5", "募集媒体を調べる", "m2", -35, "完了", 38],
  ["p6", "試作の要件を整理する", "m2", -30, "完了", 33],
];

export const tasks: Task[] = rows.map(([pjId, title, assigneeId, due, status, ago], i) => ({
  id: `t${i + 1}`,
  pjId,
  title,
  assigneeId,
  due: addDays(TODAY, due),
  status,
  updated: addDays(TODAY, -ago),
}));

// ---------- 対照表（KRの目標・現状） ----------

export const checkinsInit: Checkin[] = [
  { id: "c1", date: "2026-10-06", title: "10月第1回チェックイン" },
  { id: "c2", date: "2026-10-20", title: "10月第2回チェックイン" },
  { id: "c3", date: "2026-11-03", title: "11月第1回チェックイン" },
];
/** 「資料を読ませる」で確定したときに加わる回 */
export const nextCheckin: Checkin = { id: "c4", date: "2026-11-10", title: "11月第2回チェックイン" };

export const recordsInit: Record<string, KrRecord> = {
  kr1: { krId: "kr1", kind: "number", unit: "社", target: 30, value: 18, prev: 15, updatedAt: "2026-11-03", prevAt: "2026-10-20", source: { doc: "チェックイン資料_20261103.pptx", page: "p.3" } },
  kr2: { krId: "kr2", kind: "number", unit: "%", target: 80, value: 71, prev: 66, updatedAt: "2026-10-20", prevAt: "2026-10-06", source: { doc: "チェックイン資料_20261020.pptx", page: "p.4" } },
  kr3: { krId: "kr3", kind: "band", target: "A", value: "C", prev: "D", updatedAt: "2026-11-03", prevAt: "2026-10-20", source: { doc: "チェックイン資料_20261103.pptx", page: "p.5" } },
};

// ---------- 決定事項と宿題 ----------

export const decisionsInit: Decision[] = [
  { id: "d1", checkinId: "c1", kind: "決定", text: "提案資料は11月中旬までに初稿を出す", ownerId: null, source: { doc: "議事録_20261006.txt", page: "2段落目" }, krIds: ["kr1"] },
  { id: "d2", checkinId: "c1", kind: "宿題", text: "展示会のフォロー先を10社に絞る", ownerId: "m4", source: { doc: "議事録_20261006.txt", page: "4段落目" }, krIds: ["kr1"] },
  { id: "d3", checkinId: "c2", kind: "決定", text: "予約フォームの作り直しを優先する", ownerId: null, source: { doc: "議事録_20261020.txt", page: "3段落目" }, krIds: ["kr2"] },
  { id: "d4", checkinId: "c2", kind: "宿題", text: "対象レポートの洗い出しを終える", ownerId: "m2", source: { doc: "議事録_20261020.txt", page: "5段落目" }, krIds: ["kr3"] },
  { id: "d5", checkinId: "c3", kind: "決定", text: "説明会の日程を早めに確定する", ownerId: null, source: { doc: "議事録_20261103.txt", page: "2段落目" }, krIds: ["kr2"] },
  { id: "d6", checkinId: "c3", kind: "宿題", text: "ヒアリングの4〜6社目を今週中に行う", ownerId: "m2", source: { doc: "議事録_20261103.txt", page: "6段落目" }, krIds: ["kr1"] },
  { id: "d7", checkinId: "c3", kind: "宿題", text: "ナレッジ整理のルール案を出す", ownerId: "m6", source: { doc: "チェックイン資料_20261103.pptx", page: "p.7" }, krIds: ["kr3"] },
];

// ---------- 資料を読ませる（結果は固定データ） ----------

export const resources: Resource[] = [
  {
    id: "deck",
    name: "チェックイン資料_20261110.pptx",
    kind: "PowerPoint / PDF（チェックイン資料）",
    checkinId: "c4",
    drafts: [
      { krId: "kr1", value: 22, source: { doc: "チェックイン資料_20261110.pptx", page: "p.3" } },
      { krId: "kr3", value: "B", source: { doc: "チェックイン資料_20261110.pptx", page: "p.5" } },
    ],
    decisions: [
      { kind: "決定", text: "新規開拓の進め方を1枚にまとめ、12月に共有する", ownerId: null, source: { doc: "チェックイン資料_20261110.pptx", page: "p.8" }, krIds: ["kr1"] },
      { kind: "宿題", text: "月次レポート1本の自動化を終える", ownerId: "m2", source: { doc: "チェックイン資料_20261110.pptx", page: "p.6" }, krIds: ["kr3"] },
      { kind: "宿題", text: "予約フォームの公開日を決める", ownerId: "m5", source: { doc: "チェックイン資料_20261110.pptx", page: "p.9" }, krIds: ["kr2"] },
    ],
  },
  {
    id: "minutes",
    name: "議事録_20261110.txt（文字起こし）",
    kind: "議事録・文字起こし",
    checkinId: "c4",
    drafts: [
      { krId: "kr1", value: 21, source: { doc: "議事録_20261110.txt", page: "2段落目" } },
      { krId: "kr2", value: 73, source: { doc: "議事録_20261110.txt", page: "4段落目" } },
    ],
    decisions: [
      { kind: "決定", text: "説明会は12月第1週に開く", ownerId: null, source: { doc: "議事録_20261110.txt", page: "5段落目" }, krIds: ["kr2"] },
      { kind: "宿題", text: "反応の良かった先に再連絡する", ownerId: "m4", source: { doc: "議事録_20261110.txt", page: "7段落目" }, krIds: ["kr1"] },
    ],
  },
];

// ---------- 仕事のつなぎ（AIの候補は固定） ----------

/** PJごとの、AIが出すつなぎ先の候補（先頭が最有力） */
export const aiCandidates: Record<string, AiCandidate[]> = {
  p1: [
    { krId: "kr1", reason: "提案資料は共創パートナーを増やす場面で使うため" },
    { krId: "kr3", reason: "資料づくりの型を揃えれば、定型作業が減るため" },
  ],
  p2: [
    { krId: "kr1", reason: "展示会で会った相手へのフォローは、パートナー獲得に直結するため" },
    { krId: "kr2", reason: "フォロー先に拠点の利用を勧められるため" },
  ],
  p3: [
    { krId: "kr1", reason: "既存のお客様との関係は、新しい紹介につながるため" },
    { krId: "kr2", reason: "お客様の声が拠点の使いやすさの改善に役立つため" },
  ],
  p4: [
    { krId: "kr2", reason: "予約しやすくなると、稼働率が上がるため" },
    { krId: "kr3", reason: "予約の問い合わせ対応が減るため" },
  ],
  p5: [
    { krId: "kr2", reason: "ボランティアが増えると、拠点を開けられる日が増えるため" },
    { krId: "kr1", reason: "参加者がパートナー企業の社員であることがあるため" },
  ],
  p6: [
    { krId: "kr3", reason: "レポートの自動化は、定型業務の削減そのものであるため" },
    { krId: "kr1", reason: "レポートの数字が提案資料に使えるため" },
  ],
  p7: [
    { krId: "kr3", reason: "探す手間が減り、定型業務が減るため" },
    { krId: "kr2", reason: "拠点の運営資料が見つけやすくなるため" },
  ],
  p8: [
    { krId: "kr1", reason: "交流会にパートナー候補を招けるため" },
    { krId: "kr3", reason: "社内の情報共有を進める場になるため" },
  ],
};

/** 「どう効くか」の一言。AIの案から選ぶ（自由入力は置かない） */
export const howOptions: Record<string, string[]> = {
  kr1: ["提案の質を上げて、紹介を増やす", "フォロー先を絞って、商談につなげる", "お客様の声を集めて、次の提案に活かす"],
  kr2: ["予約の手間を減らして、利用を増やす", "運営の人手を確保して、開けられる日を増やす", "利用者の声を集めて、使いにくさを直す"],
  kr3: ["手作業を自動化して、時間を減らす", "探す手間を減らして、時間を減らす", "やり方をそろえて、迷いを減らす"],
};

// ---------- 自分のOKR（本人だけ） ----------

export const personalOkrs: PersonalOkr[] = [
  { id: "po1", ownerId: "m2", text: "提案の質を上げて、紹介を増やす" },
  { id: "po2", ownerId: "m2", text: "業務の自動化の腕を上げる" },
  { id: "po3", ownerId: "m2", text: "拠点の運営を現場から学ぶ" },
];
/** 個人OKRからKRへの最初のつながり */
export const personalLinksInit: { personalId: string; krId: string }[] = [
  { personalId: "po1", krId: "kr1" },
  { personalId: "po2", krId: "kr3" },
];

// ---------- 週の振り返り（本人だけ） ----------

/** AIの見立て（固定文） */
export const aiViews: Record<string, string> = {
  kr1: "今週のあなたの仕事は、提案資料の初稿づくりとヒアリングを進めて、パートナー候補への説明材料を整えました。",
  kr2: "今週のあなたの仕事は、予約画面まわりの確認が中心で、稼働率への効き方はまだ間接的です。",
  kr3: "今週のあなたの仕事は、月次レポートの自動化を1本分進めて、定型業務の削減に近づけました。",
};

export const pastWeeks: PastWeek[] = [
  {
    weekStart: "2026-11-02",
    answers: {
      kr1: { effect: "よく効いた", match: "そのとおり", view: "あなたの仕事は、ヒアリングの3社分を終えて、お客様の声を集めました。" },
      kr3: { effect: "少し", match: "少し違う", view: "あなたの仕事は、レポートの手順書きで、自動化の準備を進めました。" },
    },
  },
  {
    weekStart: "2026-10-26",
    answers: {
      kr1: { effect: "少し", match: "そのとおり", view: "あなたの仕事は、提案資料の骨子づくりが中心でした。" },
      kr2: { effect: "効かせられなかった", match: "違う", view: "あなたの仕事は、予約画面の用語確認で、稼働率に効きました。" },
    },
  },
  {
    weekStart: "2026-10-19",
    answers: {
      kr2: { effect: "少し", match: "そのとおり", view: "あなたの仕事は、予約画面の用語をそろえることでした。" },
      kr3: { effect: "よく効いた", match: "そのとおり", view: "あなたの仕事は、集計の手順を書き出して自動化の下地を作りました。" },
    },
  },
];
