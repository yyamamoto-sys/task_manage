// src/lib/tips/loadingTips.ts
//
// 【設計意図】
// ローディング画面（App.tsx のプログレスバー画面）に出す操作テクニックのヒント。
//
// ここが解く問題：ヒントの実データは Supabase の loading_tips テーブルにあるが、
// ローディング画面は「まさにその DB を読んでいる最中」に表示されるため、
// DB から取ってきた値をその場で使うことはできない（初回表示に間に合わない）。
//
// そこで2段構えにする：
//   1. DB から取得できたら localStorage にキャッシュする（次回以降の起動で即使える）
//   2. キャッシュが無い／壊れている初回は、このファイルの DEFAULT_LOADING_TIPS を使う
//
// DEFAULT_LOADING_TIPS の内容は migrations/20260727_add_loading_tips.sql の初期投入分と
// 同じ（あちらが編集できる実データ、こちらは読めなかった場合のフォールバック）。
// スーパー管理者が設定画面で内容を変えても、このファイルは変更不要
// （変更後の内容はキャッシュ経由で次回起動から反映される）。

import { KEYS } from "../localData/localStore";
import type { LoadingTip } from "../localData/types";

/** 表示に必要な最小限のフィールドだけを持つ、キャッシュ／表示用の軽量な形 */
export interface DisplayTip {
  title: string;
  body: string;
}

/**
 * 初期の10件（ガイドツアー first-time.ts では扱っていないテクニックに限定）。
 * ツアーが扱う内容（5つのビュー・AIツールの入口・FAB・PJ単体のAI分析・ガイド）は
 * 重複を避けるためここには入れない。
 */
export const DEFAULT_LOADING_TIPS: DisplayTip[] = [
  {
    title: "🔍 どこからでも一発ジャンプ",
    body: "Ctrl（Mac は ⌘）＋ K でコマンドパレットが開きます。タスク名・プロジェクト名で横断検索してそのまま開けるほか、ビュー切替・新規タスク・AI相談もここから呼び出せます。",
  },
  {
    title: "↩ 間違えても戻せます",
    body: "削除や一括変更のあとに出るトーストの「元に戻す」、または Ctrl（⌘）＋ Z で直前の操作を取り消せます。文字入力中は通常の文字取り消しが優先されるので、安心して使えます。",
  },
  {
    title: "🖱 ガントはドラッグで日付を編集",
    body: "バーの中央をドラッグすると期間を保ったままタスクごと移動、左右の端をドラッグすると開始日・期日だけを変更できます。ドラッグ中はカーソルの横に日付が出ます。",
  },
  {
    title: "✚ 空いた行を横にドラッグして期間をつくる",
    body: "期日が未設定のタスクは、ガントのその行を横にドラッグするだけで開始日〜期日をまとめて設定できます。まず名前だけ登録して、あとから期間を引く使い方がおすすめです。",
  },
  {
    title: "🔗 依存関係はドラッグでつなぐ",
    body: "ガントのバーにカーソルを合わせると端の外側に小さな丸が出ます。それを別のタスクのバーへドラッグすると「先行 → 後続」の依存になります。先行が終わるまで後続は完了にできません。",
  },
  {
    title: "🗂 まとめて動かす",
    body: "ガントで Ctrl（⌘）＋ クリックすると複数のタスクを選べます。そのうち1本をドラッグすれば、選択中の全タスクが同じ日数だけまとめてずれます。",
  },
  {
    title: "🎯 ガントのトグルで見方を変える",
    body: "ツールバーの 🎯クリティカルパス／▤ベースライン（当初計画との差）／⚠過負荷／🙈完了を隠す を切り替えると、遅れの原因や負荷の偏りが一目で分かります。",
  },
  {
    title: "📋 リスト・カンバンも複数選択できます",
    body: "Shift＋クリックで範囲選択、Ctrl（⌘）＋ A で全選択。選んだあとはステータス・担当者・優先度の変更や削除をまとめて実行できます。",
  },
  {
    title: "👥 ワークロードは行をクリック",
    body: "メンバー別の負荷一覧で行をクリックすると、その人が今抱えているタスクの中身（プロジェクト別・期限超過・先行待ち）が右側のパネルに開きます。",
  },
  {
    title: "📄 プロジェクトは過去のPJから作れます",
    body: "サイドバーの「プロジェクト」見出しの＋から新規作成するとき、「他のPJから引き継ぐ」を選ぶと過去のPJのタスクをチェックで選んで複製できます。日付は新しいPJの開始日を基準にスライドします。",
  },
];

/**
 * DB から取得した LoadingTip[] を、表示に使える DisplayTip[] に整える純粋関数。
 * ・論理削除済み・非アクティブ・本文が空のものを除外
 * ・sort_order の昇順（同値は元の順）に並べる
 */
export function toDisplayTips(tips: LoadingTip[]): DisplayTip[] {
  return tips
    .filter(t => !t.is_deleted && t.is_active && t.body.trim() !== "")
    .map((t, i) => ({ tip: t, i }))
    .sort((a, b) => (a.tip.sort_order - b.tip.sort_order) || (a.i - b.i))
    .map(({ tip }) => ({ title: tip.title, body: tip.body }));
}

/**
 * 実際に表示するヒントを決める純粋関数。
 * DB 由来（キャッシュ含む）が1件でもあればそれを使い、無ければ組み込みの既定値にフォールバックする。
 * 「スーパー管理者が全部消した」場合も、待ち時間が無言にならないよう既定値に戻る。
 */
export function pickTipsForDisplay(cached: DisplayTip[] | null): DisplayTip[] {
  return cached && cached.length > 0 ? cached : DEFAULT_LOADING_TIPS;
}

/** localStorage のキャッシュを読む（壊れていたら null を返し、既定値へフォールバックさせる） */
export function readCachedTips(): DisplayTip[] | null {
  try {
    const raw = localStorage.getItem(KEYS.LOADING_TIPS_CACHE);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const tips = parsed.filter(
      (t): t is DisplayTip =>
        typeof t === "object" && t !== null &&
        typeof (t as DisplayTip).title === "string" &&
        typeof (t as DisplayTip).body === "string",
    );
    return tips.length > 0 ? tips : null;
  } catch {
    return null;
  }
}

/** localStorage にキャッシュを書く（失敗しても致命的ではないので握りつぶす） */
export function writeCachedTips(tips: DisplayTip[]): void {
  try {
    localStorage.setItem(KEYS.LOADING_TIPS_CACHE, JSON.stringify(tips));
  } catch {
    /* quota超過等。次回起動で既定値が出るだけなので無視 */
  }
}
