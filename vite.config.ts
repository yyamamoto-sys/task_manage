import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { gzipSync, strToU8 } from "fflate";

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
});
