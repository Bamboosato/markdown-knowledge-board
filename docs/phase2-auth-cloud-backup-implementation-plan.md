# Markdown Knowledge Board フェーズ2 実装計画

## 1. 目的

本書は、[要件定義](./phase2-auth-cloud-backup-requirements.md)と[基本設計](./phase2-auth-cloud-backup-architecture.md)を、実行順序、担当、PR単位、確認ゲートへ落とし込む。認証・クラウド機能が未完成の期間も、未ログインのローカル機能を常に利用可能に保つ。

## 2. テスト設計観点

| 分類 | Phase 0／PR1で確認する観点 | 検証意図 |
| --- | --- | --- |
| 機能 | ローカルJSON作成・インポート、旧version 1互換 | 共通module抽出で既存機能を変えないこと |
| 非機能 | PBKDF2性能、秘密情報非保持、再現可能な計測 | 暗号設定を実測で固定し、資格情報をコードへ持ち込まないこと |
| データ | `pinnedAt`、Marp、`customMetadata`、Unicode、空配列 | 現行`Note`の情報を欠落なくroundtripすること |
| UI | 未ログイン状態のBackup／Import、結果表示 | 内部refactorで利用者向け動作を変えないこと |

正常系、異常系、境界値、状態遷移を分離し、unit、E2E、Production smokeのどこで検証するかをPRごとに明示する。

## 3. 確定ゲート

### 3.1 Phase 0-A: 実装着手前／基盤PRで確認

| ゲート | 完了条件 | 証跡 | 状態 |
| --- | --- | --- | --- |
| ローカルJSON回帰 | 新旧version 1、空、Unicode、`pinnedAt`、Marp、`customMetadata`がunit/E2Eで成功 | test結果 | 完了（unit 10件、対象E2E 8件、全E2E 58件） |
| PBKDF2 browser計測 | 600,000回をdesktop browserで3回以上計測 | `npm run benchmark:pbkdf2`出力 | 完了（候補値600,000回） |
| 実mobile計測 | 対象mobile実機で同条件を計測 | 端末・OS・browser・測定値 | 管理者確認待ち |
| GitHub App | 本番2 callback、expiring user token、`Gists: write`を確認 | 設定画面記録（secretを除く） | 管理者作業待ち |
| GitHub REST version | 実装時点の公式support値を固定 | `api/_lib/github.ts`、GitHub公式API Versions | 完了（`2026-03-10`） |

mobile emulationはWeb Crypto互換確認には利用できるが、実機性能の代替証跡にはしない。

2026年8月3日の基準計測では、Windows 11／Chromium 149／Intel Core Ultra 7 155Uで600,000回を3 sample実行し、desktopは平均78.7ms（77.2～80.6ms）、Pixel 7 emulationは平均77.9ms（74.0～83.9ms）だった。emulationは同じCPU上の結果であるため、`PBKDF2_ITERATIONS_V1 = 600_000`は実mobile計測完了まで候補値とする。

同日のPR1回帰は`npm run test:unit`が10/10、Backup／Import対象Playwrightが8/8、全Playwrightを1 workerで58/58成功した。全実行を直列化し、単体成功後の通し実行でも状態残留や順序依存がないことを確認した。

PR1基準では`npm audit`が既存のtransitive dependencyにhigh 2件、low 1件を報告する。Vitest追加前のlockfileにも同じ対象versionが存在するためPR1起因ではないが、PR8のsecurity smoke完了前に別の依存更新として解消し、全回帰を行う。

### 3.2 Phase 0-B: API基盤実装後に確認

| ゲート | 実施時点 | 状態・証跡 |
| --- | --- | --- |
| 4,500,000 bytes成功／4,500,001 bytes拒否 | PR4でserver境界をunit固定、PR6でupload endpoint、PR8でProduction実経路 | server境界値unitは完了。Production実経路は未実施 |
| 1 MB超Gistの`raw_url`取得 | PR6のGist discovery実装後 | 未着手 |
| Previewのcloud UI非表示・API拒否・Production secret非配布 | PR4以降の各PR | API拒否とUI非表示をunit／E2Eで確認済み。secret scopeはProduction設定時に管理者確認 |
| 本番2 OriginのOAuth／Cookie分離 | PR5以降 | exact Origin、host-only Cookie、Origin別callback、state／PKCEをunit固定済み。実OAuthはPR8で確認する |

## 4. 担当と権限

| 役割 | 主担当 | 責務 |
| --- | --- | --- |
| 製品・リリース責任者 | プロジェクト所有者 | 方針とProduction有効化の承認 |
| GitHub／Vercel管理者 | プロジェクト所有者 | GitHub App、callback、Production環境変数、テストアカウント |
| 実装・自動テスト | Codex | コード、unit/E2E、文書、PR、失敗証跡 |
| 結合確認 | Codex＋プロジェクト所有者 | 実OAuth、Gist、別browser復元、Production smoke |

