// src/lib/project/sidebarProjectFilter.ts
//
// 【設計意図】
// サイドバーの「プロジェクト」一覧に何を出すかを決める純粋関数。
// 元々 MainLayout.tsx は `status === "active"` のPJしか通していなかった（初回実装から
// 変更なし）ため、`completed` にしたPJも `archived` にしたPJも一律で見えなくなっていた。
// ProjectStructureView（体制図）は既に `status !== "archived"` で運用済み（= completed は
// 出す）だったため、サイドバーもこれに合わせる。
//
// 山本さんの要望（2026-08-11）：「完了したPJをアーカイブできるようにしたい。完了しても
// 消えないのが不便」に対応する形は、
//   - active / completed は常に表示する（完了直後も参照したいため）
//   - archived は既定で隠す。「アーカイブを表示」トグルで見えるようにする
// という設計にした。
//
// 【選択中PJが隠れて宙に浮く問題への対応】
// トグルOFFのままアーカイブ済みPJを選択中にすると、サイドバーからその項目が消えて
// ハイライトが宙に浮く（どのPJを見ているか分からなくなる）。ここでは
// `pinnedProjectId`（＝現在選択中のPJ id）を渡すと、アーカイブ判定だけを免除して
// 常に一覧に残す方式にした（トグルを勝手にONにする／選択を強制解除する、の2案を検討し、
// 「今見ているものが急に消えない」を優先してこちらを採用）。
// 🔴 mineOnly の絞り込みは pinnedProjectId でも免除しない。既存挙動（mineOnly中に
// 自分の担当外の active なPJを選択しても一覧からは消える）と一貫性を保つため。
export type SidebarProjectStatus = "active" | "completed" | "archived";

export interface SidebarProjectFilterOptions {
  /** 「アーカイブを表示」トグルの状態 */
  showArchived: boolean;
  /** 「自分が参加しているPJのみ」トグルの状態 */
  mineOnly: boolean;
  /** mineOnly=true のときに残す対象PJ id */
  myProjectIds: ReadonlySet<string>;
  /** 現在選択中のPJ id（アーカイブ判定のみ免除して常に表示する） */
  pinnedProjectId?: string | null;
}

export function filterSidebarProjects<
  T extends { id: string; is_deleted?: boolean; status: SidebarProjectStatus },
>(projects: T[], opts: SidebarProjectFilterOptions): T[] {
  return projects.filter(p => {
    if (p.is_deleted) return false;
    const isPinned = opts.pinnedProjectId != null && p.id === opts.pinnedProjectId;
    if (p.status === "archived" && !opts.showArchived && !isPinned) return false;
    if (opts.mineOnly && !opts.myProjectIds.has(p.id)) return false;
    return true;
  });
}
