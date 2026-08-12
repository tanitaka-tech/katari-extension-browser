/**
 * 拡張 API の型定義（[ADR-0061](../../docs/adr/0061-editor-extension-system.md)）。
 *
 * 拡張のソースツリーにこのファイルをコピーするか、`tsconfig.json` の `paths` で
 * `@katari/ext` をここに向けると補完が効く。実体は Worker ランタイム
 * （`src/lib/ext/worker/runtime.ts`）が `globalThis.__katari__` に入れる。
 *
 * すべての API は非同期（Promise）。同期版は存在しない。
 */

declare module "@katari/ext" {
  /** UI ツリーのノード。`ui.*` ビルダの戻り値。 */
  export type UiNode = Record<string, unknown>;

  export type ToastKind = "info" | "success" | "warning" | "error";

  /** 宣言 UI のビルダ。ハンドラには関数をそのまま渡せる。 */
  export interface Ui {
    column(children: UiNode[], props?: Record<string, unknown>): UiNode;
    row(children: UiNode[], props?: Record<string, unknown>): UiNode;
    group(children: UiNode[], props?: Record<string, unknown>): UiNode;
    collapsible(
      title: string,
      children: UiNode[],
      props?: Record<string, unknown>,
    ): UiNode;
    text(value: string, props?: { muted?: boolean; bold?: boolean; key?: string }): UiNode;
    heading(value: string): UiNode;
    separator(): UiNode;
    button(props: {
      label: string;
      variant?: "default" | "primary" | "danger" | "ghost";
      disabled?: boolean;
      key?: string;
      onClick?: () => unknown;
    }): UiNode;
    textField(props: {
      label?: string;
      value: string;
      placeholder?: string;
      multiline?: boolean;
      disabled?: boolean;
      key?: string;
      onChange?: (value: string) => unknown;
      /** Enter で確定したとき（multiline では発火しない）。 */
      onSubmit?: (value: string) => unknown;
    }): UiNode;
    numberField(props: {
      label?: string;
      value: number;
      min?: number;
      max?: number;
      step?: number;
      disabled?: boolean;
      key?: string;
      onChange?: (value: number) => unknown;
    }): UiNode;
    checkbox(props: {
      label?: string;
      value: boolean;
      disabled?: boolean;
      key?: string;
      onChange?: (value: boolean) => unknown;
    }): UiNode;
    select(props: {
      label?: string;
      value: string;
      options: Array<{ value: string; label: string }>;
      disabled?: boolean;
      key?: string;
      onChange?: (value: string) => unknown;
    }): UiNode;
    color(props: {
      label?: string;
      value: string;
      disabled?: boolean;
      key?: string;
      onChange?: (value: string) => unknown;
    }): UiNode;
    list(props: {
      items: Array<{ id: string; label: string; selected?: boolean }>;
      key?: string;
      onSelect?: (id: string) => unknown;
    }): UiNode;
    /**
     * Web ページの埋め込み表示（sandbox 付き iframe）。`webview:<host>` または
     * `webview:*` 権限が必要で、https のみ。`grow: true` でタブの残り領域
     * いっぱいに広がる。`key` を変えると remount ＝再読込になる。
     * ページ内遷移の URL 観測や戻る / 進むはできない（cross-origin のため）。
     */
    webview(props: {
      url: string;
      height?: number;
      grow?: boolean;
      key?: string;
      /**
       * iframe ではなくネイティブ子 webview をタブに重ねて描画する。トップレベル
       * 文書扱いなので `X-Frame-Options` / `frame-ancestors` を受けず、埋め込み拒否
       * サイトも表示できる。main ウィンドウのタブ内でのみ有効（OS ウィンドウへ
       * 切り離すと iframe にフォールバックする）。
       */
      native?: boolean;
      /** native webview の遷移（リンククリック含む）時に新しい URL を受け取る。 */
      onNavigate?: (url: string) => unknown;
      /** native webview のページタイトル変化を受け取る（タブ名に使える）。 */
      onTitle?: (title: string) => unknown;
    }): UiNode;
  }

  /** 拡張ストレージ 1 スコープ分の KV。 */
  export interface ExtStorageScope {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<unknown>;
    remove(key: string): Promise<unknown>;
    keys(): Promise<string[]>;
  }

  export interface Katari {
    readonly extensionId: string;
    /** エディタの表示言語（`ja` / `en` / `zh-CN` / `ko`）。 */
    readonly locale: string;

    commands: {
      /** manifest の `contributes.commands[].id` と同じ id で登録する。 */
      register(id: string, handler: () => unknown): void;
    };

