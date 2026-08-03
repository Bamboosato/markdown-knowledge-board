# Markdown Knowledge Board フェーズ2 API・認証詳細設計

作成日: 2026-07-30
文書状態: PR5 OAuth・認証UI実装と同期

## 1. 目的

本書は、[基本設計](./phase2-auth-cloud-backup-architecture.md)に基づき、Vercel Functions、GitHub App、Gist API の契約を定義する。ブラウザ内の暗号化・復元ロジックは[フロントエンド詳細設計](./phase2-auth-cloud-backup-frontend-design.md)を参照する。

> 実装状況（2026年8月3日時点）: PR4でProduction環境ゲート、exact Origin、session sealing／refresh、CSRF、共通HTTP応答、raw body上限、`GET /api/auth/session`を実装した。PR5でOAuth start／callback、PKCE、Sign out、Disconnectとフロントエンド認証UIを実装した。Gist中継endpointは未実装で、cloud feature flagはPR8まで既定offとする。

## 2. テスト設計観点

API ケースの詳細化前に、次の観点を必ず確認する。

| 分類 | 観点 | 検証意図 |
| --- | --- | --- |
| 機能 | OAuth、session、refresh、Sign out、Disconnect、Gist 検出・作成・更新・取得 | 各 endpoint が認可された明示操作だけを実行すること |
| 非機能 | Cookie、CSRF、SSRF、secret、timeout、rate limit、ログ | 秘密情報とローカル機能を障害・攻撃から隔離すること |
| データ | user/Origin 分離、revision、idempotency、SHA-256、4.5 MB | 取り違え、重複作成、欠落、無警告上書きを防ぐこと |
| UI 契約 | error code、retryable、次操作、処理段階 | クライアントが状態に応じた一貫した案内を表示できること |

| 区分 | API テスト対象 |
| --- | --- |
| 正常系 | 2 Origin の OAuth、token refresh、初回 Gist、更新、直接 upload/download、Sign out、Disconnect |
| 異常系 | state/CSRF/Origin 不正、401/403/404/429/5xx、timeout、raw URL 不正、payload 破損 |
| 境界値 | Cookie 上限、0/1/複数候補、1 MB、4,500,000/4,500,001 bytes、pagination 上限 |
| 状態遷移 | signed out→authorizing→signed in、refresh、upload retry→complete、revision mismatch、expired session |

結合テストは専用 GitHub アカウントと専用 Gist を使用し、同一 Gist を更新するテストを並列実行しない。失敗時に request ID、GitHub status、処理段階、一時 session ID の末尾だけで原因を切り分けられることを前提とする。

## 3. 共通 HTTP 契約

### 3.1 基本方針

- Functions は Web Standard `Request` / `Response` を使用する TypeScript 実装とする。
- API path は `/api` 配下に置き、SPA の route と分離する。
- 認証・クラウド応答に `Cache-Control: no-store` を付ける。
- GitHub REST API には `Accept: application/vnd.github+json` と、2026年8月3日時点で公式サポート対象の固定値 `X-GitHub-Api-Version: 2026-03-10` を付ける。値は `api/_lib/github.ts` で一元管理する。
- JSON の request body は `Content-Type: application/json` を必須とする。
- encrypted backup body は `application/vnd.mkb.encrypted-backup+json` の raw UTF-8 bytes とし、圧縮を受け付けない。
- request body は読み込み前と読み込み後の両方で上限を検査する。
- CORS は許可せず、同一 Origin のみとする。

### 3.2 成功応答

```ts
type ApiSuccess<T> = {
  ok: true;
  data: T;
  requestId: string;
};
```

### 3.3 エラー応答

```ts
type ApiError = {
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    stage?:
      | "auth-check"
      | "auth-callback"
      | "backup-discovery"
      | "backup-upload"
      | "restore-download";
    retryAfterSeconds?: number;
  };
  requestId: string;
};
```

`message` は利用者へそのまま表示する詳細ログではなく、安全な英語文言とする。GitHub の response body、token、URL query、stack trace を含めない。

### 3.4 request ID

- Functions 入口で UUID v4 を生成する。
- client が送信した request ID を信頼して再利用しない。
- `X-Request-Id` response header と response body の両方に返す。
- GitHub request のログ相関に使用するが、GitHub へ user data として送らない。

