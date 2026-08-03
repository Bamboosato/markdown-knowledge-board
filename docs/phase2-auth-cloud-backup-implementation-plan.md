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
| GitHub REST version | 実装時点の公式support値を固定 | 定数・参照URL | PR4開始前 |

mobile emulationはWeb Crypto互換確認には利用できるが、実機性能の代替証跡にはしない。

2026年8月3日の基準計測では、Windows 11／Chromium 149／Intel Core Ultra 7 155Uで600,000回を3 sample実行し、desktopは平均78.7ms（77.2～80.6ms）、Pixel 7 emulationは平均77.9ms（74.0～83.9ms）だった。emulationは同じCPU上の結果であるため、`PBKDF2_ITERATIONS_V1 = 600_000`は実mobile計測完了まで候補値とする。

同日のPR1回帰は`npm run test:unit`が10/10、Backup／Import対象Playwrightが8/8、全Playwrightを1 workerで58/58成功した。全実行を直列化し、単体成功後の通し実行でも状態残留や順序依存がないことを確認した。

PR1基準では`npm audit`が既存のtransitive dependencyにhigh 2件、low 1件を報告する。Vitest追加前のlockfileにも同じ対象versionが存在するためPR1起因ではないが、PR8のsecurity smoke完了前に別の依存更新として解消し、全回帰を行う。

### 3.2 Phase 0-B: API基盤実装後に確認

| ゲート | 実施時点 |
| --- | --- |
| 4,500,000 bytes成功／4,500,001 bytes拒否 | PR4のProduction API基盤反映後 |
| 1 MB超Gistの`raw_url`取得 | PR6のGist discovery実装後 |
| Previewのcloud UI非表示・API拒否・Production secret非配布 | PR4以降の各PR |
| 本番2 OriginのOAuth／Cookie分離 | PR5以降 |

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
| PR2 | strict schema、diff、IndexedDB transaction | `RESTORE-001..020` | unit、fake IndexedDB commit／rollback |
| PR3 | AES-GCM、PBKDF2、envelope | `CRYPTO-001..011` | 固定vector、改ざん、境界値、性能 |
| PR4 | Production gate、session、CSRF、Origin | `SESSION-001..005`、`ENV-001..005` | API unit／integration、Preview拒否 |
| PR5 | OAuth UI、Save and Continue、Sign out、Disconnect | `AUTH-001..015`、`SIGNOUT-001..004`、`DISCONNECT-001..007` | component、stub E2E、2 Origin |
| PR6 | Gist discovery、候補選択、Cloud Backup | `BACKUP-001..019` | API stub、revision競合、4.5 MB |
| PR7 | download、復号、preview、safe merge | `RESTORE-001..020` | merge matrix、rollback、別browser |
| PR8 | offline、mobile、アクセシビリティ、Production有効化 | `OFFLINE-001..005`、横断要件 | full E2E、実GitHub serial、security smoke |

PR1からPR7まではcloud feature flagを既定offとする。各PRで未ログインlocal回帰を実行し、PR本文に対象要件ID、追加テスト、未実施の本番ゲート、rollback方法を記載する。PR8の完了条件を満たした場合だけProductionでcloud UIを有効にする。

2026年8月3日時点でPR1のローカル実装と検証は完了し、GitHub公開前の状態である。GitHub App作成、Production環境変数、実mobile計測はプロジェクト所有者の資格情報または実機を必要とするため、PR1と並行する管理者作業として追跡する。

## 6. 失敗時の証跡

- unit／E2Eの失敗ケース名、前提データ、再現コマンドを残す。
- GitHub API失敗はrequest ID、HTTP status、処理段階だけを記録する。
- 性能測定は端末、OS、browser、iteration、sample数、min／average／maxを記録する。
- 同一Gistを使用する実結合テストは並列実行しない。
