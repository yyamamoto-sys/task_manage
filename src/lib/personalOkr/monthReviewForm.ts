// src/lib/personalOkr/monthReviewForm.ts
//
// 【設計意図】
// 「振り返り」ブロック（MonthReviewBlock.tsx）の入力バリデーション・dirty判定を
// 純粋関数として切り出す（Reactレンダリングテスト基盤が無いため、ロジックはここでテストする）。
//
// 🔴 self_eval_pct・gm_eval_pct は数値入力欄を文字列stateで受けるため、文字列⇔数値の
// 往復で誤判定しやすい（例："80" と 80 は同じ値のはずなのに文字列比較だと不一致になる）。
// 必ずparseEvalPctInputで正規化してから比較すること。

export interface ParsedEvalPct {
  /** 空欄はnull。無効な入力（範囲外・数値でない）はundefinedのvalueとerrorメッセージを返す */
  value: number | null;
  error: string | null;
}

/** 0〜100の数値入力をパースする。空欄はnull・エラーなし。範囲外/非数値はエラー文言付きでnull */
export function parseEvalPctInput(raw: string): ParsedEvalPct {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null, error: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { value: null, error: "数値を入力してください" };
  if (n < 0 || n > 100) return { value: null, error: "0〜100の範囲で入力してください" };
  return { value: n, error: null };
}

export interface MonthReviewDraft {
  reviewText: string;
  selfEvalRaw: string;
  gmEvalRaw: string;
  gmComment: string;
}

export interface MonthReviewSaved {
  reviewText: string | null | undefined;
  selfEvalPct: number | null | undefined;
  gmEvalPct: number | null | undefined;
  gmComment: string | null | undefined;
}

/**
 * dirty判定（値比較）。self_eval_pct/gm_eval_pctは文字列→数値に正規化してから比較する。
 * 数値入力が無効（parseEvalPctInputがerrorを返す）な場合も、まだ保存できない変更として
 * dirty=trueにする（保存ボタンを押させてエラー表示に導くため）。
 */
export function computeMonthReviewDirty(current: MonthReviewDraft, saved: MonthReviewSaved): boolean {
  const savedReviewText = saved.reviewText ?? "";
  const savedGmComment = saved.gmComment ?? "";
  if (current.reviewText !== savedReviewText) return true;
  if (current.gmComment !== savedGmComment) return true;

  const selfEval = parseEvalPctInput(current.selfEvalRaw);
  if (selfEval.error) return true;
  if (selfEval.value !== (saved.selfEvalPct ?? null)) return true;

  const gmEval = parseEvalPctInput(current.gmEvalRaw);
  if (gmEval.error) return true;
  if (gmEval.value !== (saved.gmEvalPct ?? null)) return true;

  return false;
}

/**
 * 保存済み値が（保存完了・他画面からの更新で）変わったときの入力欄の同期（v3.169・M60）。
 * 入力欄が「直前の保存済み値のまま」＝未編集のときだけ新しい保存済み値に差し替え、
 * 利用者が編集中の欄はそのまま残す。
 * 🔴 以前は record の id／review_text が変わるたびに全欄を保存済み値で上書きしており、
 * 新規期間で「実施記録」だけ先に保存すると record.id が生まれて、書きかけの振り返り本文・
 * 評価%が無言で消えた。
 */
export function syncEditedValue(current: string, prevSaved: string, nextSaved: string): string {
  return current === prevSaved ? nextSaved : current;
}

/** 保存済みの数値（null/undefined＝空欄）を入力欄の文字列表現にする */
export function evalPctToRaw(v: number | null | undefined): string {
  return v != null ? String(v) : "";
}
