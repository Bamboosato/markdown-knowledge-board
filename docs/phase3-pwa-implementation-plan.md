# Markdown Knowledge Board フェーズ3 PWA実装計画

作成日: 2026-08-06
更新日: 2026-10-06
文書状態: 実装・自動検証記録を含む計画。両本番Originのmanifest／Service Worker配信をHTTP確認済み。実機・本番操作の確認状況は末尾に区別して記載する。
参照: [要件定義](./phase3-pwa-requirements.md) / [基本・詳細設計](./phase3-pwa-design.md)

---

## 1. 目的

Phase 3を小さなPRに分け、各段階でlocal-only回帰、cache境界、データ保全を検証する。Production有効化と実機確認は、実装PRと分けてrelease gateとして扱う。

## 2. テスト設計観点

### 2.1 観点

| 分類 | 各PRで確認すること |
| --- | --- |
| 機能 | 追加機能だけでなく、PWA無効時の通常Webを維持する |
| 非機能 | build容量、offline起動、update信頼性、security、a11y |
| データ | IndexedDB不変、cache分離、Origin分離、dirty保全 |
| UI | exact copy、keyboard、focus、390×844、standalone |

### 2.2 系統

- 正常系: ready、install、offline再起動、clean／dirty update
- 異常系: registration、precache、quota、save、update失敗
- 境界値: 4 MB、5 MiB、ready直前／直後、0／多数notes、2 tabs
- 状態遷移: online／offline、waiting／deferred／applying、dialog／cloud busy

各test名またはPR本文に「何を検証しているか」を記載する。button clickの成立だけでなく、たとえば「API responseがCache Storageへ入らない」「Save失敗時にworkerがwaitingのまま」といった意図をassertする。

## 3. Phase 0: 実装前gate

### 3.1 完了済みbaseline

- Requirements: `docs/phase3-pwa-requirements.md`
- Design: `docs/phase3-pwa-design.md`
- 2026-08-06 build baseline:
  - 68 files
  - raw 8,160,762 bytes
  - gzip 2,537,728 bytes
  - largest `marp-*.js` 3,650,803 bytes
- `vite-plugin-pwa` current確認値: 1.3.0、Vite 7をpeer dependencyとして許容

### 3.2 実装前確認

- working treeにあるRequirements／README変更をPhase 3文書として同じscopeで扱う。
- Production 2 Originの`VITE_PWA_ENABLED`設定方針を確認する。
- 承認済みのA案（Markdown Board）を正本SVGから192／512／maskable／Apple touchへ生成し、通常／円形／角丸四角／iOS previewで確認する。
- PWA test用portを既存E2Eと分離する。

## 4. PR分割

### 4.1 PR1: build基盤・manifest・precache gate

実装:

- `vite-plugin-pwa`追加
- build環境に応じた`disable`と秘密情報を含まない`.env.pwa-test`
- manifest、icon、HTML metadata
- `generateSW` prompt構成
- `/api` navigation denylist、runtime cacheなし
- `vercel.json` cache header
- `verify-pwa-build.mjs`
- `pwaCapability`とunit test

feature gate:

- Production登録UIはまだ接続しない。
- generated artifactとtest buildだけを検証する。

対象要件:

- PWA-MAN-001..007
- PWA-REG-001、002、004、005
- PWA-CACHE-001..006、008
- PWA-NFR-001、003、004
- PWA-SEC-001..005

主なtest:

- manifest field／icon寸法
- 全build assetとprecache entryの突合
- 4 MB／5 MiB budget
- API／auth／cloud URL非cache
- Production／Preview／loopback capability matrix

PR1 gate:

```text
npm run lint
npm run test:unit
npm run build:pwa:test
npm run verify:pwa
git diff --check
```

### 4.2 PR2: registration・offline起動・install UI

実装:

- `pwaController` singletonと`usePwaLifecycle`
- Production／test registration gate
- Offline status region
- Application menuのInstall App／Install Help
- install help dialog
- persistent storage best effort
- production-build offline E2E

