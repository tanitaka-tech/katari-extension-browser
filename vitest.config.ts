import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // 本番はエディタの esbuild が同じ内容のシムを差し込む（Katari ADR-0061 / 0084）。
      // テストには bundler が居ないので、`@katari/ext` をシムへ向ける。
      "@katari/ext": fileURLToPath(new URL("./katari-ext-shim.ts", import.meta.url)),
    },
  },
  test: {
    include: ["*.test.ts"],
  },
});
