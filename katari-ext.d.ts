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

  /**
   * op 名から引数の型を引く。生成表（`katari-ops.d.ts`）に無い名前を渡した
   * ときは緩い形にフォールバックするので、将来増えた op も呼べる。
   */
  export type OpArgs<K extends string> = K extends KatariOpName
    ? KatariOps[K]
    : Record<string, unknown>;

  /**
   * `katari.edit()` に渡す 1 操作。既知の op は引数まで検査される。
   * 生成表に無い op を呼びたいときは `{ op, args } as EditOp` で明示する。
   */
  export type EditOp = {
    [K in KatariOpName]: { op: K; args: KatariOps[K] };
  }[KatariOpName];

  export type ToastKind = "info" | "success" | "warning" | "error";

  /** `katari.events.on()` で購読できるイベントと、そのペイロード。 */
  export interface ExtensionEventPayload {
    "project.opened": { path: string };
    "project.closed": null;
    "project.saved": { at: number };
    /** `katari.selection.get()` と同じ形。 */
    "selection.changed": unknown;
    "assets.changed": { count: number };
    "build.started": null;
    "build.finished": { ok: boolean };
    "preview.started": null;
    "preview.stopped": null;
    "locale.changed": { locale: string };
    /** 自分の宣言的設定がユーザーに編集された。 */
    "config.changed": { key: string; scope: "project" | "editor" };
  }

  export type ExtensionEventName = keyof ExtensionEventPayload;

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
    /**
     * ボタンを押すと上に浮くポップアップ（ブラウザのメニュー相当）。`collapsible` と違って
     * 下のコンテンツを押し出さないので、`webview` を含むタブでも使える。
     * 開閉は既定でエディタ側が保持する（`open` を渡した場合のみ拡張が制御し、
     * `onOpenChange` で更新する）。
     */
    popover(
      label: string,
      children: UiNode[],
      props?: {
        variant?: "default" | "primary" | "danger" | "ghost";
        disabled?: boolean;
        /** 明示すると開閉を拡張が制御する。 */
        open?: boolean;
        /** ポップアップの幅(px)。 */
        width?: number;
        key?: string;
        onOpenChange?: (open: boolean) => unknown;
      },
    ): UiNode;
    list(props: {
      items: Array<{ id: string; label: string; selected?: boolean }>;
      key?: string;
      onSelect?: (id: string) => unknown;
    }): UiNode;
    /**
     * エディタのインスペクタと同じリスト UI。見出しでの折りたたみ・件数表示・
     * ドラッグ並べ替え・行の `×`・フッタの `＋` / `−` が付いた編集リストで、
     * お気に入りやプリセットのような「並びに意味がある一覧」に向く。
     *
     * 渡さなかったハンドラの操作は自動的に無効化される（`onAdd` 省略 → `＋` は押せない）。
     * `items[].children` を付けると、その行を選択したときに下へ展開される編集エリアになる。
     */
    inspectorList(props: {
      title: string;
      items: Array<{
        id: string;
        label: string;
        selected?: boolean;
        /** 行を開いたときに表示する編集 UI。 */
        children?: UiNode[];
      }>;
      /** 0 件のときに出す文言。 */
      emptyText?: string;
      addDisabled?: boolean;
      removeDisabled?: boolean;
      reorderDisabled?: boolean;
      key?: string;
      /** 行を選択したとき（クリックで開く / 移動する用途）。 */
      onSelect?: (id: string) => unknown;
      onAdd?: () => unknown;
      onRemove?: (e: { id: string | null; index: number }) => unknown;
      onReorder?: (e: { from: number; to: number; id: string | null }) => unknown;
    }): UiNode;
    /**
     * Web ページの埋め込み表示（sandbox 付き iframe）。`webview:<host>` または
     * `webview:*` 権限が必要で、https のみ。`grow: true` でタブの残り領域
     * いっぱいに広がる。`key` を変えると remount ＝再読込になる。
     * ページ内遷移の URL 観測や戻る / 進むはできない（cross-origin のため）。
     */
    /** 0..1 の進捗バー。`value` を省略すると不定（処理中）表示になる。 */
    progress(props?: { label?: string; value?: number; key?: string }): UiNode;
    slider(props: {
      label?: string;
      value: number;
      min?: number;
      max?: number;
      step?: number;
      disabled?: boolean;
      key?: string;
      onChange?: (value: number) => unknown;
    }): UiNode;
    /** 小さな状態チップ。 */
    badge(
      label: string,
      props?: {
        tone?: "neutral" | "info" | "success" | "warning" | "danger";
        key?: string;
      },
    ): UiNode;
    /**
     * タブ切り替え。`active` を渡すと拡張が制御し、省略時はエディタが保持する
     * （`refresh()` してもタブが先頭に戻らない）。
     */
    tabs(
      items: Array<{ id: string; label: string; children: UiNode[] }>,
      props?: { active?: string; key?: string; onChange?: (id: string) => unknown },
    ): UiNode;
    /** 読み取り専用の表。`cells` は `columns` と同じ並びで渡す。 */
    table(props: {
      columns: Array<{ key: string; label: string; width?: number }>;
      rows: Array<{ id: string; cells: string[]; selected?: boolean }>;
      emptyText?: string;
      key?: string;
      onSelect?: (id: string) => unknown;
    }): UiNode;
    /**
     * プロジェクト内アセットの表示。`asset` はアセットのパス。表示 URL は
     * エディタが解決するので、任意の外部 URL を貼ることはできない
     * （外部ページを出したいときは `ui.webview()`）。
     */
    image(props: {
      asset: string;
      width?: number;
      height?: number;
      fit?: "contain" | "cover";
      key?: string;
    }): UiNode;
    /**
     * アセットを選ばせる。**選択肢はエディタが埋める**ので拡張は一覧を用意しない。
     * `project:read` が無くても使え、ユーザーが選んだ 1 件だけが `onChange` に届く。
     */
    assetPicker(props: {
      label?: string;
      value: string;
      /** `image` / `sound` / `film` / `font` / `model` / `environment` / `other`。省略で全部。 */
      kind?: string;
      placeholder?: string;
      disabled?: boolean;
      key?: string;
      /** 選ばれたアセットのパス。 */
      onChange?: (assetPath: string) => unknown;
    }): UiNode;
    /** 画面を選ばせる（選択肢はエディタが埋める）。 */
    screenPicker(props: {
      label?: string;
      value: string;
      placeholder?: string;
      disabled?: boolean;
      key?: string;
      /** 選ばれた screen id。 */
      onChange?: (screenId: string) => unknown;
    }): UiNode;
    /** 画面変数を選ばせる。`screenId` 省略時は現在選択中の画面。 */
    variablePicker(props: {
      label?: string;
      value: string;
      screenId?: string;
      placeholder?: string;
      disabled?: boolean;
      key?: string;
      /** 選ばれた変数名。 */
      onChange?: (name: string) => unknown;
    }): UiNode;
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

    /**
     * 拡張自身の文言を引く。`l10n/<locale>.toon` に
     * `greeting: "こんにちは {name}"` のように書いておくと、
     * `katari.t("greeting", { name: "A" })` で現在の言語の文言が返る。
     * 見つからなければ en → キーそのもの、の順にフォールバックする。
     */
    t(key: string, params?: Record<string, string | number>): string;

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
     * manifest の `contributes.configuration` で宣言した設定。**フォームは
     * エディタが描く**ので、拡張は値を読むだけでよい（設定 UI のコードが要らない）。
     * `type: secret` の項目は OS の資格情報ストアに入り、設定ファイルには残らない。
     */
    config: {
      get(
        key: string,
        options?: { scope?: "project" | "editor"; secret?: boolean },
      ): Promise<unknown>;
      set(
        key: string,
        value: unknown,
        options?: { scope?: "project" | "editor"; secret?: boolean },
      ): Promise<unknown>;
      /** ユーザーが設定を編集したときに呼ばれる。戻り値を呼ぶと解除。 */
      onChange(
        handler: (payload: { key: string; scope: "project" | "editor" }) => unknown,
      ): () => void;
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

    /**
     * operation registry の操作を直接呼ぶ。読み取りは `project:read` が必要。
     *
     * op 名と引数は `katari-ops.d.ts`（Rust のツールスキーマから自動生成）で
     * 型付けされているので補完が効く。生成表に無い op も文字列で呼べる。
     */
    ops: {
      invoke<K extends string>(op: K, args?: OpArgs<K>): Promise<unknown>;
      list(): Promise<string[]>;
    };

    /**
     * 編集はここを通す。ops 列は 1 トランザクションとして適用され、
     * undo 1 回でまとめて戻る。`project:write` が必要。
     */
    edit(label: string, ops: EditOp[]): Promise<unknown>;

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

    /**
     * エディタ側の変化を購読する。戻り値を呼ぶと解除できる。
     * `locale.changed` 以外は `project:read` が必要。イベントだけで動く拡張は
     * manifest の `activation` に `onEvent` を宣言する（起動時に立ち上がる）。
     */
    events: {
      on<K extends ExtensionEventName>(
        name: K,
        handler: (payload: ExtensionEventPayload[K]) => unknown,
      ): () => void;
    };

    /**
     * 任意権限（manifest の `optional_permissions`）。承認時ではなく**使う直前に**
     * ユーザーへ尋ねられる。ユーザーはいつでも管理ウィンドウから取り消せるので、
     * 使う前に毎回 `has()` か `request()` で確認すること。
     */
    permissions: {
      has(permission: string): Promise<boolean>;
      /** 許可されたら true。必須側や未宣言の権限を渡すと例外。 */
      request(permission: string): Promise<boolean>;
    };

    /**
     * 本体の「問題」パネルへ出す診断。呼ぶたびに**その拡張の分を全置換**するので、
     * 消したいときは空配列を渡す。`project:read` が必要。
     * `target` を付けるとクリックでその場所へ飛べる。
     */
    diagnostics: {
      set(
        items: Array<{
          message: string;
          severity?: "error" | "warning";
          resource?: string;
          detail?: string;
          target?:
            | { kind: "scene"; sceneName: string; line?: number }
            | { kind: "screen"; screenId: string };
        }>,
      ): Promise<unknown>;
    };

    /**
     * ステータスバーに出す小さな項目（同期状態・カウンタなど、常時見えていて
     * ほしい情報）。1 拡張あたり 3 件まで。
     */
    status: {
      set(item: {
        id: string;
        text: string;
        tooltip?: string;
        tone?: "neutral" | "info" | "success" | "warning" | "danger";
        /** 押したときに実行する自分のコマンド id。 */
        command?: string;
        order?: number;
      }): Promise<unknown>;
      clear(id: string): Promise<unknown>;
    };

    clipboard: {
      /** `clipboard` 権限が必要。 */
      writeText(text: string): Promise<unknown>;
    };

    net: {
      /** `net:<host>` 権限が必要。https のみ。 */
      fetchText(url: string): Promise<string>;
      /**
       * method / headers / body を指定できる版。`net:<host>` 権限が必要で https のみ。
       * リクエストはエディタ webview ではなくネイティブ側から出るため、CORS の
       * 影響を受けず、エディタの Cookie とも混ざらない。応答は 8MB まで。
       */
      fetch(options: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string;
        /** `text`（既定）は `text`、`bytes` は `base64` に入って返る。 */
        responseType?: "text" | "bytes";
      }): Promise<{
        status: number;
        ok: boolean;
        headers: Record<string, string>;
        text: string | null;
        base64: string | null;
      }>;
    };

    /**
     * ユーザーが選んだ 1 ファイルだけを読み書きする。**権限は不要**な代わりに
     * 毎回 OS のダイアログを経由し、パスを覚えて後から読み直すことはできない。
     * インポータ / エクスポータ（CSV・JSON・他ツールからの移行）はこれで書く。
     */
    fs: {
      /** 「開く」ダイアログ → 選ばれた 1 ファイルの中身。キャンセルは null。 */
      openFile(options?: {
        /** 拡張子で絞る（`["csv", "json"]`）。 */
        accept?: string[];
        /** `utf8`（既定）は `text`、`base64` は `base64` に入って返る。 */
        encoding?: "utf8" | "base64";
        title?: string;
      }): Promise<{
        path: string;
        name: string;
        text?: string;
        base64?: string;
      } | null>;
      /** 「保存」ダイアログ → 書き出し。キャンセルは null。 */
      saveFile(options: {
        data: string;
        suggestedName?: string;
        accept?: string[];
        encoding?: "utf8" | "base64";
        title?: string;
      }): Promise<{ path: string } | null>;
    };

    log(...args: unknown[]): void;
  }

  export const katari: Katari;
  export const ui: Ui;
  export default katari;
}
