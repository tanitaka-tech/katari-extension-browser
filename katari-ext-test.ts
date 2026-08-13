/**
 * 拡張作者向けのテストキット（ADR-0061 追補）。
 *
 * 拡張のコードは `@katari/ext` を import するだけなので、その中身を差し替えれば
 * **エディタを起動せずに**振る舞いを検証できる。ここはその差し替え役。
 *
 * 使い方（vitest / node:test どちらでも）:
 *
 * ```ts
 * import { createKatariMock, findNode, clickButton } from "./katari-ext-test";
 *
 * const mock = createKatariMock();
 * // 拡張本体を import する前にグローバルへ入れておく
 * (globalThis as any).__katari__ = mock.module;
 * await import("./main");
 *
 * await mock.runCommand("open");
 * const view = mock.views[0];
 * expect(findNode(view.tree, "heading")?.value).toBe("こんにちは");
 *
 * await clickButton(mock, view.id, "閉じる");
 * expect(mock.views).toHaveLength(0);
 * ```
 *
 * このファイルはコピーして使う想定。npm 依存は無い。
 */

export type MockNode = Record<string, unknown> & { type: string; children?: MockNode[] };

export type MockView = {
  id: string;
  kind: "window" | "dialog";
  title: string;
  /** 直近の `render()` の結果。`refresh()` するたびに差し替わる。 */
  tree: MockNode | null;
  render: () => MockNode;
};

export type MockCall = { method: string; args: unknown };

export type KatariMockOptions = {
  /** `katari.ops.invoke` / `katari.edit` の戻り値を差し替える。 */
  ops?: Record<string, (args: Record<string, unknown>) => unknown>;
  /** `katari.selection.get()` の戻り値。 */
  selection?: unknown;
  /** `katari.config.get(key)` の戻り値。 */
  config?: Record<string, unknown>;
  /** `katari.ui.confirm` の応答（既定 true）。 */
  confirm?: boolean;
  /** `katari.ui.prompt` の応答（既定 null = キャンセル）。 */
  prompt?: string | null;
  /** `katari.fs.openFile()` が返すファイル。 */
  openFile?: { path: string; name: string; text?: string; base64?: string } | null;
  locale?: string;
  /**
   * ローカル追加（upstream の katari-ext-test.ts には無い）: `katari.t()` が引く文字列表。
   * 本番は `l10n/<locale>.toon` をエディタが読むので、テストでは読み込んだ表をここへ渡す。
   * 未指定ならキーがそのまま返る（実行時のフォールバックと同じ）。
   */
  l10n?: Record<string, string>;
  /**
   * ローカル追加（upstream は `has` / `request` とも常に true）: 既に許可済みの任意権限。
   * 省略時は空（＝拡張が `request()` するまで持っていない）。
   */
  grantedPermissions?: string[];
  /**
   * ローカル追加: `katari.permissions.request()` にユーザーが答える内容（既定 true）。
   * 許可した権限は `grantedPermissions` に積まれるので、以後 `has()` も true になる。
   */
  allowPermissionRequest?: boolean;
};

export type KatariMock = {
  /** `globalThis.__katari__` に入れる値。 */
  module: { katari: unknown; ui: unknown };
  /** 開いているビュー。 */
  views: MockView[];
  /** 記録された呼び出し（順序込み）。 */
  calls: MockCall[];
  /** トースト履歴。 */
  toasts: Array<{ message: string; kind: string }>;
  /** `katari.edit()` に渡された ops 列（トランザクション単位）。 */
  edits: Array<{ label: string; ops: Array<{ op: string; args?: unknown }> }>;
  /** 拡張が出した診断 / ステータス項目。 */
  diagnostics: unknown[];
  statusItems: Map<string, unknown>;
  /**
   * ローカル追加: いま許可されている任意権限。テストから `delete()` すると、
   * ユーザーが管理ウィンドウで取り消したのと同じ状態になる。
   */
  grantedPermissions: Set<string>;
  /** 登録済みコマンドを実行する。 */
  runCommand: (id: string) => Promise<unknown>;
  /** インスペクタセクションを描画させる。 */
  renderInspector: (id: string, context?: unknown) => MockNode | null;
  /**
   * ローカル追加（upstream はパネルを登録するだけで描画させる口が無い）:
   * `katari.settings.panel()` で登録された設定タブを描画させる。
   */
  renderSettings: (id: string, context?: unknown) => MockNode | null;
  /** 購読中のハンドラへイベントを配る。 */
  emit: (name: string, payload?: unknown) => void;
  /** ビューを再描画する（`katari.refresh()` 相当）。 */
  refresh: (viewId?: string) => void;
};

