// src/lib/admin/resolveAdminGroupId.ts
//
// 【設計意図】
// 設定画面（AdminView）はサイドバーの「表示部署」（appStore.currentGroupId）に従う
// （v3.60・山本さん指示。以前は設定画面ローカルの独立した部署セレクタを持っていた）。
//
// ただし currentGroupId は「string | null」であり、ログイン直後の一瞬・members未登録・
// ホーム部署が未設定の古いデータ等でnullになりうる。この関数は「編集対象の部署をどれに
// 決めるか」の判定だけを担う純粋関数で、以下を必ず守る：
//
// 🔴 空文字("")や「絞り込み無し」を意味する値を返してはならない。
//    2026-06-26のマルチテナンシー初回実装で「NULL＝全部署公開」という抜け穴を作り、
//    未登録ユーザーに全部署のデータを見せてしまった事故と同じ轍を踏まないため
//    （CLAUDE.md Section 1.6「過去に実際に起きた事故と教訓」参照）。
// 🔴 currentGroupIdが不明・未確定のときは、選べる部署が1つしかない場合に限り
//    その1つへフォールバックする（誤りうる余地が無いケースのみ）。2つ以上ある場合は
//    判定を諦めてnullを返し、呼び出し側に「部署を判定できない」ことを明示させる
//    （安全側に倒す＝fail closed。「全部見せる」は選ばない）。
export function resolveAdminGroupId(
  currentGroupId: string | null,
  accessibleGroupIds: string[],
): string | null {
  if (currentGroupId && accessibleGroupIds.includes(currentGroupId)) return currentGroupId;
  if (accessibleGroupIds.length === 1) return accessibleGroupIds[0];
  return null;
}
