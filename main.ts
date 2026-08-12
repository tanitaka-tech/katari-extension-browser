/**
 * エディタ内ブラウザタブ拡張。
 *
 * `ui.webview`（sandbox 付き cross-origin iframe、Katari ADR-0076）で任意の
 * https ページを Dock タブに表示する。cross-origin のため、ページ内遷移の URL
 * 観測や戻る / 進む制御はできない（README の制限を参照）。
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

const HOME = "https://developer.mozilla.org/";

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

function openTab(initialUrl: string = HOME) {
  const tab: Tab = { input: initialUrl, url: initialUrl, gen: 0 };

  const navigate = (raw: string) => {
    const url = normalize(raw);
    if (url) {
      tab.url = url;
      tab.input = url;
    } else {
      void katari.ui.toast("https の URL を入力してください", "warning");
    }
  };

  const viewId = katari.window.open({
    title: "Browser",
    width: 900,
    height: 640,
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
          ui.button({ label: "＋", variant: "ghost", onClick: () => openTab() }),
        ]),
        // key に gen と url を含める → 「再読込」や URL 変更で iframe が remount される
        ui.webview({ url: tab.url, grow: true, key: `wv:${tab.gen}:${tab.url}` }),
      ]),
  });
  return viewId;
}

katari.commands.register("open", () => {
  openTab();
});
