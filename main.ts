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

/** 一覧に出す 1 件。表示は `title`（無ければ URL から作ったラベル）。 */
type Entry = { url: string; title?: string };

type Tab = {
  input: string;
  url: string;
  /** 現在ページのタイトル（`onTitle` 追従。履歴 / お気に入りの表示名に使う）。 */
  title: string;
  /** 訪問履歴（新しい順、重複した連続 URL は積まない）。 */
  history: Entry[];
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

// お気に入り（scope ごと）。onStartup で storage からロードするモジュールキャッシュ。
const favorites: Record<Scope, Entry[]> = { editor: [], project: [] };
// 設定パネルで編集中のバッファ（`url:<scope>:<index>` / `title:<scope>:<index>` → 入力値）。
const editInput: Record<string, string> = {};
/** 設定タブの `＋` で追加する既定 URL（追加後に行を開いて編集する前提）。 */
const NEW_FAVORITE_BASE = "https://example.com/";

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

/** タイトルが無いときのラベル。scheme を落として「ホスト + パス」にする。 */
function labelOf(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    return `${u.hostname}${path}${u.search}`;
  } catch {
    return url;
  }
}

/** 一覧行の表示名。ページタイトルを優先し、無ければ URL から作る。 */
function labelFor(entry: Entry): string {
  const title = entry.title?.trim();
  return title ? title : labelOf(entry.url);
}

/** 保存値を Entry 列にする。**旧形式（URL の文字列配列）も受ける**。 */
function asEntries(value: unknown): Entry[] {
  if (!Array.isArray(value)) return [];
  const out: Entry[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      out.push({ url: item });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.url !== "string") continue;
    out.push({
      url: rec.url,
      ...(typeof rec.title === "string" && rec.title ? { title: rec.title } : {}),
    });
  }
  return out;
}

// -------------------------------------------------------------- お気に入り

async function loadFavorites(): Promise<void> {
  favorites.editor = asEntries(await katari.storage.editor.get("favorites"));
  favorites.project = asEntries(await katari.storage.project.get("favorites"));
  katari.refresh(); // ロード完了後に設定パネル / ブラウザ view を描き直す。
}

async function saveFavorites(scope: Scope, next: Entry[]): Promise<void> {
  favorites[scope] = next;
  await katari.storage[scope].set("favorites", next);
  katari.refresh();
}

function isFavorite(scope: Scope, url: string): boolean {
  return favorites[scope].some((f) => f.url === url);
}

async function addFavorite(scope: Scope, raw: string, title?: string): Promise<void> {
  const url = normalize(raw);
  if (!url) {
    void katari.ui.toast("https の URL を入力してください", "warning");
    return;
  }
  if (isFavorite(scope, url)) return;
  const name = title?.trim();
  await saveFavorites(scope, [...favorites[scope], name ? { url, title: name } : { url }]);
}

async function removeFavorite(scope: Scope, url: string): Promise<void> {
  await saveFavorites(
    scope,
    favorites[scope].filter((f) => f.url !== url),
  );
}

/** 現在ページのお気に入り登録をトグルする（メニューのチェックボックス）。 */
async function toggleFavorite(scope: Scope, url: string, title?: string): Promise<void> {
  if (isFavorite(scope, url)) await removeFavorite(scope, url);
  else await addFavorite(scope, url, title);
}

/**
 * 現在ページのタイトルを、同じ URL のお気に入りへ書き戻す（タイトル未設定のものだけ）。
 * 旧形式で保存された URL だけのお気に入りも、一度開けば名前が付く。
 */
