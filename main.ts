/**
 * エディタ内ブラウザタブ拡張。
 *
 * `ui.webview({ native: true })`（ネイティブ子 webview、Katari ADR-0076）で任意の
 * https ページを Dock タブに表示する。X-Frame-Options 拒否サイトも表示できる。
 * タブは Dock 位置 + URL ごと永続化され、再起動後に復元される（`restoreId` + `onRestore`）。
 *
 * お気に入り URL を「エディタ設定 / プロジェクト設定」の拡張タブで編集でき、
 * ブラウザ内に一覧表示してクリックで移動できる（`katari.settings` + `katari.storage`）。
 */
import { katari, ui } from "@katari/ext";

type Tab = { input: string; url: string };

type Scope = "editor" | "project";

// native 子 webview 描画なので、X-Frame-Options で埋め込みを拒否するサイトも初期ページにできる。
const HOME = "https://developer.mozilla.org/";

// お気に入り URL（scope ごと）。onStartup で storage からロードするモジュールキャッシュ。
const favorites: Record<Scope, string[]> = { editor: [], project: [] };
// 設定パネルの「追加」入力バッファ（scope ごと）。
const addInput: Record<Scope, string> = { editor: "", project: "" };

let restoreSeq = 0;
function newRestoreId(): string {
  return `tab-${Date.now().toString(36)}-${restoreSeq++}`;
}

