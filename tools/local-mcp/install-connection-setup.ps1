param(
    [string]$MkbShortcut,
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'MarkdownKnowledgeBoard/ConnectionSetup'),
    [string]$DesktopDirectory = [Environment]::GetFolderPath('DesktopDirectory'),
    [string]$NodePath = (Get-Command node.exe -ErrorAction Stop).Source,
    [string]$StateDirectory
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop') { throw 'Run this installer with Windows PowerShell 5.1 (powershell.exe).' }
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

$installDirectory = [IO.Path]::GetFullPath($InstallDirectory)
$desktopShortcut = Join-Path $DesktopDirectory 'MKB Connection Setup.lnk'
$applicationPath = Join-Path $installDirectory 'MKBConnectionSetup.exe'
if (-not ('MkbWindowsShortcut' -as [type])) { Add-Type -Path (Join-Path $PSScriptRoot 'WindowsShortcut.cs') }
if (-not $MkbShortcut) {
    $candidates = @(Get-ChildItem -LiteralPath ([Environment]::GetFolderPath('StartMenu')) -Recurse -Filter 'Markdown Knowledge Board.lnk' -ErrorAction SilentlyContinue)
    if ($candidates.Count -ne 1) { throw 'Specify the installed MKB PWA shortcut with -MkbShortcut.' }
    $MkbShortcut = $candidates[0].FullName
}
if (-not (Test-Path -LiteralPath $MkbShortcut -PathType Leaf)) { throw 'The MKB PWA shortcut was not found.' }
$MkbShortcut = (Resolve-Path -LiteralPath $MkbShortcut).Path
$pwaLink = [MkbWindowsShortcut]::Read($MkbShortcut)
if (-not (Test-Path -LiteralPath $pwaLink.TargetPath -PathType Leaf)) { throw 'The MKB PWA launcher was not found.' }
if (Test-Path -LiteralPath $desktopShortcut) {
    $existing = [MkbWindowsShortcut]::Read($desktopShortcut)
    $isPreviousScript = $existing.Arguments.Contains((Join-Path $installDirectory 'connection-setup.ps1'))
    if ($existing.TargetPath -ne $applicationPath -and -not $isPreviousScript) {
        throw 'A different desktop shortcut already uses this name. Nothing was overwritten.'
    }
}

# Resolve the same identity location used by the MCP, without reading or copying its secrets.
if (-not $StateDirectory) {
    Push-Location -LiteralPath $PSScriptRoot
    try {
        $StateDirectory = & $NodePath --input-type=module -e "import {stateDirectory} from './identity.mjs'; process.stdout.write(stateDirectory());"
        if ($LASTEXITCODE -ne 0 -or -not $StateDirectory) { throw 'Could not locate connection settings.' }
    } finally { Pop-Location }
}
$stateDirectory = [IO.Path]::GetFullPath($StateDirectory)
[void](New-Item -ItemType Directory -Path $installDirectory -Force)
foreach ($file in @('setup-code.mjs', 'identity.mjs')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $installDirectory $file) -Force
}
$buildPath = Join-Path $installDirectory ('setup-build-' + [guid]::NewGuid().ToString('N') + '.exe')
Add-Type -Path (Join-Path $PSScriptRoot 'ConnectionSetup.cs') -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions -OutputAssembly $buildPath -OutputType WindowsApplication
Move-Item -LiteralPath $buildPath -Destination $applicationPath -Force
@{ nodePath = $nodePath; stateDirectory = $stateDirectory; mkbShortcut = $MkbShortcut } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $installDirectory 'setup-config.json') -Encoding UTF8
$iconPath = $pwaLink.IconLocation
if ($iconPath -and (Test-Path -LiteralPath $iconPath -PathType Leaf)) {
    Copy-Item -LiteralPath $iconPath -Destination (Join-Path $installDirectory 'mkb.ico') -Force
}
$installedIcon = Join-Path $installDirectory 'mkb.ico'
$shortcutIcon = if (Test-Path -LiteralPath $installedIcon) { $installedIcon } else { $applicationPath }
[MkbWindowsShortcut]::Write($desktopShortcut, $applicationPath, '', $installDirectory, 'Copy your connection code and open MKB.', $shortcutIcon)
Write-Output ('Installed: ' + $desktopShortcut)