async function fillFavoriteTitle(url: string, title: string): Promise<void> {
  const name = title.trim();
  if (!name) return;
  for (const scope of ["editor", "project"] as const) {
    const list = favorites[scope];
    if (!list.some((f) => f.url === url && !f.title)) continue;
    await saveFavorites(
      scope,
      list.map((f) => (f.url === url && !f.title ? { ...f, title: name } : f)),
    );
  }
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

/** 設定タブで行を開いて URL を編集したときの置き換え（タイトルは維持する）。 */
async function replaceFavorite(scope: Scope, index: number, raw: string): Promise<void> {
  const url = normalize(raw);
  if (!url) {
    void katari.ui.toast("https の URL を入力してください", "warning");
    return;
  }
  const next = [...favorites[scope]];
  const current = next[index];
  if (!current) return;
  if (current.url === url) return;
  if (next.some((f) => f.url === url)) {
    void katari.ui.toast("同じ URL が既にあります", "warning");
    return;
  }
  next[index] = { ...current, url };
  delete editInput[`url:${scope}:${index}`];
  await saveFavorites(scope, next);
}

/** 設定タブで表示名（タイトル）を編集したときの置き換え。空にすると URL 表示へ戻る。 */
async function renameFavorite(scope: Scope, index: number, raw: string): Promise<void> {
  const next = [...favorites[scope]];
  const current = next[index];
  if (!current) return;
  const title = raw.trim();
  next[index] = title ? { ...current, title } : { url: current.url };
  delete editInput[`title:${scope}:${index}`];
  await saveFavorites(scope, next);
}

/** `＋` で足す既定 URL。既にあれば連番を付けて必ず新しい行になるようにする。 */
function newFavoriteUrl(scope: Scope): string {
  const has = (u: string) => favorites[scope].some((f) => f.url === u);
  if (!has(NEW_FAVORITE_BASE)) return NEW_FAVORITE_BASE;
  for (let i = 2; ; i++) {
    const candidate = `${NEW_FAVORITE_BASE}${i}`;
    if (!has(candidate)) return candidate;
  }
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
        ? "すべてのプロジェクトで共有されます。＋ で追加し、行をクリックして名前と URL を編集します。"
        : "現在のプロジェクトにのみ保存されます（project-settings に含まれます）。＋ で追加し、行をクリックして名前と URL を編集します。",
      { muted: true },
    ),
    ui.inspectorList({
      key: `fav:${scope}`,
      title: SCOPE_TITLE[scope],
      emptyText: "まだ登録がありません。＋ で追加できます。",
      // 一覧はページタイトル（未取得なら URL）で表示する。
      items: favorites[scope].map((fav, i) => ({
        id: fav.url,
        label: labelFor(fav),
        children: [
          ui.row([
            ui.text("名前", { muted: true, key: `tl:${scope}:${i}` }),
            ui.textField({
              value: editInput[`title:${scope}:${i}`] ?? fav.title ?? "",
              placeholder: "未設定なら URL を表示",
              key: `title:${scope}:${i}`,
              onChange: (v) => {
                editInput[`title:${scope}:${i}`] = v;
              },
              onSubmit: (v) => void renameFavorite(scope, i, v),
            }),
            ui.button({
              label: "保存",
              variant: "primary",
              key: `savetitle:${scope}:${i}`,
              onClick: () =>
                void renameFavorite(scope, i, editInput[`title:${scope}:${i}`] ?? fav.title ?? ""),
            }),
          ]),
          ui.row([
            ui.text("URL", { muted: true, key: `ul:${scope}:${i}` }),
            ui.textField({
              value: editInput[`url:${scope}:${i}`] ?? fav.url,
              placeholder: "https://…",
              key: `edit:${scope}:${i}`,
              onChange: (v) => {
                editInput[`url:${scope}:${i}`] = v;
              },
              onSubmit: (v) => void replaceFavorite(scope, i, v),
            }),
            ui.button({
              label: "保存",
              variant: "primary",
              key: `save:${scope}:${i}`,
              onClick: () =>
                void replaceFavorite(scope, i, editInput[`url:${scope}:${i}`] ?? fav.url),
            }),
            ui.button({
              label: "開く",
              variant: "ghost",
              key: `open:${scope}:${i}`,
              onClick: () => openTab(fav.url),
            }),
          ]),
        ],
      })),
      // ＋ は既定 URL の行をそのまま足す（行を開いて URL を書き換える運用）。
      onAdd: () => void addFavorite(scope, newFavoriteUrl(scope)),
      onRemove: ({ id }) => {
        if (id) void removeFavorite(scope, id);
      },
      onReorder: ({ from, to }) => void moveFavorite(scope, from, to),
    }),
  ]);
}

katari.settings.panel("favEditor", () => renderFavPanel("editor"));
katari.settings.panel("favProject", () => renderFavPanel("project"));

// -------------------------------------------------------------- 履歴

/**
 * 履歴の先頭に積む（直前と同じ URL は積まない）。
 *
 * **タイトルはここでは載せない**。エディタは URL とタイトルを 1 組で（URL → タイトルの順に）
 * 配ってくるので、直後の `onTitle` が先頭行へ正しい名前を書き込む。前ページのタイトルを
 * 引き継がせないために、あえて空で積む（タイトルの無いページは URL 表示のままになる）。
 */
function pushHistory(tab: Tab, url: string): void {
  if (tab.history[0]?.url === url) return;
  tab.history = [{ url }, ...tab.history].slice(0, HISTORY_MAX);
}

