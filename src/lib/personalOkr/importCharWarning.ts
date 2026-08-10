// src/lib/personalOkr/importCharWarning.ts
//
// 【設計意図】
// 個人OKR取込（PersonalOkrImportModal.tsx）で、添付から抽出した文字数を解析実行前に画面へ
// 表示するための閾値判定。546 WORKER_RESOURCE_LIMIT（Supabase Edge Functionのワーカーが
// リソース上限で落ちる。CLAUDE.md Section 19 ⑦・27）は、ペイロードのサイズだけでなく
// 1回の呼び出しの生成にかかる時間でも起きることが2026-08-10の実例（v3.46）で判明した。
// 入力が長いほど抽出対象（KR件数・月次件数）が多くなり出力生成が長引く傾向があるため、
// 入力文字数を危険度の目安として画面に出す（呼び出し分割だけでは解消しきれない場合の
// 切り分けにも使う。personalOkrImportExtractor.ts の呼び出し分割と併用する備え）。
//
// 【閾値の根拠】
// 既存の入力文字数の上限は MAX_TEXT_CHARS=40000（PersonalOkrImportModal.tsx。添付テキストは
// この値でクライアント側で切り詰めている）。2026-08-10に546が再発した実データは、テキスト
// 抽出自体には成功していた＝この40000字の上限内に収まっていた入力だった。正確な文字数は
// 記録が残っていないため、「40000字の上限内でも起きた」という事実から安全側に倒し、上限の
// 半分（20000字）を警告閾値とする。上限そのものではなく半分に抑えることで、8KR×3か月分の
// 月次振返り記録のような大きめの資料（本件で問題が起きた規模）を確実に警告対象に含める。
export const PERSONAL_OKR_IMPORT_CHAR_WARNING_THRESHOLD = 20000;

/** 抽出文字数が警告閾値を超えているか（境界値=閾値そのものはまだ超えていない扱い） */
export function isPersonalOkrImportTextTooLong(charCount: number): boolean {
  return charCount > PERSONAL_OKR_IMPORT_CHAR_WARNING_THRESHOLD;
}
