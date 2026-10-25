# 13 — 公開とPWA

2026-10-25 JST。「レポジトリに作り公開」「PWAにも」の指示に対応。

GitHub Pages公開アプリ：https://totoro0419.github.io/TtroPiano/

初回に公開した別ホスト：https://ttropiano-compose.ibukioike2009.chatgpt.site/ （以下の初回公開設定の記録はこのホストについて）。

実装コード：[GitHubの改善ブランチ](https://github.com/totoro0419/TtroPiano/tree/improvement/direct-composition-2026-10-25)。既存のPR #1/#2は未マージ。GitHub Pagesの有効化・デプロイ・公開URLでの起動確認も後続作業で完了した。

後続の「Git hubで公開して」に対応した公開ブランチとPagesの設定状況は [14 — GitHub Pages公開](14_GITHUB_PAGES.md) を参照。

## 公開状態

所有者のみのアクセス制限を、URLを持つ人が訪問できる `public` へ変更した。公開設定の再取得でも `public`、policy revision 2を確認。[設定の記録](evidence/publication-access.json)。作品は引き続き訪問者ごとの端末内保存で、他人の作品を公開する変更ではない。

公開設定後のブラウザーで、ログイン画面を経由せず編集画面が開くこと、3音の入力、保存済み表示、再生ボタンの「一時停止」状態を確認した。物理スピーカーの出音は未確認。その後の再読込に続く追加観察は、自動操作ブラウザーのURLポリシーが操作・観察を拒否したため実行不能。別経路で迂回していない。

## PWAの変更

- 既存のmanifest、192/512pxアイコン、standalone表示、Apple用アイコン、全アプリ・ピアノ音源のService Workerキャッシュを維持。
- `id: "./"` と説明文をmanifestへ追加。start_urlと同じ識別子を使い、既存のアプリ識別を変えない。
- モバイル用のアプリ表示メタデータを補完。
- 「曲の設定 → ホーム画面に追加」を追加。ブラウザーがインストール用イベントを提供したときだけ、その明示操作から追加画面を開く。
- 提供されないブラウザーでは、手動追加の手順を表示。操作欄や作曲面にはボタンを増やしていない。
- オフラインの全資産を確認できた場合だけ「オフライン準備完了」を表示。準備中・確認失敗・未完了を区別する。

参考： [MDNのPWAインストール説明](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)、[ブラウザーのインストールイベント](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Trigger_install_prompt)。インストール方法と対応はブラウザーによって異なる。

## 使い始め方

1. 公開URLをブラウザーで開く。
2. 「曲の設定 → ホーム画面に追加」。追加画面が表示されなければ、その下の「追加方法」を参照。
3. 初回は接続を保ち、「オフライン準備完了」を確認する。
4. 追加したアイコンから開く。アプリ更新前のタブが残っている場合は、同じURLのタブとアプリを一度閉じて開き直す。

ブラウザーのサイトデータ削除やOSによる容量整理への保存保証ではない。長く残す曲は作品ファイルにも保存できる。

## 検証

検証済みコード：`7a8e611360545be288d97e81df7f74e4fc5d5be8`。2026-10-25 15:55 JST、[CI](https://github.com/totoro0419/TtroPiano/actions/runs/40170722553)で単体16件・本番ブラウザー8試験がPASS。既存の統合33項目と作曲比較も回帰検証した。

| 項目 | 結果 | 範囲 |
|---|---|---|
| manifest・安定ID・start_url・scope・standalone | PASS | 本番ビルドをブラウザーで取得・解析 |
| 192/512pxアイコン | PASS | 両PNGを実デコードし寸法を確認 |
| オフライン準備表示 | PASS | 全資産キャッシュ完了の応答後に準備完了を表示 |
| ネット切断後の再読込・編集・保存・ピアノ再生 | PASS | CIブラウザーの実ネット切断。manifestとアイコンもオフライン取得 |
| インストール入口・キャンセル・完了通知UI | PASS | テストイベント。OSへの本当のインストールではない |
| 初回の別ホストのPWA追加後の再観察 | 実行不能 | 自動操作ブラウザーのURLポリシー制限 |
| GitHub Pagesでの再読込・保存復元・PWA準備表示 | PASS | 公開URLで2音を作り、再読込後に復元。「オフライン準備完了・ピアノ音源も保存済み」を確認 |
| Android/iPad/Windows実機へのインストール | 未確認 | 実機試験をしていない |

[manifest・アイコン・PWA試験データ](evidence/pwa-validation.json)、[CI結果](evidence/pwa-ci.json)。

OSの実機へのインストール、ホーム画面アイコンからの実機起動は未確認。テスト用のインストールイベントを、実際のOSインストール成功と扱わない。別ホストへの追加検査は上記の制限で実行不能だったが、独立したGitHub Pagesの公開確認は [14](14_GITHUB_PAGES.md) のとおり実施した。
