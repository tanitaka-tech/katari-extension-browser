# katari-extension-browser

[Katari](https://github.com/tanitaka-tech/Katari) エディタ内に**ブラウザタブ**を開くエディタ拡張。
URL バー + ネイティブ子 webview（`ui.webview({ native: true })`、Katari ADR-0076）で任意の
https ページを Dock タブとして表示する。ネイティブ webview はトップレベル文書扱いなので、
`X-Frame-Options` で埋め込みを拒否する google.com / MDN などもタブ内に表示できる。
タブは他のビューと同様にドック / フローティング / OS ウィンドウ化できる。

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
- 「別ウィンドウで開く」で、現在の URL を**別 OS ウィンドウ**としても開ける（tear-out 時や
  ネイティブ webview を使いたくない場合のフォールバック）。

## お気に入り

- ブラウザ上部にお気に入り一覧が並び、クリックで移動できる。「★共通」「★PJ」で現在の URL を追加。
- **エディタ設定 → 「ブラウザお気に入り(共通)」**: すべてのプロジェクトで共有（`settings.json`）。
- **プロジェクト設定 → 「ブラウザお気に入り」**: 現在のプロジェクトに保存（`project-settings.toon`、
  git 管理・配布同梱）。
- 各設定タブで URL の追加・削除・「開く」（新しいブラウザタブで開く）ができる。

## 権限

`webview:*` — 任意の https サイトをエディタ内に表示する権限（タブ内ネイティブ webview /
別 OS ウィンドウの両方）。拡張がページの内容を読んだり、ページがエディタ本体へ到達したり
することはできない（ネイティブ webview は Tauri IPC 非注入）。fetch（`net:`）権限は持たない。

## 制限

- URL バーはページ内リンクでの遷移に**追従しない**（現在 URL は観測不能）。戻る / 進むも無い。
- タブ内ネイティブ webview は **main ウィンドウのタブ内でのみ**表示できる。OS ウィンドウへ
  切り離す（tear-out）と iframe にフォールバックし、そこでは `X-Frame-Options` 拒否サイト
  （google.com / MDN 等）は空白になる。その場合は「別ウィンドウで開く」を使う。
- ネイティブ webview は最前面に描くため、ダイアログ / メニュー表示中は自動で隠れる。
  トースト等が隠れることがある。

## 開発

`katari-ext.d.ts`（Katari 本体 `examples/extensions/katari-ext.d.ts` のコピー）で
`@katari/ext` の補完が効く。型検査は `npx tsc --noEmit`。ビルド手順は不要
（Katari が esbuild-wasm で `.ts` をそのままバンドルする）。
