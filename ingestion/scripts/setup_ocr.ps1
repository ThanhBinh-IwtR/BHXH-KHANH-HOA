[CmdletBinding()]
param(
    [string]$CondaCommand
)

$ErrorActionPreference = "Stop"
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$installPrefix = Join-Path $workspaceRoot ".tools\tesseract"
$expectedTesseractVersion = "5.5.2"
$tessdataBaseUrl = "https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/4.1.0"
# Hashes were computed from the immutable official 4.1.0 tag and its files'
# SHA-512 values were cross-checked against Gentoo manifest commit 87d7216.
$trainedDataSha256 = @{
    vie = "B6B49293D95D0B6DBD8780174627E82C75BE957B6F4ED9862155540D6B00BB45"
    eng = "8280AED0782FE27257A68EA10FE7EF324CA0F8D85BD2FD145D1C2B560BCB66BA"
}

$tesseractCommand = Join-Path $installPrefix "Library\bin\tesseract.exe"
if (-not (Test-Path -LiteralPath $tesseractCommand -PathType Leaf)) {
    if (-not $CondaCommand) {
        $resolvedConda = Get-Command conda.bat, conda.exe, conda -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($resolvedConda) {
            $CondaCommand = $resolvedConda.Source
        }
        elseif ($env:USERPROFILE) {
            $knownLocalConda = Join-Path $env:USERPROFILE "anaconda3\Library\bin\conda.bat"
            if (Test-Path -LiteralPath $knownLocalConda -PathType Leaf) {
                $CondaCommand = $knownLocalConda
            }
        }
    }
    if (-not $CondaCommand -or -not (Test-Path -LiteralPath $CondaCommand -PathType Leaf)) {
        throw "Conda executable not found. Pass -CondaCommand with a valid local path."
    }
    # Conda 23.x otherwise writes Unicode workspace paths through the legacy
    # Windows code page and fails before the package transaction begins.
    $env:PYTHONIOENCODING = "utf-8"
    & $CondaCommand create --prefix $installPrefix --channel conda-forge --override-channels "tesseract=5.5.2" --yes
    if ($LASTEXITCODE -ne 0) {
        throw "Conda failed to install workspace-local Tesseract"
    }
    if (-not (Test-Path -LiteralPath $tesseractCommand -PathType Leaf)) {
        throw "Tesseract executable was not created: $tesseractCommand"
    }
}

$versionOutput = & $tesseractCommand --version 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Unable to determine Tesseract version: $versionOutput"
}
$versionLine = [string]@($versionOutput)[0]
if ($versionLine -notmatch '^tesseract 5\.5\.2(?:\s|$)') {
    throw "Expected tesseract 5.5.2 but found: $versionLine"
}

$tessdataDirectory = Join-Path $installPrefix "tessdata_best"
New-Item -ItemType Directory -Path $tessdataDirectory -Force | Out-Null
foreach ($language in @("vie", "eng")) {
    $trainedData = Join-Path $tessdataDirectory "$language.traineddata"
    $isVerified = (Test-Path -LiteralPath $trainedData -PathType Leaf) -and
        ((Get-FileHash -LiteralPath $trainedData -Algorithm SHA256).Hash -eq $trainedDataSha256[$language])
    if (-not $isVerified) {
        $download = "$trainedData.download"
        Invoke-WebRequest -Uri "$tessdataBaseUrl/$language.traineddata" -OutFile $download
        $actualHash = (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash
        if ($actualHash -ne $trainedDataSha256[$language]) {
            Remove-Item -LiteralPath $download
            throw "SHA-256 verification failed for $language.traineddata"
        }
        Move-Item -LiteralPath $download -Destination $trainedData -Force
    }
}

$previousLocation = Get-Location
try {
    Set-Location -LiteralPath $tessdataDirectory
    $languages = & $tesseractCommand --tessdata-dir . --list-langs 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to list installed Tesseract languages: $languages"
    }
}
finally {
    Set-Location -LiteralPath $previousLocation
}
foreach ($language in @("vie", "eng")) {
    if ($languages -notcontains $language) {
        throw "Missing required Tesseract language: $language"
    }
}

Write-Output "TESSERACT_CMD=$tesseractCommand"
Write-Output "TESSDATA_PREFIX=$tessdataDirectory"
Write-Output "Verified Tesseract version: $expectedTesseractVersion"
Write-Output "Verified Tesseract languages: vie, eng"
