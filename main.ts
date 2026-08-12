/**
 * エディタ内ブラウザタブ拡張。
 *
 * `ui.webview({ native: true })`（ネイティブ子 webview、Katari ADR-0076）で任意の
 * https ページを Dock タブに表示する。X-Frame-Options 拒否サイトも表示できる。
 * タブは Dock 位置 + URL + 履歴ごと永続化され、再起動後に復元される（`restoreId` + `onRestore`）。
 *
 * ツールバーの「★」「🕘」でお気に入り / 履歴メニューを開閉する。一覧は本体の
 * インスペクタと同じリスト UI（`ui.inspectorList`）なので、その場で並べ替え・削除できる。
 * お気に入りは「エディタ設定 / プロジェクト設定」の拡張タブでも編集できる
 * （`katari.settings` + `katari.storage`）。
 */
import { katari, ui } from "@katari/ext";

type Scope = "editor" | "project";
type Menu = "fav" | "history" | null;

type Tab = {
  input: string;
  url: string;
  /** 訪問履歴（新しい順、重複した連続 URL は積まない）。 */
  history: string[];
  menu: Menu;
};

// native 子 webview 描画なので、X-Frame-Options で埋め込みを拒否するサイトも初期ページにできる。
const HOME = "https://developer.mozilla.org/";

/** タブ状態に保存する履歴の最大件数。 */
const HISTORY_MAX = 20;
/**
 * タブ状態（`window.setState`）の JSON 予算。本体は 4KB を超えた state を**丸ごと捨てる**ので、
 * URL まで失わないよう手前で履歴を削る。
 */
const STATE_BUDGET = 3000;

// お気に入り URL（scope ごと）。onStartup で storage からロードするモジュールキャッシュ。
const favorites: Record<Scope, string[]> = { editor: [], project: [] };
// 設定パネルの「追加」入力バッファ（scope ごと）。
const addInput: Record<Scope, string> = { editor: "", project: "" };
// 設定パネルで行を開いて URL を編集中のバッファ（`${scope}:${index}` → 入力値）。
const editInput: Record<string, string> = {};

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

