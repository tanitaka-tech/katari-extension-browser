/**
 * 拡張のロジックを**エディタを起動せずに**検証する（Katari ADR-0084 のテストキット）。
 *
 * `katari-ext-test.ts` が `@katari/ext` の中身を差し替えるので、本番と同じ経路
 * （`katari-ext-shim.ts` → `globalThis.__katari__`）で API が解決される。
 * 実 UI（ネイティブ webview、ステータスバーの描画、権限ダイアログ）は実機でしか
 * 確認できないので、ここでは拡張が本体へ渡す値までを固定する。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createKatariMock,
  findAllNodes,
  findNode,
  type KatariMock,
  type MockNode,
} from "./katari-ext-test";

const WEBVIEW_PERMISSION = "webview:*";
const DEFAULT_HOME = "https://developer.mozilla.org/";

// ----------------------------------------------------------------- l10n 読み込み

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/**
 * `l10n/<locale>.toon` を読む。本体の読み手（`readL10nTable`）と同じく
 * **文字列値のフラットな表**だけを受け付ける。
 */
function parseL10n(text: string): Record<string, string> {
  const table: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (!key || !value.startsWith('"') || !value.endsWith('"')) continue;
    table[key] = value.slice(1, -1);
  }
  return table;
}

const JA = parseL10n(read("./l10n/ja.toon"));
const EN = parseL10n(read("./l10n/en.toon"));
const MAIN_SOURCE = read("./main.ts");
/** コメントを落としたソース（「コードに残っていないこと」を見る検査用）。 */
const MAIN_CODE = MAIN_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ------------------------------------------------------------------- ヘルパ

/**
 * 拡張の起動チェーン（設定 → お気に入り → ステータス）と、押したボタンの続きを流す。
 * モックの API はどれも即座に解決するので、マクロタスクを 1 回回せば全部片付く。
 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type MockOptions = Parameters<typeof createKatariMock>[0];

/**
 * モックを差し込んでから拡張を読み込む。`seed` は**拡張が起動する前**に走るので、
 * 「前回のセッションで保存済み」の状態を作れる。
 */
async function load(
  options: MockOptions = {},
  seed?: (katari: KatariApi) => Promise<void>,
): Promise<KatariMock> {
  const mock = createKatariMock({ l10n: JA, ...options });
  if (seed) await seed(katariOf(mock));
  (globalThis as unknown as { __katari__: unknown }).__katari__ = mock.module;
  vi.resetModules();
  await import("./main");
  await flush();
  return mock;
}

type KatariApi = {
  storage: Record<"editor" | "project", { set: (k: string, v: unknown) => Promise<unknown> }>;
  config: { set: (k: string, v: unknown) => Promise<unknown> };
};

function katariOf(mock: KatariMock): KatariApi {
  return mock.module.katari as KatariApi;
}

/** 「新しいブラウザタブ...」を実行して、開いたビューを返す。 */
async function openTab(mock: KatariMock): Promise<KatariMock["views"][number]> {
  await mock.runCommand("open");
  await flush();
  const view = mock.views.at(-1);
  if (!view) throw new Error("no view was opened");
  return view;
}

function webviewOf(view: { tree: MockNode | null }): MockNode | null {
  return findNode(view.tree, "webview");
}

function popover(view: { tree: MockNode | null }, label: string): MockNode | null {
  return findAllNodes(view.tree, (n) => n.type === "popover" && n.label === label)[0] ?? null;
}

/** URL バーに URL を入れて Enter（`onSubmit`）した状態にする。 */
async function submitUrl(mock: KatariMock, view: { tree: MockNode | null }, url: string) {
  const field = findAllNodes(view.tree, (n) => n.type === "textField" && n.key === "url")[0];
  await (field?.onSubmit as (v: string) => unknown)?.(url);
  mock.refresh();
  await flush();
}

// ------------------------------------------------------------------- テスト