secret、token、session key、テストアカウントの資格情報をGit、PR本文、テスト出力、文書へ記録しない。

## 5. PR分割とトレーサビリティ

| PR | 実装範囲 | 主な要件 | 主なテスト |
| --- | --- | --- | --- |
| PR1 | `backup.ts`抽出、現行JSON回帰、Phase 0計測 | `LOCAL-001..008`、`BACKUP`のデータ形式 | unit、既存Backup／Import E2E |
| PR2 | strict schema、diff、IndexedDB transaction | `RESTORE-006..019`のlocal基盤 | unit、fake IndexedDB commit／rollback |
| PR3 | AES-GCM、PBKDF2、envelope | `CRYPTO-001..011` | 固定vector、改ざん、境界値、性能 |
| PR4 | Production gate、session server、CSRF、Origin | `SESSION-003..005`のserver側、`ENV-001..005` | API unit／integration、Preview拒否 |
| PR5 | session client、OAuth UI、Save and Continue、Sign out、Disconnect | `SESSION-001..002`・`005`のclient側、`AUTH-001..015`、`SIGNOUT-001..004`、`DISCONNECT-001..007` | component、stub E2E、2 Origin |
| PR6 | Gist discovery、候補選択、Cloud Backup | `BACKUP-001..019` | API stub、revision競合、4.5 MB |
| PR7 | download、復号、preview、safe merge | `RESTORE-001..020` | merge matrix、rollback、別browser |
| PR8 | offline、mobile、アクセシビリティ、Production有効化 | `OFFLINE-001..005`、横断要件 | full E2E、実GitHub serial、security smoke |

PR1からPR7まではcloud feature flagを既定offとする。各PRで未ログインlocal回帰を実行し、PR本文に対象要件ID、追加テスト、未実施の本番ゲート、rollback方法を記載する。PR8の完了条件を満たした場合だけProductionでcloud UIを有効にする。

### 5.1 PR2テスト観点

| 分類 | 正常系・異常系・境界値・状態遷移 | 検証意図 |
| --- | --- | --- |
| 機能 | strict validation、`added`／`updated`／`skipped`／`conflicted`、適用対象抽出 | RESTORE-006、010〜016、018、019の判定をUI接続前に固定する |
| 非機能 | SHA-256 fingerprint、pure validation/diff、単一transaction | preview前のDB不変と部分反映防止を保証する |
| データ | 必須／未知field、重複ID、noteCount、UTC日時、frontmatter ID、metadata | 破損・曖昧・非対応データを推測復元しない |
| UI | このPRではUI非接続、cloud feature flag off | 未完成の復元導線や自動適用を利用者へ公開しない |
| 境界値 | 0件、同一時刻・異内容、metadata深度20／21、配列1,000／1,001 | 許容境界を実装とテストで一致させる |
| 状態・競合 | local-only保持、apply途中失敗、testごとのDB初期化 | safe mergeとrollbackを順序依存なく再現する |

PR2のローカル検証は、unit 36/36（strict validation 20件、safe diff 3件、既存backup 10件、fake IndexedDB transaction 3件）、`npm run lint`、`npm run build`、全Playwright 58/58を1 workerで成功した。E2Eにretry／flakyはなく、既存の未ログインローカル操作に回帰がないことを確認した。

### 5.2 PR3テスト観点

| 分類 | 正常系・異常系・境界値・状態遷移 | 検証意図 |
| --- | --- | --- |
| 機能 | AES-256-GCM暗号化・復号、PBKDF2、strict envelope、canonical JSON | `CRYPTO-001..011`のbrowser内暗号契約をUI接続前に固定する |
| 非機能 | 600,000 iterations再計測、非extractable key、async Web Crypto | 秘密情報を永続化せず、候補値の性能証跡を残す |
| データ | 16-byte salt、12-byte IV、128-bit tag、AAD、base64url no padding | header改ざん、形式揺れ、平文保存を防ぐ |
| UI | このPRではUI非接続、passphrase stateなし | 未完成のupload／restoreと秘密入力を公開しない |
| 境界値 | 11／12 code points、NFC同値、4,500,000／4,500,001 bytes | Unicodeと転送上限をexactに判定する |
| 異常・改ざん | 誤passphrase、ciphertext 1 byte変更、salt変更、不正version／iteration | 原因を断定せず、復号・形式検証前後の失敗を分離する |