### 3.5 CSRF と Origin

state-changing endpoint は次の全条件を満たした場合だけ処理する。

1. `Request.url` の Origin が exact allowlist に含まれる。
2. `Origin` header が存在し、`Request.url` の Origin と完全一致する。
3. `__Host-mkb_csrf` Cookie と `X-CSRF-Token` header が定数時間比較で一致する。
4. session が必要な endpoint は有効な session Cookie を持つ。

CSRF token は256 bit乱数の base64url とする。`GET /api/auth/session` が Cookie と response data に同じ値を返し、client はメモリにだけ保持する。CSRF token を localStorage へ保存しない。Cookieは `__Host-mkb_csrf`、`HttpOnly; Secure; SameSite=Strict; Path=/` とし、`Domain`を付けない。

### 3.6 timeout と AbortSignal

すべての GitHub outbound fetch に `AbortSignal.timeout` 相当を設定する。timeout は `504` と内部 code に変換し、GitHub の不定な error text を返さない。

### 3.7 Production環境ゲート

認証・クラウドendpointは、secretの読込みやGitHub API呼出より前に次を検証する。

1. Vercel system envの`VERCEL_ENV`が`production`である。
2. `Request.url`のOriginがchecked-in `ORIGIN_CONFIG`の本番2 Originのいずれかと完全一致する。
3. state-changing requestは3.5のOrigin/CSRF条件も満たす。

Vercel Previewとlocalhostは実GitHub接続の対象外とし、`404 CLOUD_NOT_AVAILABLE`を返す。Preview URLをsuffixやbranch名で許可しない。本番GitHub secretとsession鍵はVercel Production scopeだけへ設定し、Preview Functionsへ配布しない。unit/E2EではGitHub adapterをstubし、この環境ゲートをtest dependency injectionで検証するが、localhostから実GitHub APIへ接続しない。

PR4では`api/_lib/environment.ts`がこの判定を担い、`api/auth/session.ts`は判定通過後だけCookieやsecretを扱う。`VERCEL_ENV`未設定、`preview`、`development`、localhost、Preview URL、allowlistのsuffix類似URLはすべて同じ404応答とする。

## 4. OAuth・認証 endpoint

### 4.1 `GET /api/auth/github/start`

GitHub ログイン開始専用の navigation endpoint である。

#### query

| 名前 | 必須 | 値 |
| --- | --- | --- |
| `returnPath` | 任意 | 初期実装は `/` だけ。未指定も `/` |

#### 処理

1. Production環境ゲートを通過後、`Request.url`のOriginを本番2 Originのallowlistと照合する。
2. 32 bytes の `state` と32 bytesのPKCE `code_verifier`を`crypto.randomBytes`で個別に生成する。
3. `code_verifier`のSHA-256からbase64urlの`code_challenge`を作成し、`code_challenge_method=S256`を使用する。
4. `{ state, codeVerifier, originKey, returnPath, issuedAt, expiresAt }` を server key で封印する。
5. `__Host-mkb_oauth_state` Cookie を設定する。
6. 対応する callback URL を `redirect_uri` に明示して GitHub へ302 redirectする。

OAuth state Cookie は `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600` とし、`Domain` を付けない。`__Host-` prefix は `Path=/` を必須とするため callback path だけには狭めず、10分の期限と callback 後の即時削除で露出期間を限定する。OAuth URL やログに client secret を含めない。

#### 失敗

| 条件 | status/code |
| --- | --- |
| Production環境／Origin 未許可 | `404 CLOUD_NOT_AVAILABLE` |
| returnPath 不許可 | `400 INVALID_RETURN_PATH` |
| Cookie sealing 失敗 | `500 AUTH_START_FAILED` |

未保存確認と IndexedDB 保存はこの endpoint へ遷移する前に client が完了させる。

### 4.2 `GET /api/auth/github/callback`

#### query

- `code`: GitHub が返す一回限りの code
- `state`: 開始時の state
- `error` / `error_description`: 認可拒否時。安全な内部 code へ変換し、原文を表示しない

#### 処理

