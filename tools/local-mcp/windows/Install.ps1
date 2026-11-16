param(
    [string]$MkbShortcut,
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'MarkdownKnowledgeBoard'),
    [string]$DesktopDirectory = [Environment]::GetFolderPath('DesktopDirectory'),
    [switch]$SkipMcpRegistration
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop') { throw 'Use Windows PowerShell 5.1 (powershell.exe).' }
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$source = Join-Path $PSScriptRoot 'tools/local-mcp'
$nodePath = [IO.Path]::GetFullPath((Get-Command node.exe -ErrorAction Stop).Source)
$npmPath = Join-Path (Split-Path $nodePath) 'npm.cmd'
if (-not (Test-Path -LiteralPath $npmPath)) { throw 'Install Node.js with npm, then reopen this window.' }
$nodeMajor = & $nodePath -p 'process.versions.node.match(/^[0-9]+/)[0]'
if ($LASTEXITCODE -ne 0 -or [int]$nodeMajor -lt 24) { throw 'Node.js 24 or newer is required.' }
if (-not (Test-Path -LiteralPath $DesktopDirectory -PathType Container)) { throw 'Desktop folder was not found.' }

# Check the packaged files before loading the shortcut helper or installing anything.
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') -Raw | ConvertFrom-Json
foreach ($entry in $manifest.files) {
    $file = Join-Path $PSScriptRoot $entry.path
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $hash = [BitConverter]::ToString($hasher.ComputeHash([IO.File]::ReadAllBytes($file))).Replace('-', '').ToLowerInvariant() }
    finally { $hasher.Dispose() }
    if ($hash -ne $entry.sha256) { throw ('Package file changed: ' + $entry.path) }
}

# Validate all prerequisites before installing or changing the Codex registration.
Add-Type -Path (Join-Path $source 'WindowsShortcut.cs')
if (-not $MkbShortcut) {
    $candidates = @(Get-ChildItem -LiteralPath ([Environment]::GetFolderPath('StartMenu')) -Recurse -Filter 'Markdown Knowledge Board.lnk' -ErrorAction SilentlyContinue)
    if ($candidates.Count -ne 1) { throw 'Install the MKB PWA, or specify its shortcut with -MkbShortcut.' }
    $MkbShortcut = $candidates[0].FullName
}
$MkbShortcut = (Resolve-Path -LiteralPath $MkbShortcut).Path
if (-not (Test-Path -LiteralPath ([MkbWindowsShortcut]::Read($MkbShortcut).TargetPath) -PathType Leaf)) { throw 'MKB PWA launcher was not found.' }
$launcher = Join-Path $InstallRoot 'start-mcp.mjs'
$codex = $null
$existing = $null
if (-not $SkipMcpRegistration) {
    $codex = (Get-Command codex -ErrorAction Stop).Source
    $registrations = & $codex mcp list --json
    if ($LASTEXITCODE -ne 0) { throw 'Could not read Codex MCP settings. No registration was changed.' }
    $registrationList = ConvertFrom-Json -InputObject ($registrations -join "`n")
    $existing = $registrationList | Where-Object { $_.name -eq 'mkb_local_prototype' }
    if ($existing -and ($existing.transport.command -ne $nodePath -or
        @($existing.transport.args).Count -ne 1 -or $existing.transport.args[0] -ne $launcher)) {
        throw 'mkb_local_prototype already points to another installation. Use -SkipMcpRegistration and follow README.md to migrate it explicitly.'
    }
}

# Never copy this PC's pairing or browser data into the runtime.
Push-Location -LiteralPath $source
try {
    $stateDirectory = & $nodePath --input-type=module -e "import {stateDirectory} from './identity.mjs'; process.stdout.write(stateDirectory());"
    if ($LASTEXITCODE -ne 0) { throw 'Could not locate pairing settings.' }
} finally { Pop-Location }
$stateDirectory = [IO.Path]::GetFullPath($stateDirectory)

# Keep the old runtime until the new one is installed. Existing pairing stays outside runtimes.
$runtimeId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$runtimeRoot = Join-Path $InstallRoot ('runtimes/' + $runtimeId)
$runtime = Join-Path $runtimeRoot 'tools/local-mcp'
[void](New-Item -ItemType Directory -Path $runtime -Force)
foreach ($entry in $manifest.files | Where-Object { $_.path.StartsWith('tools/local-mcp/') }) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $entry.path) -Destination $runtime
}
& $npmPath ci --prefix $runtime --omit=dev --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Existing registration and pairing were not changed. Check network access and rerun setup.' }

& (Join-Path $runtime 'install-connection-setup.ps1') -MkbShortcut $MkbShortcut -InstallDirectory (Join-Path $InstallRoot 'ConnectionSetup') -DesktopDirectory $DesktopDirectory -NodePath $nodePath -StateDirectory $stateDirectory

$serverUri = ([Uri](Join-Path $runtime 'server.mjs')).AbsoluteUri | ConvertTo-Json -Compress
$stateJson = $stateDirectory | ConvertTo-Json -Compress
$launcherText = "process.env.MKB_MCP_DEV = '0';`nprocess.env.MKB_MCP_STATE_DIR = $stateJson;`nawait import($serverUri);`n"
$temporaryLauncher = Join-Path $InstallRoot ('start-mcp-' + [guid]::NewGuid().ToString('N') + '.tmp')
[IO.File]::WriteAllText($temporaryLauncher, $launcherText, (New-Object Text.UTF8Encoding($false)))
if (Test-Path -LiteralPath $launcher) { [IO.File]::Replace($temporaryLauncher, $launcher, (Join-Path $InstallRoot 'start-mcp.previous.mjs')) }
else { [IO.File]::Move($temporaryLauncher, $launcher) }

# JSON-escaped forward-slash paths are also valid TOML basic strings.
$nodeToml = $nodePath.Replace('\', '/') | ConvertTo-Json -Compress
$launcherToml = $launcher.Replace('\', '/') | ConvertTo-Json -Compress
$configText = "[mcp_servers.mkb_local_prototype]`ncommand = $nodeToml`nargs = [$launcherToml]`nstartup_timeout_sec = 60`ntool_timeout_sec = 30`nenabled = true`n"
[IO.File]::WriteAllText((Join-Path $InstallRoot 'codex-mcp.toml'), $configText, (New-Object Text.UTF8Encoding($false)))
if (-not $SkipMcpRegistration -and -not $existing) {
    & $codex mcp add mkb_local_prototype -- $nodePath $launcher
    if ($LASTEXITCODE -ne 0) { throw 'Files installed, but MCP registration failed. Use codex-mcp.toml as described in README.md.' }
}
Write-Output 'Setup complete.'
if ($SkipMcpRegistration) { Write-Output ('Register MCP using: ' + (Join-Path $InstallRoot 'codex-mcp.toml')) }
Write-Output 'Restart Codex. Open MKB Connection Setup from your desktop.'