対象要件:

- PWA-REG-003
- PWA-OFF-001..008
- PWA-INSTALL-001..007
- PWA-DATA-001..007
- PWA-UI-001..005

主なtest:

- StrictMode／再mountでregister 1回
- ready前後のoffline境界
- close後のoffline新規起動
- local CRUD、Preview、Mermaid、Slides、import/export
- prompt accepted／dismissed／unsupported
- iPhone help条件、focus、Escape
- reconnectでcloud actionを自動開始しない

PR2 gate:

```text
npm run lint
npm run test:unit
npm run build:pwa:test
npm run verify:pwa
npm run test:e2e:pwa -- --grep "offline|install"
npm run test:e2e -- --project=chromium
git diff --check
```

### 4.3 PR3: 安全なupdate・複数tab・障害注入

実装:

- Update available notice／Later
- dirty用PwaUpdateDialog
- `handleSave()`成功後だけ`updateSW(true)`
- dialog／save／cloud blocker
- visible復帰時のupdate check
- reload single-flight
- v1／v2同一Origin test server
- cache／worker diagnostics

対象要件:

- PWA-CACHE-006、007
- PWA-UPD-001..010
- PWA-NFR-005..007
- PWA-ERR-001..010

主なtest:

- clean update
- dirty save成功／失敗／Cancel
- dialog open、cloud upload、restore apply中のwaiting
- Later後のwaiting維持
- download中network切断
- controllerchange重複
- 2 tabsの他方を強制reloadしない
- v1／v2 asset混在と旧版fallback

PR3 gate:

```text
npm run lint
npm run test:unit
npm run build:pwa:test
npm run verify:pwa
npm run test:e2e:pwa -- --workers=1
npm run test:e2e -- --project=chromium
npm run test:e2e -- --project=firefox
npm run test:e2e -- --project=webkit
git diff --check
```

### 4.4 Release: Production有効化・実機handoff

実施:

- `VITE_PWA_ENABLED=true`をProductionだけに設定
- PreviewでPWA UIが無効でlocal-onlyが継続することを確認
- 2 Production Originへdeploy
- manifest、scope、headers、precache、offline起動、update、API非cacheを確認
- Android Chrome／iPhone Safariの実機手順と記録表をユーザーへ渡す
- ユーザーの手動結果を受領し、重大Fail 0件を確認
- `docs/design-spec.md`とREADMEを実装済み状態へ更新

Release gate:

- 自動test結果、Production smoke、実機環境情報を1つのチェックリストへ集約する。
- 実機結果受領前は「実機確認待ち」とし、Phase 3完了扱いにしない。
- 同一実機への並列実行を前提にしない。

## 5. Test file構成

```text
tests/
  unit/
    pwaCapability.test.ts
    storagePersistence.test.ts
  e2e/
    pwa.spec.ts
  fixtures/
    pwa-version-server.mjs
playwright.pwa.config.ts
scripts/
  generate-pwa-icons.mjs
  verify-pwa-build.mjs
```

- 通常E2EとPWA E2Eはserver、port、configを共有しない。
- update suiteはserialとし、v1→v2以外の順序依存を作らない。
- 各test前提にregistration／cache／DBの保持または初期化を明記する。
- 実機確認は自動test fileへ含めず、release checklistで管理する。

## 6. Failure evidence

失敗時に次を保存する。

| 分類 | 証跡 |
| --- | --- |
| build | asset一覧、raw／gzip、precache差分、manifest |
| registration | scope、installing／waiting／active、controller URL |
| offline | ready時刻、offline化時刻、navigation結果、cache hit |
| update | v1／v2 build ID、reload回数、dirty、dialog、blocker |
| cache | cache名、URLだけのkey一覧。response bodyは保存しない |
| UI | trace、screenshot、focus element、viewport |

再実行で偶然成功した場合もcloseせず、次のいずれかへ分類する。

