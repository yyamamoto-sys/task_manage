// src/lib/project/projectEditPermission.ts
//
// 【設計意図】
// PJの基本情報を編集できるか（＝status変更を含む）の判定条件を1箇所に集約する。
// 呼び出し元は2つだけ：ProjectSettingsModal.tsx（基本情報タブの編集可否）と
// MainLayout.tsx（サイドバーPJ行の「⋮」メニューに状態変更ボタンを出すか。CLAUDE.md Section 4）。
//
// 🔴 2026-09-17（v3.109）：管理者限定をやめ、同じ部署のメンバーなら誰でも編集可にした。
//
// 【変更の理由】
// 利用者から「プロジェクトの名前が変えられない」という声が上がった。調べたところ、
// 原因は権限条件（部署管理者 or 全社スーパー管理者。ただし部署内にis_adminが1人も
// いなければ全員可）で、一般メンバーは名前が読み取り表示になっていた。
//
// 🔴 より重要な発見：**この制限はUIにしか存在しなかった。**
// projects のRLS（schema.sql の projects_group ポリシー）は
//   USING (group_ids && current_member_group_ids() OR current_member_is_super_admin())
//   WITH CHECK (同上)
// で、部署スコープのみを条件にしている。つまりDB側は元々「同じ部署なら誰でもUPDATE可」で、
// 管理者制限はUI側の「約束」にすぎなかった（APIを直接叩けば一般メンバーでも更新できた）。
// UIとDBで条件が食い違っている状態だったため、DB側に合わせてUIを緩める判断をした
// （逆にDB側を締める案もあったが、10名弱のチームで自分たちのPJ名を直せないほうが
// 実害が大きいと山本さんが判断した）。
//
// 【開放した範囲】基本情報タブ全体（名前・目的・貢献メモ・オーナー・期間・色・ステータス）。
// これに伴い、サイドバー「⋮」の「完了にする」「アーカイブ」「activeに戻す」も全員に出る。
// 基本情報タブでステータスを変えられるのに「⋮」からは変えられない、という不整合を
// 作らないための一貫した扱い。
//
// 【ゲストへの影響は無い】ゲスト（サンプル閲覧）は buildProjectRowMenuItems() が空配列を
// 返すため「⋮」自体が出ず、saveProject もゲスト分岐でメモリ上の更新に留まる（Section 23）。
//
// 【将来また権限を絞る場合】引数（members / currentUser）は意図的に残してある。
// 「PJオーナーのみ」「PJに関わる人のみ」等に変えるときは、この関数の中だけを直せばよい。

import type { Member } from "../localData/types";

/**
 * PJの基本情報編集・状態変更（完了/アーカイブ/戻す）が可能かどうか。
 *
 * 🔴 現在は「同じ部署のメンバーなら誰でも可」＝常に true を返す。
 * この画面に到達している時点で、そのPJは selectScopedProjects / RLS を通って
 * 見えているPJ（＝自分がアクセスできる部署のPJ）に限られているため、
 * ここで追加の絞り込みは行わない。
 *
 * 引数は将来また権限を絞るときのために残している（現在は未使用）。
 */
export function canEditProjectBasicInfo(_members: Member[], _currentUser: Member): boolean {
  return true;
}
