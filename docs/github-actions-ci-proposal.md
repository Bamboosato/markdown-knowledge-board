# GitHub Actions・依存関係監査の導入案

確認日: 2026-10-06（日本時間）

状態: 承認済みの導入案に沿って実装・検証中。文書整合PR #48とは分離し、`codex/github-actions-ci`でworkflow、監査script、依存更新、証跡設定を追加した。GitHubの実行結果とmain必須checkの設定状況は末尾に記録する。

## 1. 結論

`tennis-organizing-app`のCIと同じく、main向けPRとmainへのpushで、再現可能な依存インストール、lint、型チェック、unit、依存脆弱性監査、build、ブラウザ検証を行う構成を採用する。

Markdown Knowledge Boardでは、Chromiumの対象スモークとPWA専用検証を分ける。現在の依存関係には監査検出があるため、依存更新と回帰検証を行ってから、監査成功をマージ条件へ設定する。既知の検出を通すためだけの包括的な例外は設けない。

## 2. 現状と導入前の課題

- `.github/workflows/`は未設定。PR #48のチェックはVercel buildとPreview Commentsであり、専用の依存脆弱性監査はない。
- `package-lock.json`はversion 3。ローカル確認環境はWindows、Node.js 24.13.0、npm 11.6.2。
- `npm run build`は`tsc -b && vite build`。`tsconfig.json`はapp、api、nodeの3設定を参照するため、既存buildでfrontendとAPIの型を確認できる。
- `npm run test:unit`、通常Playwright、PWA専用Playwright、PWA build verifierが既にある。
- 通常E2Eはdevelopment serverとAPI mockを使用する。PWAは別のproduction-preview serverを使用し、worker／複数versionの状態を制御する。

### 2.1 依存監査の実測

次のコマンドを読み取り調査として実行した。依存インストールや自動修正は行っていない。

```bash
npm audit --omit=dev --json
npm audit --json
```

| 範囲 | low | moderate | high | critical | 合計 | 終了コード |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 本番依存 | 2 | 5 | 4 | 0 | 11 | 1 |
| 全依存（開発依存を含む） | 2 | 7 | 6 | 0 | 15 | 1 |

これは2026-10-06のnpm registry監査によるパッケージ単位の検出集計であり、15件の独立したadvisoryや実アプリでの悪用成立を意味しない。全依存には本番依存の11件を含む。

照合commit: `c13aec5a0ec0e4820c947e4b331bb866cb2d897f`。

lockfile SHA-256: `107e9dcde8b7444afd146a22505c57c5600e96248b0fc5dd9d7e4a9fb889145d`。

主要な検出対象は`js-yaml`、`mermaid`、`dompurify`、`@xmldom/xmldom`、`katex`、`markdown-it`、`vitest`と推移依存。npmの修正候補には、Marp Core 4系から5系へのmajor更新も含まれる。まず互換範囲の更新を確認し、残る検出について親依存の更新か限定的なoverrideを検討する。major更新やoverrideは型・描画・出力・offline回帰を伴わせる。`npm audit fix --force`でまとめて更新する運用は採用しない。

## 3. CIとテストの設計観点

ケース詳細化の前に次の観点を固定する。最優先はデータ消失・未保存編集の暗黙破棄を防ぐこと、次に脆弱性監査の誤通過と復元不能を防ぐこと。

| 分類 | 観点 | 検証意図 |
| --- | --- | --- |
| 機能 | ローカル保存、Import／Export、Mermaid、Slides、暗号化・復元、PWA | ライブラリ更新後も既存機能が利用できること |
| 非機能 | 再現可能なinstall、監査応答、Linux／Windows差、offline、性能、競合 | 環境や通信障害で誤通過せず、非同期更新で編集を失わないこと |
| データ | lockfile、JSON／frontmatter、画像・SVG、passphrase、IndexedDB | 不正データ、形式差、部分成功・部分反映を扱えること |
| UI | Import選択、結果・エラー、描画fallback、印刷、install／update | 表示だけの成功を保存・復元成功と混同しないこと |

| 区分 | 監査policyの必須ケース | UI・データ検証の例 |
| --- | --- | --- |
| 正常系 | 本番・全依存とも有効な応答で検出0なら成功 | Import保存成功、図・Slides描画、PWA offline再起動 |
| 異常系 | 検出あり、network失敗、timeout、空／不正JSON、npm実行異常は失敗 | 保存失敗、誤passphrase、画像未解決、renderer失敗 |
| 境界値 | 例外期限の直前／一致／直後、severity変更、対象version変更 | 容量上限、空Draft、部分Import成功 |
| 状態遷移 | dev依存がruntimeへ移行、例外へ別advisory追加、修正後の0件 | 遅延Import中の編集・保存・Revert・ノート往復、PWA更新 |

フレークは状態初期化不足、server再利用、待機不足、port衝突、worker／cache状態の持越しを先に疑う。再試行は原因分類・証跡取得を補助するもので、恒常的な失敗を許容する仕組みにはしない。

