// src/components/task/DeliverableLink.tsx
//
// タスク名の横に出す📎（成果物欄に http/https の URL があるときだけ）。押すと新しいタブで開く
// （rel="noopener noreferrer"）。マウスを乗せると成果物の説明（URL を除いた本文の先頭）が出る。
// URL が複数あるときは最初の1件を開く（ほかは詳細画面の成果物欄の下に並ぶ。ツールチップで案内する）。
// 実体は <a> のため、中クリック・右クリック「新しいタブで開く」・キーボード操作がそのまま使える。
// 行のクリック（タスク詳細を開く）に伝播させない。

import { useMemo } from "react";
import { buildDeliverableLink } from "../../lib/task/deliverable";

interface Props {
  deliverable: string | undefined | null;
  size?: number;
}

export function DeliverableLink({ deliverable, size = 12 }: Props) {
  const link = useMemo(() => buildDeliverableLink(deliverable), [deliverable]);
  if (!link) return null;
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      title={link.tooltip}
      aria-label={link.tooltip}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      draggable={false}
      style={{
        flexShrink: 0, fontSize: `${size}px`, lineHeight: 1, textDecoration: "none",
        cursor: "pointer", opacity: 0.8,
      }}
    >📎</a>
  );
}
