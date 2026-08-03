# Markdown Knowledge Board フェーズ2 実装計画

更新日: 2026-08-03
状態: Production初回作成／既存Gist更新／restore確認済み（最新修正の反映を追跡中）

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
| 実mobile計測 | 対象mobile実機で同条件を計測 | 端末・OS・browser・測定値 | 未実施。Production有効化を妨げない追加品質確認として継続 |
| GitHub App | 本番2 callback、expiring user token、`Gists: write`を確認 | 設定画面記録（secretを除く） | 完了。GitHub client ID/secretもVercel Productionへ設定済み |
| GitHub REST version | 実装時点の公式support値を固定 | `api/_lib/github.ts`、GitHub公式API Versions | 完了（`2026-03-10`） |

mobile emulationはWeb Crypto互換確認には利用できるが、実機性能の代替証跡にはしない。

2026年8月3日の基準計測では、Windows 11／Chromium 149／Intel Core Ultra 7 155Uで600,000回を3 sample実行し、desktopは平均78.7ms（77.2～80.6ms）、Pixel 7 emulationは平均77.9ms（74.0～83.9ms）だった。この結果と主要3ブラウザ回帰に基づき`PBKDF2_ITERATIONS_V1 = 600_000`を採用した。emulationは同じCPU上の結果であるため、実mobile計測は性能劣化を検出する追加品質確認として残す。

同日のPR1回帰は`npm run test:unit`が10/10、Backup／Import対象Playwrightが8/8、全Playwrightを1 workerで58/58成功した。全実行を直列化し、単体成功後の通し実行でも状態残留や順序依存がないことを確認した。

PR1基準で報告された既存transitive dependencyのhigh 2件、low 1件は、PR8でlockfileの互換patch更新により解消した。`npm audit --audit-level=low`は0件で、更新後にunit／build／主要3ブラウザE2Eを全回帰した。

### 3.2 Phase 0-B: API基盤実装後に確認

| ゲート | 実施時点 | 状態・証跡 |
| --- | --- | --- |
| 4,500,000 bytes成功／4,500,001 bytes拒否 | PR4でserver境界をunit固定、PR6でupload endpoint、Production実経路は追加確認 | browser／endpointの境界値unitまで完了。Production実上限サイズは追加品質確認として未実施 |
| 1 MB超Gistの`raw_url`取得 | PR6のGist discovery実装後 | raw host固定、各redirect再検証、最大2回、size、UTF-8、Bearer非送信をunit固定済み。実Gistのcontent取得は確認済み、1 MB超の実データは追加確認 |
| Previewのcloud UI非表示・API拒否・Production secret非配布 | PR4以降の各PR | API拒否とUI非表示をunit／E2Eで確認済み。GitHub／session秘密情報はProductionだけに設定し、Preview／Developmentは変数0件を維持 |
| 本番2 OriginのOAuth／Cookie分離 | PR5以降 | exact Origin、host-only Cookie、Origin別callback、state／PKCEをunit固定し、両本番Originで実OAuthとOrigin別ローカルデータを確認済み |

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

PR5の追加unitは22/22（OAuth／Sign out／Disconnect 16件、cloud capability 6件）、全unitは129/129、`npm run lint`、`npm run build`、追加stub E2Eは9/9、全Playwrightは67/67を1 workerで成功した。初回の追加E2E失敗1件は新規noteの`Draft`状態を`Unsaved`としたテストデータ前提、初回の全E2E失敗1件は`Last local backup`と280 px menuへ更新前の旧UI期待値が原因であり、実装問題ではなくテスト前提／UI契約更新として修正した。修正後の全再実行にretry／flakyはなかった。PR5完了時点ではProduction secret、実GitHub、GitHub App権限、実OAuthをPR8の残件としていたが、その後すべて設定・確認した。

### 5.5 PR6テスト観点