1. callback の Origin と allowlist を照合する。
2. state Cookie を復号し、期限、origin key、callback Origin、returnPath を検証する。
3. query state と Cookie state を定数時間比較する。
4. state Cookie を成功・失敗にかかわらず削除する。
5. GitHub token endpoint へ `client_id`、`client_secret`、`code`、同じ `redirect_uri`、開始時の`code_verifier`を送る。
6. expiring access token、refresh token、有効期限を検証する。
7. user endpoint から `id`、`login`、`avatar_url` だけを取得する。
8. sealed session Cookie と CSRF Cookie を設定する。
9. `/?auth=connected` へ303 redirectする。client は表示後に `history.replaceState` で query を除去する。

callback ではバックアップ、復元、暗号文取得を実行しない。

#### 失敗 redirect

`/?auth=error&code=<safe-code>` へ303 redirectする。許可する code は固定 enum とし、OAuth code/state/token を query へ含めない。

| safe code | 条件 |
| --- | --- |
| `access_denied` | 利用者が認可をキャンセル |
| `state_invalid` | state 不一致、期限切れ、Cookie 不在 |
| `origin_invalid` | callback Origin 不一致 |
| `exchange_failed` | code 交換失敗、timeout |
| `permission_missing` | Gists 権限不足。PR6のGist接続後に使用する予約code |

### 4.3 `GET /api/auth/session`

認証状態確認は local UI をブロックしない。

```ts
type SessionResponse =
  | {
      status: "signed-out";
      csrfToken: string;
    }
  | {
      status: "signed-in";
      user: { id: number; login: string; avatarUrl: string };
      accessTokenExpiresAt: string;
      csrfToken: string;
    }
  | {
      status: "reauthorization-required";
      csrfToken: string;
    };
```

- session Cookie がなくても200を返す。
- access token の残存時間が5分以下なら server 内で refresh する。
- refresh 成功時は access/refresh token の両方を新しい session Cookie へ置換する。
- refresh 失敗または取消済みなら Cookie を削除し `reauthorization-required` を返す。
- GitHub refreshのtimeout、通信失敗、429、5xx、応答形式不正は一時障害としてCookieを保持し、retryableな`503 SESSION_CHECK_UNAVAILABLE`または`504 SESSION_CHECK_TIMEOUT`を返す。ログアウト済みとは断定しない。
- GitHub user API の毎回呼び出しは行わず、sealed session 内の最小 profile を使用する。
- client timeout/offline は HTTP response ではなく client の `unknown/unavailable` 状態として扱う。

### 4.4 `POST /api/auth/signout`

- CSRF と Origin を検証する。
- session、OAuth state、CSRF Cookie を期限切れで上書きする。
- GitHub API の token 失効は行わない。
- IndexedDB、localStorage、Gist を操作しない。
- response は `{ signedOut: true }` とする。

### 4.5 `POST /api/auth/disconnect`

- CSRF、Origin、session を検証する。
- `DELETE /applications/{client_id}/token` を GitHub App client ID/secret と現在の access token で呼ぶ。
- refresh token を含む session Cookie、OAuth state、CSRF Cookie を必ず削除する。
- Gist delete endpoint を呼ばない。

```ts
type DisconnectResponse = {
  disconnected: true;
  revocation: "succeeded" | "failed";
  githubSettingsUrl?: "https://github.com/settings/applications";
};
```

GitHub 失効が失敗しても local session 終了は完了させ、`revocation: "failed"` と設定確認導線を返す。client はアカウント別 Gist metadata を削除し、IndexedDB とローカルバックアップ日時を保持する。

## 5. session Cookie 詳細

### 5.1 payload

```ts
type SessionPayloadV1 = {
  version: 1;
  user: { id: number; login: string; avatarUrl: string };
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
  refreshTokenExpiresAt: number;
  issuedAt: number;
};
```

### 5.2 sealing

- AES-256-GCM、96 bit IV、128 bit tag を使用する。
- `SESSION_KEYS` は active key と previous key を key ID 付きで保持する。
- Cookie format は `v1.<keyId>.<iv>.<ciphertextAndTag>` の base64url とする。
- Cookie 名と version/key ID を AAD に含める。
- Cookie 復号時は key ID で選択し、active key 以外で成功した場合は次回 response で再封印する。
- serialized Cookie 値が3,800 bytesを超える場合は session を発行せず、機密情報をログに出さず `SESSION_TOO_LARGE` とする。