/** scheme 省略を https 補完し、https 以外は拒否して null を返す。 */
function normalize(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function asUrlList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

// -------------------------------------------------------------- お気に入り

async function loadFavorites(): Promise<void> {
  favorites.editor = asUrlList(await katari.storage.editor.get("favorites"));
  favorites.project = asUrlList(await katari.storage.project.get("favorites"));
  katari.refresh(); // ロード完了後に設定パネル / ブラウザ view を描き直す。
}

async function addFavorite(scope: Scope, raw: string): Promise<void> {
  const url = normalize(raw);
  if (!url) {
    void katari.ui.toast("https の URL を入力してください", "warning");
    return;
  }
  if (favorites[scope].includes(url)) return;
  favorites[scope] = [...favorites[scope], url];
  await katari.storage[scope].set("favorites", favorites[scope]);
  katari.refresh();
}

async function removeFavorite(scope: Scope, url: string): Promise<void> {
  favorites[scope] = favorites[scope].filter((u) => u !== url);
  await katari.storage[scope].set("favorites", favorites[scope]);
  katari.refresh();
}

/** 設定タブ（プロジェクト設定 / エディタ設定）のお気に入り編集パネル。 */
function renderFavPanel(scope: Scope) {
  const rows = favorites[scope].map((url, i) =>
    ui.row(
      [
        ui.text(url, { key: `t:${i}` }),
        ui.button({ label: "開く", variant: "ghost", key: `o:${i}`, onClick: () => openTab(url) }),
        ui.button({
          label: "削除",
          variant: "danger",
          key: `d:${i}`,
          onClick: () => void removeFavorite(scope, url),
        }),
      ],
      { key: `row:${i}`, align: "center" },
    ),
  );
  return ui.column([
    ui.heading(scope === "editor" ? "お気に入り URL（エディタ共通）" : "お気に入り URL（このプロジェクト）"),
    ui.text(
      scope === "editor"
        ? "すべてのプロジェクトで共有されます。"
        : "現在のプロジェクトにのみ保存されます（project-settings に含まれます）。",
      { muted: true },
    ),
    ...rows,
    ui.separator(),
    ui.row([
      ui.textField({
        value: addInput[scope],
        placeholder: "https://…",
        key: `add:${scope}`,
        onChange: (v) => {
          addInput[scope] = v;
        },
        onSubmit: (v) => {
          void addFavorite(scope, v);
          addInput[scope] = "";
        },
      }),
      ui.button({
        label: "追加",
        variant: "primary",
        onClick: () => {
          void addFavorite(scope, addInput[scope]);
          addInput[scope] = "";
        },
      }),
    ]),
  ]);
}

katari.settings.panel("favEditor", () => renderFavPanel("editor"));
katari.settings.panel("favProject", () => renderFavPanel("project"));

// -------------------------------------------------------------- ブラウザタブ

/** ブラウザ view 内のお気に入り一覧行（クリックで移動）。空 scope は null。 */
function favBar(scope: Scope, navigate: (url: string) => void) {
  const list = favorites[scope];
  if (list.length === 0) return null;
  return ui.row(
    [
      ui.text(scope === "editor" ? "★共通:" : "★このPJ:", { muted: true, key: "lbl" }),
      ...list.map((url, i) =>
        ui.button({
          label: hostOf(url),
          variant: "ghost",
          key: `fav:${scope}:${i}`,
          onClick: () => navigate(url),
        }),
      ),
    ],
    { key: `favbar:${scope}`, align: "center" },
  );
}

function openTab(
  initialUrl: string = HOME,
  restoreId: string = newRestoreId(),
  near?: string,
) {
  const tab: Tab = { input: initialUrl, url: initialUrl };
  let viewId = "";

  // URL バーからの移動（Enter）。tab.url を変えると webview が navigate される（履歴維持）。
  const navigate = (raw: string) => {
    const url = normalize(raw);
    if (!url) {
      void katari.ui.toast("https の URL を入力してください", "warning");
      return;
    }
    tab.url = url;
    tab.input = url;
  };

  // 実際の遷移（リンククリック含む）で URL バー・永続状態を追従させる。
  const onNavigate = (url: string) => {
    tab.url = url;
    tab.input = url;
    if (viewId) katari.window.setState(viewId, { url });
  };
  // ページタイトルをタブ名にする。
  const onTitle = (title: string) => {
    if (viewId && title) katari.window.setTitle(viewId, title);
  };

  viewId = katari.window.open({
    title: hostOf(initialUrl),
    width: 900,
    height: 640,
    restoreId,
    state: { url: initialUrl },
    icon: "🌐",
    near,
    render: () => {
      const bars = [favBar("editor", navigate), favBar("project", navigate)].filter(
        (b): b is NonNullable<typeof b> => b != null,
      );
      return ui.column([
        ui.row([
          ui.button({ label: "←", variant: "ghost", onClick: () => void katari.window.webviewBack(viewId) }),
          ui.button({ label: "→", variant: "ghost", onClick: () => void katari.window.webviewForward(viewId) }),
          ui.button({ label: "⟳", variant: "ghost", onClick: () => void katari.window.webviewReload(viewId) }),
          ui.textField({
            value: tab.input,
            placeholder: "https://…",
            key: "url",
            onChange: (v) => {
              tab.input = v;
            },
            onSubmit: (v) => navigate(v),
          }),
          // 現在 URL をお気に入りに追加。
          ui.button({ label: "★共通", variant: "ghost", onClick: () => void addFavorite("editor", tab.url) }),
          ui.button({ label: "★PJ", variant: "ghost", onClick: () => void addFavorite("project", tab.url) }),
          // 新しいタブは、この（元）タブの隣に開く。
          ui.button({ label: "＋", variant: "ghost", onClick: () => openTab(HOME, newRestoreId(), viewId) }),
        ]),
        ...bars,
        ui.webview({
          url: tab.url,
          grow: true,
          native: true,
          onNavigate,
          onTitle,
        }),
      ]);
    },
  });
  return viewId;
}

katari.commands.register("open", () => {
  openTab();
});

// 再起動時、前回開いていたブラウザタブを同じ URL で復元する（Dock 位置は本体が保持）。
katari.window.onRestore((restoreId, state) => {
  const url =
    state && typeof state === "object" && typeof (state as { url?: unknown }).url === "string"
      ? (state as { url: string }).url
      : HOME;
  openTab(url, restoreId);
});

// 起動時にお気に入りをロードする（onStartup activation）。
void loadFavorites();