| 分類 | 正常系・異常系・境界値・状態遷移 | 検証意図 |
| --- | --- | --- |
| 機能 | Gist検出、0件作成、1件更新、複数候補選択、明示操作だけのupload | ログイン完了ではuploadせず、利用者が選んだ対象だけを更新する |
| 非機能 | browser暗号化、CSRF、timeout、rate limit、raw host固定、Bearer非送信、tab lock | token・平文漏えい、二重実行、外部hostへの資格情報送信を防ぐ |
| データ | deterministic snapshot、Secret Gist、SHA-256、revision、ユーザー別metadata | 重複作成、アカウント混同、無警告上書き、ローカル変更を防ぐ |
| UI | dirty Save and Continue、候補選択、passphrase、空backup警告、競合停止、390×844 | 危険操作と次の選択をkeyboard・mobileでも明確に提示する |
| 境界値 | 0／1／複数Gist、10 page、11／12文字、4,500,000／4,500,001 bytes、1 MB超raw | 上限の内外をexactに判定し、不完全探索を成功扱いしない |
| 異常・状態 | offline、CSRF／hash不一致、権限／rate limit、remote revision変更、同一hash再送 | ローカルデータを変えず、自動上書き・自動再作成をしない |

PR6の追加unitは27/27（Gist adapter 10件、backup endpoint 13件、metadata cache 4件）、全unitは156/156、`npm run lint`、`npm run build`、追加stub E2Eは4/4、全Playwrightは71/71を1 workerで成功した。4,500,000／4,500,001 bytes、最大10 page、nullable description、権限／rate limit、raw host制限、Bearer非送信、dirty save、空backup警告、複数候補、revision競合を個別に固定した。PR6完了時点ではProduction secret、実GitHub、GitHub App権限、実OAuth、実GistをPR8の残件としていたが、その後、実Gist更新を除いて設定・確認した。

### 5.6 PR7テスト観点

| 分類 | 正常系・異常系・境界値・状態遷移 | 検証意図 |
| --- | --- | --- |
| 機能 | 明示download、browser復号、preview、added／updated適用、skipped／conflicted保持 | 利用者が内容と件数を確認するまでIndexedDBを変更せず、安全な差分だけを適用する |
| 非機能 | passphrase非永続化、SHA-256再検証、raw redirect再検証、tab lock、単一transaction | 平文・資格情報漏えい、競合実行、部分反映を防ぐ |
| データ | local-only保持、同一内容、cloud newer、local newer、同時刻異内容、custom metadata | 無警告の削除・上書き・属性欠落を防ぐ |
| UI | Restore開始、単一passphrase、件数preview、競合理由、適用結果、390×844 | 状態と次操作をkeyboard・狭幅でも判断できるようにする |
| 境界値 | 1／4,500,000／4,500,001 bytes、raw redirect 0／1／2／3回、0／1／複数Gist | 通信量と対象選択の許容境界をexactに固定する |
| 異常・状態 | 誤passphrase、改ざん、dirty Cancel／保存成功／保存失敗、apply失敗、他tab変更、offline | DB不変、rollback、再previewへ安全に収束し、ローカル編集を妨げない |

PR7の追加unitは14/14（raw redirect 2件、restore download endpoint 8件、browser download検証4件）、全unitは170/170、`npm run lint`、`npm run build`、追加stub E2Eは3/3、全Playwrightは74/74を1 workerで成功した。E2E初回失敗2件は`dl`行の相対locator指定、次の失敗1件はBackupDocumentから復元したMarkdown本文に生成済み見出しを含む既存契約をテスト期待値が省いていたことが原因で、いずれもテスト実装／データ前提として修正した。修正後の直列再実行にretry／flakyはない。これはPR7完了時点の証跡であり、その後Production秘密情報と実GitHub経路を確認した。

### 5.7 PR8テスト観点

| 分類 | 正常系・異常系・境界値・状態遷移 | 検証意図 |
| --- | --- | --- |
| 機能 | 読み込み後offlineでedit/save/Markdown export/JSON backup・import、明示Retry | cloud障害と無関係に全ローカル経路を維持し、復旧で自動送信しない |
| 非機能 | audit 0件、secret非bundle、1 worker、Chromium／Firefox／WebKit | 依存脆弱性、機密情報露出、順序依存、browser差をリリース前に検出する |
| データ | IndexedDB、Markdown、JSON version 1、offline import、cloud mutation 0回 | offlineやfocus改善で保存内容を欠落・変形・送信しない |
| UI | 390×844、menu scroll、dialog/result境界、初期focus、Tab containment、focus復帰、`aria-pressed` | keyboard・狭幅・支援技術で状態と次操作を判断可能にする |
| 境界値 | online→offline→online、dialog表示後切断、desktop 1200×800／mobile 390×844 | タイミング競合とviewport境界でcloud処理やUIを誤作動させない |
| 異常・状態 | offline判定を`AUTH_REQUIRED`より優先、WebKit test file I/O差、Production設定欠落 | 原因に合う表示を保ち、テスト環境差を製品不具合と混同しない |

