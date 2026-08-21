// src/lib/layout/bottomStack.ts
//
// 【設計意図・v3.91】
// 画面右下（PC）／画面下端（モバイル）に積み上がる複数の固定要素——
// TaskSidePanelのフッター（PCのみ）／FAB／FAB展開メニュー／ショートカットボタン／Toast、
// モバイルはさらにボトムナビ——の bottom 座標を、1つの「積み順」として一元管理する。
//
// 【v3.86〜v3.90で起きていたこと】各要素が独立に自分の bottom 値を手書きしていたため、
// 片方を動かすたびに別の要素とぶつかった。実例：
//   - v3.86でTaskSidePanelを明示保存化した際、FABの通常位置（bottom:24px）がフッター
//     （bottom:0〜約40px）の中に入り込み、「保存ボタンの上にFABが重なる」クレームになった。
//   - Toast（bottom:84px, 高さ約36px→占有[84,120)）とショートカットボタン（PC通常時
//     bottom:100px, 高さ約28px→占有[100,128)）は、v3.90時点の値でもそもそも重なっていた
//     （モバイルは128px同士で完全一致）。「FABだけ直して終わり」にすると同種の事故が
//     別の2要素間で再発するため、今回は全要素をまとめて1つの計算に載せる。
//
// 【積み順（下から上）】
//   PC     ：TaskSidePanelフッター → FAB（→展開時はFAB展開メニュー） → ショートカットボタン → Toast
//   モバイル：ボトムナビ            → FAB（→展開時はFAB展開メニュー） → ショートカットボタン → Toast
// （TaskSidePanelはPC・タブレット専用でモバイルには出ない。TaskSidePanel.tsx冒頭コメント参照。
//   モバイルの編集はTaskEditModal＝中央寄せの全画面モーダルで、この右下スタックには参加しない）
//
// 各要素の bottom は「1つ下の要素の bottom + 高さ + クリアランス」の式で算出し、
// 手書きの数値を並べない。高さが必要な箇所は、その要素の実際のスタイル（padding・
// フォントサイズ等）から見積もった定数をここに集約し、対応するコンポーネント側も
// 同じ定数を明示 height として使う（TaskSidePanelのフッター・Toast本体・ショートカット
// ボタン・FAB展開メニュー項目）。こうすることで「見積もりが実物とズレる」余地を無くし、
// 高さを変えたら bottom 側も自動で追随する。

/** 隣接する要素どうしに最低限確保する隙間[px] */
export const STACK_CLEARANCE_PX = 12;

// ===== 土台（各プラットフォームの最下段） =====

/** TaskSidePanelのフッター（🗑削除／保存ボタン）の高さ。PCのみ（モバイルはTaskSidePanel非表示）。
 *  padding "8px 12px"（上下16px）＋ボタン実高さ(padding4px×2+10px文字=約20px)＋border-top 1px
 *  ＝約37px の実測見積りに、視認性のため少し余裕を持たせた丸め値。TaskSidePanel.tsx側の
 *  フッターdivがこの値をそのまま明示heightとして使うため、ここを変えれば実物・FAB位置の
 *  両方が追随する。 */
export const SIDE_PANEL_FOOTER_HEIGHT_PX = 40;

/** モバイルのボトムナビ（MainLayout.tsx）の高さ。56px固定（既存実装のheight:"56px"のまま）。 */
export const BOTTOM_NAV_HEIGHT_MOBILE_PX = 56;

// ===== FAB本体 =====

export const FAB_SIZE_PX = 48;
export const FAB_RIGHT_PC_PX = 24;
export const FAB_RIGHT_MOBILE_PX = 16;

/** FAB本体のbottom。
 *  PC：TaskSidePanelのフッターは開いている間だけ画面右に重なる可能性があるが、開閉のたびに
 *  FABの位置が動くとちらつく（かつ「開いた瞬間だけ重なる隙」が生まれる）ため、常にフッター分の
 *  余白を確保した位置を既定にする（クレーム「少し上へずらす」に対応。上げ幅は避けられる最小限）。
 *  モバイル：ボトムナビの上端+クリアランス（68px。既存実装と同値＝見た目は変わらない）。 */
export const FAB_BOTTOM_PC_PX = SIDE_PANEL_FOOTER_HEIGHT_PX + STACK_CLEARANCE_PX; // 40+12=52
export const FAB_BOTTOM_MOBILE_PX = BOTTOM_NAV_HEIGHT_MOBILE_PX + STACK_CLEARANCE_PX; // 56+12=68

// ===== FAB展開メニュー（3項目：AI相談／マイルストーン／タスク）：FAB本体の直上に積み上がる =====

