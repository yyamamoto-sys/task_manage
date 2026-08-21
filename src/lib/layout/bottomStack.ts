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
// 被る」というクレームが再発した）。v3.94でこの依存自体を無くした。
//
// 【v3.94：TaskSidePanelとの関係は「横へ退避」に変更し、この1次元スタックから外した】
// TaskSidePanelが開いている間は、FAB自体をパネル幅ぶん右へ（＝画面上は左へ）退避させる
// 方式にした（src/stores/uiLayoutStore.ts・QuickAddFab.tsxのextraAvoidWidthPx参照。
// CLAUDE.md Section 49）。これによりFABとTaskSidePanelフッターは横方向で常に分離され、
// 縦方向の衝突が構造的に起きなくなったため、FABの縦位置（bottom）を「フッターを避けるために
// 上げる」必要が無くなった。v3.86以前と同じ自然な位置（24px）に戻した。
//
// 【v3.95：固定heightをやめ、実測が必要な依存だけResizeObserverで組む】
// v3.91→v3.94の3回にわたって「見積もりと実物のズレ」を直しきれずにいた。理由は3つ重なって
// いた：①見積もり値をハードコードして少し足すだけの対応（v3.91）②bottomStack.test.tsが
// 定数どうしの整合性しか検査せず、実物とのズレを検知できない（v3.91〜v3.94）③固定height
// そのものが「人による設定で中身が切れる」原因だと認識しながら、検出できないとだけ書いて
// 直していなかった（v3.94の2-2）。
//
// v3.95で以下のとおり整理した：
// - 文字を含む要素（TaskSidePanelフッター・ショートカットボタン・Toast・ボトムナビ・
//   FAB展開メニュー項目）は、固定heightをやめてminHeightにした。ここに並ぶ定数は
//   「最低保証の高さ」であり、拡大率・最小フォントサイズ設定で中身が大きくなれば箱ごと
//   伸びる（＝切れない）。FAB本体だけはアイコンのみの48x48固定正円のため、文字の
//   拡大に影響されず引き続き固定サイズで良い。
// - 残る「本当の縦の依存」は2つだけ（他は下から積むだけの静的な式で足りる）：
//   1. モバイルのボトムナビ→FAB：ボトムナビが実際に高くなると、その分FABも押し上げないと
//      ナビに埋もれる。useUiLayoutStoreのmobileBottomNavHeightPxにResizeObserver（
//      MainLayout.tsx）で実測値を反映し、computeFabBottomMobile()で使う。
//   2. FAB展開メニュー→退避したショートカットボタン：メニュー項目が実際に高くなると、
//      退避後のショートカットの位置も合わせて上げないとメニューに埋もれる。
//      useUiLayoutStoreのfabMenuHeightPxにResizeObserver（QuickAddFab.tsx）で
//      実測値を反映し、computeFabMenuTop()で使う。
//   ショートカットボタン・Toastの「通常時（FABメニュー非表示）」の位置は、この2つの
//   実測値から computeAboveFabBottom() で機械的に導出する（FAB本体の高さは固定のため、
//   ここは新たな実測を要らない）。
// - 開発ビルド限定のランタイムチェック（devOverlapCheck.ts）は、重なり検査に加えて
//   「中身が箱からあふれていないか」（scrollHeight>clientHeight）も見るようにした。
//   固定height方式が引き起こす「切れ」は重なり検査では原理的に検出できないため。

/** 隣接する要素どうしに最低限確保する隙間[px]。
 *  【v3.94：12→16へ引き上げ】これは「見積もりを少し大きくする」対応であり、クレームの構造
 *  （値を足しても別の拡大率・フォント設定の利用者ではまた起きうる）そのものへの解決には
 *  ならないと認識している。実質的な再発防止は v3.95 の「固定heightをやめる」「実依存だけ
 *  実測する」対応（このファイル冒頭コメント参照）と devOverlapCheck.ts に委ねている。 */
export const STACK_CLEARANCE_PX = 16;

// ===== 土台（各プラットフォームの最下段） =====