PR8自動ゲートは`npm audit --audit-level=low`が0件、`npm run lint`、`npm run test:unit`が170/170、`npm run build`、Playwrightが115/115を1 workerで成功した。内訳はChromium全77件、Firefox／WebKitはauth・backup・restore・readiness各19件で、retry／flakyはない。初回追加E2Eではoffline後の判定順が`AUTH_REQUIRED`になった実装問題を検出して`OFFLINE`優先へ修正した。ほかの失敗はdesktopで非表示のmobileボタンを選んだテスト観点不足、Playwright WebKitのnetwork-level offline中のfile input I/O制限というテスト環境問題であり、DB内容の直接確認とWebKit固有のofflineイベント再現へ修正した。

同日の初回Production監査では両Originのsession endpointは応答したが、GitHub開始endpointは`500 AUTH_START_FAILED`で、GitHub client ID/secretが未設定であることを確認した。この記録は設定前の原因切り分け証跡として残す。

その後、GitHub Appへ本番2 callback、expiring user token、`Gists: write`を設定し、GitHub client ID/secretとsession秘密情報をVercel Productionだけへ登録して再deployした。`VITE_CLOUD_BACKUP_ENABLED`もProductionで有効化し、Preview／Developmentは変数0件とlocal-onlyを維持した。両本番Originで実OAuth成功とOrigin別のローカルデータ分離を確認した。

実Gist初回作成ではGist保存後にclientが失敗表示となる問題を検出した。GitHub API `2026-03-10`のfull Gist responseで`history`が省略される実挙動に対し、`history[0].version`を必須としていた実装問題が原因だった。full Gist responseの`ETag`をrevisionとして優先し、旧応答の`history[0].version`へfallbackするよう修正・Production反映した後、Gist検出、暗号文取得、復号、safe merge復元まで確認した。

続く既存Gist更新では、別Originが保持していた古い`none`状態からPOSTを選び、serverの重複作成防止により`GIST_SELECTION_REQUIRED`となる状態依存問題を検出した。再読込後に同一Gistを17件で更新し、重複が増えないことをProductionで確認した。再発防止としてCloud Backup／Restore開始時は`none`／`selected`を含め必ず再検出し、別Origin作成後のupdate、passphrase入力中の作成競合から再読込なしでの再試行、restoreをChromium／Firefox／WebKit各3件で直列確認した。

後続のdialog横overflow修正では、tooltipの疑似要素がdocument幅を広げるUI問題を検出した。auth 27件とbackup／restore 21件の計48件をChromium／Firefox／WebKitで直列実行し、tooltip表示前後の`clientWidth === scrollWidth`を確認した。全unitは172/172、lint、buildも成功しているが、このUI修正はProduction反映前である。

2026年8月3日時点でPR1はPR #19、PR2はPR #20、PR3はPR #21、PR4はPR #22、PR5はPR #23、PR6はPR #24、PR7はPR #26としてsquash merge済みである。PR8相当のProduction readinessと実結合修正はDraft PR #27で追跡する。

### 5.8 最終残件

| 優先度 | 項目 | 完了条件 |
| --- | --- | --- |
| 必須 | 最新修正のProduction反映 | action開始時のGist再検出とdialog横overflow修正をProductionへdeployし、別Origin変更を再読込なしで反映し、狭幅で横スクロールが発生しないこと |
| 必須 | PR完了と最終smoke | Draft PR #27をready化してmainへ反映し、両本番Originでローカル利用とcloud UIの基本動作を確認すること |
| 追加品質確認 | 実上限・大容量 | 4,500,000 bytesのProduction upload/downloadと1 MB超raw取得を専用データで確認すること |
| 追加品質確認 | 実mobile性能 | 対象実機でPBKDF2時間と390×844相当の操作性を記録すること |

## 6. 失敗時の証跡

- unit／E2Eの失敗ケース名、前提データ、再現コマンドを残す。
- GitHub API失敗はrequest ID、HTTP status、処理段階だけを記録する。
- 性能測定は端末、OS、browser、iteration、sample数、min／average／maxを記録する。
- 同一Gistを使用する実結合テストは並列実行しない。
