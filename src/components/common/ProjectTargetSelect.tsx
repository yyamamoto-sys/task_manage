// src/components/common/ProjectTargetSelect.tsx
//
// 【設計意図】
// 「対象PJ」プルダウン（単一選択＋先頭に「すべてのPJ」）。AIパネルとダッシュボードの両方で使う共通部品。
// 既存の CustomSelect（色ドット・ポータル描画・画面外クランプ・検索付き）をそのまま使う。
// 選択肢が多いPJ構成（EGGは数十PJ）でも探せるよう、PJが PROJECT_TARGET_SEARCH_THRESHOLD 件を
// 超えたら検索欄を出す。長いPJ名は選択肢内で省略記号になるが、title に全文を持たせる。

import { useMemo } from "react";
import type { Project } from "../../lib/localData/types";
import { CustomSelect } from "./CustomSelect";
import {
  ALL_PJ_VALUE,
  MULTI_PJ_VALUE,
  PROJECT_TARGET_SEARCH_THRESHOLD,
  buildProjectTargetOptions,
} from "../../lib/project/projectTargetOptions";

interface Props {
  /** 候補のPJ（表示部署で絞り込み済みのもの。アーカイブ済みはここで除かれる） */
  projects: Project[];
  /** 選択中のPJのid。null＝すべてのPJ */
  value: string | null;
  onChange: (pjId: string | null) => void;
  /** 複数PJに絞り込み中（ダッシュボードのKRクリック）のPJ数。2以上のとき表示専用の選択肢を出す */
  multiCount?: number;
  style?: React.CSSProperties;
}

export function ProjectTargetSelect({ projects, value, onChange, multiCount, style }: Props) {
  const options = useMemo(() => buildProjectTargetOptions(projects, { multiCount }), [projects, multiCount]);
  const selectedValue = multiCount && multiCount > 1 && value == null
    ? MULTI_PJ_VALUE
    : (value != null && options.some(o => o.value === value) ? value : ALL_PJ_VALUE);

  return (
    <CustomSelect
      value={selectedValue}
      onChange={v => {
        if (v === MULTI_PJ_VALUE) return;
        onChange(v === ALL_PJ_VALUE ? null : v);
      }}
      options={options}
      searchable={options.length > PROJECT_TARGET_SEARCH_THRESHOLD + 1}
      searchPlaceholder="PJ名で検索"
      style={style}
    />
  );
}
