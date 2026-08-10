import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { gzipSync, strToU8 } from "fflate";
import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 【設計意図】
 * pdfjs-dist の cmaps・standard_fonts（CJKの文字コード解決・代替フォント表示に使う補助
 * データ）は pdfjs-dist 自体にCDNフォールバックが無く（未設定時は例外を投げるだけ。
 * src/lib/pdfText.ts 参照）、外部への接続を一切発生させないためにローカルで配信する必要がある。
 * node_modules/pdfjs-dist から public/pdfjs/ へコピーし、Vite開発サーバー・本番ビルドの
 * 両方で same-origin の静的ファイルとして配信させる（src/lib/pdfText.ts の cMapUrl /
 * standardFontDataUrl が参照するパスと対応）。
 * バイナリ（cmap/フォント計約2.3MB）をリポジトリにコミットしたくないため public/pdfjs/ は
 * .gitignore 対象にし、package.json記載のpdfjs-distバージョンと突き合わせたマーカーファイルで
 * 再コピーが要らないときは何もしない（開発サーバー起動のたびにコピーし直さない）。
 */
function ensurePdfjsAssets(): void {
  const pdfjsDir = join(__dirname, "node_modules/pdfjs-dist");
  if (!existsSync(pdfjsDir)) return; // npm install前の一時的な状態を落とさない
  const pkgVersion: string = JSON.parse(
    readFileSync(join(pdfjsDir, "package.json"), "utf-8"),
  ).version;
  const destRoot = join(__dirname, "public/pdfjs");
  const marker = join(destRoot, ".version");
  if (existsSync(marker) && readFileSync(marker, "utf-8") === pkgVersion) return;
  mkdirSync(destRoot, { recursive: true });
  for (const name of ["cmaps", "standard_fonts"]) {
    cpSync(join(pdfjsDir, name), join(destRoot, name), { recursive: true });
  }
  writeFileSync(marker, pkgVersion, "utf-8");
}
ensurePdfjsAssets();

/**
 * 【設計意図】
 * React.lazy で分割した各チャンクの実サイズ（raw / gzip）を、ビルド時に実測して
 * dist/chunk-sizes.json へ書き出すプラグイン。
 * ダウンロード確認ダイアログ（src/lib/chunkSizeGate.ts）が閾値判定に使う唯一のデータ
 * ソースであり、サイズをコード中にハードコードしない（ビルド内容とズレて嘘の数字に
 * なるのを防ぐため）。rollup の generateBundle フック（全チャンクのコード・ファイル名が
 * 確定した直後に走る唯一のタイミング）から実測する。gzip計算には Node組込のzlibではなく
 * 既存依存の fflate（docxText.ts で既に使用中）を再利用し、新規パッケージを増やさない。
 * このJSONはビルド成果物としてdist直下に置かれ、実行時にアプリがfetchして読む
 * （ビルドすれば自動で正しい数字になる＝手動更新が要らない）。
 */
function chunkSizeManifestPlugin(): Plugin {
  return {
    name: "chunk-size-manifest",
    generateBundle(_options, bundle) {
      const sizes: Record<string, { raw: number; gzip: number }> = {};
      for (const file of Object.values(bundle)) {
        if (file.type !== "chunk") continue;
        const code: string = file.code;
        sizes[file.name] = {
          raw: strToU8(code).length,
          gzip: gzipSync(strToU8(code)).length,
        };
      }
      this.emitFile({
        type: "asset",
        fileName: "chunk-sizes.json",
        source: JSON.stringify(sizes),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), chunkSizeManifestPlugin()],
  server: { port: 5173, host: true },
  // ビルド日時（UTC ISO文字列）をコードに焼き込む。表示側（src/lib/version.ts）で
  // Asia/Tokyoへ変換する。dev サーバーではこの値＝dev起動時刻になる（それで構わない）。
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
});
