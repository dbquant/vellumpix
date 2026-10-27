[CmdletBinding()]
param(
    [string]$ThreadId = ("image-revision-test-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss")),
    [string]$ThreadTitle = "ChatGPT multi-turn image revision test",
    [string]$OutputDirectory = (Join-Path (Get-Location) ("test-output\image-thread-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss"))),
    [string]$InitialPrompt = "Create a cinematic storybook illustration of a canal-side bookstore at dusk. Keep these visual anchors clearly visible: one arched stone bridge, one person holding a red umbrella, and one orange cat sitting beside the bookstore door. No text or watermark.",
    [string[]]$RevisionPrompt = @(
        "Revise the previous image in this same conversation. Preserve the composition, stone bridge, red umbrella, orange cat, and bookstore architecture. Change only the weather and lighting to a rainy night with wet reflections. No text or watermark.",
        "Revise the previous image again. Preserve the same composition and all visual anchors. Change the season to early winter with light snow, while keeping the bridge, red umbrella, orange cat, and bookstore recognizable. No text or watermark.",
        "Make one final revision of the same image. Preserve the scene geometry and every visual anchor. Apply a restrained cinematic color grade with teal shadows and warm amber window light. No text or watermark."
    ),
    [string]$VellumPixCommand = "vellumpix",
    [ValidateRange(1, 60)]
    [int]$BrowserTimeoutMinutes = 12,
    [switch]$ResumeExisting,
    [switch]$PlanOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-VellumPixHome {
    if (-not [string]::IsNullOrWhiteSpace($env:VELLUMPIX_HOME_DIR)) {
        return [System.IO.Path]::GetFullPath($env:VELLUMPIX_HOME_DIR)
    }

    $userProfile = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
    return Join-Path $userProfile ".vellumpix"
}

function Assert-ThreadId {
    param([Parameter(Mandatory = $true)][string]$Value)

    if ($Value -notmatch "^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$") {
        throw "ThreadId must contain 1-64 lowercase letters, digits, or hyphens, and cannot start or end with a hyphen."
    }
}

function Read-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Expected JSON file was not created: $Path"
    }

    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Get-OptionalProperty {
    param(
        [Parameter(Mandatory = $true)][object]$InputObject,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }
    return $property.Value
}

function Invoke-VellumPix {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    Write-Host ("`n> {0} {1}" -f $VellumPixCommand, ($Arguments -join " ")) -ForegroundColor Cyan
    & $VellumPixCommand @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "VellumPix exited with code $LASTEXITCODE."
    }
}

function Test-ImageFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Expected image was not created: $Path"
    }

    $item = Get-Item -LiteralPath $Path
    if ($item.Length -le 1024) {
        throw "Image is unexpectedly small ($($item.Length) bytes): $Path"
    }

    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $header = New-Object byte[] 12
        $read = $stream.Read($header, 0, $header.Length)
    }
    finally {
        $stream.Dispose()
    }

    $isPng = $read -ge 8 -and $header[0] -eq 0x89 -and $header[1] -eq 0x50 -and $header[2] -eq 0x4E -and $header[3] -eq 0x47
    $isJpeg = $read -ge 3 -and $header[0] -eq 0xFF -and $header[1] -eq 0xD8 -and $header[2] -eq 0xFF
    $isWebP = $read -ge 12 -and [Text.Encoding]::ASCII.GetString($header, 0, 4) -eq "RIFF" -and [Text.Encoding]::ASCII.GetString($header, 8, 4) -eq "WEBP"

    if (-not ($isPng -or $isJpeg -or $isWebP)) {
        throw "File does not have a PNG, JPEG, or WebP signature: $Path"
    }

    return $item.Length
}

function Get-BrowserWindowSnapshot {
    param(
        [Parameter(Mandatory = $true)][string]$BrowserHost,
        [Parameter(Mandatory = $true)][int]$BrowserPort
    )

    $inspectorPath = Join-Path $PSScriptRoot "inspect-browser-windows.mjs"
    if (-not (Test-Path -LiteralPath $inspectorPath -PathType Leaf)) {
        throw "Browser window inspector was not found: $inspectorPath"
    }

    $json = & node $inspectorPath --host $BrowserHost --port $BrowserPort
    if ($LASTEXITCODE -ne 0) {
        throw "Browser window inspector exited with code $LASTEXITCODE."
    }
    return ($json -join "`n") | ConvertFrom-Json
}

