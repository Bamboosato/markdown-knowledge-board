# PDF品質改善 Phase 1 ローカル検証記録

2026-11-02。対象は `c2a4c5b` とその後のローカル差分。Windows・Playwright Chromium、A4 portrait。印刷ダイアログは代替し、PDFは `page.pdf` で生成した。Safari/iOS/Android実機、OSネイティブ印刷ダイアログ、本番環境は未検証。生成PDFとページ画像はローカルの `output/pdf-review/` に保存し、リポジトリには含めない。

## 観点と前提

- 機能: 2経路のready/fallback/failed/timeout、操作の再試行、画像・Mermaidの準備。
- 非機能: 大きな要素・長URLの改ページ、オフライン、単一HTMLの通信、印刷後の復帰。
- データ: 未保存draft、固定snapshot、出力の末尾と長大表・コードの連続性。
- UI: 390px、失敗理由、再試行、印刷対象外UI。正常・異常・境界・状態遷移を分け、各ブラウザは直列実行。

## 受け入れ条件の結果

| ID | 状態 | 検証と未確認事項 |
| --- | --- | --- |
| AC-01 | 人手確認待ち | Windows Chromiumの固定fixtureでは日本語禁則と長URLを全ページ画像・テキストで確認し、検出対象の行頭/行末禁則は0。別OS/ブラウザと文字種を変えた確認は未実施。 |
| AC-02 | 人手確認待ち | 両経路の100行コード・100行表と末尾を抽出確認し、全ページ画像を確認。表見出しの反復を確認。12組の見出しと後続本文は同ページ。ページ末尾に見出しを強制配置するfixture、長大引用の境界確認は未実施。 |
| AC-03 | 失敗 | 60ノードの縦長Mermaidは修正前に空白ページと簡易印刷で後続本文との重なりを確認。修正後は警告付きソースfallbackで60ノードと後続本文を抽出・画像確認。100×3000の縦長SVG画像では両経路に大きな空白ページが出る。画像と後続本文は出力されるが、画像縮小・分割時の可読性を含む解決が必要。 |
| AC-04 | 合格（対象ケース） | フォントPromiseを未完了にし、10秒で簡易印刷を抑止、理由表示、再試行可能をChromiumで確認。Styled初期化の未完了Mermaidでもtimeout・再試行を確認。 |
| AC-05 | 合格（対象ケース） | 読み込み失敗画像の印刷抑止、サイズ超過Mermaidのコードfallback、縦長SVG fallbackの警告と印刷を確認。すべての画像・フォント障害の組合せは未実施。 |
| AC-06 | 合格（対象ケース） | 保存済みノートを編集後、未保存draftを印刷し、画面上の未保存状態と入力値を確認。IndexedDB全体や全バックアップ経路の比較は未実施。 |
| AC-07 | 人手確認待ち | `window.print` の例外と`afterprint`欠落を代替し、busy解除・再試行をChromiumで確認。OSダイアログのキャンセルと保存操作は未実施。 |
| AC-08 | 合格（対象ケース） | オフライン状態でテキストのみのStyled HTMLを出力し、ローカルファイルを開いたときHTTP/HTTPS要求0件。画像・Mermaidを埋め込んだ組合せは未実施。 |
| AC-09 | 合格（対象ケース） | PWAの保存済みノートを伴うオフライン再起動1件と、オフラインでのStyled HTML出力をChromiumで確認。全オフライン操作を保証しない。 |
| AC-10 | 未実施 | Windows Chromiumの対象E2E・PDFを確認。Safari/iPhone/Android実機およびFirefox/WebKitのPDF差異は未確認。 |
| AC-11 | 合格（対象ケース） | 簡易印刷のフォント待機中にノートを切替えて旧試行が印刷されないことを確認。 |
| AC-12 | 合格（対象ケース） | StyledのMermaid初期化を未完了にしてノートを切替え、初期化完了後も元のsnapshotを表示することを確認。 |
| AC-13 | 合格（対象ケース） | Styled初期化の未完了Promiseで期限切れと理由を表示し、再試行で復帰することを確認。 |

## PDF比較と図の境界