/** 一覧行のラベル。scheme を落として「ホスト + パス」にする（幅は UI 側で省略表示）。 */
function labelOf(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    return `${u.hostname}${path}${u.search}`;
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

async function saveFavorites(scope: Scope, next: string[]): Promise<void> {
  favorites[scope] = next;
  await katari.storage[scope].set("favorites", next);
  katari.refresh();
}

function isFavorite(scope: Scope, url: string): boolean {
  return favorites[scope].includes(url);
}

async function addFavorite(scope: Scope, raw: string): Promise<void> {
  const url = normalize(raw);
  if (!url) {
    void katari.ui.toast("https の URL を入力してください", "warning");
    return;
  }
  if (favorites[scope].includes(url)) return;
  await saveFavorites(scope, [...favorites[scope], url]);
}

async function removeFavorite(scope: Scope, url: string): Promise<void> {
  await saveFavorites(
    scope,
    favorites[scope].filter((u) => u !== url),
  );
}

/** 現在ページのお気に入り登録をトグルする（メニューのチェックボックス）。 */
async function toggleFavorite(scope: Scope, url: string): Promise<void> {
  if (isFavorite(scope, url)) await removeFavorite(scope, url);
  else await addFavorite(scope, url);
}

/** ドラッグ並べ替え。`to` は from を抜いたあとの挿入位置。 */
async function moveFavorite(scope: Scope, from: number, to: number): Promise<void> {
  const next = [...favorites[scope]];
  if (from < 0 || from >= next.length) return;
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return;
  next.splice(Math.max(0, Math.min(next.length, to)), 0, moved);
  await saveFavorites(scope, next);
}

/** 設定タブで行を開いて URL を編集したときの置き換え。 */
async function replaceFavorite(scope: Scope, index: number, raw: string): Promise<void> {
  const url = normalize(raw);
  if (!url) {
    void katari.ui.toast("https の URL を入力してください", "warning");
    return;
  }
  const next = [...favorites[scope]];
  if (index < 0 || index >= next.length) return;
  if (next[index] === url) return;
  if (next.includes(url)) {
    void katari.ui.toast("同じ URL が既にあります", "warning");
    return;
  }
  next[index] = url;
  delete editInput[`${scope}:${index}`];
  await saveFavorites(scope, next);
}

const SCOPE_TITLE: Record<Scope, string> = {
  editor: "エディタお気に入り",
  project: "プロジェクトお気に入り",
};

// -------------------------------------------------------------- 設定タブ

/** 設定タブ（プロジェクト設定 / エディタ設定）のお気に入り編集パネル。 */
function renderFavPanel(scope: Scope) {
  return ui.column([
    ui.heading(scope === "editor" ? "お気に入り URL（エディタ共通）" : "お気に入り URL（このプロジェクト）"),
    ui.text(
      scope === "editor"
        ? "すべてのプロジェクトで共有されます。行をクリックすると URL を編集できます。"
        : "現在のプロジェクトにのみ保存されます（project-settings に含まれます）。行をクリックすると URL を編集できます。",
      { muted: true },
    ),
    ui.inspectorList({
      key: `fav:${scope}`,
      title: SCOPE_TITLE[scope],
      emptyText: "まだ登録がありません。下の欄から追加できます。",
      items: favorites[scope].map((url, i) => ({
        id: url,
        label: labelOf(url),
        children: [
          ui.row([
            ui.textField({
              value: editInput[`${scope}:${i}`] ?? url,
              placeholder: "https://…",
              key: `edit:${scope}:${i}`,
              onChange: (v) => {
                editInput[`${scope}:${i}`] = v;
              },
              onSubmit: (v) => void replaceFavorite(scope, i, v),
            }),
            ui.button({
              label: "保存",
              variant: "primary",
              key: `save:${scope}:${i}`,
              onClick: () => void replaceFavorite(scope, i, editInput[`${scope}:${i}`] ?? url),
            }),
            ui.button({
              label: "開く",
              variant: "ghost",
              key: `open:${scope}:${i}`,
              onClick: () => openTab(url),
            }),
          ]),
        ],
      })),
      onAdd: () => {
        if (!addInput[scope].trim()) {
          void katari.ui.toast("下の欄に URL を入れてから ＋ を押してください", "info");
          return;
        }
        void addFavorite(scope, addInput[scope]);
        addInput[scope] = "";
      },
      onRemove: ({ id }) => {
        if (id) void removeFavorite(scope, id);
      },
      onReorder: ({ from, to }) => void moveFavorite(scope, from, to),
    }),
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

// -------------------------------------------------------------- 履歴

/** 履歴の先頭に積む（直前と同じ URL は積まない）。 */
function pushHistory(tab: Tab, url: string): void {
  if (tab.history[0] === url) return;
  tab.history = [url, ...tab.history].slice(0, HISTORY_MAX);
}

/**
 * タブ状態（`window.setState` に渡す値）。本体は JSON 4KB 超の state を丸ごと捨てるので、
 * 予算に収まるまで**古い履歴から**落とす（URL は必ず残す）。
 */
function tabState(tab: Tab): { url: string; history: string[] } {
  let history = tab.history.slice(0, HISTORY_MAX);
  while (history.length > 0 && JSON.stringify({ url: tab.url, history }).length > STATE_BUDGET) {
    history = history.slice(0, -1);
  }
  return { url: tab.url, history };
}

// -------------------------------------------------------------- ブラウザタブ

function openTab(
  initialUrl: string = HOME,
  restoreId: string = newRestoreId(),
  near?: string,
  initialHistory: string[] = [],
) {
  const tab: Tab = {
    input: initialUrl,
    url: initialUrl,
    history: initialHistory.slice(0, HISTORY_MAX),
    menu: null,
  };
  let viewId = "";

  const persist = () => {
    if (viewId) katari.window.setState(viewId, tabState(tab));
  };

  // URL バー / 一覧からの移動。tab.url を変えると webview が navigate される（履歴維持）。
  const navigate = (raw: string) => {
    const url = normalize(raw);
    if (!url) {
      void katari.ui.toast("https の URL を入力してください", "warning");
      return;
    }
    tab.url = url;
    tab.input = url;
    katari.refresh();
  };

  // 実際の遷移（リンククリック / SPA の pushState 含む）で URL バー・履歴・永続状態を追従させる。
  const onNavigate = (url: string) => {
    tab.url = url;
    tab.input = url;
    pushHistory(tab, url);
    persist();
  };
  // ページタイトルをタブ名にする。
  const onTitle = (title: string) => {
    if (viewId && title) katari.window.setTitle(viewId, title);
  };

  const setMenu = (next: Menu) => {
    tab.menu = tab.menu === next ? null : next;
    katari.refresh();
  };

  /** お気に入り一覧（scope 1 つ分）。クリックで移動、× で削除、ドラッグで並べ替え。 */
  const favList = (scope: Scope) =>
    ui.inspectorList({
      key: `fav:${scope}`,
      title: SCOPE_TITLE[scope],
      emptyText: "★ のトグルで現在のページを追加できます",
      items: favorites[scope].map((url) => ({ id: url, label: labelOf(url) })),
      onSelect: (id) => navigate(id),
      onRemove: ({ id }) => {
        if (id) void removeFavorite(scope, id);
      },
      onReorder: ({ from, to }) => void moveFavorite(scope, from, to),
    });

  /** ★メニュー: 現在ページのトグル 2 つ + お気に入り一覧（エディタ → プロジェクトの順）。 */
  const favMenu = () =>
    ui.group([
      ui.row([
        ui.checkbox({
          label: "エディタお気に入り",
          value: isFavorite("editor", tab.url),
          key: "fav-toggle-editor",
          onChange: () => void toggleFavorite("editor", tab.url),
        }),
        ui.checkbox({
          label: "プロジェクトお気に入り",
          value: isFavorite("project", tab.url),
          key: "fav-toggle-project",
          onChange: () => void toggleFavorite("project", tab.url),
        }),
      ]),
      favList("editor"),
      favList("project"),
    ]);

  /** 🕘メニュー: このタブの訪問履歴（新しい順）。クリックで移動、× で 1 件削除。 */
  const historyMenu = () =>
    ui.group([
      ui.row([
        ui.text(`${tab.history.length} 件（最大 ${HISTORY_MAX}）`, { muted: true, key: "hcount" }),
        ui.button({
          label: "履歴を消去",
          variant: "ghost",
          disabled: tab.history.length === 0,
          onClick: () => {
            tab.history = [];
            persist();
            katari.refresh();
          },
        }),
      ]),
      ui.inspectorList({
        key: "history",
        title: "履歴（新しい順）",
        emptyText: "まだ移動していません",
        // 履歴は時系列なので並べ替えは無効（ハンドルも出さない）。
        reorderDisabled: true,
        // 同じ URL を何度も訪れるので、id には位置を混ぜて一意にする。
        items: tab.history.map((url, i) => ({ id: `${i}:${url}`, label: labelOf(url) })),
        onSelect: (id) => navigate(id.slice(id.indexOf(":") + 1)),
        onRemove: ({ index }) => {
          tab.history = tab.history.filter((_, i) => i !== index);
          persist();
          katari.refresh();
        },
      }),
    ]);

  viewId = katari.window.open({
    title: hostOf(initialUrl),
    width: 900,
    height: 640,
    restoreId,
    state: { url: initialUrl, history: tab.history },
    icon: "🌐",
    near,
    render: () => {
      // ★/☆ は描画のたびに現在 URL で判定する（別タブや設定タブでの変更にも追従する）。
      const favorited = isFavorite("editor", tab.url) || isFavorite("project", tab.url);
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
          // お気に入り / 履歴メニューの開閉（ネイティブ webview は最前面に描かれるので、
          // ポップアップではなくツールバー直下へインラインで開く）。
          ui.button({
            label: favorited ? "★ ▾" : "☆ ▾",
            variant: tab.menu === "fav" ? "primary" : "ghost",
            onClick: () => setMenu("fav"),
          }),
          ui.button({
            label: "🕘 ▾",
            variant: tab.menu === "history" ? "primary" : "ghost",
            onClick: () => setMenu("history"),
          }),
          // 新しいタブは、この（元）タブの隣に開く。
          ui.button({ label: "＋", variant: "ghost", onClick: () => openTab(HOME, newRestoreId(), viewId) }),
        ]),
        ...(tab.menu === "fav" ? [favMenu()] : []),
        ...(tab.menu === "history" ? [historyMenu()] : []),
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

// 再起動時、前回開いていたブラウザタブを同じ URL・履歴で復元する（Dock 位置は本体が保持）。
katari.window.onRestore((restoreId, state) => {
  const rec = state && typeof state === "object" ? (state as Record<string, unknown>) : {};
  const url = typeof rec.url === "string" ? rec.url : HOME;
  openTab(url, restoreId, undefined, asUrlList(rec.history));
});

// 起動時にお気に入りをロードする（onStartup activation）。
void loadFavorites();
