// src/lib/project/sidebarProjectFilter.ts
//
// 【設計意図】
// サイドバーの「プロジェクト」一覧に何を出すかを決める純粋関数。
// 元々 MainLayout.tsx は `status === "active"` のPJしか通していなかった（初回実装から
// 変更なし）ため、`completed` にしたPJも `archived` にしたPJも一律で見えなくなっていた。
//
// 【v3.49→v3.50の訂正】
// v3.49では「completedは常に表示・archivedのみトグルで隠す」という設計に変更したが、
// これは山本さんの要望（「完了したPJがサイドバーに残り続けて散らかる。片付けたい」）と
// 逆方向の変更だった。v3.49以前の実態（=completedもarchivedも一律で隠れていた）の方が
// 要望に合っていたため、v3.50で「既定では active のみ表示」に戻し、
// 「完了・アーカイブも表示」という単一のトグルで completed と archived の両方を
// まとめて表示できるようにした（v3.49までの「アーカイブを表示」トグルを置き換え）。
//
// 【選択中PJが隠れて宙に浮く問題への対応】
// トグルOFFのまま completed/archived 済みPJを選択中にすると、サイドバーからその項目が消えて
// ハイライトが宙に浮く（どのPJを見ているか分からなくなる）。ここでは
// `pinnedProjectId`（＝現在選択中のPJ id）を渡すと、completed/archived判定だけを免除して
// 常に一覧に残す方式にした（トグルを勝手にONにする／選択を強制解除する、の2案を検討し、
// 「今見ているものが急に消えない」を優先してこちらを採用）。
//
// 【v3.188】「自分」トグル（mineOnly）でPJ一覧を絞る処理を撤去した。トグルの説明はタスクの
// 絞り込みなのに一覧からPJが消え、「PJが見えない」と複数の利用者が困ったため。mineOnly は
// 各ビューのタスクの絞り込みにだけ効く。自分が担当するPJは sortProjectsMineFirst で上に
// まとめ、行の目印で示す。
export type SidebarProjectStatus = "active" | "completed" | "archived";

export interface SidebarProjectFilterOptions {
  /** 「完了・アーカイブも表示」トグルの状態（v3.50。旧「アーカイブを表示」を置き換え） */
  showCompletedAndArchived: boolean;
  /** 現在選択中のPJ id（completed/archived判定のみ免除して常に表示する） */
  pinnedProjectId?: string | null;
}

export function filterSidebarProjects<
  T extends { id: string; is_deleted?: boolean; status: SidebarProjectStatus },
>(projects: T[], opts: SidebarProjectFilterOptions): T[] {
  return projects.filter(p => {
    if (p.is_deleted) return false;
    const isPinned = opts.pinnedProjectId != null && p.id === opts.pinnedProjectId;
    const isHiddenByDefault = p.status === "completed" || p.status === "archived";
    if (isHiddenByDefault && !opts.showCompletedAndArchived && !isPinned) return false;
    return true;
  });
}

/**
 * 自分が担当するタスクを持つPJを上にまとめる安定ソート（各グループ内は渡された順を保つ）。
 * サイドバーに手動の並び順（ドラッグ等）は無く、元の順序は store の並びのみ。
 */
export function sortProjectsMineFirst<T extends { id: string }>(
  projects: T[],
  myProjectIds: ReadonlySet<string>,
): T[] {
  const mine: T[] = [];
  const others: T[] = [];
  for (const p of projects) (myProjectIds.has(p.id) ? mine : others).push(p);
  return mine.length === 0 || others.length === 0 ? projects : [...mine, ...others];
}
