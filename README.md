# katari-extension-browser

[Katari](https://github.com/tanitaka-tech/Katari) エディタ内に**ブラウザタブ**を開くエディタ拡張。
URL バー + sandbox 付き iframe（`ui.webview`、Katari ADR-0076）で任意の https ページを
Dock タブとして表示する。タブは他のビューと同様にドック / フローティング / OS ウィンドウ化できる。

## インストール

いずれかの方法で入れる。初回はエディタの承認ダイアログで有効化する。

1. **URL から追加**: Katari のメインメニュー「拡張 → 拡張を管理...」を開き、
   「URL から追加」欄にこのリポジトリの URL を貼って「追加」。
2. **プロジェクト同梱**: このリポジトリの中身を
   `<project>.ktrtproj/Extensions/com.tanitaka.browser/` に置き、管理ウィンドウの「リロード」。

## 使い方

- メインメニュー「拡張 → 新しいブラウザタブ...」または `CmdOrCtrl+Alt+B`。
- URL バーに入力して Enter か「移動」。scheme 省略時は `https://` を補完する（http は不可）。
- 「再読込」でページを読み直し、「＋」で新しいブラウザタブを開く。
- 「別ウィンドウで開く」で、現在の URL を**別 OS ウィンドウ（ネイティブ webview）**として開く。
  埋め込みを拒否するサイト（google.com / developer.mozilla.org 等）はタブ内 iframe では
  空白になるが、このボタンなら**トップレベルで開くため表示できる**。

## 権限

`webview:*` — 任意の https サイトをエディタ内に**埋め込み表示**する権限。加えて、
「別ウィンドウで開く」（`katari.window.openExternal`）による別 OS ウィンドウでの表示も
この権限で許可される。いずれの場合も拡張がページの内容を読んだり、ページがエディタ本体へ
到達したりすることはできない（sandbox iframe / IPC 非注入のネイティブウィンドウ）。
ネットワーク fetch（`net:`）権限は持たない。

## 制限（cross-origin iframe に由来）

- URL バーはページ内リンクでの遷移に**追従しない**（iframe の現在 URL は観測不能）。
- 戻る / 進むボタンは無い（iframe の履歴に触れない）。
- `X-Frame-Options` / `frame-ancestors` で埋め込みを拒否するサイト
  （google.com、developer.mozilla.org など）はタブ内 iframe では**空白表示**になる
  （拒否を検知できない）。その場合は「別ウィンドウで開く」を使う（別 OS ウィンドウの
  ネイティブ webview はトップレベルで開くため、これらの制限を受けない）。
  初期ページには埋め込み可能な ja.wikipedia.org を使っている。
- `target="_blank"` のリンクは開かない（popups を sandbox で拒否している）。
- iframe にフォーカスがある間はエディタのキーバインドが届かない。

## 開発

`katari-ext.d.ts`（Katari 本体 `examples/extensions/katari-ext.d.ts` のコピー）で
`@katari/ext` の補完が効く。型検査は `npx tsc --noEmit`。ビルド手順は不要
（Katari が esbuild-wasm で `.ts` をそのままバンドルする）。