- テスト観点不足
- データ問題
- 環境問題
- 実装問題

原因と再発防止assertを追加してから完了とする。

## 7. Rollback

### 7.1 通常rollback

1. Vercelで直前の正常なPWA deploymentへ戻す。
2. `/sw.js`がrevalidateされ、rollback版workerがinstallされることを確認する。
3. 利用者には通常のUpdate available導線で戻す。
4. IndexedDBは変更しない。

### 7.2 registration障害

- `VITE_PWA_ENABLED=false`のbuildを配信し、新規registrationを止める。
- 既存registrationを自動unregisterしない。offline利用者のlocal accessを突然失わせないためである。
- 緊急時だけone-time cleanup workerを設計レビュー後に配信し、Workbox cacheとregistrationのみを削除する。IndexedDB、localStorage、notesは削除しない。

### 7.3 broken cache

- 正常assetを同じOriginへ再deployし、worker scriptを変更してupdate check対象にする。
- reload loopを再現する場合は、online Web fallback手順としてbrowserのsite permission／cache削除を案内する。ただしlocal note消去の可能性を警告し、先にexport可否を確認する。

## 8. 完了定義

- RequirementsのMust要件がcode／test／docsへtraceできる。
- PWA無効環境で現行local-only機能が回帰しない。
- API／auth／cloud responseがCache Storageへ存在しない。
- dirty、dialog、cloud operation、2 tabsで強制reloadとデータ消失がない。
- 2 Production Originでoffline新規起動が成功する。
- ユーザーによるAndroid Chrome／iPhone Safari手動確認が完了する。
- rollback手順がProductionで実行可能な粒度になっている。

## 9. 実装・検証状況（2026-08-06）

実装済み:

- A案アイコン、manifest、Service Worker、全build assetのprecache
- online限定のAPI／auth／cloudをCache Storage対象外とする境界
- offline／install／install help／update availableの状態表示
- dirty、dialog、cloud operation、複数tabを考慮した明示update
- 保存成功後のpersistent storage要求（失敗時は保存を妨げない）
- Production限定flag、PWA専用build verifier、version切替E2E fixture
- Android Chrome／iPhone Safari向け手動確認checklist

自動検証結果:

- lint: 成功
- unit: 195件成功
- 通常build: 成功
- PWA build／構成検証: 成功（precache 75 files、gzip合計 2,564,592 bytes）
- PWA専用Chromium E2E: 11件成功
- 通常Chromium E2E: 89件成功
- 通常Firefox E2E: 29件成功、Chromium専用IME 1件は想定skip
- 通常WebKit E2E: 29件成功、Chromium専用IME 1件は想定skip

当時のRelease前残作業（2026-08-06の記録）:

1. Vercel Productionだけで`VITE_PWA_ENABLED=true`を設定する。
2. 2 Production Originへdeployし、manifest／headers／offline／update／API非cacheをsmoke確認する。
3. ユーザーが`docs/phase3-pwa-device-checklist.md`に沿って実機を1台ずつ手動確認する。
4. 重大Fail 0件と証跡を確認してPhase 3を完了扱いにする。

当時の判定は「実装・自動検証完了／Production有効化前／実機確認待ち」であった。

### 9.1 文書監査時の確認（2026-10-06）

両本番OriginのHTMLは`/manifest.webmanifest`を参照し、`/sw.js`はJavaScriptとしてHTTP 200で配信され、`Cache-Control: no-cache, max-age=0, must-revalidate`を返した。Production有効化前という判定は現状に適用しない。

現在の判定は「実装済み／ProductionでPWA資産配信確認／実機確認待ち」。今回のHTTP確認ではinstall、offline新規起動、update、API非cacheのブラウザ操作を再実施していない。§9の自動検証結果は実装当時の記録であり、今回の再実行結果ではない。Android Chrome／iPhone Safariの実機結果と本番操作の証跡を確認してから完了定義を判定する。
