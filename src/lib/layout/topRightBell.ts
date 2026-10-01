// src/lib/layout/topRightBell.ts
//
// 画面右上に常設するベル（v3.129・CLAUDE.md Section 67）の位置と、各画面のヘッダーが空けておく幅。
// PC：画面右上に position:fixed で置く（AI相談パネルが開いているときはその左へ退く＝FAB と同じ避け方）。
//     各ビューのヘッダー（右端にボタンが並ぶ行）は padding-right に CSS 変数 --app-bell-reserve を足して、
//     ベルの下にボタンが潜り込まないようにする（MainLayout が PC のときだけ値を入れる。モバイル・ゲストは 0）。
// モバイル：ヘッダーの右端に並べる（fixed にしない）ため、この予約は使わない。

/** globals.css の body の padding（PC）。アプリの角丸カードの外周 */
export const APP_FRAME_INSET_PC_PX = 8;

// 一覧のツールバー（1段・約38px。Section 60）の高さに収まる大きさ
export const APP_BELL_SIZE_PC_PX = 32;
export const APP_BELL_SIZE_MOBILE_PX = 32;
/** 角丸カードの上端からの距離 */
export const APP_BELL_TOP_PC_PX = 3;
/** 角丸カード（または AI 相談パネル）の右端からの距離 */
export const APP_BELL_RIGHT_PC_PX = 10;
/** ベルとヘッダーのボタンの間に空ける隙間 */
export const APP_BELL_GAP_PX = 6;

/** ヘッダーが右端に空けておく幅（ベル本体＋右の余白＋隙間） */
export const APP_BELL_RESERVE_PC_PX = APP_BELL_RIGHT_PC_PX + APP_BELL_SIZE_PC_PX + APP_BELL_GAP_PX;

export const APP_BELL_RESERVE_VAR = "--app-bell-reserve";

/** ヘッダーの padding-right：元の余白＋ベルの予約幅（予約が無い画面では元の余白のまま） */
export function withBellReserve(basePx: number): string {
  return `calc(${basePx}px + var(${APP_BELL_RESERVE_VAR}, 0px))`;
}

/** PC のベルの top（ビューポート基準） */
export const APP_BELL_FIXED_TOP_PX = APP_FRAME_INSET_PC_PX + APP_BELL_TOP_PC_PX;

/** PC のベルの right（ビューポート基準）。AI 相談パネル（PC は角丸カード内の右端に並ぶ）が開いていればその幅だけ左へ */
export function computeBellRightPc(consultOpen: boolean, consultPanelWidth: number): number {
  return APP_FRAME_INSET_PC_PX + APP_BELL_RIGHT_PC_PX + (consultOpen ? Math.max(0, consultPanelWidth) : 0);
}

/** 右上に出るカード型の通知（super_admin 向けのヘルスバナー）の top。ベルの下に置いて重ねない */
export const BELOW_BELL_TOP_PX = APP_BELL_FIXED_TOP_PX + APP_BELL_SIZE_PC_PX + 10;