`SESSION_KEYS`はVercel Production scopeのsecretへ次のJSON形式で設定する。`key`は32 bytesをpaddingなしbase64urlで表した43文字とし、`id`は1〜32文字の英数字、`_`、`-`だけを許可する。ローテーション完了後は`previous`を省略できる。

```json
{
  "active": { "id": "2026-08", "key": "<32-byte-base64url>" },
  "previous": { "id": "2026-07", "key": "<32-byte-base64url>" }
}
```

### 5.3 属性

本番は次を使用する。

```text
__Host-mkb_session=<sealed>;
HttpOnly; Secure; SameSite=Lax; Path=/;
Max-Age=<refresh token の残存秒以下>
```

`Domain` は付けない。localhostとVercel Previewでは実認証session Cookieを発行しない。

### 5.4 refresh 競合

GitHub refresh token は使用後に旧 access/refresh token が無効になるため、client は同一 Origin の認証・クラウド要求を `navigator.locks` の `mkb-github-session` lock で直列化する。未対応ブラウザでは同一 tab の promise single-flight を使用する。競合で refresh に失敗した場合は `REAUTH_REQUIRED` とし、自動 OAuth を開始しない。

## 6. Gist 検出と metadata

### 6.1 識別条件

```text
description = Markdown Knowledge Board encrypted backup
filename    = markdown-knowledge-board.backup.enc.json
public      = false
```

Secret Gist は URL を知る者が取得可能であり、`public: false` を暗号化の代替にしない。

### 6.2 `GET /api/cloud-backups`

#### query

| 名前 | 必須 | 説明 |
| --- | --- | --- |
| `gistId` | 任意 | GitHub user ID に紐づき localStorage にある cached ID |

#### response

```ts
type CloudBackupResolution =
  | { status: "none" }
  | {
      status: "selected";
      backup: CloudBackupMetadata;
    }
  | {
      status: "selection-required";
      candidates: CloudBackupMetadata[];
    };

type CloudBackupMetadata = {
  gistId: string;
  revision: string;
  updatedAt: string;
  htmlUrl: string;
  encryptedSize: number;
};
```

#### 解決手順

1. cached `gistId` があれば `GET /gists/{id}` で所有者、description、filename を検証する。
2. 404または不一致なら cache を採用せず、`GET /gists?per_page=100&page=N` を走査する。
3. exact description と filename を持つ候補だけを抽出する。
4. 0件は `none`、1件は `selected`、2件以上は `selection-required` とする。
5. candidate 選択後に full Gist を取得し、`history[0].version` を revision とする。

pagination は `Link` header を追跡し、最大10 page/1,000 Gist とする。上限到達時は `GIST_DISCOVERY_INCOMPLETE` を返し、新規 Gist を作成しない。複数候補を更新日時だけで自動選択しない。

## 7. クラウドバックアップ API

暗号化エンベロープは raw UTF-8 body で直接送信する。JSON request envelope で包まず、4.5 MB の Functions payload 上限を暗号文本体へ使用する。

### 7.1 共通 upload headers

```text
Content-Type: application/vnd.mkb.encrypted-backup+json
Content-Length: 1..4,500,000
X-MKB-Operation-Id: <UUID v4>
X-MKB-Content-SHA256: <envelope bytes の SHA-256 base64url>
X-CSRF-Token: <token>
```

- client は送信前に1～4,500,000 bytesであることを確認する。
- server は `Content-Length` が上限内でも stream を4,500,001 bytesで打ち切り、実測値を検証する。
- `Content-Encoding` がある request は拒否する。
- SHA-256 は server でも再計算し header と定数時間比較する。
- UTF-8 JSON として parseし、top-level が `app`、`envelopeVersion`、`crypto`、`ciphertext` だけであることを shallow validationする。
- server は復号せず、`noteCount`、title、tags、createdAtを受け取らない。

### 7.2 `POST /api/cloud-backups`

初回 Secret Gist を作成する。

1. CSRF、Origin、session、upload headers/body を検証する。
2. authenticated user の候補 Gist を直前に再検索する。
3. 候補0件の場合だけ `POST /gists` を呼ぶ。
4. 候補が1件あり保存 content hash が request と一致する場合は、timeout後の同一操作再送として既存 Gist の成功 metadata を返す。
5. 候補が1件で hash が異なる、または複数件なら作成せず `GIST_SELECTION_REQUIRED` を返す。