## 4. 推奨workflow構成

### 4.1 共通設定

- イベントは`pull_request`（base main）、`push`（main）、`workflow_dispatch`。初期案では自動スケジュールを追加しない。
- `permissions: contents: read`とし、PRのコードを本番秘密情報付きで実行しない。checkoutは`persist-credentials: false`とする。
- `ubuntu-latest`、Node.js 24、npm cacheを使用し、`npm ci`でlockfileとの不一致を検出する。Node／npmの実versionをログへ記録する。npm majorを監査policyの対応範囲として固定・検証する。
- Checkout／setup-node／upload-artifactは導入時に互換性を確認したリリースを選び、commit SHAで固定する。参照元tennisのmajorタグを無条件に流用しない。
- PR単位のconcurrencyで古い実行をcancelし、同じPRの新しい結果を評価する。
- 必須checkが出なくなるworkflow全体のpaths-ignoreは初期導入では使わない。
- 本番OAuth・Google Picker・Drive書き込み・実Gist操作はCIで実行しない。unitのAPI stubとE2Eのmockで既存の境界・ローカル保全を確認する。

最小権限とイベントの扱いは[GitHub workflow構文](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)と[イベントのセキュリティ説明](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)に従う。

### 4.2 Verifyジョブ

実行順は`npm ci` → lint → unit → 監査policyのunit → 依存監査 → 型チェック付きbuildとする。依存監査で失敗しても監査JSONと判定理由は`if: always()`で保存する。

| ステップ | コマンド／実装 | 備考 |
| --- | --- | --- |
| Install | `npm ci` | lockfileに従う。自動更新しない |
| Lint | `npm run lint` | 既存scriptを使用 |
| Unit | `npm run test:unit` | DB、frontmatter、暗号化、API境界、Google Drive mockを含む |
| Policy tests | `npm run test:security`（新設案） | node:testで監査の成功・失敗・期限・依存区分を検証 |
| Audit | `npm run audit:security`（新設案） | 本番と全依存を別々に取得・判定・保存 |
| Type/build | `npm run build` | `tsc -b`でapp／api／nodeを検査してVite build |
| Evidence | `.security-audit/*.json`をArtifactへ保存 | 失敗時も取得可能にする |

### 4.3 Browser smokeジョブ

`npm ci`、Chromium導入、対象スモーク14件を`--project=chromium --workers=1`で実行する。Verify成功後に開始し、別runnerと専用browser contextで実行する。各ケースのIndexedDB準備／初期化とAPI mockを使い、`CI=true`により既存serverを再利用しない。

選定対象は次のとおり。`@ci-smoke`を付けた14件を`playwright.ci.config.ts`で選択する。custom reporterが14件すべての成功を要求し、0件・部分選択・skip・flakyを成功扱いにしない。`--list`では件数だけを検査し、実行結果とは区別する。

- Import: drop／picker × Edit／Previewの4件、最初の保存成功を選ぶ1件。
- Import競合: 遅延read中のedit／save／revert／select round tripの4件、空Draft・未確定タグの保護1件。
- Mermaid描画・code切替1件、Marp描画・frontmatter出力1件。
- Preview全体印刷1件、offlineのローカル操作・明示Retry1件。

対象ファイルは`markdown-import-current-note.spec.ts`、`mermaid-preview.spec.ts`、`marp-slides.spec.ts`、`preview-pdf.spec.ts`、`phase2-production-readiness.spec.ts`。

選定tagと`npm run test:e2e:smoke`で対象を固定した。件数を変更するときは、観点とreporterの期待件数を一緒に更新する。

### 4.4 PWAジョブ

別runnerで`npm ci`、`npm run build:pwa:test`、`npm run verify:pwa`、Chromium導入、`npm run test:e2e:pwa`を順に実行する。既存PWA configはworkers 1、fullyParallel false、server再利用なし。production-preview fixtureは各ケース開始時に配信versionを初期化する。

offline再起動、API非cache、install Help、dirty更新・保存失敗・複数tabなどの既存11件を対象にする。通常buildの`dist`と同じrunnerで競合させない。PWA config側でbuildを再実行する点は初回に実行時間を計測し、共通化の必要性を判断する。

Browser smoke／PWAには失敗時のtrace・screenshotとHTML reportを保存する。現行`trace: on-first-retry`だけでは初回失敗時のtraceを残せないため、CI専用設定では`retain-on-failure`を採用する案とする。reportには実施対象、skipと理由、未実施範囲、OS／browser versionを記録する。

## 5. 監査判定と例外

