// src/hooks/useMyPageLayout.ts
//
// 【設計意図】
// マイページ（ウィジェット）のレイアウト永続化を担うフック。appStore には足さない
// （アプリ全体で常時必要なデータではなく、マイページを開いた時だけ読む個人設定のため）。
//
// - マウント時に一度だけ DB（member_widget_layouts）から取得する
// - 変更（setLayout 呼び出し）は 800ms デバウンスで保存する
// - ゲスト（isGuestMember）は DB 読み書きを一切行わず、既定レイアウトの閲覧のみにする
//   （members に行が無いため FK違反・RLS拒否になる。呼び出し側＝MyPageView が isGuest を
//   見て編集トグル自体を出さない設計と対をなす）
// - 取得・保存の失敗は formatErrorForUser + showToast で通知し、画面は既定レイアウトのまま
//   動き続ける（マイグレ未適用でも壊れない。ローディングヒント機能と同じ方針）

import { useCallback, useEffect, useRef, useState } from "react";
import type { Member } from "../lib/localData/types";
import type { MyPageLayout } from "../lib/widgets/types";
import { createDefaultLayout, normalizeLayout } from "../lib/widgets/layout";
import { fetchMyWidgetLayout, upsertMyWidgetLayout } from "../lib/supabase/store";
import { isGuestMember } from "../lib/guestMode";
import { formatErrorForUser } from "../lib/errorMessage";
import { showToast } from "../components/common/Toast";

const SAVE_DEBOUNCE_MS = 800;

export function useMyPageLayout(currentUser: Member) {
  const isGuest = isGuestMember(currentUser);
  const [layout, setLayoutState] = useState<MyPageLayout>(() => createDefaultLayout());
  const [loading, setLoading] = useState(!isGuest);

  // フェッチが完了するまでは setLayout 経由の変更でも保存を発火させない
  // （初回フェッチ結果を state にセットする瞬間を「ユーザーの変更」と誤認して
  //  既定レイアウト等を DB に書き戻してしまうのを防ぐ）
  const initializedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    initializedRef.current = false;
    if (isGuest) {
      setLayoutState(createDefaultLayout());
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchMyWidgetLayout(currentUser.id)
      .then(raw => {
        if (cancelled) return;
        setLayoutState(normalizeLayout(raw));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        showToast(formatErrorForUser("マイページの読み込みに失敗しました", e), "error");
        // 失敗しても既定レイアウトで画面は動き続ける（初期state のまま）
      })
      .finally(() => {
        if (cancelled) return;
        initializedRef.current = true;
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [currentUser.id, isGuest]);

  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, []);

  /** layout を更新する。ゲスト・未初期化（フェッチ未完了）時は保存をスキップする */
  const setLayout = useCallback((updater: (prev: MyPageLayout) => MyPageLayout) => {
    setLayoutState(prev => {
      const next = updater(prev);
      if (!isGuest && initializedRef.current) {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          upsertMyWidgetLayout(currentUser.id, next, currentUser.id).catch((e: unknown) => {
            showToast(formatErrorForUser("マイページの保存に失敗しました", e), "error");
          });
        }, SAVE_DEBOUNCE_MS);
      }
      return next;
    });
  }, [currentUser.id, isGuest]);

  return { layout, setLayout, loading, isGuest };
}