/** メニュー項目の高さ。PCは既存実装のheight:"38px"固定をそのまま踏襲（実測そのもの）。
 *  モバイルは明示heightを新設し、この値をQuickAddFab.tsx側にも使わせる（padding "10px 16px"+
 *  fontSize13pxの自然な高さ＝約35pxに近い丸め値）。 */
const FAB_MENU_ITEM_HEIGHT_PC_PX = 38;
export const FAB_MENU_ITEM_HEIGHT_MOBILE_PX = 40;

const FAB_MENU_ITEM_GAP_PC_PX = 6;
const FAB_MENU_ITEM_GAP_MOBILE_PX = 8;
const FAB_MENU_ITEM_COUNT = 3;

/** FAB本体の直上に密着させる隙間（旧実装＝FAB上端の2px上からメニューが始まる、を踏襲） */
const FAB_TO_MENU_GAP_PX = 2;

function menuStackHeight(itemHeight: number, gap: number): number {
  return FAB_MENU_ITEM_COUNT * itemHeight + (FAB_MENU_ITEM_COUNT - 1) * gap;
}

/** FAB展開メニュー（3項目の列）自体のbottom。QuickAddFab.tsxが使う。 */
export const FAB_MENU_BOTTOM_PC_PX = FAB_BOTTOM_PC_PX + FAB_SIZE_PX + FAB_TO_MENU_GAP_PX; // 52+48+2=102
export const FAB_MENU_BOTTOM_MOBILE_PX = FAB_BOTTOM_MOBILE_PX + FAB_SIZE_PX + FAB_TO_MENU_GAP_PX; // 68+48+2=118

/** FAB展開メニューの上端（3項目+gap分の高さを足した値）。ショートカットボタンの退避先計算・
 *  機械チェック（重なり検査）の両方で使うため export する。 */
export const FAB_MENU_TOP_PC_PX = FAB_MENU_BOTTOM_PC_PX + menuStackHeight(FAB_MENU_ITEM_HEIGHT_PC_PX, FAB_MENU_ITEM_GAP_PC_PX);
export const FAB_MENU_TOP_MOBILE_PX = FAB_MENU_BOTTOM_MOBILE_PX + menuStackHeight(FAB_MENU_ITEM_HEIGHT_MOBILE_PX, FAB_MENU_ITEM_GAP_MOBILE_PX);

// ===== ショートカットボタン =====

/** ショートカットボタンの高さ。padding "6px 10px"（上下12px）+アイコン・文字(fontSize11-12px)
 *  の実測見積り。MainLayout.tsx側がこの値を明示heightとして使う。 */
export const SHORTCUTS_BUTTON_HEIGHT_PX = 28;

/** 通常時（FABメニュー閉時）：FAB本体の上端+クリアランス */
export const SHORTCUTS_BOTTOM_PC_PX = FAB_BOTTOM_PC_PX + FAB_SIZE_PX + STACK_CLEARANCE_PX; // 52+48+12=112
export const SHORTCUTS_BOTTOM_MOBILE_PX = FAB_BOTTOM_MOBILE_PX + FAB_SIZE_PX + STACK_CLEARANCE_PX; // 68+48+12=128

/** FABメニュー展開時：展開メニューの上端+クリアランスへ退避 */
export const SHORTCUTS_BOTTOM_FAB_OPEN_PC_PX = FAB_MENU_TOP_PC_PX + STACK_CLEARANCE_PX;
export const SHORTCUTS_BOTTOM_FAB_OPEN_MOBILE_PX = FAB_MENU_TOP_MOBILE_PX + STACK_CLEARANCE_PX;

// ===== Toast =====

/** Toast1件の高さ。padding "10px 16px"（上下20px）+アイコン・文字(fontSize12px)の実測見積り。
 *  Toast.tsx側がこの値を明示heightとして使う。 */
export const TOAST_ITEM_HEIGHT_PX = 40;

/** ToastはFABメニューの開閉によらず出現しうる（保存完了・エラー等はいつでも起こる）ため、
 *  開閉のたびに位置を動かすとちらつく。ショートカットボタンが最も高い位置に来る
 *  「FABメニュー展開時」を基準に、常にその上へ静的に確保する（どちらの状態でも重ならない）。 */
export const TOAST_BOTTOM_PC_PX = SHORTCUTS_BOTTOM_FAB_OPEN_PC_PX + SHORTCUTS_BUTTON_HEIGHT_PX + STACK_CLEARANCE_PX;
export const TOAST_BOTTOM_MOBILE_PX = SHORTCUTS_BOTTOM_FAB_OPEN_MOBILE_PX + SHORTCUTS_BUTTON_HEIGHT_PX + STACK_CLEARANCE_PX;