### 7.3 `PUT /api/cloud-backups/update?gistId={gistId}`

既存 Gist を更新する。共通 headers に次を追加する。

```text
X-MKB-Expected-Revision: <直前にclientが確認したrevision>
```

1. Gist の所有者、description、filename を検証する。
2. 現在の保存 content hash が request と一致する場合は、timeout後の同一操作再送として現在の成功metadataを返す。
3. hashが異なる場合は `GET /gists/{id}` の `history[0].version` を取得する。
4. expected revision と一致した場合だけ `PATCH /gists/{id}` を呼ぶ。
5. 不一致なら body を保存せず `REMOTE_REVISION_CHANGED` を返す。

明示的な `Replace Cloud Backup` も同じ endpoint を使う。client が最新 revision を再取得して強い確認を表示した後、その revision を expected revision として送る。server は確認後にも再度 revision を比較する。

### 7.4 GitHub create/update body

GitHub request:

```json
{
  "description": "Markdown Knowledge Board encrypted backup",
  "public": false,
  "files": {
    "markdown-knowledge-board.backup.enc.json": {
      "content": "<encrypted envelope JSON only>"
    }
  }
}
```

update では `public` を送らず、対象 file content だけを更新する。他 file を削除しない。

```ts
type CloudBackupWriteResponse = {
  gistId: string;
  revision: string;
  updatedAt: string;
  encryptedSize: number;
  sha256: string;
};
```

更新後に Gist を再取得し、新しい revision と保存 content hash を確認する。1 MB超で `truncated: true` の場合は 8.1 と同じ検証済み raw URL取得を使用する。GitHub 成功が不明な timeout の場合も再取得し、SHA-256 が一致すれば成功として確定する。一致しなければ `UPLOAD_STATUS_UNKNOWN` とし、自動再作成・再更新しない。

## 8. クラウド復元 download API

### 8.1 `GET /api/cloud-backups/content?gistId={gistId}`

処理:

1. session user が所有する Gist を取得する。
2. description と filename を exact match で検証する。
3. file が `truncated: false` なら `content` を使用する。
4. `truncated: true` なら API が返した `raw_url` を検証して取得する。
5. envelope bytes を最大4,500,000 bytesで打ち切りながら読む。
6. shallow envelope validation と全体 SHA-256 を行う。
7. raw UTF-8 bytes を response bodyとして返す。

`raw_url` は `https:` かつ hostname が完全に `gist.githubusercontent.com` の場合だけ許可する。userinfo、非443 port、IP literal を拒否する。fetch は `redirect: manual` とし、redirect が必要なら最大2回、各 Location を同じ規則で再検証する。

成功 response:

```text
Content-Type: application/vnd.mkb.encrypted-backup+json
Content-Length: 1..4,500,000
X-MKB-Gist-Id: <gistId>
X-MKB-Revision: <history[0].version>
X-MKB-Gist-Updated-At: <ISO timestamp>
X-MKB-Content-SHA256: <envelope bytes の SHA-256 base64url>
Cache-Control: no-store
```

この endpoint は暗号化エンベロープだけを返し、server は復号しない。GET は Cookie を使うため、Origin/Referer と Fetch Metadata の same-origin 検証を行い、CORS を許可しない。4,500,001 bytes以上、非対応envelope、hash不一致はJSON error responseで返す。

## 9. GitHub API mapping

| 用途 | GitHub endpoint | 必要権限 |
| --- | --- | --- |
| user profile | `GET /user` | user access token |
| Gist 一覧 | `GET /gists` | `Gists: write` user permission |
| Gist 詳細 | `GET /gists/{gist_id}` | 同上 |
| Gist 作成 | `POST /gists` | 同上 |
| Gist 更新 | `PATCH /gists/{gist_id}` | 同上 |
| token 失効 | `DELETE /applications/{client_id}/token` | App owner client credentials |

Gist delete endpoint は実装しない。list response は候補検出にだけ使い、revision は full Gist response の `history[0].version` を使用する。

## 10. error code mapping

