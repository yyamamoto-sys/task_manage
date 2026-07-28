// src/components/lab/widgets/__tests__/widgetContract.test.ts
//
// 【設計意図】
// docs/dev/widget-authoring.md に書いた契約を、文章だけでなくテストで強制する。
// 将来ここに引っかかるのは（人間ではなく）Claude Code が生成したウィジェットである可能性が
// 高いため、失敗メッセージは「何が・どのファイルで・なぜダメか・どう直すか」まで含める。
//
// fs で src/components/lab/widgets/*.tsx を読み、①禁止import ②外部通信 ③レジストリの
// 不変条件、を検査する。vitest の実行環境は environment:"node"（vitest.config.ts）のため
// fs/path はそのまま使える。パス解決は process.cwd() に依存させず import.meta.url 基準にする
// （どのディレクトリから vitest を実行しても同じ結果になるようにするため）。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WIDGET_REGISTRY } from "../registry";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WIDGETS_DIR = path.resolve(__dirname, "..");

/** widgets/ 直下（サブディレクトリを除く）の .tsx ファイル名一覧 */
function listWidgetTsxFiles(): string[] {
  return fs
    .readdirSync(WIDGETS_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith(".tsx"))
    .map(e => e.name)
    .sort();
}

function readWidgetFile(fileName: string): string {
  return fs.readFileSync(path.join(WIDGETS_DIR, fileName), "utf-8");
}

const FORBIDDEN_IMPORT_PATTERNS: { pattern: RegExp; label: string; fix: string }[] = [
  {
    pattern: /\buseAppStore\b/,
    label: "useAppStore",
    fix: "useAppStore を直接呼ばず、WidgetContext.data（ホストが渡す部署スコープ済みデータ）だけを使ってください。",
  },
  {
    pattern: /stores\/appStore/,
    label: "stores/appStore からの import",
    fix: "appStore を直接 import せず、WidgetContext 経由でデータ・アクションを受け取ってください。",
  },
  {
    pattern: /from\s+["'][^"']*supabase[^"']*["']/,
    label: "supabase クライアントの import",
    fix: "supabase を直接呼ばず、書き込みが必要なら WidgetContext.actions に無い機能をホスト側（MyPageView→MainLayout）に追加する形で実装してください（docs/dev/widget-authoring.md「副作用（書き込み）を増やしたいとき」参照）。",
  },
];

const FORBIDDEN_NETWORK_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bfetch\s*\(/, label: "fetch(" },
  { pattern: /\bXMLHttpRequest\b/, label: "XMLHttpRequest" },
  { pattern: /\bWebSocket\s*\(/, label: "WebSocket(" },
];

describe("ウィジェット契約：禁止import", () => {
  const files = listWidgetTsxFiles();

  it("widgets ディレクトリに .tsx ファイルが存在する（テスト自体の健全性チェック）", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s が useAppStore / stores/appStore / supabase を import していない", fileName => {
    const content = readWidgetFile(fileName);
    const violations = FORBIDDEN_IMPORT_PATTERNS.filter(({ pattern }) => pattern.test(content));
    if (violations.length > 0) {
      const details = violations.map(v => `  - ${v.label} が見つかりました。${v.fix}`).join("\n");
      throw new Error(
        `[widgetContract] ${fileName} が禁止されたimportを含んでいます。\n${details}\n` +
        `理由：ウィジェットは WidgetContext だけを唯一の入口としてデータ・副作用を得る契約です` +
        `（部署スコープの担保・choke point 迂回防止のため。docs/dev/widget-authoring.md 参照）。`,
      );
    }
  });
});

describe("ウィジェット契約：外部通信の検出", () => {
  const files = listWidgetTsxFiles();

  it.each(files)("%s が fetch / XMLHttpRequest / WebSocket を含んでいない", fileName => {
    const content = readWidgetFile(fileName);
    const violations = FORBIDDEN_NETWORK_PATTERNS.filter(({ pattern }) => pattern.test(content));
    if (violations.length > 0) {
      const found = violations.map(v => v.label).join(" / ");
      throw new Error(
        `[widgetContract] ${fileName} に外部通信の呼び出し（${found}）が見つかりました。\n` +
        `理由：ウィジェットからの外部API呼び出しは禁止です（ブランドコア§4・` +
        `docs/dev/widget-authoring.md「禁止事項」参照）。外部データが必要な場合は統括に相談してください。`,
      );
    }
  });
});