/** TaskSidePanelのフッター（🗑削除／保存ボタン）の最低保証の高さ。PCのみ（モバイルは
 *  TaskSidePanel非表示）。padding "8px 12px"（上下16px）＋ボタン実高さ(約20px)＋
 *  border-top 1px＝約37pxの実測見積りに、視認性のため少し余裕を持たせた丸め値。
 *  【v3.95】TaskSidePanel.tsx側は height ではなく minHeight としてこの値を使う（中身
 *  （ボタンの文字）が拡大率・最小フォントサイズ設定で大きくなっても切れないようにするため）。
 *  FABの位置計算はv3.94時点で既にこの定数への依存を外している（横へ退避する方式のため）。 */
export const SIDE_PANEL_FOOTER_MIN_HEIGHT_PX = 40;

/** モバイルのボトムナビ（MainLayout.tsx）の最低保証の高さ。
 *  【v3.95】固定heightをやめ minHeight にした。実際の描画高さはMainLayout.tsxが
 *  ResizeObserverで実測し、useUiLayoutStoreのmobileBottomNavHeightPxへ反映する
 *  （初期値・未測定時のフォールバックとしてこの定数を使う）。FABの縦位置（モバイル）は
 *  この実測値から computeFabBottomMobile() で算出する＝残る2つの実依存の1つ。 */
export const BOTTOM_NAV_MIN_HEIGHT_MOBILE_PX = 56;

// ===== FAB本体 =====
// アイコン（＋）のみの48x48固定正円。文字を含まないため拡大率・最小フォントサイズ設定の
// 影響を受けない＝固定サイズのままで良い（v3.95でも変更していない）。

export const FAB_SIZE_PX = 48;
export const FAB_RIGHT_PC_PX = 24;
export const FAB_RIGHT_MOBILE_PX = 16;

/** FAB本体のbottom（PC）。TaskSidePanelとは横方向の退避（uiLayoutStore経由）で分離する
 *  ため、縦位置をフッター回避のために上げる必要が無い（v3.94で24pxへ戻した。詳細はファイル
 *  冒頭コメント・CLAUDE.md Section 49参照）。PCにはモバイルのボトムナビに相当する可変要素が
 *  無いため、静的な値のままで良い。 */
export const FAB_BOTTOM_PC_PX = 24;

/**
 * FAB本体のbottom（モバイル）。【v3.95】ボトムナビの実測高さ（useUiLayoutStoreの
 * mobileBottomNavHeightPx）から算出する（残る2つの実依存の1つ目）。ボトムナビが実際に
 * 高くなった分だけFABも押し上げないと、ナビに埋もれてしまうため。
 */
export function computeFabBottomMobile(measuredBottomNavHeightPx: number): number {
  return measuredBottomNavHeightPx + STACK_CLEARANCE_PX;
}

// ===== FAB展開メニュー（3項目：AI相談／マイルストーン／タスク）：FAB本体の直上に積み上がる =====

/** メニュー項目の最低保証の高さ。【v3.95】固定heightをやめ minHeight にした（中身の文字が
 *  拡大率・最小フォントサイズ設定で大きくなっても切れないように）。PC/モバイルとも
 *  QuickAddFab.tsx側がこの定数をminHeightとして使う（PCは従来「38px」を直書きしていたが、
 *  この定数の直接インポートに揃えた）。 */
export const FAB_MENU_ITEM_MIN_HEIGHT_PC_PX = 38;
export const FAB_MENU_ITEM_MIN_HEIGHT_MOBILE_PX = 40;

export const FAB_MENU_ITEM_GAP_PC_PX = 6;
export const FAB_MENU_ITEM_GAP_MOBILE_PX = 8;
export const FAB_MENU_ITEM_COUNT = 3;

/** FAB本体の直上に密着させる隙間（旧実装＝FAB上端の2px上からメニューが始まる、を踏襲） */
export const FAB_TO_MENU_GAP_PX = 2;

function menuStackHeight(itemHeight: number, gap: number): number {
  return FAB_MENU_ITEM_COUNT * itemHeight + (FAB_MENU_ITEM_COUNT - 1) * gap;
}

/** メニュー全体の高さの「最低保証」見積もり（未測定時のフォールバック用）。実際の高さは
 *  QuickAddFab.tsxがResizeObserverで実測し、useUiLayoutStoreのfabMenuHeightPxへ
 *  反映する（残る2つの実依存の2つ目）。 */