function Find-LiveBrowserEndpoint {
    param([Parameter(Mandatory = $true)][string]$VellumPixHome)

    $sessionsRoot = Join-Path $VellumPixHome "sessions"
    if (-not (Test-Path -LiteralPath $sessionsRoot -PathType Container)) {
        return $null
    }

    $checkedEndpoints = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $metadataFiles = @(Get-ChildItem -LiteralPath $sessionsRoot -Filter "meta.json" -Recurse -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
    foreach ($metadataFile in $metadataFiles) {
        try {
            $metadata = Read-JsonFile -Path $metadataFile.FullName
            $runtime = $metadata.browser.runtime
            $browserPortValue = Get-OptionalProperty -InputObject $runtime -Name "chromePort"
            if ($null -eq $browserPortValue) {
                continue
            }
            $browserHostValue = [string](Get-OptionalProperty -InputObject $runtime -Name "chromeHost")
            if ([string]::IsNullOrWhiteSpace($browserHostValue)) {
                $browserHostValue = "127.0.0.1"
            }
            $endpointKey = "${browserHostValue}:$browserPortValue"
            if (-not $checkedEndpoints.Add($endpointKey)) {
                continue
            }
            $snapshot = Get-BrowserWindowSnapshot -BrowserHost $browserHostValue -BrowserPort ([int]$browserPortValue)
            if ($snapshot.available -eq $true) {
                return [pscustomobject]@{
                    Host = $browserHostValue
                    Port = [int]$browserPortValue
                    Snapshot = $snapshot
                }
            }
        }
        catch {
            continue
        }
    }
    return $null
}

Assert-ThreadId -Value $ThreadId
if ([string]::IsNullOrWhiteSpace($InitialPrompt)) {
    throw "InitialPrompt cannot be empty."
}
if ($RevisionPrompt.Count -eq 0 -or @($RevisionPrompt | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -gt 0) {
    throw "RevisionPrompt must contain at least one non-empty prompt."
}

$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
$allPrompts = @($InitialPrompt) + @($RevisionPrompt)
$plannedRounds = for ($index = 0; $index -lt $allPrompts.Count; $index++) {
    [pscustomobject]@{
        Number = $index + 1
        Prompt = $allPrompts[$index]
        ImagePath = Join-Path $outputRoot ("round-{0:D2}.png" -f ($index + 1))
    }
}

if ($PlanOnly) {
    Write-Host "PLAN ONLY - no browser will open and no prompt will be submitted." -ForegroundColor Yellow
    Write-Host "Browser mode: headful no-focus; reuse an existing browser window when one is live, then reuse one target after the first round"
    Write-Host "Thread: $ThreadId"
    Write-Host "Output: $outputRoot"
    foreach ($round in $plannedRounds) {
        Write-Host ("[{0:D2}] {1}" -f $round.Number, $round.ImagePath)
        Write-Host ("     {0}" -f $round.Prompt)
    }
    return
}

if (-not (Get-Command $VellumPixCommand -ErrorAction SilentlyContinue)) {
    throw "Cannot find VellumPix command: $VellumPixCommand"
}

$vellumpixHome = Resolve-VellumPixHome
$baselineEndpoint = Find-LiveBrowserEndpoint -VellumPixHome $vellumpixHome
$baselineWindowIds = @()
if ($null -ne $baselineEndpoint) {
    $baselineWindowIds = @($baselineEndpoint.Snapshot.targets | ForEach-Object { [string]$_.windowId } | Sort-Object -Unique)
    Write-Host ("Detected {0} existing browser window(s) on {1}:{2}; round 1 must reuse one of them." -f $baselineWindowIds.Count, $baselineEndpoint.Host, $baselineEndpoint.Port) -ForegroundColor DarkCyan
}
$threadJsonPath = Join-Path $vellumpixHome ("threads\{0}\thread.json" -f $ThreadId)
$threadExists = Test-Path -LiteralPath $threadJsonPath -PathType Leaf
if ($threadExists -and -not $ResumeExisting) {
    throw "Thread '$ThreadId' already exists. Use a new ThreadId, or pass -ResumeExisting deliberately."
}
if (-not $threadExists -and $ResumeExisting) {
    throw "Thread '$ThreadId' does not exist, so it cannot be resumed."
}

if (Test-Path -LiteralPath $outputRoot) {
    if (@(Get-ChildItem -LiteralPath $outputRoot -Force).Count -gt 0) {
        throw "OutputDirectory is not empty: $outputRoot"
    }
}
else {
    New-Item -ItemType Directory -Path $outputRoot | Out-Null
}

if (-not $threadExists) {
    Invoke-VellumPix -Arguments @("thread", "create", $ThreadId, "--title", $ThreadTitle, "--tag", "image", "live-test")
}

$expectedConversationId = $null
$expectedTargetId = $null
$expectedWindowId = $null
$sharedWindowBaselineDetected = $baselineWindowIds.Count -gt 0
$sharedWindowReuseVerified = $null
$previousSessionId = $null
$results = @()

if ($ResumeExisting) {
    $existingThread = Read-JsonFile -Path $threadJsonPath
    $existingSessionIds = @($existingThread.sessionIds)
    for ($index = $existingSessionIds.Count - 1; $index -ge 0; $index--) {
        $candidateId = [string]$existingSessionIds[$index]
        $candidatePath = Join-Path $vellumpixHome ("sessions\{0}\meta.json" -f $candidateId)
        if (-not (Test-Path -LiteralPath $candidatePath -PathType Leaf)) {
            continue
        }
        $candidate = Read-JsonFile -Path $candidatePath
        $candidateConversationId = [string](Get-OptionalProperty -InputObject $candidate.browser.runtime -Name "conversationId")
        if ([string]$candidate.status -eq "completed" -and -not [string]::IsNullOrWhiteSpace($candidateConversationId)) {
            $expectedConversationId = $candidateConversationId
            $previousSessionId = $candidateId
            break
        }
    }
    if ($null -eq $expectedConversationId) {
        throw "Thread '$ThreadId' has no completed session with a recoverable ChatGPT conversation."
    }
}

foreach ($round in $plannedRounds) {
    Write-Host ("`n=== Round {0}/{1} ===" -f $round.Number, $plannedRounds.Count) -ForegroundColor Green
    Invoke-VellumPix -Arguments @(
        "--thread", $ThreadId,
        "--engine", "browser",
        "--browser-keep-browser",
        "--browser-no-focus",
        "--browser-archive", "never",
        "--browser-timeout", ("{0}m" -f $BrowserTimeoutMinutes),
        "--generate-image", $round.ImagePath,
        "--prompt", $round.Prompt
    )

    $thread = Read-JsonFile -Path $threadJsonPath
    $sessionId = [string]$thread.headSessionId
    if ([string]::IsNullOrWhiteSpace($sessionId)) {
        throw "Thread '$ThreadId' has no headSessionId after round $($round.Number)."
    }

    $metaPath = Join-Path $vellumpixHome ("sessions\{0}\meta.json" -f $sessionId)
    $meta = Read-JsonFile -Path $metaPath
    if ([string]$meta.status -ne "completed") {
        throw "Session '$sessionId' ended with status '$($meta.status)'."
    }
    if ($meta.browser.runtime.promptSubmitted -ne $true) {
        throw "Session '$sessionId' did not record promptSubmitted=true."
    }
    if ($meta.browser.config.noFocus -ne $true) {
        throw "Session '$sessionId' did not run with noFocus=true."
    }

    $conversationId = [string]$meta.browser.runtime.conversationId
    if ([string]::IsNullOrWhiteSpace($conversationId)) {
        throw "Session '$sessionId' did not record a ChatGPT conversationId."
    }
    if ($null -eq $expectedConversationId) {
        $expectedConversationId = $conversationId
    }
    elseif ($conversationId -ne $expectedConversationId) {
        throw "Conversation changed at round $($round.Number): expected '$expectedConversationId', got '$conversationId'."
    }

    $targetId = [string]$meta.browser.runtime.chromeTargetId
    if ([string]::IsNullOrWhiteSpace($targetId)) {
        throw "Session '$sessionId' did not record a Chrome/Edge target id."
    }
    if ($null -eq $expectedTargetId) {
        $expectedTargetId = $targetId
    }
    elseif ($targetId -ne $expectedTargetId) {
        throw "Browser target changed at round $($round.Number): expected '$expectedTargetId', got '$targetId'."
    }

    $browserHost = [string](Get-OptionalProperty -InputObject $meta.browser.runtime -Name "chromeHost")
    if ([string]::IsNullOrWhiteSpace($browserHost)) {
        $browserHost = "127.0.0.1"
    }
    $browserPort = [int](Get-OptionalProperty -InputObject $meta.browser.runtime -Name "chromePort")
    $windowSnapshot = Get-BrowserWindowSnapshot -BrowserHost $browserHost -BrowserPort $browserPort
    if ($windowSnapshot.available -ne $true) {
        throw "Cannot inspect browser windows after round $($round.Number): $($windowSnapshot.error)"
    }
    $targetWindow = @($windowSnapshot.targets | Where-Object { [string]$_.targetId -eq $targetId }) | Select-Object -First 1
    if ($null -eq $targetWindow) {
        throw "Browser target '$targetId' is not live after round $($round.Number)."
    }
    $windowId = [string]$targetWindow.windowId
    if ([string]::IsNullOrWhiteSpace($windowId)) {
        throw "Browser target '$targetId' did not resolve to a browser window after round $($round.Number)."
    }
    if ($null -eq $expectedWindowId) {
        $expectedWindowId = $windowId
        if ($sharedWindowBaselineDetected) {
            $sameEndpoint = $browserHost -eq $baselineEndpoint.Host -and $browserPort -eq $baselineEndpoint.Port
            if (-not $sameEndpoint) {
                Write-Warning "The browser endpoint changed before round 1; existing-window reuse cannot be verified."
                $sharedWindowReuseVerified = $null
            }
            elseif ($baselineWindowIds -notcontains $windowId) {
                throw "Round 1 opened browser window '$windowId' instead of reusing an existing window ($($baselineWindowIds -join ', '))."
            }
            else {
                $sharedWindowReuseVerified = $true
            }
        }
    }
    elseif ($windowId -ne $expectedWindowId) {
        throw "Browser window changed at round $($round.Number): expected '$expectedWindowId', got '$windowId'."
    }

    $parentSessionId = [string](Get-OptionalProperty -InputObject $meta.options -Name "followupSessionId")
    if ($null -ne $previousSessionId -and $parentSessionId -ne $previousSessionId) {
        throw "Session lineage broke at round $($round.Number): expected parent '$previousSessionId', got '$parentSessionId'."
    }

    $imageBytes = Test-ImageFile -Path $round.ImagePath
    $imageArtifacts = @($meta.artifacts | Where-Object { $_.kind -eq "image" })
    if ($imageArtifacts.Count -eq 0) {
        throw "Session '$sessionId' completed without a saved image artifact."
    }

    $results += [pscustomobject]@{
        round = $round.Number
        sessionId = $sessionId
        parentSessionId = if ([string]::IsNullOrWhiteSpace($parentSessionId)) { $null } else { $parentSessionId }
        conversationId = $conversationId
        browserTargetId = $targetId
        browserWindowId = $windowId
        targetReused = if ($round.Number -eq 1) { $null } else { $true }
        windowReused = if ($round.Number -eq 1) { $sharedWindowReuseVerified } else { $true }
        noFocus = $true
        prompt = $round.Prompt
        imagePath = $round.ImagePath
        imageBytes = $imageBytes
        imageArtifactCount = $imageArtifacts.Count
    }
    $previousSessionId = $sessionId
}

$summaryPath = Join-Path $outputRoot "summary.json"
$summary = [ordered]@{
    passed = $true
    testedAt = (Get-Date).ToUniversalTime().ToString("o")
    threadId = $ThreadId
    conversationId = $expectedConversationId
    browserTargetId = $expectedTargetId
    browserWindowId = $expectedWindowId
    browserMode = "headful-no-focus"
    sharedWindowBaselineDetected = $sharedWindowBaselineDetected
    sharedWindowReuseVerified = $sharedWindowReuseVerified
    outputDirectory = $outputRoot
    rounds = $results
}
$summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $summaryPath -Encoding UTF8

Write-Host "`nPASS: all rounds used the same ChatGPT conversation, browser target, and browser window; no-focus mode stayed enabled and every image file was valid." -ForegroundColor Green
Write-Host "Thread: $ThreadId"
Write-Host "Conversation: $expectedConversationId"
Write-Host "Browser target: $expectedTargetId"
Write-Host "Browser window: $expectedWindowId"
Write-Host "Summary: $summaryPath"
