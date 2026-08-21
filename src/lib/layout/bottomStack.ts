// src/lib/layout/bottomStack.ts
//
// 【設計意図・v3.91】
// 画面右下（PC）／画面下端（モバイル）に積み上がる複数の固定要素——
// FAB／FAB展開メニュー／ショートカットボタン／Toast、モバイルはさらにボトムナビ——の
// bottom 座標を、1つの「積み順」として一元管理する。
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
// 【v3.91〜v3.92：TaskSidePanelフッターとの縦の衝突をFABの上げ幅で回避（廃止済み）】
// v3.91はFABをTaskSidePanelフッターの直上（bottom:52px）に固定することで縦方向の衝突を
// 避けていたが、この「上げ幅」は拡大率・最小フォントサイズ設定・OSの表示スケール次第で
// 実際のフッター高さが変わりうる前提の上に成り立つ見積もりで、値を足しても別の環境の
// 利用者ではまた重なりうるという構造的な弱さを抱えていた（実際に「人によっては依然として
// 被る」というクレームが再発した）。v3.94でこの依存自体を無くした（下記参照）。
//
// 【v3.94：TaskSidePanelとの関係は「横へ退避」に変更し、この1次元スタックから外した】
// TaskSidePanelが開いている間は、FAB（と展開メニュー・ショートカットボタン等の右下スタック
// 全体ではなくFAB自体）をパネル幅ぶん右へ（＝画面上は左へ）退避させる方式にした
// （src/stores/uiLayoutStore.ts・QuickAddFab.tsxのextraAvoidWidthPx参照。CLAUDE.md Section 49）。
// これによりFABとTaskSidePanelフッターは横方向で常に分離され、縦方向の衝突が構造的に
// 起きなくなったため、FABの縦位置（bottom）を「フッターを避けるために上げる」必要が
// 無くなった。v3.86以前と同じ自然な位置（24px）に戻し、SIDE_PANEL_FOOTER_HEIGHT_PXへの
// 依存も削除した。この1次元（bottom座標のみを見る）スタックはあくまで「同じ右下の縦列を
// 共有する要素」を対象にしたモデルであり、横に退避したTaskSidePanelフッターはもはや
// この縦列を共有しないため対象外にした（実際に重ならないことの検証は
// src/lib/layout/devOverlapCheck.ts の開発ビルド限定ランタイム実測チェックに委ねる）。
//
// 【積み順（下から上）】
//   PC     ：FAB（→展開時はFAB展開メニュー） → ショートカットボタン → Toast
//   モバイル：ボトムナビ → FAB（→展開時はFAB展開メニュー） → ショートカットボタン → Toast
// （TaskSidePanelはPC・タブレット専用でモバイルには出ない。TaskSidePanel.tsx冒頭コメント参照。
//   モバイルの編集はTaskEditModal＝中央寄せの全画面モーダルで、この右下スタックには参加しない）
//
// 各要素の bottom は「1つ下の要素の bottom + 高さ + クリアランス」の式で算出し、
// 手書きの数値を並べない。高さが必要な箇所は、その要素の実際のスタイル（padding・
// フォントサイズ等）から見積もった定数をここに集約し、対応するコンポーネント側も
// 同じ定数を明示 height として使う（Toast本体・ショートカットボタン・FAB展開メニュー項目）。
// こうすることで「見積もりが実物とズレる」余地を無くし、高さを変えたら bottom 側も自動で
// 追随する。ただし「実際の描画サイズが定数どおりであること」自体は拡大率・フォント設定に
// 左右されうるため保証できない（CLAUDE.md Section 49）。この関係は明示height（最小保証）＋
// devOverlapCheck.ts（実測での再発検知）の組み合わせで守っている。

/** 隣接する要素どうしに最低限確保する隙間[px]。
 *  【v3.94：12→16へ引き上げ】これは「見積もりを少し大きくする」対応であり、クレームの構造
 *  （値を足しても別の拡大率・フォント設定の利用者ではまた起きうる）そのものへの解決には
 *  ならないと認識している。恒久対応は devOverlapCheck.ts の実測チェック（山本さんが拡大率
 *  等を変えて確認したときにコンソールで気づける仕組み）に委ねている。CLAUDE.md Section 49参照。 */
export const STACK_CLEARANCE_PX = 16;

// ===== 土台（各プラットフォームの最下段） =====

/** TaskSidePanelのフッター（🗑削除／保存ボタン）の高さ。PCのみ（モバイルはTaskSidePanel非表示）。
 *  padding "8px 12px"（上下16px）＋ボタン実高さ(padding4px×2+10px文字=約20px)＋border-top 1px
 *  ＝約37px の実測見積りに、視認性のため少し余裕を持たせた丸め値。TaskSidePanel.tsx側の
 *  フッターdivがこの値をそのまま明示heightとして使う。
 *  【v3.94】FABの位置計算からはこの定数への依存を外した（横へ退避する方式に変更したため）。
 *  TaskSidePanel自身の見た目の高さとしてのみ引き続き使う。 */
export const SIDE_PANEL_FOOTER_HEIGHT_PX = 40;

/** モバイルのボトムナビ（MainLayout.tsx）の高さ。56px固定（既存実装のheight:"56px"のまま）。 */
export const BOTTOM_NAV_HEIGHT_MOBILE_PX = 56;

// ===== FAB本体 =====

export const FAB_SIZE_PX = 48;
export const FAB_RIGHT_PC_PX = 24;
export const FAB_RIGHT_MOBILE_PX = 16;