export const FAB_MENU_STACK_HEIGHT_ESTIMATE_PC_PX = menuStackHeight(FAB_MENU_ITEM_MIN_HEIGHT_PC_PX, FAB_MENU_ITEM_GAP_PC_PX);
export const FAB_MENU_STACK_HEIGHT_ESTIMATE_MOBILE_PX = menuStackHeight(FAB_MENU_ITEM_MIN_HEIGHT_MOBILE_PX, FAB_MENU_ITEM_GAP_MOBILE_PX);

/** FAB展開メニュー（3項目の列）自体のbottom。QuickAddFab.tsxが使う。FAB本体のbottomから
 *  常に一定の式で求まる（FAB本体の高さは固定のため実測は不要）。 */
export function computeFabMenuBottom(fabBottomPx: number): number {
  return fabBottomPx + FAB_SIZE_PX + FAB_TO_MENU_GAP_PX;
}

/**
 * FAB展開メニューの上端。ショートカットボタンの退避先計算に使う（残る2つの実依存の2つ目）。
 * measuredMenuStackHeightPxにはQuickAddFab.tsxが実測した値（未測定時は
 * FAB_MENU_STACK_HEIGHT_ESTIMATE_*_PXにフォールバック）を渡すこと。
 */
export function computeFabMenuTop(fabMenuBottomPx: number, measuredMenuStackHeightPx: number): number {
  return fabMenuBottomPx + measuredMenuStackHeightPx;
}

/** FABメニュー展開時：展開メニューの上端+クリアランスへショートカットボタンを退避させる。 */
export function computeShortcutsBottomFabOpen(fabMenuTopPx: number): number {
  return fabMenuTopPx + STACK_CLEARANCE_PX;
}

// ===== ショートカットボタン =====

/** ショートカットボタンの最低保証の高さ。【v3.95】固定heightをやめ minHeight にした
 *  （中身の文字「⌨ ショートカット」が拡大率・最小フォントサイズ設定で大きくなっても
 *  切れないように）。MainLayout.tsx側がこの値をminHeightとして使う。 */
export const SHORTCUTS_BUTTON_MIN_HEIGHT_PX = 28;

/**
 * ショートカットボタン・Toastの「通常時（FABメニュー非表示）」のbottom。FAB本体の上端+
 * クリアランス。FAB本体は48x48の固定正円（アイコンのみ・文字を含まない）なので高さは
 * 常にFAB_SIZE_PXで確定してよく、追加の実測は不要。
 */
export function computeAboveFabBottom(fabBottomPx: number): number {
  return fabBottomPx + FAB_SIZE_PX + STACK_CLEARANCE_PX;
}

/** PC：FAB本体のbottomが静的なため、通常時のショートカット/Toastのbottomも静的に確定できる。 */
export const SHORTCUTS_BOTTOM_PC_PX = computeAboveFabBottom(FAB_BOTTOM_PC_PX);

/** FAB展開メニューのbottom（PC）。FAB本体のbottomが静的なため静的に確定できる。 */
export const FAB_MENU_BOTTOM_PC_PX = computeFabMenuBottom(FAB_BOTTOM_PC_PX);

// ===== Toast =====

/** Toast1件の最低保証の高さ。【v3.95】固定heightをやめ minHeight にした（通知メッセージが
 *  拡大率・最小フォントサイズ設定で複数行に伸びても切れないように）。Toast.tsx側がこの値を
 *  minHeightとして使う。 */
export const TOAST_ITEM_MIN_HEIGHT_PX = 40;

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
 * ことだけを守り、「ショートカットボタンと重ならない」ことまでは要求しない。Toastの位置は
 * FABメニューの開閉によらず常に静的（computeAboveFabBottomのみに依存し、
 * computeShortcutsBottomFabOpenは使わない）。
 *
 * Toast⇔ショートカットボタンの重なりは意図した許容であり、bottomStack.test.tsの
 * ALLOWED_OVERLAPSに理由付きで登録している（FABメニュー展開時にもToastとメニューが
 * 重なりうるが、これも同じ理由で許容している。詳細はテストファイルのコメント参照）。
 */
export const TOAST_BOTTOM_PC_PX = computeAboveFabBottom(FAB_BOTTOM_PC_PX);