- 比較は現行DOMに親コミット `f708207` の印刷CSSを適用したもので、旧アプリ全体の再実行ではない。固定fixtureの `long-code` 2,000個について、PDFテキストの改行・ページ番号を正規化後、簡易印刷は旧CSSで1,000個、現CSSで2,000個、Styledは旧・現とも2,000個を抽出。両経路の表100行・コード100行・末尾文字列を確認。
- 巨大SVGの判定は、A4用紙幅約794 CSS pxを上回る800pxを描画幅の上限として見積もり、SVGに明示されたpx単位の最大幅がこれより小さい場合はその値を使う。高さ800pxを超える場合は、余白・警告用の余裕を見込んでコードfallbackとする。viewBox不明・不正もfallback。実寸はブラウザ・印刷設定に依存する。
- 模擬SVG viewBox 1200×1200は両経路で図・末尾・後続本文が1ページ内、1200×1800は両経路で警告・コード・後続本文が重ならないことをPDF画像で確認。実Mermaid 60ノードもコードfallback後の両PDFで全ノードを抽出し、後続本文が末尾以降にあることを確認。

## 実行と既知の制限

- `npm ci --no-audit`、`npm run test:unit`（255件）、lint、型チェック付きbuildが成功。`tests/e2e/preview-pdf.spec.ts` は変更範囲の15ケースが成功し、その後に追加した禁則fixture・timeout・初期化中切替はそれぞれ対象実行で成功。PWAはオフライン再起動1ケースのみ実行。
- 追加試験の初回は9,000行のエディター入力でタイムアウト。51,200文字超の少数行fixtureへ変更し再現性を確保した。別のE2E初回ページ読み込みtimeoutは単独再実行で成功した。いずれも製品の印刷失敗と断定しない。
- 依存監査はproduction 0件、全依存low 2件/moderate 19件で失敗。lockfile・依存は今回変更しておらず、既存開発依存の問題として別途扱う。
- 縦長画像の空白ページ、未検証の実機・印刷ダイアログ、印刷境界の追加確認、依存監査が残るため、Phase 1の完了判定は保留。

## 縦長画像の追加調査

- 再現: 100×3,000pxの合成SVG、後続本文、Windows Chromium・A4。実画像取得はPlaywrightで固定応答を返し、外部送信しない。既存CSSでは簡易5ページ、Styled 6ページとなり、それぞれ先頭付近に大きな空白が生じた。
- 画像に `break-inside: auto` を適用してもページ数・空白は変わらなかった。画像の比率を維持して `max-height: 245mm` とした場合は簡易2ページ・Styled 3ページになったが、先頭の空白は残り、画像幅は約31 CSS pxとなって文字が読みにくい。両案とも試験用の一時CSSであり製品CSSには適用していない。
- 400×300pxと300×400pxの合成SVGでは通常Preview、簡易・Styled印刷、保存したStyled HTMLで縦横比を確認。Styled HTMLの再表示時の外部HTTP/HTTPS要求は0件。
- 等倍に近い複数ページ出力、ページ内縮小、画像を可読な大きさでページごとに切り分ける方法には可読性と実装・HTML互換性の差がある。方針の決定まではAC-03を保留する。比較PDFはローカルの `output/pdf-review/image-trials/` にある。

## GitHub送信前の自動プレビュー確認（未適用）

- 接続先はGitHub `Bamboosato/markdown-knowledge-board`、Vercelプロジェクト `markdown-knowledge-board`。ローカルoriginには旧名 `set3-markdown-knowledge-board` が設定され、GitHub APIは現在のリポジトリへ移転応答を返す。既存の非mainブランチからのVercel Preview生成履歴がある。現在取得できたプロジェクト情報ではVercel認証が `all_except_custom_domains` で有効。今回のブランチやPRはリモート検索で見つからなかった。リポジトリ内workflow・package・設定の文字列検索では別のデプロイ処理は見つからなかったが、外部連携をすべて網羅した証明ではない。
- 既存 `vercel.json` に `git.deploymentEnabled` はない。[Vercel公式Git設定](https://vercel.com/docs/project-configuration/git-configuration)では未指定ブランチはデフォルト有効で、pushによる自動デプロイをブランチ単位で無効化できる。取得した情報だけでは他のプロジェクト側ルールすべてを確定できないため、実際の生成有無はpush後に確認が必要。
- 対象ブランチのプレビューを抑止する案は、既存JSONのルートに `"git": { "deploymentEnabled": { "feat/pdf-print-quality-phase1": false } }` を追加すること。これは設定変更を含む案であり、**未適用**。別案はプレビュー生成を追加承認して既存設定のままpushすること。どちらもマージ・本番デプロイを意味しない。