| HTTP | code | retryable | client の次操作 |
| --- | --- | --- | --- |
| 400 | `INVALID_REQUEST` | false | 入力を見直す |
| 400 | `INVALID_ENVELOPE` | false | ローカル JSON を案内 |
| 401 | `REAUTH_REQUIRED` | false | `Sign in with GitHub` |
| 403 | `CSRF_REJECTED` | false | session 再確認 |
| 403 | `PERMISSION_MISSING` | false | 再認証と権限説明 |
| 404 | `CLOUD_NOT_AVAILABLE` | false | ローカル機能を継続 |
| 404 | `GIST_NOT_FOUND` | false | 新規 backup または再検出 |
| 409 | `GIST_SELECTION_REQUIRED` | false | 候補選択 |
| 409 | `REMOTE_REVISION_CHANGED` | false | 復元または明示置換 |
| 400 | `CONTENT_HASH_MISMATCH` | true | 同じenvelope bytesを再検証して手動再試行 |
| 413 | `ENCRYPTED_BACKUP_TOO_LARGE` | false | ローカル JSON を案内 |
| 429 | `GITHUB_RATE_LIMITED` | true | reset 後に手動再試行 |
| 502 | `GITHUB_UPSTREAM_ERROR` | true | 手動再試行 |
| 504 | `UPSTREAM_TIMEOUT` | true | 状態再確認後に再試行 |

GitHub 403 は permission と rate limit を response headerで切り分ける。`Retry-After` または rate limit reset を安全な秒数へ変換する。

## 11. 入力検証と情報最小化

- JSON parser 前に stream と実測 bytes で4,500,000 bytes上限を適用する。
- unknown field は認証 payload、encrypted envelope で拒否する。
- Gist ID は GitHub が返す形式に限定し、URL/path を受け付けない。
- login、avatar URL、html URL は GitHub response からのみ採用する。
- avatar URL は UI で使用する場合も GitHub HTTPS host を検証する。
- encrypted envelope の `ciphertext` は base64url 文字と長さだけを server で検証し、復号しない。
- server は `noteCount`、title、tags、createdAt を受け取らない。

## 12. 監査・メトリクス

### 12.1 記録可能

- request ID、endpoint、stage、status、error code、duration
- bytes の bucket、retry count
- GitHub rate limit remaining/reset
- revision/content hash の先頭8文字ではなく、比較結果だけ

### 12.2 記録禁止

- request/response body
- Authorization/Cookie/CSRF header 値
- OAuth code/state、token、client secret
- envelope/ciphertext、raw URL
- GitHub login/user ID/Gist ID の生値

## 13. テストケース設計

### 13.1 前提条件

- unit/component は固定 clock、固定乱数 adapter、GitHub stub を使う。
- API integration は Origin ごとに別 Cookie jar を使う。
- Preview/localのAPI testはGitHub adapterをstubし、実GitHub endpointへ通信しないことをassertする。
- GitHub 結合は専用 user と Gist を使い、実行前後の revision を証跡に残す。
- 同一 Gist を変更するテストを並列実行しない。
- 失敗時は request ID、stage、HTTP transcript の機密値を redaction して保存する。

### 13.2 正常系

| ID | 前提 | 操作 | 検証意図 |
| --- | --- | --- | --- |
| API-N-01 | primary、signed out | OAuth 完了 | primary callback と host-only session だけが使用されること |
| API-N-02 | Vercel URL、signed out | OAuth 完了 | secondary callback と独立 Cookie が使用されること |
| API-N-03 | token 残存5分以下 | session 確認 | refresh 後の access/refresh token へ一度だけ置換すること |
| API-N-04 | candidate 0件 | raw envelope POST | Secret Gist を1件だけ作成すること |
| API-N-05 | expected revision 一致 | raw envelope PUT | 同じ Gist の対象 file だけを更新すること |
| API-N-06 | 4.5 MB以下 envelope | upload/download | SHA-256とbytesが往復で一致すること |
| API-N-07 | signed in | Sign out | Cookie だけを削除し GitHub token revoke を呼ばないこと |
| API-N-08 | signed in | Disconnect | revoke を試行し Gist delete を呼ばないこと |

### 13.3 異常系

