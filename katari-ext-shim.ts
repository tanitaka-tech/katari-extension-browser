/**
 * テスト時に `@katari/ext` の実体になるシム（ADR-0061 追補）。
 *
 * 本番ではエディタの esbuild がこれと同じものを差し込む
 * （`src/lib/ext/build.ts` の `SHIM_SOURCE`）。テストでは bundler が居ないので、
 * `@katari/ext` をこのファイルへ alias する:
 *
 * ```ts
 * // vitest.config.ts
 * export default defineConfig({
 *   resolve: { alias: { "@katari/ext": "./katari-ext-shim.ts" } },
 * });
 * ```
 *
 * あとは `createKatariMock()` の結果を `globalThis.__katari__` に入れてから
 * 拡張本体を import すれば、実行時と同じ経路で API が解決される。
 */

type KatariGlobal = { katari: unknown; ui: unknown };

function runtime(): KatariGlobal {
  const g = (globalThis as unknown as { __katari__?: KatariGlobal }).__katari__;
  if (!g) {
    throw new Error(
      "Katari extension runtime is not available " +
        "(set globalThis.__katari__ before importing the extension)",
    );
  }
  return g;
}

// import 時点ではまだモックが入っていないことがあるので、
// プロパティアクセスのたびに引き直す。
export const katari = new Proxy(
  {},
  {
    get: (_target, prop) => (runtime().katari as Record<string | symbol, unknown>)[prop],
  },
) as never;

export const ui = new Proxy(
  {},
  {
    get: (_target, prop) => (runtime().ui as Record<string | symbol, unknown>)[prop],
  },
) as never;

export default katari;