/** UI ツリーから最初に見つかった種別のノードを返す。 */
export function findNode(tree: MockNode | null, type: string): MockNode | null {
  if (!tree) return null;
  if (tree.type === type) return tree;
  for (const child of childrenOf(tree)) {
    const found = findNode(child, type);
    if (found) return found;
  }
  return null;
}

/** 条件に合うノードを全部返す。 */
export function findAllNodes(
  tree: MockNode | null,
  predicate: (node: MockNode) => boolean,
): MockNode[] {
  if (!tree) return [];
  const out = predicate(tree) ? [tree] : [];
  for (const child of childrenOf(tree)) out.push(...findAllNodes(child, predicate));
  return out;
}

function childrenOf(node: MockNode): MockNode[] {
  const out: MockNode[] = [];
  if (Array.isArray(node.children)) out.push(...(node.children as MockNode[]));
  // tabs / inspectorList は items の中に子を持つ。
  if (Array.isArray(node.items)) {
    for (const item of node.items as Array<Record<string, unknown>>) {
      if (Array.isArray(item?.children)) out.push(...(item.children as MockNode[]));
    }
  }
  return out;
}

/** ラベルでボタンを探して押す（押した後の再描画まで済ませる）。 */
export async function clickButton(
  mock: KatariMock,
  viewId: string,
  label: string,
): Promise<void> {
  const view = mock.views.find((v) => v.id === viewId);
  if (!view) throw new Error(`view not found: ${viewId}`);
  const button = findAllNodes(view.tree, (n) => n.type === "button" && n.label === label)[0];
  if (!button) throw new Error(`button not found: ${label}`);
  const onClick = button.onClick as (() => unknown) | undefined;
  if (!onClick) throw new Error(`button has no onClick: ${label}`);
  await onClick();
  mock.refresh(viewId);
}

/** 入力欄に値を入れる（`onChange` を呼んで再描画する）。 */
export async function typeInto(
  mock: KatariMock,
  viewId: string,
  label: string,
  value: string,
): Promise<void> {
  const view = mock.views.find((v) => v.id === viewId);
  if (!view) throw new Error(`view not found: ${viewId}`);
  const field = findAllNodes(
    view.tree,
    (n) => n.type === "textField" && n.label === label,
  )[0];
  if (!field) throw new Error(`textField not found: ${label}`);
  await (field.onChange as (v: string) => unknown)?.(value);
  mock.refresh(viewId);
}

/**
 * `@katari/ext` の差し替え実装を作る。実 API と同じく**すべて非同期**で、
 * 呼び出しは `calls` に記録される。
 */
