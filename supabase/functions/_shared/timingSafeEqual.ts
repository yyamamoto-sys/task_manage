// supabase/functions/_shared/timingSafeEqual.ts
//
// x-cron-secret の比較をタイミング攻撃に強くする（独立レビュー指摘：軽）。
// 文字列の長さが違っても早期return・短絡評価をせず、常に両者の最大長ぶん比較してから
// 最後にまとめて判定する（「===」だと長さ違い・先頭不一致ですぐ抜けるため、応答時間の
// 差から正解の先頭バイトを推測されうる）。シークレットは十分に長いランダム文字列である
// 前提（このEdge Functionではpg_cron登録時に生成したREMINDER_CRON_SECRETのみが対象）。

export function timingSafeEqualString(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bytesA = encoder.encode(a);
  const bytesB = encoder.encode(b);
  const maxLen = Math.max(bytesA.length, bytesB.length);
  let diff = bytesA.length ^ bytesB.length;
  for (let i = 0; i < maxLen; i++) {
    const x = i < bytesA.length ? bytesA[i] : 0;
    const y = i < bytesB.length ? bytesB[i] : 0;
    diff |= x ^ y;
  }
  return diff === 0;
}
