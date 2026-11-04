[CmdletBinding()]
param(
  [switch]$KeepStage
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ElectronVersion = "22.3.27"
$SqliteVersion = "8.7.0"
$NodemailerVersion = "6.10.1"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$OutputDirectory = Join-Path $ProjectRoot "release\windows-2012-r2"
$StageDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("mailforge-win2012-" + [Guid]::NewGuid().ToString("N"))

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string[]]$CommandArguments
  )

  Write-Host ("> " + $Executable + " " + ($CommandArguments -join " ")) -ForegroundColor DarkGray
  & $Executable @CommandArguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Executable failed with exit code $LASTEXITCODE."
  }
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw "This build must run on 64-bit Windows because better-sqlite3 is a native dependency."
}

$WindowsArchitecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
if ($WindowsArchitecture -ne "AMD64") {
  throw "This build requires an x64 Windows build machine. Detected architecture: $WindowsArchitecture"
}

foreach ($RequiredCommand in @("node", "npm", "npx", "robocopy")) {
  if (-not (Get-Command $RequiredCommand -ErrorAction SilentlyContinue)) {
    throw "Required command '$RequiredCommand' was not found in PATH."
  }
}

$NodeVersion = (& node -p "process.versions.node").Trim()
if ($LASTEXITCODE -ne 0) {
  throw "Unable to determine the installed Node.js version."
}
$NodeMajor = [int]($NodeVersion.Split(".")[0])
if ($NodeMajor -lt 22) {
  throw "Node.js 22 or newer is required on the build machine. Detected Node.js $NodeVersion."
}

Write-Host "Creating an isolated Windows Server 2012 R2 build..." -ForegroundColor Cyan
Write-Host "Electron $ElectronVersion | better-sqlite3 $SqliteVersion | Nodemailer $NodemailerVersion | x64"
New-Item -ItemType Directory -Path $StageDirectory -Force | Out-Null

try {
  $ExcludedDirectories = @(
    (Join-Path $ProjectRoot ".git"),
    (Join-Path $ProjectRoot "node_modules"),
    (Join-Path $ProjectRoot "dist"),
    (Join-Path $ProjectRoot "dist-electron"),
    (Join-Path $ProjectRoot "release")
  )
  $RobocopyArguments = @(
    $ProjectRoot,
    $StageDirectory,
    "/E",
    "/NFL",
    "/NDL",
    "/NJH",
    "/NJS",
    "/NP",
    "/XD"
  ) + $ExcludedDirectories

  & robocopy @RobocopyArguments
  $RobocopyExitCode = $LASTEXITCODE
  if ($RobocopyExitCode -gt 7) {
    throw "robocopy failed with exit code $RobocopyExitCode."
  }

  $StagePackagePath = Join-Path $StageDirectory "package.json"
  $Package = Get-Content -Raw $StagePackagePath | ConvertFrom-Json
  $Package.devDependencies.electron = $ElectronVersion
  $Package.dependencies."better-sqlite3" = $SqliteVersion
  $Package.dependencies.nodemailer = $NodemailerVersion

  $InstallerArtifactName = '${productName}-${version}-windows-2012-r2-installer-${arch}.${ext}'
  $PortableArtifactName = '${productName}-${version}-windows-2012-r2-portable-${arch}.${ext}'
  if ($Package.build.PSObject.Properties.Name -contains "nsis") {
    if ($Package.build.nsis.PSObject.Properties.Name -contains "artifactName") {
      $Package.build.nsis.artifactName = $InstallerArtifactName
    } else {
      $Package.build.nsis | Add-Member -NotePropertyName "artifactName" -NotePropertyValue $InstallerArtifactName
    }
  } else {
    $Package.build | Add-Member -NotePropertyName "nsis" -NotePropertyValue ([PSCustomObject]@{ artifactName = $InstallerArtifactName })
  }
  if ($Package.build.PSObject.Properties.Name -contains "portable") {
    if ($Package.build.portable.PSObject.Properties.Name -contains "artifactName") {
      $Package.build.portable.artifactName = $PortableArtifactName
    } else {
      $Package.build.portable | Add-Member -NotePropertyName "artifactName" -NotePropertyValue $PortableArtifactName
    }
  } else {
    $Package.build | Add-Member -NotePropertyName "portable" -NotePropertyValue ([PSCustomObject]@{ artifactName = $PortableArtifactName })
  }

  $Package | ConvertTo-Json -Depth 100 | Set-Content -Encoding UTF8 $StagePackagePath

  Push-Location $StageDirectory
  try {
    Write-Host "Installing the isolated legacy dependency set..." -ForegroundColor Cyan
    Invoke-CheckedCommand "npm" @("install", "--package-lock-only", "--ignore-scripts")
    Invoke-CheckedCommand "npm" @("ci")

    Write-Host "Running checks and compiling MailForge..." -ForegroundColor Cyan
    Invoke-CheckedCommand "npm" @("run", "typecheck")
    Invoke-CheckedCommand "npm" @("test")
    Invoke-CheckedCommand "npm" @("run", "build")
    Invoke-CheckedCommand "npm" @("run", "build:electron")

    Write-Host "Building the Windows x64 installer and portable executable..." -ForegroundColor Cyan
    Invoke-CheckedCommand "npx" @(
      "electron-builder",
      "--win",
      "nsis",
      "portable",
      "--x64",
      "--publish",
      "never"
    )
  } finally {
    Pop-Location
  }

  New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
  $Artifacts = Get-ChildItem (Join-Path $StageDirectory "release") -File | Where-Object {
    $_.Extension -in @(".exe", ".blockmap", ".yml")
  }
  if (-not ($Artifacts | Where-Object { $_.Extension -eq ".exe" })) {
    throw "The build completed without producing an .exe file."
  }
  $Artifacts | Copy-Item -Destination $OutputDirectory -Force

  Write-Host ""
  Write-Host "Build complete:" -ForegroundColor Green
  Get-ChildItem $OutputDirectory -File | ForEach-Object {
    Write-Host ("  " + $_.FullName)
  }
  Write-Host ""
  Write-Warning "Electron 22 and Windows Server 2012 R2 are end-of-life. Test both .exe files on a clean Windows Server 2012 R2 Desktop Experience VM before distribution."
} finally {
  if ($KeepStage) {
    Write-Host "Staging directory retained at: $StageDirectory" -ForegroundColor Yellow
  } elseif (Test-Path $StageDirectory) {
    Remove-Item -LiteralPath $StageDirectory -Recurse -Force
  }
}