/** タイトルが届いたら、現在ページ（履歴の先頭）に反映する。 */
function applyTitle(tab: Tab, title: string): void {
  tab.title = title;
  const head = tab.history[0];
  if (head && head.url === tab.url) head.title = title.trim() || undefined;
}

/**
 * タブ状態（`window.setState` に渡す値）。本体は JSON 4KB 超の state を丸ごと捨てるので、
 * 予算に収まるまで**古い履歴から**落とす（URL は必ず残す）。
 */
function tabState(tab: Tab): { url: string; history: Entry[] } {
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
  initialHistory: Entry[] = [],
) {
  const tab: Tab = {
    input: initialUrl,
    url: initialUrl,
    // 復元直後はタイトル未取得。最初の onTitle で埋まる。
    title: initialHistory.find((e) => e.url === initialUrl)?.title ?? "",
    history: initialHistory.slice(0, HISTORY_MAX),
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
  // ページタイトルはタブ名 + 履歴 / お気に入りの表示名に使う。
  const onTitle = (title: string) => {
    if (!title) return;
    if (viewId) katari.window.setTitle(viewId, title);
    applyTitle(tab, title);
    // 名前の無いお気に入り（旧形式 / 設定タブで足した行）に名前を付ける。
    void fillFavoriteTitle(tab.url, title);
    persist();
    katari.refresh();
  };

  /** お気に入り一覧（scope 1 つ分）。クリックで移動、× で削除、ドラッグで並べ替え。 */
  const favList = (scope: Scope) =>
    ui.inspectorList({
      key: `fav:${scope}`,
      title: SCOPE_TITLE[scope],
      emptyText: "★ のトグルで現在のページを追加できます",
      // 一覧はページタイトル（未取得なら URL）で表示する。
      items: favorites[scope].map((fav) => ({ id: fav.url, label: labelFor(fav) })),
      onSelect: (id) => navigate(id),
      onRemove: ({ id }) => {
        if (id) void removeFavorite(scope, id);
      },
      onReorder: ({ from, to }) => void moveFavorite(scope, from, to),
    });

  /**
   * ★メニュー: 現在ページのトグル 2 つ + お気に入り一覧（エディタ → プロジェクトの順）。
   * ポップアップなので webview を押し出さない（開いている間だけ webview が隠れる）。
   */
  const favMenu = (favorited: boolean) =>
    ui.popover(
      favorited ? "★" : "☆",
      [
        ui.row([
          ui.checkbox({
            label: "エディタお気に入り",
            value: isFavorite("editor", tab.url),
            key: "fav-toggle-editor",
            onChange: () => void toggleFavorite("editor", tab.url, tab.title),
          }),
          ui.checkbox({
            label: "プロジェクトお気に入り",
            value: isFavorite("project", tab.url),
            key: "fav-toggle-project",
            onChange: () => void toggleFavorite("project", tab.url, tab.title),
          }),
        ]),
        favList("editor"),
        favList("project"),
      ],
      { key: "fav-menu", variant: "ghost", width: 360 },
    );

  /** 🕘メニュー: このタブの訪問履歴（新しい順）。クリックで移動、× で 1 件削除。 */
  const historyMenu = () =>
    ui.popover(
      "🕘",
      [
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
          // 履歴もページタイトル（未取得なら URL）で表示する。
        items: tab.history.map((entry, i) => ({ id: `${i}:${entry.url}`, label: labelFor(entry) })),
          onSelect: (id) => navigate(id.slice(id.indexOf(":") + 1)),
          onRemove: ({ index }) => {
            tab.history = tab.history.filter((_, i) => i !== index);
            persist();
            katari.refresh();
          },
        }),
      ],
      { key: "history-menu", variant: "ghost", width: 360 },
    );

  viewId = katari.window.open({
    title: hostOf(initialUrl),
    width: 900,
    height: 640,
    restoreId,
    state: tabState(tab),
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
          // お気に入り / 履歴はポップアップメニュー（ページを押し出さない）。
          favMenu(favorited),
          historyMenu(),
          // 新しいタブは、この（元）タブの隣に開く。
          ui.button({ label: "＋", variant: "ghost", onClick: () => openTab(HOME, newRestoreId(), viewId) }),
        ]),
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
  openTab(url, restoreId, undefined, asEntries(rec.history));
});

// 起動時にお気に入りをロードする（onStartup activation）。
void loadFavorites();