describe("ウィジェット契約：レジストリの不変条件", () => {
  it("id が全ウィジェットで一意である", () => {
    const ids = WIDGET_REGISTRY.map(d => d.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (duplicates.length > 0) {
      throw new Error(
        `[widgetContract] WidgetDefinition.id が重複しています：${[...new Set(duplicates)].join(", ")}\n` +
        `直し方：重複しているウィジェットのどちらか一方の id を、他と被らない安定した文字列に変更してください` +
        `（一度公開した id は変えない前提のため、まだ配布していない新規ウィジェットの id を直すこと）。`,
      );
    }
  });

  it.each(WIDGET_REGISTRY.map(d => d.id))("%s の allowedSizes が defaultSize を含む", id => {
    const def = WIDGET_REGISTRY.find(d => d.id === id)!;
    if (!def.allowedSizes.includes(def.defaultSize)) {
      throw new Error(
        `[widgetContract] ウィジェット "${id}" の allowedSizes（${def.allowedSizes.join(", ")}）に ` +
        `defaultSize（${def.defaultSize}）が含まれていません。\n` +
        `直し方：allowedSizes に defaultSize を追加するか、defaultSize を allowedSizes 内の値に変更してください。`,
      );
    }
  });

  it.each(WIDGET_REGISTRY.map(d => d.id))("%s の dataNeeds が配列として定義されている（空配列は可）", id => {
    const def = WIDGET_REGISTRY.find(d => d.id === id)!;
    if (!Array.isArray(def.dataNeeds)) {
      throw new Error(
        `[widgetContract] ウィジェット "${id}" の dataNeeds が配列ではありません。\n` +
        `直し方：実際に使うデータの種類（"tasks"/"projects"/"members"/"dependencies"/"okr"）を` +
        `配列で正直に書いてください。何も使わない場合は空配列 [] にしてください。`,
      );
    }
  });

  it("configSchema を持つウィジェットの key が、それぞれのウィジェット内で一意である", () => {
    for (const def of WIDGET_REGISTRY) {
      if (!def.configSchema || def.configSchema.length === 0) continue;
      const keys = def.configSchema.map(f => f.key);
      const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i);
      if (duplicates.length > 0) {
        throw new Error(
          `[widgetContract] ウィジェット "${def.id}" の configSchema に重複した key があります：` +
          `${[...new Set(duplicates)].join(", ")}\n` +
          `直し方：configSchema の各項目の key を、そのウィジェット内で重複しない名前に変更してください。`,
        );
      }
    }
  });

  it.each(WIDGET_REGISTRY.map(d => d.id))("%s の title / description / icon が空でない", id => {
    const def = WIDGET_REGISTRY.find(d => d.id === id)!;
    const missing: string[] = [];
    if (!def.title || def.title.trim().length === 0) missing.push("title");
    if (!def.description || def.description.trim().length === 0) missing.push("description");
    if (!def.icon || def.icon.trim().length === 0) missing.push("icon");
    if (missing.length > 0) {
      throw new Error(
        `[widgetContract] ウィジェット "${id}" の以下のフィールドが空です：${missing.join(", ")}\n` +
        `直し方：registry.ts の該当ウィジェット定義にこれらを記入してください` +
        `（title=表示名・description=一言説明・icon=絵文字1個。docs/dev/widget-authoring.md 参照）。`,
      );
    }
  });

  it("_template.tsx がレジストリに登録されていない", () => {
    const registrySource = fs.readFileSync(path.join(WIDGETS_DIR, "registry.ts"), "utf-8");
    if (/["']\.\/_template["']/.test(registrySource)) {
      throw new Error(
        `[widgetContract] registry.ts が _template.tsx を import/登録しています。\n` +
        `理由：_template.tsx はコピー用の雛形であり、そのままレジストリに登録すると画面に` +
        `「テンプレート」という中身のないウィジェットが表示されてしまいます。\n` +
        `直し方：_template.tsx をコピーして別ファイル名にリネームしたものを登録してください` +
        `（docs/dev/widget-authoring.md「5分で1個作る手順」参照）。`,
      );
    }
  });
});
