# 卒業制作報告書 作成支援ツール

担当の引き継ぎと、毎年の作業・反映の手順は [docs/引き継ぎ手順.md](docs/引き継ぎ手順.md) を参照。

## 開発の始め方

```bash
npm install      # 初回のみ
npm run dev      # 開発用サーバー（http://localhost:5173）
npm test         # 単体テスト（セルフチェックのルール、データ操作、保存など）
npm run e2e      # 通しテスト（Edge を自動で操作。開発用サーバーを起動しておく）
npm run build    # 配信用ファイルを dist/ に出力
```

## フォルダ構成

| 場所 | 役割 |
|---|---|
| `src/config/` | 年度設定の型と初期値（`2026.json`）。毎年の更新は管理ページで行う |
| `src/model/` | 文書データの型、新規作成、自動保存（IndexedDB）、バックアップ、写真の取り込み |
| `src/layout/` | 組版（ページの CSS、表紙〜作品写真の HTML、紙面の計測） |
| `src/editor/` | 紙面の表示（Vivliostyle）、紙面に重ねる入力欄、データ操作、編集の中核 |
| `src/checker/` | セルフチェックのルールとテスト |
| `src/app/` | 画面の部品（ツールバー、ページ一覧、チェック欄、ダイアログ） |
| `mockups/` | デザイン案（学生用は案A、管理ページは案2に決定） |
| `scripts/e2e/` | 通しテスト |
| `scripts/poc/`、`src/poc/` | 技術検証で使ったスクリプトと試作ページ |

## 方針

- 書式はツールが持ち、学生が変更する手段は用意しない。
- ルールの判断基準は手順書。手順書のルール違反だけを「エラー」にする。
- 画面のデザインは複数案を確認していただいてから決める。
- 画面の紙面と提出 PDF は同じ組版の結果（印刷すると紙面だけが出る）。

## ライセンス

このツールは [GNU Affero General Public License v3.0](LICENSE)（AGPL-3.0-or-later）のもとで公開する。
組版エンジンの Vivliostyle.js（`@vivliostyle/core`）が AGPL-3.0 のため、それに合わせている。
ツールと管理ページの画面には、ソースコードの場所（`.env` の `VITE_SOURCE_URL`）へのリンクを表示する。

同梱フォント（BIZ UD明朝・BIZ UDPゴシック）は SIL Open Font License 1.1。

## 公開

- 学生用ツール：GitHub Pages。`main` に送ると GitHub Actions がテスト・ビルドして公開する（`.github/workflows/pages.yml`）
- 管理ページと年度設定の配信：大学の Google アカウントの Apps Script。更新は `npm run deploy:gas`（場所は `gas/deployments.json`）
