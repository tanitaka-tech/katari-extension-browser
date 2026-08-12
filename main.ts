/**
 * エディタ内ブラウザタブ拡張。
 *
 * `ui.webview({ native: true })`（ネイティブ子 webview、Katari ADR-0076）で任意の
 * https ページを Dock タブに表示する。X-Frame-Options 拒否サイトも表示できる。
 * タブは Dock 位置 + URL ごと永続化され、再起動後に復元される（`restoreId` + `onRestore`）。
 */
import { katari, ui } from "@katari/ext";

type Tab = {
  /** URL バーの入力中テキスト（未確定でもよい）。 */
  input: string;
  /** webview に実際に読み込んでいる URL。 */
  url: string;
  /** 再読込用の世代番号。key に含めて remount させる。 */
  gen: number;
};

// native 子 webview 描画なので、X-Frame-Options で埋め込みを拒否するサイト
// （developer.mozilla.org 等）も初期ページにできる。
const HOME = "https://developer.mozilla.org/";

/** 復元用の安定 id を採番する（タブごとに一意）。 */
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

function openTab(initialUrl: string = HOME, restoreId: string = newRestoreId()) {
  const tab: Tab = { input: initialUrl, url: initialUrl, gen: 0 };
  let viewId = "";

  const navigate = (raw: string) => {
    const url = normalize(raw);
    if (!url) {
      void katari.ui.toast("https の URL を入力してください", "warning");
      return;
    }
    // 同じ URL への「移動」は再読込として扱う（押しても無反応に見えるのを防ぐ）。
    if (url === tab.url) tab.gen++;
    tab.url = url;
    tab.input = url;
    // 表示中の URL を永続化する（再起動後にこの URL で復元される）。
    if (viewId) katari.window.setState(viewId, { url });
  };

  viewId = katari.window.open({
    title: "Browser",
    width: 900,
    height: 640,
    restoreId,
    state: { url: initialUrl },
    render: () =>
      ui.column([
        ui.row([
          ui.textField({
            value: tab.input,
            placeholder: "https://…",
            key: "url",
            onChange: (v) => {
              tab.input = v;
            },
            onSubmit: (v) => navigate(v),
          }),
          ui.button({ label: "移動", variant: "primary", onClick: () => navigate(tab.input) }),
          ui.button({
            label: "再読込",
            onClick: () => {
              tab.gen++;
            },
          }),
          // 埋め込みを拒否するサイト（google.com / MDN 等）は iframe では空白になる。
          // その場合はこのボタンで別 OS ウィンドウ（ネイティブ webview）を開けば表示できる。
          ui.button({
            label: "別ウィンドウで開く",
            onClick: () => {
              const url = normalize(tab.input) ?? tab.url;
              void katari.window.openExternal(url);
            },
          }),
          ui.button({ label: "＋", variant: "ghost", onClick: () => openTab() }),
        ]),
        // native: ネイティブ子 webview をタブに重ねて描画する（ADR-0076）。
        // トップレベル文書なので X-Frame-Options / frame-ancestors を受けず、
        // google.com / MDN などの埋め込み拒否サイトもタブ内に表示できる。
        // key に gen と url を含める → 「再読込」や URL 変更で作り直す。
        ui.webview({
          url: tab.url,
          grow: true,
          native: true,
          key: `wv:${tab.gen}:${tab.url}`,
        }),
      ]),
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
