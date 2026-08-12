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

## 権限

`webview:*` — 任意の https サイトをエディタ内に**埋め込み表示**する権限。
拡張がページの内容を読んだり、ページがエディタ本体へ到達したりすることはできない
（sandbox iframe + cross-origin）。ネットワーク fetch（`net:`）権限は持たない。

## 制限（cross-origin iframe に由来）

- URL バーはページ内リンクでの遷移に**追従しない**（iframe の現在 URL は観測不能）。
- 戻る / 進むボタンは無い（iframe の履歴に触れない）。
- `X-Frame-Options` / `frame-ancestors` で埋め込みを拒否するサイト
  （google.com など）は**空白表示**になる（拒否を検知できない）。
- `target="_blank"` のリンクは開かない（popups を sandbox で拒否している）。
- iframe にフォーカスがある間はエディタのキーバインドが届かない。

## 開発

`katari-ext.d.ts`（Katari 本体 `examples/extensions/katari-ext.d.ts` のコピー）で
`@katari/ext` の補完が効く。型検査は `npx tsc --noEmit`。ビルド手順は不要
（Katari が esbuild-wasm で `.ts` をそのままバンドルする）。
