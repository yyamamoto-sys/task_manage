// src/hooks/useSectionActions.ts
//
// PJ内「グループ」の作成・名前変更・並べ替え・削除を、リスト・ガントで共通にする（見出しの操作）。
// 保存は appStore（saveProjectSection／reorderProjectSections／deleteProjectSection＝楽観ロック・
// ゲストのメモリ保存・realtime はストア側）。ここは確認ダイアログ・トースト・エラー表示だけを持つ。
//
// 権限：PJの基本情報と同じく、PJにアクセスできる人なら誰でも作成・編集・削除できる
// （canEditProjectBasicInfo と同じ規則。DB の RLS も同じ範囲）。ゲストはメモリ上だけで成立する。

import { useCallback } from "react";
import { useAppStore } from "../stores/appStore";
import type { ProjectSection } from "../lib/localData/types";
import { buildNewSection, sectionsOfProject, computeSectionMoveOrder, type SectionMoveDir } from "../lib/section/sections";
import { confirmDialog } from "../lib/dialog";
import { showToast } from "../components/common/Toast";
import { formatErrorForUser } from "../lib/errorMessage";

export function useSectionActions(currentUserId: string) {
  const saveProjectSection = useAppStore(s => s.saveProjectSection);
  const deleteProjectSection = useAppStore(s => s.deleteProjectSection);
  const reorderProjectSections = useAppStore(s => s.reorderProjectSections);

  const createSection = useCallback(async (projectId: string, name: string): Promise<ProjectSection | null> => {
    const existing = useAppStore.getState().projectSections;
    const section = buildNewSection(projectId, name, existing, currentUserId);
    if (!section) return null;
    try {
      await saveProjectSection(section);
      return section;
    } catch (e) {
      showToast(formatErrorForUser("グループの追加に失敗しました", e), "error");
      return null;
    }
  }, [currentUserId, saveProjectSection]);

  const renameSection = useCallback(async (section: ProjectSection, name: string) => {
    try {
      await saveProjectSection({ ...section, name, updated_by: currentUserId });
    } catch (e) {
      showToast(formatErrorForUser("グループ名の変更に失敗しました", e), "error");
    }
  }, [currentUserId, saveProjectSection]);

  const moveSection = useCallback(async (section: ProjectSection, dir: SectionMoveDir) => {
    const list = sectionsOfProject(useAppStore.getState().projectSections, section.project_id);
    const ordered = computeSectionMoveOrder(list, section.id, dir);
    if (!ordered) return;
    try {
      await reorderProjectSections(section.project_id, ordered, currentUserId);
    } catch (e) {
      showToast(formatErrorForUser("グループの並べ替えに失敗しました", e), "error");
    }
  }, [currentUserId, reorderProjectSections]);

  const reorderSections = useCallback(async (projectId: string, orderedIds: string[]) => {
    try {
      await reorderProjectSections(projectId, orderedIds, currentUserId);
    } catch (e) {
      showToast(formatErrorForUser("グループの並べ替えに失敗しました", e), "error");
    }
  }, [currentUserId, reorderProjectSections]);

  const removeSection = useCallback(async (section: ProjectSection) => {
    const count = useAppStore.getState().tasks.filter(t => !t.is_deleted && t.section_id === section.id).length;
    const note = count > 0
      ? `中のタスク（${count}件）は削除されず、「未分類」に移ります。`
      : "中にタスクはありません。";
    const ok = await confirmDialog(`グループ「${section.name}」を削除しますか？\n${note}`, { confirmLabel: "削除する" });
    if (!ok) return;
    try {
      await deleteProjectSection(section.id, currentUserId);
    } catch (e) {
      showToast(formatErrorForUser("グループの削除に失敗しました", e), "error");
    }
  }, [currentUserId, deleteProjectSection]);

  return { createSection, renameSection, moveSection, reorderSections, removeSection };
}