/** FAB本体のbottom。
 *  【v3.94】PC：TaskSidePanelとは横方向の退避（uiLayoutStore経由）で分離するようにしたため、
 *  縦位置をフッター回避のために上げる必要が無くなった。v3.86以前と同じ自然な位置（24px）に
 *  戻した（詳細はファイル冒頭コメント・CLAUDE.md Section 49参照）。
 *  モバイル：ボトムナビの上端+クリアランス（TaskSidePanelはモバイルに出ないため変更なし。
 *  クリアランスを12→16へ引き上げた分だけ68→72pxへ変わる）。 */
export const FAB_BOTTOM_PC_PX = 24;
export const FAB_BOTTOM_MOBILE_PX = BOTTOM_NAV_HEIGHT_MOBILE_PX + STACK_CLEARANCE_PX; // 56+16=72

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
export const FAB_MENU_BOTTOM_PC_PX = FAB_BOTTOM_PC_PX + FAB_SIZE_PX + FAB_TO_MENU_GAP_PX; // 24+48+2=74
export const FAB_MENU_BOTTOM_MOBILE_PX = FAB_BOTTOM_MOBILE_PX + FAB_SIZE_PX + FAB_TO_MENU_GAP_PX; // 72+48+2=122

/** FAB展開メニューの上端（3項目+gap分の高さを足した値）。ショートカットボタンの退避先計算・
 *  機械チェック（重なり検査）の両方で使うため export する。 */
export const FAB_MENU_TOP_PC_PX = FAB_MENU_BOTTOM_PC_PX + menuStackHeight(FAB_MENU_ITEM_HEIGHT_PC_PX, FAB_MENU_ITEM_GAP_PC_PX);
export const FAB_MENU_TOP_MOBILE_PX = FAB_MENU_BOTTOM_MOBILE_PX + menuStackHeight(FAB_MENU_ITEM_HEIGHT_MOBILE_PX, FAB_MENU_ITEM_GAP_MOBILE_PX);

// ===== ショートカットボタン =====

/** ショートカットボタンの高さ。padding "6px 10px"（上下12px）+アイコン・文字(fontSize11-12px)
 *  の実測見積り。MainLayout.tsx側がこの値を明示heightとして使う。 */
export const SHORTCUTS_BUTTON_HEIGHT_PX = 28;

/** 通常時（FABメニュー閉時）：FAB本体の上端+クリアランス */
export const SHORTCUTS_BOTTOM_PC_PX = FAB_BOTTOM_PC_PX + FAB_SIZE_PX + STACK_CLEARANCE_PX; // 24+48+16=88
export const SHORTCUTS_BOTTOM_MOBILE_PX = FAB_BOTTOM_MOBILE_PX + FAB_SIZE_PX + STACK_CLEARANCE_PX; // 72+48+16=136

/** FABメニュー展開時：展開メニューの上端+クリアランスへ退避 */
export const SHORTCUTS_BOTTOM_FAB_OPEN_PC_PX = FAB_MENU_TOP_PC_PX + STACK_CLEARANCE_PX;
export const SHORTCUTS_BOTTOM_FAB_OPEN_MOBILE_PX = FAB_MENU_TOP_MOBILE_PX + STACK_CLEARANCE_PX;

// ===== Toast =====

/** Toast1件の高さ。padding "10px 16px"（上下20px）+アイコン・文字(fontSize12px)の実測見積り。
 *  Toast.tsx側がこの値を明示heightとして使う。 */
export const TOAST_ITEM_HEIGHT_PX = 40;

/**
 * 【v3.92：Toastは「FABの真上まで」に留める（v3.91からの修正）】
 * v3.91では「ショートカットボタンが最も高い位置に来るFABメニュー展開時」を基準にToastを
 * 静的に確保しており、通常時のToastが画面の下から1/3ほど（280px）まで押し上げられていた。
 * これは「どの2つも重ならない」という不変条件を、重なっても実害の無いペアにまで一律に
 * 適用したことが原因だった（統括の指摘）。
 *
 * このスタックが守るべき不変条件は「操作を妨げないこと」であって「一切重ならないこと」では
 * ない。要素は次の2種に分かれる：
 *   - FAB（と、その展開メニュー3項目）：利用者が押したい主要な操作ボタン。隠してはいけない。
 *   - ショートカットボタン：常設だが補助的なaffordance。数秒間Toastに隠れても実害が無い
 *     （通知が消えれば元に戻る）。
 * Toastはz-index最前面に出るうえ数秒で自動消去される一過性の表示であるため、「FABを隠さない」
 * ことだけを守り、「ショートカットボタンと重ならない」ことまでは要求しない。
 *
 * そのためToastの位置は「FAB本体の上端+クリアランス」＝ショートカットボタンの通常位置
 * （SHORTCUTS_BOTTOM_PC_PX/MOBILE_PX）と同じ高さになる（数値が一致するのは偶然ではなく、
 * どちらも「FABの直上に一段だけ載る」という同じ設計だから）。Toast⇔ショートカットボタンの
 * 重なりは意図した許容であり、bottomStack.test.tsのALLOWED_OVERLAPSに理由付きで登録している
 * （FABメニュー展開時にもToastとメニューが重なりうるが、これも同じ理由で許容している。
 * 詳細はテストファイルのコメント参照）。
 */
export const TOAST_BOTTOM_PC_PX = FAB_BOTTOM_PC_PX + FAB_SIZE_PX + STACK_CLEARANCE_PX; // 24+48+16=88
export const TOAST_BOTTOM_MOBILE_PX = FAB_BOTTOM_MOBILE_PX + FAB_SIZE_PX + STACK_CLEARANCE_PX; // 72+48+16=136