export function createKatariMock(options: KatariMockOptions = {}): KatariMock {
  const calls: MockCall[] = [];
  const toasts: Array<{ message: string; kind: string }> = [];
  const edits: KatariMock["edits"] = [];
  const views: MockView[] = [];
  const commands = new Map<string, () => unknown>();
  const inspectors = new Map<string, (context: unknown) => MockNode>();
  const settingsPanels = new Map<string, (context: unknown) => MockNode>();
  const eventHandlers = new Map<string, Set<(payload: unknown) => unknown>>();
  const statusItems = new Map<string, unknown>();
  const configValues: Record<string, unknown> = { ...(options.config ?? {}) };
  // ローカル追加: 現在許可されている任意権限。`request()` で増え、`revoke()` で減る。
  const granted = new Set<string>(options.grantedPermissions ?? []);
  let diagnostics: unknown[] = [];
  let viewSeq = 0;

  function record(method: string, args: unknown): void {
    calls.push({ method, args });
  }

  function node(type: string, props: Record<string, unknown> = {}): MockNode {
    return { type, ...props } as MockNode;
  }

  const ui = {
    column: (children: MockNode[], props = {}) => node("column", { ...props, children }),
    row: (children: MockNode[], props = {}) => node("row", { ...props, children }),
    group: (children: MockNode[], props = {}) => node("group", { ...props, children }),
    collapsible: (title: string, children: MockNode[], props = {}) =>
      node("collapsible", { ...props, title, children }),
    popover: (label: string, children: MockNode[], props = {}) =>
      node("popover", { ...props, label, children }),
    text: (value: string, props = {}) => node("text", { ...props, value }),
    heading: (value: string) => node("heading", { value }),
    separator: () => node("separator"),
    button: (props: Record<string, unknown>) => node("button", props),
    textField: (props: Record<string, unknown>) => node("textField", props),
    numberField: (props: Record<string, unknown>) => node("numberField", props),
    checkbox: (props: Record<string, unknown>) => node("checkbox", props),
    select: (props: Record<string, unknown>) => node("select", props),
    color: (props: Record<string, unknown>) => node("color", props),
    list: (props: Record<string, unknown>) => node("list", props),
    inspectorList: (props: Record<string, unknown>) => node("inspectorList", props),
    webview: (props: Record<string, unknown>) => node("webview", props),
    progress: (props = {}) => node("progress", props),
    slider: (props: Record<string, unknown>) => node("slider", props),
    badge: (label: string, props = {}) => node("badge", { ...props, label }),
    tabs: (items: unknown[], props = {}) => node("tabs", { ...props, items }),
    table: (props: Record<string, unknown>) => node("table", props),
    image: (props: Record<string, unknown>) => node("image", props),
    assetPicker: (props: Record<string, unknown>) => node("assetPicker", props),
    screenPicker: (props: Record<string, unknown>) => node("screenPicker", props),
    variablePicker: (props: Record<string, unknown>) => node("variablePicker", props),
  };

  function refresh(viewId?: string): void {
    for (const view of views) {
      if (viewId && view.id !== viewId) continue;
      view.tree = view.render();
    }
  }

  function openView(kind: "window" | "dialog", opts: Record<string, unknown>): string {
    const id = `mock#${++viewSeq}`;
    const view: MockView = {
      id,
      kind,
      title: String(opts.title ?? id),
      render: opts.render as () => MockNode,
      tree: null,
    };
    views.push(view);
    view.tree = view.render();
    return id;
  }

  function closeView(viewId: string): void {
    const index = views.findIndex((v) => v.id === viewId);
    if (index >= 0) views.splice(index, 1);
  }

  const katari = {
    extensionId: "com.example.test",
    locale: options.locale ?? "ja",

    /**
     * ローカル追加（upstream には無い）: `l10n/<locale>.toon` 相当の引き当て。
     * 見つからなければキーをそのまま返す（実行時の最終フォールバックと同じ）。
     */
    t: (key: string, params?: Record<string, string | number>) => {
      const template = options.l10n?.[key] ?? key;
      if (!params) return template;
      return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
        name in params ? String(params[name]) : whole,
      );
    },

    commands: {
      register: (id: string, handler: () => unknown) => commands.set(id, handler),
    },
    inspector: {
      section: (id: string, render: (context: unknown) => MockNode) =>
        inspectors.set(id, render),
    },
    settings: {
      panel: (id: string, render: (context: unknown) => MockNode) =>
        settingsPanels.set(id, render),
    },

    ops: {
      invoke: async (op: string, args: Record<string, unknown> = {}) => {
        record("ops.invoke", { op, args });
        return options.ops?.[op]?.(args) ?? null;
      },
      list: async () => Object.keys(options.ops ?? {}),
    },

    edit: async (label: string, ops: Array<{ op: string; args?: unknown }>) => {
      record("edit", { label, ops });
      edits.push({ label, ops });
      return ops.map((o) => options.ops?.[o.op]?.((o.args ?? {}) as never) ?? null);
    },

    project: {
      listScreens: async () => options.ops?.list_screens?.({}) ?? [],
      getScreen: async (screenId: string) =>
        options.ops?.get_screen?.({ screen_id: screenId }) ?? null,
      listScenes: async () => options.ops?.list_scenes?.({}) ?? [],
      info: async () => ({ name: "mock", path: null, screenCount: 0, sceneCount: 0 }),
    },

    selection: { get: async () => options.selection ?? { kind: "none" } },

    ui: {
      ...ui,
      toast: async (message: string, kind = "info") => {
        toasts.push({ message, kind });
        return null;
      },
      confirm: async (message: string) => {
        record("ui.confirm", { message });
        return options.confirm ?? true;
      },
      prompt: async (message: string, defaultValue = "") => {
        record("ui.prompt", { message, defaultValue });
        return options.prompt ?? null;
      },
    },

    window: {
      open: (opts: Record<string, unknown>) => openView("window", opts),
      close: closeView,
      setState: (viewId: string, state: unknown) => record("window.setState", { viewId, state }),
      setTitle: (viewId: string, title: string) => {
        const view = views.find((v) => v.id === viewId);
        if (view) view.title = title;
      },
      webviewBack: async () => null,
      webviewForward: async () => null,
      webviewReload: async () => null,
      onRestore: () => {},
      openExternal: async (url: string) => {
        record("window.openExternal", { url });
      },
    },

    dialog: {
      open: (opts: Record<string, unknown>) => openView("dialog", opts),
      close: closeView,
    },

    refresh,

    events: {
      on(name: string, handler: (payload: unknown) => unknown) {
        let set = eventHandlers.get(name);
        if (!set) {
          set = new Set();
          eventHandlers.set(name, set);
        }
        set.add(handler);
        return () => set?.delete(handler);
      },
    },

    config: {
      get: async (key: string) => configValues[key] ?? null,
      set: async (key: string, value: unknown) => {
        configValues[key] = value;
        return null;
      },
      onChange: (handler: (payload: unknown) => unknown) =>
        katari.events.on("config.changed", handler),
    },

    // ローカル追加: 任意権限（ADR-0084）の許可 / 取り消しをテストから動かせるようにした。
    permissions: {
      has: async (permission: string) => granted.has(permission),
      request: async (permission: string) => {
        record("permissions.request", { permission });
        if (options.allowPermissionRequest === false) return false;
        granted.add(permission);
        return true;
      },
    },

    diagnostics: {
      set: async (items: unknown[]) => {
        diagnostics = items;
        return null;
      },
    },

    status: {
      set: async (item: { id: string }) => {
        statusItems.set(item.id, item);
        return null;
      },
      clear: async (id: string) => {
        statusItems.delete(id);
        return null;
      },
    },

    storage: {
      editor: makeStorageScope(),
      project: makeStorageScope(),
    },

    fs: {
      openFile: async (opts: unknown = {}) => {
        record("fs.openFile", opts);
        return options.openFile ?? null;
      },
      saveFile: async (opts: unknown) => {
        record("fs.saveFile", opts);
        return { path: "/mock/out" };
      },
    },

    clipboard: {
      writeText: async (text: string) => {
        record("clipboard.writeText", { text });
        return null;
      },
    },

    net: {
      fetchText: async (url: string) => {
        record("net.fetchText", { url });
        return "";
      },
      fetch: async (opts: unknown) => {
        record("net.fetch", opts);
        return { status: 200, ok: true, headers: {}, text: "", base64: null };
      },
    },

    log: (...args: unknown[]) => record("log", args),
  };

  function makeStorageScope() {
    const store = new Map<string, unknown>();
    return {
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, value: unknown) => {
        store.set(key, value);
        return null;
      },
      remove: async (key: string) => {
        store.delete(key);
        return null;
      },
      keys: async () => [...store.keys()],
    };
  }

  return {
    module: { katari, ui },
    views,
    calls,
    toasts,
    edits,
    get diagnostics() {
      return diagnostics;
    },
    statusItems,
    grantedPermissions: granted,
    runCommand: async (id: string) => {
      const handler = commands.get(id);
      if (!handler) throw new Error(`command not registered: ${id}`);
      return await handler();
    },
    renderInspector: (id: string, context: unknown = {}) => {
      const render = inspectors.get(id);
      if (!render) throw new Error(`inspector section not registered: ${id}`);
      return render(context);
    },
    renderSettings: (id: string, context: unknown = {}) => {
      const render = settingsPanels.get(id);
      if (!render) throw new Error(`settings panel not registered: ${id}`);
      return render(context);
    },
    emit: (name: string, payload: unknown = null) => {
      for (const handler of eventHandlers.get(name) ?? []) handler(payload);
    },
    refresh,
  } as KatariMock;
}