    inspector: {
      /** manifest の `contributes.inspector[].id` に対応する描画関数。 */
      section(
        id: string,
        render: (context: { selection?: unknown }) => UiNode,
      ): void;
    };

    settings: {
      /**
       * manifest の `contributes.settings[].id` に対応する設定パネルの描画関数。
       * `scope`（project / editor）はそのパネルがどちらの設定ビューに出るか。
       */
      panel(
        id: string,
        render: (context: { scope: "project" | "editor" }) => UiNode,
      ): void;
    };

    /**
     * 拡張ごとの永続ストレージ。`editor` はプロジェクト非依存のグローバル、
     * `project` は現在のプロジェクトに紐づく。値は JSON 直列化可能なもの。
     * 拡張ごとに隔離されており専用権限は不要。
     */
    storage: {
      editor: ExtStorageScope;
      project: ExtStorageScope;
    };

    /** operation registry の操作を直接呼ぶ。読み取りは `project:read` が必要。 */
    ops: {
      invoke(op: string, args?: Record<string, unknown>): Promise<unknown>;
      list(): Promise<string[]>;
    };

    /**
     * 編集はここを通す。ops 列は 1 トランザクションとして適用され、
     * undo 1 回でまとめて戻る。`project:write` が必要。
     */
    edit(
      label: string,
      ops: Array<{ op: string; args?: Record<string, unknown> }>,
    ): Promise<unknown>;

    project: {
      listScreens(): Promise<unknown>;
      getScreen(screenId: string): Promise<unknown>;
      listScenes(): Promise<unknown>;
      info(): Promise<unknown>;
    };

    selection: {
      get(): Promise<unknown>;
    };

    ui: Ui & {
      toast(message: string, kind?: ToastKind): Promise<unknown>;
      confirm(message: string): Promise<boolean>;
      prompt(message: string, defaultValue?: string): Promise<string | null>;
    };

    /** Dock タブとして開く独自ビュー（ADR-0063 追補）。戻り値の viewId を `close` に渡す。 */
    window: {
      open(options: {
        title?: string;
        width?: number;
        height?: number;
        render: () => UiNode;
        /**
         * 復元用の安定 id（セッション跨ぎ）。指定するとこのビューは Dock 位置ごと
         * 永続化され、次回起動時に `onRestore` 経由で復元される（ADR-0076 追補）。
         */
        restoreId?: string;
        /** 復元用の小さな状態（URL 等の JSON。4KB まで）。`onRestore` に渡る。 */
        state?: unknown;
        /** タブアイコン（絵文字 1〜2 文字）。 */
        icon?: string;
        /** 開いた元 view の id。指定するとその隣に新タブを配置する。 */
        near?: string;
      }): string;
      close(viewId: string): void;
      /** ビューの復元用状態を更新する（URL 遷移時などに呼ぶ）。次回起動時に復元される。 */
      setState(viewId: string, state: unknown): void;
      /** タブのタイトルを更新する（ページ名をタブ名にする等）。 */
      setTitle(viewId: string, title: string): void;
      /** native webview（`ui.webview({ native: true })`）の履歴を戻る / 進む / 再読込する。 */
      webviewBack(viewId: string): Promise<unknown>;
      webviewForward(viewId: string): Promise<unknown>;
      webviewReload(viewId: string): Promise<unknown>;
      /**
       * 起動時、前回開いていた復元可能ビューごとに呼ばれる。ハンドラ内で
       * `window.open({ restoreId, state, render })` を呼んで同じビューを復元する。
       * `onStartup` activation を宣言した拡張で有効。
       */
      onRestore(handler: (restoreId: string, state: unknown) => void): void;
      /**
       * 任意の https ページを別 OS ウィンドウ（ネイティブ webview）で開く。
       * iframe 埋め込みを拒否するサイト（`X-Frame-Options` / `frame-ancestors`）も
       * トップレベルで開くため表示できる。`webview:<host>` / `webview:*` 権限が必要。
       */
      openExternal(url: string, title?: string): Promise<void>;
    };

    /** エディタ内のモーダル。 */
    dialog: {
      open(options: { title?: string; render: () => UiNode }): string;
      close(viewId: string): void;
    };

    /** ビューを再描画する。省略時は開いている全ビュー。 */
    refresh(viewId?: string): void;

    clipboard: {
      /** `clipboard` 権限が必要。 */
      writeText(text: string): Promise<unknown>;
    };

    net: {
      /** `net:<host>` 権限が必要。https のみ。 */
      fetchText(url: string): Promise<string>;
    };

    log(...args: unknown[]): void;
  }

  export const katari: Katari;
  export const ui: Ui;
  export default katari;
}