describe("l10n", () => {
  it("ja と en が同じキーを持つ（en はフォールバック先なので欠けると生キーが出る）", () => {
    expect(Object.keys(JA).sort()).toEqual(Object.keys(EN).sort());
  });

  it("main.ts が引いているキーがすべて表にある", () => {
    const used = [...MAIN_SOURCE.matchAll(/katari\.t\(\s*"([^"]+)"/g)].map((m) => m[1]);
    const dynamic = [...MAIN_SOURCE.matchAll(/katari\.t\(\s*scope === "editor" \? "([^"]+)" : "([^"]+)"/g)]
      .flatMap((m) => [m[1], m[2]]);
    const keys = [...new Set([...used, ...dynamic])];
    expect(keys.length).toBeGreaterThan(10);
    expect(keys.filter((k) => !(k in JA))).toEqual([]);
  });

  it("文言に katari.locale の自前分岐が残っていない", () => {
    expect(MAIN_CODE).not.toMatch(/katari\.locale/);
  });

  it("埋め込みは表とコードで噛み合う", () => {
    expect(JA.historyCount).toContain("{count}");
    expect(JA.historyCount).toContain("{max}");
    expect(JA.statusText).toContain("{count}");
  });
});

describe("任意権限 webview:*", () => {
  it("承認時ではなく、タブを開く直前に要求する", async () => {
    const mock = await load();
    // 起動しただけでは要求しない。
    expect(mock.calls.filter((c) => c.method === "permissions.request")).toHaveLength(0);

    const view = await openTab(mock);
    expect(mock.calls.filter((c) => c.method === "permissions.request")).toEqual([
      { method: "permissions.request", args: { permission: WEBVIEW_PERMISSION } },
    ]);
    expect(webviewOf(view)?.url).toBe(DEFAULT_HOME);
  });

  it("既に許可済みなら尋ね直さない", async () => {
    const mock = await load({ grantedPermissions: [WEBVIEW_PERMISSION] });
    const view = await openTab(mock);
    expect(mock.calls.filter((c) => c.method === "permissions.request")).toHaveLength(0);
    expect(webviewOf(view)).not.toBeNull();
  });

  it("断られたらページを描かず、その場で求め直せるゲートを出す", async () => {
    const mock = await load({ allowPermissionRequest: false });
    const view = await openTab(mock);

    expect(webviewOf(view)).toBeNull();
    expect(findNode(view.tree, "heading")?.value).toBe(JA.permHeading);

    const grant = findAllNodes(view.tree, (n) => n.key === "perm-grant")[0];
    expect(grant?.label).toBe(JA.permGrant);
    await (grant?.onClick as () => unknown)?.();
    await flush();
    expect(mock.calls.filter((c) => c.method === "permissions.request")).toHaveLength(2);
  });

  it("取り消されたら次に表示するときにページを外す", async () => {
    const mock = await load();
    const view = await openTab(mock);
    expect(webviewOf(view)).not.toBeNull();

    // ユーザーが管理ウィンドウから取り消した状態。
    mock.grantedPermissions.delete(WEBVIEW_PERMISSION);
    await submitUrl(mock, view, "https://example.com/");

    expect(webviewOf(view)).toBeNull();
    expect(findNode(view.tree, "heading")?.value).toBe(JA.permHeading);
  });
});

describe("宣言的設定 contributes.configuration", () => {
  it("homeUrl が新しいタブの初期ページになる", async () => {
    const mock = await load({ config: { homeUrl: "https://example.org/docs" } });
    const view = await openTab(mock);
    expect(webviewOf(view)?.url).toBe("https://example.org/docs");
  });

  it("https でない homeUrl は既定値へ落とす", async () => {
    const mock = await load({ config: { homeUrl: "http://insecure.example/" } });
    const view = await openTab(mock);
    expect(webviewOf(view)?.url).toBe(DEFAULT_HOME);
  });

  it("historyMax が履歴の保持件数になる", async () => {
    const mock = await load({ config: { historyMax: 2 } });
    const view = await openTab(mock);
    const onNavigate = webviewOf(view)?.onNavigate as (u: string) => void;

    onNavigate("https://a.example/");
    onNavigate("https://b.example/");
    onNavigate("https://c.example/");
    mock.refresh();

    const items = findNode(popover(view, "🕘"), "inspectorList")?.items as Array<{ label: string }>;
    expect(items.map((i) => i.label)).toEqual(["c.example", "b.example"]);
  });

  it("historyMax が 0 なら履歴を取らず、その旨を出す", async () => {
    const mock = await load({ config: { historyMax: 0 } });
    const view = await openTab(mock);
    (webviewOf(view)?.onNavigate as (u: string) => void)("https://a.example/");
    mock.refresh();

    const menu = popover(view, "🕘");
    expect(findNode(menu, "inspectorList")).toBeNull();
    expect(findNode(menu, "text")?.value).toBe(JA.historyOff);
  });

  it("設定が編集されたら読み直す", async () => {
    const mock = await load({ config: { homeUrl: "https://first.example/" } });
    // ユーザーがフォームで書き換えた（フォームを描くのはエディタ側）。
    await katariOf(mock).config.set("homeUrl", "https://second.example/");
    mock.emit("config.changed", { key: "homeUrl", scope: "editor" });
    await flush();

    const view = await openTab(mock);
    expect(webviewOf(view)?.url).toBe("https://second.example/");
  });
});

describe("ステータスバー", () => {
  it("お気に入り件数を出し、押すと新しいタブが開く", async () => {
    const mock = await load();
    expect(mock.statusItems.get("favorites")).toMatchObject({
      text: "お気に入り 0",
      command: "open",
    });

    const panel = mock.renderSettings("favEditor");
    await (findNode(panel, "inspectorList")?.onAdd as () => unknown)();
    await flush();

    expect(mock.statusItems.get("favorites")).toMatchObject({ text: "お気に入り 1" });
  });

  it("showStatus を切ると項目を消す", async () => {
    const mock = await load({ config: { showStatus: false } });
    expect(mock.statusItems.has("favorites")).toBe(false);
  });
});

describe("お気に入り", () => {
  it("保存済みの一覧を scope ごとに読み直す（旧形式の URL 文字列も受ける）", async () => {
    const mock = await load({}, async (katari) => {
      await katari.storage.editor.set("favorites", [
        { url: "https://a.example/", title: "A" },
        "https://legacy.example/docs", // 旧形式（URL の文字列だけ）
      ]);
      await katari.storage.project.set("favorites", [{ url: "https://p.example/", title: "P" }]);
    });

    const view = await openTab(mock);
    const lists = findAllNodes(popover(view, "☆"), (n) => n.type === "inspectorList");
    expect(lists).toHaveLength(2);
    expect(lists[0].title).toBe(JA.favScopeEditor);
    expect((lists[0].items as Array<{ label: string }>).map((i) => i.label)).toEqual([
      "A",
      // タイトルが無い行は URL から作ったラベルで出る。
      "legacy.example/docs",
    ]);
    expect(lists[1].title).toBe(JA.favScopeProject);
    expect((lists[1].items as Array<{ label: string }>).map((i) => i.label)).toEqual(["P"]);
    expect(mock.statusItems.get("favorites")).toMatchObject({ text: "お気に入り 3" });
  });

  it("★ トグルで現在のページを追加し、タイトルを表示名に使う", async () => {
    const mock = await load();
    const view = await openTab(mock);
    (webviewOf(view)?.onTitle as (t: string) => void)("MDN Web Docs");
    await flush();

    const toggle = findAllNodes(popover(view, "☆"), (n) => n.key === "fav-toggle-editor")[0];
    await (toggle?.onChange as () => unknown)();
    await flush();
    mock.refresh();

    const list = findAllNodes(popover(view, "★"), (n) => n.type === "inspectorList")[0];
    expect((list.items as Array<{ label: string }>).map((i) => i.label)).toEqual(["MDN Web Docs"]);
  });

  it("https でない URL は足さずに警告する", async () => {
    const mock = await load();
    const panel = mock.renderSettings("favProject");
    const list = findNode(panel, "inspectorList");
    await (list?.onAdd as () => unknown)();
    await flush();

    // ＋ は既定 URL（https）なので通る。
    expect(mock.toasts).toHaveLength(0);

    const rows = findNode(mock.renderSettings("favProject"), "inspectorList")?.items as Array<{
      children: MockNode[];
    }>;
    const urlField = findAllNodes(
      { type: "row", children: rows[0].children } as MockNode,
      (n) => n.type === "textField" && String(n.key).startsWith("edit:"),
    )[0];
    await (urlField?.onSubmit as (v: string) => unknown)("http://insecure.example/");
    await flush();

    expect(mock.toasts.at(-1)).toEqual({ message: JA.urlInvalid, kind: "warning" });
  });
});

describe("タブの復元", () => {
  it("URL と履歴を state に載せる", async () => {
    const mock = await load();
    const view = await openTab(mock);
    const onNavigate = webviewOf(view)?.onNavigate as (u: string) => void;
    onNavigate("https://a.example/");
    await flush();

    const state = mock.calls.filter((c) => c.method === "window.setState").at(-1)?.args as {
      state: { url: string; history: Array<{ url: string }> };
    };
    expect(state.state.url).toBe("https://a.example/");
    expect(state.state.history.map((h) => h.url)).toEqual(["https://a.example/"]);
  });
});
