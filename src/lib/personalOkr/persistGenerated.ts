// src/lib/personalOkr/persistGenerated.ts
//
// 【設計意図・M55】
// AI呼び出し（課金済み）が成功したあとにDBへのINSERTが失敗しても、結果を捨てない。
// INSERTの成否を値で返し、呼び出し側（personalOkrUiStore）が「結果はメモリ上の行としてstateに載せ、
// 保存失敗のエラーを併記する」判断をできるようにする。例外は投げない。

export type PersistResult = { saved: true } | { saved: false; error: unknown };

export async function persistGeneratedRow<T>(insert: (row: T) => Promise<unknown>, row: T): Promise<PersistResult> {
  try {
    await insert(row);
    return { saved: true };
  } catch (error) {
    return { saved: false, error };
  }
}
