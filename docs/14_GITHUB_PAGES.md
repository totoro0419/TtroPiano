# 14 — GitHub Pages公開

2026-10-25 JST。「Git hubで公開して」の指示に対応。GitHub Pagesへの公開状況を、既存の別ホストでの公開と区別する。

## 公開対象

- 公開専用ブランチ：[gh-pages](https://github.com/totoro0419/TtroPiano/tree/gh-pages)
- 公開用コミット：`932c3fa7f321e264087199b7424935c010db8ac5`
- 公開用tree：`2cba6264cf92302b429283bc28da18c11572aa99`
- 元ソース：`4250908a772d920269c2409c64cebf6487127ef6`
- 検証済みアプリコード：`7a8e611360545be288d97e81df7f74e4fc5d5be8`
- [CI：単体16件・本番ブラウザー8試験PASS](https://github.com/totoro0419/TtroPiano/actions/runs/40170722553)

元ソースと公開ファイルの対応は公開ブランチの `release.json` にも記録。作品データや認証情報を含めていない。ソースの全面置換、既存PRのマージ、`main` の変更は行っていない。

## 準備と有効化

`npm run build` を実行し、PWA・40個のピアノMP3・ライセンス・アプリ本体を公開ブランチのルートへ保存した。`.nojekyll` を追加し、生成済みファイルをそのまま配信する。GitHubのtreeを再取得し、57ファイルが存在し、ビルドしたファイルのGit blob hashと一致することを確認した。

GitHub Pagesを有効にする設定：

1. リポジトリの **Settings → Pages** を開く。
2. **Source: Deploy from a branch** を選ぶ。
3. **Branch: gh-pages**、**/(root)** を選び **Save**。

利用中のGitHub連携にはPages設定を変更する操作がない。ブラウザーの設定画面は未サインインで404になり、Sign inの入口を表示したため、GitHubの安全なサインイン手順が必要。公開用ブランチが存在することだけを、Pages公開成功とは扱わない。

現在の記録：**公開ファイル保存PASS／Pages有効化と公開URLでの起動確認は未確認**。

## PWAとパス

Viteの `base: './'`、manifestの `id/start_url/scope: './'`、Service Workerの自身のURLからのルート解決を維持。リポジトリ配下への配信に対応する設計。公開URLでのService Worker登録・オフライン準備確認は、有効化後に別途試験する。ルート配信でのオフライン回帰試験PASSを、GitHub Pages配下での試験PASSへ読み替えない。

Android/iPad/Windows実機へのインストールと物理端末の出音・指操作は未確認。

将来 `main` への取り込み後にGitHub Actionsから自動配信する場合は、PagesのSourceをGitHub Actionsへ変更して既存の `.github/workflows/pages.yml` を使う。現在は未マージの実装を `gh-pages` から配信する構成。