[npm audit](https://docs.npmjs.com/cli/npm-audit/)のJSONを本番（`--omit=dev`）と全体の2種類取得する。終了コード1は検出ありの正常な監査応答として解析し、npm実行エラー・timeout・不正応答と区別する。いずれもpolicyの最終判定でCIを失敗させる。

- 本番依存: severityにかかわらず検出があれば失敗。
- 全依存: 初期導入は例外なしで、検出があれば失敗。
- 修正版が公開されていない開発依存が残った場合のみ、advisory URL、package、version、依存path、owner、理由、UTC期限を持つ個別例外を検討する。
- 例外はlockfile上でdev限定であることを検証し、critical、本番依存化、別advisory、別version、別path、期限一致・超過を許容しない。
- 監査結果の形式不正や取得失敗を「検出0件」と解釈しない。JSON schemaとmetadataの整合もpolicy unitで固定する。
- CI内でlockfile更新や依存修正は行わず、専用PRで更新と検証を完結させる。

tennisの例外ファイルはこのプロジェクトの依存経路と一致しないためコピーしない。現在検出されている本番依存を例外で通す案も採用しない。

## 6. 変更範囲による追加E2E

| 変更・リスク | 追加する検証範囲 | 選定理由 |
| --- | --- | --- |
| 通常の文書・小規模コード変更 | 基本の14件＋PWA11件 | 全件を既定にせず、重要なデータ経路・offlineを固定確認 |
| js-yaml／frontmatter／Import | Import・Metadata・JSON roundtripの対象unit／E2E | 保存形式と同ID更新、本文置換の差を確認 |
| Mermaid／SVG／DOMPurify | Mermaid・Styled Export・印刷の対象検証 | 図・画像の安全化、fallback、出力への波及を確認 |
| Marp／KaTeXのmajor・override | Slides全対象、出力・offline、関連Chromiumケース | API・theme・描画の互換性を確認 |
| 認証／backup／restore | 既存phase2対象ケースをChromium／Firefox／WebKitで直列実行 | session・Cookie・focus・暗号化・transactionの差を確認 |
| 共通レイアウト・editorの広範囲変更 | 対象範囲から全件へ拡大するかをPRで判断 | 影響に応じて選ぶ。全件の根拠を明記 |

実Google認証、実Gist、OSネイティブPDF保存、Windows IME実機、Android／iPhone launcherは別の手動受入範囲。CI成功だけでこれらの確認を完了にしない。同一実機へ複数scriptを並列実行しない。

## 7. 導入順と完了条件

1. 本番・開発依存の検出を更新で解消し、major／overrideの必要性を個別確認する。対象unit、lint、buildと変更リスクに応じたE2Eを実施する。
2. workflow、`scripts/security-audit.mjs`、policy moduleとunit、package scripts、smoke選定、CI証跡設定を追加する。
3. PRで3ジョブを実行し、install、監査失敗時Artifact、テスト対象件数、PWA fixture状態、Linux動作を確認する。
4. 新規advisory、監査通信障害、不正JSON、例外期限・runtime化の失敗をpolicy unitで再現できることを確認する。
5. 各ジョブのcheck名が安定して出ることを確認後、branch protection／rulesetでVerify、Browser smoke、PWAを必須にする。Vercel deployment成功は別checkとして維持する。

## 8. 実装と検証記録

### 8.1 依存更新

互換範囲の更新でMarp Core 4.4.0、Mermaid 11.17.2、js-yaml 4.3.2、Vitest 4.1.11などへ更新した。残る親依存の固定範囲には次の限定overrideを追加した。

| 親依存 | 子依存の固定 | 理由と回帰観点 |
| --- | --- | --- |
| Marp Core／Mermaid | KaTeX 0.18.2 | [advisory](https://github.com/advisories/GHSA-238p-pmpm-9mq7)の修正版。親の0.17／0.16指定範囲を超えるため、KaTeX数式・trust制限のunitと、SVG-only label・Slidesのbrowser回帰を確認 |
| speech-rule-engine | @xmldom/xmldom 0.9.12 | 親が0.9.10を固定。0.9.12の修正を採用し、MathJax XML経路・Slides・PWAを確認 |

Marp 5は[release candidateと入口API変更](https://github.com/marp-team/marp-core/releases/tag/v5.0.2)を伴うため、今回は4系を維持した。overrideは親が修正版を採用した更新時に除去可否を確認する。CIで自動更新や例外の追加は行わない。

Mermaidは既存の`htmlLabels: false`と`foreignObject`除去を維持する。数式delimiterはSVG内の文字列として表示するため、KaTeXのHTML描画対応を追加したという意味ではない。Slidesの既定MathJax数式はiframe内でも検証する。

### 8.2 実行結果

ローカルWindowsとGitHub Actions Linuxの結果、PR、必須check設定は検証完了後に追記する。実OAuth／Drive／Gist、OSネイティブ印刷、IME実機、Android／iPhone launcherは今回の実施対象外。

比較元: [tennis CI](https://github.com/Bamboosato/tennis-organizing-app/blob/main/.github/workflows/ci.yml)、[監査script](https://github.com/Bamboosato/tennis-organizing-app/blob/main/scripts/security-audit.mjs)、[監査policy](https://github.com/Bamboosato/tennis-organizing-app/blob/main/scripts/security-audit-policy.mjs)。