固定vectorはNodeの`pbkdf2Sync`と`aes-256-gcm`で独立生成し、Web Crypto復号との相互運用性を検証した。PR3のローカル検証はunit 57/57（crypto 21件を含む）、`npm run lint`、`npm run build`、全Playwright 58/58を1 workerで成功した。PBKDF2 600,000回・3 samplesの再計測はdesktop平均73.8 ms（66.9〜80.0 ms）、Pixel 7 emulation平均82.0 ms（76.0〜89.8 ms）だった。emulationは同一PCのCPUを使用するため実mobile証跡にはしない。

### 5.3 PR4テスト観点

| 分類 | 正常系・異常系・境界値・状態遷移 | 検証意図 |
| --- | --- | --- |
| 機能 | 本番2 Origin、signed-out／signed-in、token refresh、request ID | Productionだけで認証状態を安全に確認し、tokenを応答へ出さない |
| 非機能 | AES-256-GCM session、no-store、host-only Cookie、定数時間CSRF比較 | token漏えい、Cookie改ざん、CSRF、secret先読みを防ぐ |
| データ | session version 1、active／previous key、期限、profile最小項目 | key rotationと期限遷移でアカウントやtokenを取り違えない |
| UI | cloud UI未接続、Preview／localhostはAPI 404 | 未完成機能を公開せず、既存ローカルUIを変えない |
| 境界値 | Cookie 3,800 bytes、raw body 4,500,000／4,500,001 bytes、refresh残り5分 | platform上限と更新開始条件をexactに固定する |
| 異常・状態 | Preview、suffix類似Origin、CSRF欠落／不一致、session改ざん、refresh失敗／期限切れ | secretやGitHub通信より前に拒否し、安全に再認証へ収束させる |

PR4の追加API unitは50/50、全unitは107/107、`npm run lint`、`npm run build`、全Playwright 58/58を1 workerで成功した。API単体から全unit、browser E2Eの順に直列実行し、retry／flakyはなかった。Production secretと実GitHubを使用する結合テストはPR8まで実施せず、PreviewではAPI拒否を検証する。

### 5.4 PR5テスト観点

| 分類 | 正常系・異常系・境界値・状態遷移 | 検証意図 |
| --- | --- | --- |
| 機能 | signed out／signed in／reauthorization、OAuth start／callback、Sign out、Disconnect | 任意ログインと明示操作だけで認証状態が変わり、バックアップ／復元を自動開始しない |
| 非機能 | state定数時間比較、PKCE S256、CSRF、timeout、offline、late response無効化 | 認証障害や競合をローカル編集から分離し、token／secretをブラウザへ露出しない |
| データ | dirty draft、保存成功／失敗、ローカルnote、host-only Cookie、最小profile | OAuth前の未保存内容とSign out／Disconnect後のローカルデータを保持する |
| UI | GitHub section、2択dialog、結果notice、390×844、primary／secondary Origin表示 | 状態と次操作を同じmenuで提示し、Discard導線や強制ログインを作らない |
| 境界値 | exact 2 Production Origins、Preview／localhost／suffix類似Origin、10分state期限 | environment差とOrigin境界で認証機能を誤公開しない |
| 異常・状態 | OAuth取消／state不一致／期限切れ、save失敗、revocation失敗、offline→online | 自動retryや誤成功表示を防ぎ、安全にsigned outまたは明示Retryへ収束させる |

PR5の追加unitは22/22（OAuth／Sign out／Disconnect 16件、cloud capability 6件）、全unitは129/129、`npm run lint`、`npm run build`、追加stub E2Eは9/9、全Playwrightは67/67を1 workerで成功した。初回の追加E2E失敗1件は新規noteの`Draft`状態を`Unsaved`としたテストデータ前提、初回の全E2E失敗1件は`Last local backup`と280 px menuへ更新前の旧UI期待値が原因であり、実装問題ではなくテスト前提／UI契約更新として修正した。修正後の全再実行にretry／flakyはなかった。Production secret、実GitHub、GitHub App権限、実OAuthはPR8まで実施しない。

2026年8月3日時点でPR1はPR #19、PR2はPR #20、PR3はPR #21、PR4はPR #22としてsquash merge済みである。PR5はPR #23として実装・ローカル検証済みである。GitHub App作成、Production環境変数、実OAuth、実mobile計測はプロジェクト所有者の資格情報または実機を必要とする管理者作業として引き続き追跡する。

## 6. 失敗時の証跡

- unit／E2Eの失敗ケース名、前提データ、再現コマンドを残す。
- GitHub API失敗はrequest ID、HTTP status、処理段階だけを記録する。
- 性能測定は端末、OS、browser、iteration、sample数、min／average／maxを記録する。
- 同一Gistを使用する実結合テストは並列実行しない。