| ID | 注入条件 | 期待 | 検証意図 |
| --- | --- | --- | --- |
| API-E-01 | OAuth state 不一致 | session 未発行、state削除 | login CSRF を防ぐこと |
| API-E-02 | Origin/CSRF 不一致 | 403、GitHub未呼出 | cross-site の状態変更を防ぐこと |
| API-E-03 | raw URL が任意 host | 400、fetch未実行 | SSRF を防ぐこと |
| API-E-04 | body hash 不一致 | 400、GitHub未呼出 | 転送破損を Gist へ反映しないこと |
| API-E-05 | GitHub 429 | retry 時刻付き error | 自動連打せず手動再試行できること |
| API-E-06 | create response timeout、実作成済み | hash再確認で成功 | timeout再送で重複Gistを作らないこと |
| API-E-07 | revoke 失敗 | session削除、failed導線 | 失効失敗を隠さずローカル session を残さないこと |
| API-E-08 | refresh 競合 | reauthorization-required | 無限 refresh や token ログ出力を防ぐこと |
| API-E-09 | Vercel Preview Origin | 404、GitHub未呼出、Cookie未発行 | Previewを認証・クラウド環境として使用しないこと |

### 13.4 境界値・データ

| ID | 値 | 期待 | 検証意図 |
| --- | --- | --- | --- |
| API-B-01 | 4,499,999 bytes | 成功 | 上限直前を許可すること |
| API-B-02 | 4,500,000 bytes | 成功 | 要件上限を満たすこと |
| API-B-03 | 4,500,001 bytes | client拒否または413 | Gist/Functionsへ過大送信しないこと |
| API-B-04 | Content-Length不在で上限超過 | stream打切り、413 | header回避でも上限を守ること |
| API-B-05 | Gist file 1 MB超 | raw URL 経由で取得 | truncated content を誤採用しないこと |
| API-B-06 | candidate 2件 | selection-required | 最新日時による自動選択をしないこと |
| API-B-07 | 1,000 Gistで次pageあり | discovery incomplete | 未走査のまま重複作成しないこと |
| API-B-08 | sealed Cookie 3,800 bytes超 | session発行失敗 | browser Cookie truncationを防ぐこと |

### 13.5 状態遷移・競合

| ID | 前提/タイミング | 期待 | 検証意図 |
| --- | --- | --- | --- |
| API-S-01 | POST timeout後に同じoperation/hashで再試行 | 既存Gistを成功として返す | 通信断から重複なく再開すること |
| API-S-02 | expected確認後、PUT前にremote更新 | 409、PATCHしない | 検出可能な競合を無警告上書きしないこと |
| API-S-03 | PATCH response timeout、実更新済み | hash再確認で成功確定 | 重複 Gist/二重更新を防ぐこと |
| API-S-04 | download中にsession失効 | 401、body非返却 | session終了後の取得を防ぐこと |
| API-S-05 | Sign outとcloud request競合 | 一方を直列化、最終signed out | session終了後に操作を残さないこと |

## 14. 既知の制約

- Gist API に原子的 compare-and-swap がないため、revision GET と PATCH の間の競合窓を完全には除去できない。
- `navigator.locks` 非対応かつ複数 tab で同時 refresh した場合、再認証が必要になる可能性がある。ローカル機能には影響しない。
- 暗号化エンベロープはVercel Functionsのpayload制約に合わせ4,500,000 bytes以下とする。超過時はローカルJSONを代替手段として案内する。
- Vercel Previewとlocalhostでは実GitHub認証・クラウドAPIを提供しない。
- 完全オフライン新規起動は保証しない。

## 15. 参照資料

- [フェーズ2要件定義](./phase2-auth-cloud-backup-requirements.md)
- [基本設計](./phase2-auth-cloud-backup-architecture.md)
- [GitHub Docs: REST API endpoints for gists](https://docs.github.com/en/rest/gists/gists)
- [GitHub Docs: API Versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions)
- [GitHub Docs: Refreshing user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens)
- [GitHub Docs: REST API endpoints for OAuth authorizations](https://docs.github.com/en/rest/apps/oauth-applications)
- [Vercel: System environment variables](https://vercel.com/docs/environment-variables/system-environment-variables)
- [Vercel: Using the Node.js Runtime with Vercel Functions](https://vercel.com/docs/functions/runtimes/node-js)
- [Vercel Functions Limits](https://vercel.com/docs/functions/limitations)
