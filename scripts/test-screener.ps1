param(
  [string]$BaseUrl = "http://127.0.0.1:4173",
  [string]$AdminUser = "admin",
  [string]$AdminPassword = "admin123",
  [int]$WarmupTimeoutSec = 180,
  [int]$PerfIterations = 5,
  [switch]$IncludeCrashRecovery,
  [switch]$Json,
  [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Results = New-Object System.Collections.Generic.List[object]
$Session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$SavedScreenerView = $null
$LoggedIn = $false

function Add-Result {
  param([string]$Area, [string]$Test, [string]$Status, [string]$Detail = "", [double]$Ms = 0, [string]$Priority = "P0")
  $Results.Add([pscustomobject]@{
    Area = $Area
    Test = $Test
    Status = $Status
    Detail = $Detail
    Ms = [math]::Round($Ms, 0)
    Priority = $Priority
  }) | Out-Null
}

function Invoke-Timed {
  param([string]$Area, [string]$Test, [scriptblock]$Block, [string]$Priority = "P0")
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $detail = & $Block
    $sw.Stop()
    Add-Result $Area $Test "PASS" ([string]$detail) $sw.Elapsed.TotalMilliseconds $Priority
  } catch {
    $sw.Stop()
    Add-Result $Area $Test "FAIL" $_.Exception.Message $sw.Elapsed.TotalMilliseconds $Priority
  }
}

function Invoke-Json {
  param([string]$Path, [string]$Method = "GET", [object]$Body = $null, [switch]$NoSession)
  $params = @{
    Uri = "$BaseUrl$Path"
    Method = $Method
    TimeoutSec = 60
    ErrorAction = "Stop"
  }
  if (-not $NoSession) { $params.WebSession = $Session }
  if ($null -ne $Body) {
    $params.ContentType = "application/json"
    $params.Body = ($Body | ConvertTo-Json -Depth 20)
  }
  Invoke-RestMethod @params
}

function Invoke-WebStatus {
  param([string]$Path, [string]$Method = "GET", [object]$Body = $null, [switch]$NoSession)
  try {
    $params = @{
      Uri = "$BaseUrl$Path"
      Method = $Method
      TimeoutSec = 60
      ErrorAction = "Stop"
    }
    if (-not $NoSession) { $params.WebSession = $Session }
    if ($null -ne $Body) {
      $params.ContentType = "application/json"
      $params.Body = ($Body | ConvertTo-Json -Depth 20)
    }
    $response = Invoke-WebRequest @params
    return [pscustomobject]@{ StatusCode = [int]$response.StatusCode; Body = $response.Content }
  } catch {
    if ($_.Exception.Response) {
      return [pscustomobject]@{ StatusCode = [int]$_.Exception.Response.StatusCode; Body = $_.ErrorDetails.Message }
    }
    throw
  }
}

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Assert-Ordered {
  param([array]$Rows, [string]$Field, [string]$Direction)
  $values = @($Rows | ForEach-Object { $_.$Field } | Where-Object { $_ -ne $null -and $_ -ne "" } | ForEach-Object { [double]$_ })
  if ($values.Count -lt 2) { return "insufficient comparable values" }
  for ($i = 1; $i -lt $values.Count; $i++) {
    if ($Direction -eq "desc" -and $values[$i] -gt $values[$i - 1]) { throw "$Field not desc at $i" }
    if ($Direction -eq "asc" -and $values[$i] -lt $values[$i - 1]) { throw "$Field not asc at $i" }
  }
  return "$($values.Count) comparable values sorted $Direction"
}

function Wait-ScreenerCacheReady {
  $deadline = (Get-Date).AddSeconds($WarmupTimeoutSec)
  do {
    $status = Invoke-Json "/api/screener/cache/status"
    if (-not $status.warming) { return $status }
    Start-Sleep -Seconds 5
  } while ((Get-Date) -lt $deadline)
  throw "cache still warming after $WarmupTimeoutSec seconds"
}

try {
  Invoke-Timed "Technical" "server.js syntax" {
    Push-Location $Root
    try { node --check server.js | Out-Null } finally { Pop-Location }
    "node --check passed"
  }

  Invoke-Timed "Technical" "workspace.js syntax" {
    Push-Location $Root
    try { node --check src\workspace.js | Out-Null } finally { Pop-Location }
    "node --check passed"
  }

  Invoke-Timed "Functional" "index served" {
    $r = Invoke-WebRequest -Uri "$BaseUrl/" -TimeoutSec 30 -UseBasicParsing
    Assert-True ($r.StatusCode -eq 200) "HTTP $($r.StatusCode)"
    Assert-True ($r.Content -match 'id="app"') "app root missing"
    "HTTP 200 with app root"
  }

  Invoke-Timed "Technical" "module cache bust version" {
    $main = Invoke-WebRequest -Uri "$BaseUrl/src/main.js" -TimeoutSec 30 -UseBasicParsing
    Assert-True ($main.Content -match 'workspace\.js\?v=20260627a') "main.js is not pointing at workspace.js?v=20260627a"
    "workspace.js?v=20260627a"
  } "P1"

  Invoke-Timed "Security" "screener API rejects unauthenticated request" {
    $r = Invoke-WebStatus "/api/screener/query?limit=1" -NoSession
    Assert-True ($r.StatusCode -ne 200) "unauthenticated screener query returned 200"
    "HTTP $($r.StatusCode)"
  }

  Invoke-Timed "Auth" "admin login" {
    $login = Invoke-Json "/api/auth/login" "POST" @{ username = $AdminUser; password = $AdminPassword }
    Assert-True ($login.user.username -eq $AdminUser) "unexpected login user"
    $script:LoggedIn = $true
    "role=$($login.user.role)"
  }

  Invoke-Timed "Technical" "cache status ready or warms successfully" {
    $status = Wait-ScreenerCacheReady
    "status=$($status.status), store=$($status.store), latest=$($status.latestDate), rows=$($status.rowCount)"
  }

  $query = $null
  Invoke-Timed "Functional" "recommended screener query returns enhanced rows" {
    $script:query = Invoke-Json "/api/screener/query?minRs=90&minPrice=12&minVolume=100000&limit=120&sort=rs_score&sortDir=desc"
    Assert-True ($script:query.rows.Count -gt 0) "no screener rows returned"
    $row = @($script:query.rows)[0]
    $required = @("dcr","wcr","rv20","ud_50d","c20","rmv","rmv_zone","rs_score","trend_score","tqs_score","es_score","brs_score","bbs_score","cs_score","vcp_score","cheat_entry_score","breakout_score","momentum_burst_score","accumulation_score","dollar_volume")
    foreach ($field in $required) { Assert-True ($row.PSObject.Properties.Name -contains $field) "missing $field" }
    "$($script:query.count) rows, latest=$($script:query.cache.displayDate)"
  }

  Invoke-Timed "Functional" "screener query supports lazy pagination" {
    $first = Invoke-Json "/api/screener/query?rs250=0&limit=25&offset=0&sort=rs_rank&sortDir=asc"
    $second = Invoke-Json "/api/screener/query?rs250=0&limit=25&offset=25&sort=rs_rank&sortDir=asc"
    Assert-True ($first.rows.Count -le 25) "first page exceeded requested limit"
    Assert-True ($second.rows.Count -le 25) "second page exceeded requested limit"
    Assert-True ([int]$first.total -ge [int]$first.count) "total should be at least page count"
    Assert-True ([int]$second.offset -eq 25) "second page offset was not preserved"
    $firstSymbols = @($first.rows | ForEach-Object { $_.symbol })
    $secondSymbols = @($second.rows | ForEach-Object { $_.symbol })
    Assert-True ((Compare-Object $firstSymbols $secondSymbols -IncludeEqual -ExcludeDifferent).Count -eq 0) "pagination returned duplicate symbol set"
    "page1=$($first.count), page2=$($second.count), total=$($first.total), hasMore=$($first.hasMore)"
  }

  Invoke-Timed "Functional" "RS score desc sort" {
    $q = Invoke-Json "/api/screener/query?minRs=90&minPrice=12&minVolume=100000&limit=50&sort=rs_score&sortDir=desc"
    Assert-Ordered @($q.rows) "rs_score" "desc"
  }
  Invoke-Timed "Functional" "default RS250 filter returns ranked universe" {
    $q = Invoke-Json "/api/screener/query?rs250=1&limit=500&sort=rs_rank&sortDir=asc"
    Assert-True ($q.rows.Count -le 250) "RS250 returned more than 250 rows"
    Assert-True ((@($q.rows) | Where-Object { [int]$_.rs_rank -gt 250 }).Count -eq 0) "rank above 250 found"
    "$($q.rows.Count) rows, top rank=$(@($q.rows)[0].rs_rank)"
  }

  Invoke-Timed "Functional" "RS250 unchecked exposes larger universe" {
    $q = Invoke-Json "/api/screener/query?rs250=0&limit=600&sort=rs_rank&sortDir=asc"
    Assert-True ($q.rows.Count -gt 250) "unfiltered universe did not exceed RS250"
    "$($q.rows.Count) rows available"
  }

  Invoke-Timed "Functional" "numeric Excel filter greater than" {
    $filter = [uri]::EscapeDataString((@(@{ key = "rv20"; mode = "gt"; value = "2" }) | ConvertTo-Json -Compress))
    $q = Invoke-Json "/api/screener/query?rs250=0&limit=50&filters=$filter&sort=rv20&sortDir=desc"
    Assert-True ($q.rows.Count -gt 0) "no rows for rv20 > 2"
    Assert-True ((@($q.rows) | Where-Object { [double]$_.rv20 -le 2 }).Count -eq 0) "rv20 <= 2 found"
    "$($q.rows.Count) rows rv20 > 2"
  }

  Invoke-Timed "Functional" "text Excel filter contains" {
    $filter = [uri]::EscapeDataString((@(@{ key = "symbol"; mode = "contains"; value = "A" }) | ConvertTo-Json -Compress))
    $q = Invoke-Json "/api/screener/query?rs250=0&limit=50&filters=$filter&sort=symbol&sortDir=asc"
    Assert-True ($q.rows.Count -gt 0) "no symbols containing A"
    Assert-True ((@($q.rows) | Where-Object { [string]$_.symbol -notmatch "A" }).Count -eq 0) "symbol without A found"
    "$($q.rows.Count) symbol rows contain A"
  }

  Invoke-Timed "Functional" "score grade filter red amber green" {
    $cases = @(
      @{ key = "tqs_score"; grade = "green" },
      @{ key = "es_score"; grade = "green" },
      @{ key = "brs_score"; grade = "red" },
      @{ key = "cs_score"; grade = "amber" }
    )
    foreach ($case in $cases) {
      $filter = [uri]::EscapeDataString((@(@{ key = $case.key; mode = "score_grade"; value = $case.grade }) | ConvertTo-Json -Compress))
      $q = Invoke-Json "/api/screener/query?rs250=0&limit=50&filters=$filter&sort=$($case.key)&sortDir=desc"
      Assert-True ($q.rows.Count -gt 0) "no rows for $($case.key) $($case.grade)"
      foreach ($row in @($q.rows)) {
        $value = [double]$row.($case.key)
        if ($case.key -eq "es_score") {
          $ok = if ($case.grade -eq "green") { $value -le 35 } elseif ($case.grade -eq "amber") { $value -gt 35 -and $value -le 60 } else { $value -gt 60 }
        } else {
          $ok = if ($case.grade -eq "green") { $value -ge 70 } elseif ($case.grade -eq "amber") { $value -ge 45 -and $value -lt 70 } else { $value -lt 45 }
        }
        Assert-True $ok "$($case.key)=$value does not match $($case.grade)"
      }
    }
    "validated $($cases.Count) grade filters"
  }

  Invoke-Timed "Functional" "RV20 asc sort" {
    $q = Invoke-Json "/api/screener/query?minRs=90&minPrice=12&minVolume=100000&limit=50&sort=rv20&sortDir=asc"
    Assert-Ordered @($q.rows) "rv20" "asc"
  }

  Invoke-Timed "Boundary" "invalid sort key falls back safely" {
    $q = Invoke-Json "/api/screener/query?minRs=90&minPrice=12&minVolume=100000&limit=10&sort=not_a_column&sortDir=desc"
    Assert-True ($q.rows.Count -gt 0) "fallback query returned no rows"
    "fallback returned $($q.rows.Count) rows"
  }

  Invoke-Timed "Boundary" "limit is clamped" {
    $q = Invoke-Json "/api/screener/query?limit=5000&sort=rs_score&sortDir=desc"
    Assert-True ($q.rows.Count -le 15000) "limit clamp failed: $($q.rows.Count)"
    "$($q.rows.Count) rows"
  }

  Invoke-Timed "Functional" "symbol history API provides daily OHLCV" {
    $symbol = @($script:query.rows)[0].symbol
    $h = Invoke-Json "/api/screener/cache/symbol/$symbol"
    Assert-True ($h.rows.Count -ge 120) "less than 120 history rows"
    $latest = @($h.rows)[-1]
    foreach ($field in @("sdate","open","high","low","close","volume")) { Assert-True ($latest.PSObject.Properties.Name -contains $field) "missing $field" }
    "$symbol $($h.rows.Count) rows $($h.startDate) to $($h.latestDate)"
  }

  Invoke-Timed "Functional" "chart volume coverage for last 120 daily bars" {
    $symbol = @($script:query.rows)[0].symbol
    $h = Invoke-Json "/api/screener/cache/symbol/$symbol"
    $rows = @($h.rows | Select-Object -Last 120)
    $ohlcRows = @($rows | Where-Object { $_.open -ne $null -and $_.high -ne $null -and $_.low -ne $null -and $_.close -ne $null })
    $positiveVolume = @($rows | Where-Object { [double]$_.volume -gt 0 })
    Assert-True ($ohlcRows.Count -eq $rows.Count) "OHLC missing for some chart rows"
    Assert-True ($positiveVolume.Count -eq $rows.Count) "non-positive volume rows: $($rows.Count - $positiveVolume.Count)"
    "$($rows.Count) candles, $($positiveVolume.Count) visible volume bars expected"
  }
  Invoke-Timed "Functional" "decision support score payload for selected chart" {
    $symbol = @($script:query.rows)[0].symbol
    $h = Invoke-Json "/api/screener/cache/symbol/$symbol"
    Assert-True ($h.PSObject.Properties.Name -contains "decisionSupport") "decisionSupport missing"
    $ds = $h.decisionSupport
    Assert-True (@($ds.metrics).Count -eq 4) "expected 4 decision metrics"
    foreach ($key in @("TQS","ES","BRS","CS")) { Assert-True (@(@($ds.metrics) | Where-Object { $_.key -eq $key }).Count -eq 1) "missing $key" }
    foreach ($metric in @($ds.metrics)) { Assert-True ([double]$metric.score -ge 0 -and [double]$metric.score -le 100) "$($metric.key) score out of bounds" }
    Assert-True (-not [string]::IsNullOrWhiteSpace([string]$ds.situation.label)) "situation label missing"
    Assert-True (-not [string]::IsNullOrWhiteSpace([string]$ds.personality.type)) "personality missing"
    Assert-True ($ds.validation.badge -match "Informational Only|Validated") "validation badge missing"
    "$symbol $($ds.situation.label), validation=$($ds.validation.status)"
  }

  Invoke-Timed "Functional" "extension score inverse badge logic" {
    $symbol = @($script:query.rows)[0].symbol
    $h = Invoke-Json "/api/screener/cache/symbol/$symbol"
    $es = @($h.decisionSupport.metrics) | Where-Object { $_.key -eq "ES" } | Select-Object -First 1
    Assert-True ($null -ne $es) "ES missing"
    if ([double]$es.score -gt 60) { Assert-True ($es.tone -eq "red") "ES > 60 must be red" }
    elseif ([double]$es.score -gt 35) { Assert-True ($es.tone -eq "amber") "ES 36-60 must be amber" }
    else { Assert-True ($es.tone -eq "green") "ES <= 35 must be green" }
    "ES=$($es.score), tone=$($es.tone)"
  }
  Invoke-Timed "Boundary" "EODHD score backtest caps selected symbols at 10" {
    $symbols = @("AAPL","MSFT","NVDA","META","AMZN","GOOGL","TSLA","AVGO","LLY","JPM","NFLX")
    $r = Invoke-WebStatus "/api/screener/backtest-scores" "POST" @{ symbols = $symbols }
    Assert-True ($r.StatusCode -eq 400) "expected HTTP 400 for >10 symbols, got $($r.StatusCode)"
    "HTTP $($r.StatusCode) for 11 selected symbols"
  }

  Invoke-Timed "Persistence" "screener view state round trip" {
    $statePath = "/api/state/$([uri]::EscapeDataString($AdminUser))/screener_view"
    $prior = Invoke-Json $statePath
    $script:SavedScreenerView = $prior.value
    $view = @{ preset = "QA"; columns = @("symbol","close","dcr","rmv","rv20"); sort = @{ key = "rmv"; dir = "asc" }; autoRefresh = $false; qaRun = (Get-Date).ToString("o") }
    Invoke-Json $statePath "POST" @{ value = $view } | Out-Null
    $round = Invoke-Json $statePath
    Assert-True ($round.value.sort.key -eq "rmv") "sort key did not persist"
    Assert-True ($round.value.columns.Count -eq 5) "columns did not persist"
    "persisted preset=$($round.value.preset), columns=$($round.value.columns.Count)"
  }
  Invoke-Timed "Persistence" "screener research actions round trip" {
    $statePath = "/api/state/$([uri]::EscapeDataString($AdminUser))/screener_research_actions"
    $priorResearch = Invoke-Json $statePath
    $symbol = @($script:query.rows)[0].symbol
    $payload = @{ items = @(@{ symbol = $symbol; action = "WATCH"; source = "screener"; reason = "QA research queue"; price = @($script:query.rows)[0].close; rs = @($script:query.rows)[0].rs_score; rank = @($script:query.rows)[0].rs_rank; addedAt = (Get-Date).ToString("o"); addedBy = $AdminUser }) }
    Invoke-Json $statePath "POST" @{ value = $payload } | Out-Null
    $round = Invoke-Json $statePath
    Assert-True ($round.value.items.Count -ge 1) "research item did not persist"
    Assert-True (@($round.value.items)[0].action -eq "WATCH") "research action did not persist"
    if ($null -ne $priorResearch.value) { Invoke-Json $statePath "POST" @{ value = $priorResearch.value } | Out-Null } else { Invoke-Json $statePath "POST" @{ value = @{ items = @() } } | Out-Null }
    "persisted $symbol as WATCH"
  }

  Invoke-Timed "Performance" "warm screener query latency" {
    $times = New-Object System.Collections.Generic.List[double]
    for ($i = 0; $i -lt $PerfIterations; $i++) {
      $sw = [System.Diagnostics.Stopwatch]::StartNew()
      $q = Invoke-Json "/api/screener/query?minRs=90&minPrice=12&minVolume=100000&limit=120&sort=rs_score&sortDir=desc"
      $sw.Stop()
      Assert-True ($q.rows.Count -gt 0) "iteration $i returned no rows"
      $times.Add($sw.Elapsed.TotalMilliseconds) | Out-Null
    }
    $avg = ($times | Measure-Object -Average).Average
    $max = ($times | Measure-Object -Maximum).Maximum
    Assert-True ($avg -lt 500) "average latency too high: $([math]::Round($avg,0)) ms"
    "avg=$([math]::Round($avg,0)) ms, max=$([math]::Round($max,0)) ms, n=$PerfIterations"
  }

  Invoke-Timed "Performance" "symbol chart history latency" {
    $symbol = @($script:query.rows)[0].symbol
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $h = Invoke-Json "/api/screener/cache/symbol/$symbol"
    $sw.Stop()
    Assert-True ($h.rows.Count -ge 120) "insufficient rows"
    Assert-True ($sw.Elapsed.TotalMilliseconds -lt 500) "symbol API latency $([math]::Round($sw.Elapsed.TotalMilliseconds,0)) ms"
    "$symbol $([math]::Round($sw.Elapsed.TotalMilliseconds,0)) ms"
  }

  Invoke-Timed "Performance" "10 concurrent authenticated screener queries" {
    $jobs = 1..10 | ForEach-Object {
      Start-Job -ScriptBlock {
        param($BaseUrl, $AdminUser, $AdminPassword)
        $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
        Invoke-RestMethod -Uri "$BaseUrl/api/auth/login" -Method Post -WebSession $s -ContentType "application/json" -Body (@{ username = $AdminUser; password = $AdminPassword } | ConvertTo-Json) -TimeoutSec 30 | Out-Null
        Invoke-RestMethod -Uri "$BaseUrl/api/screener/query?minRs=90&minPrice=12&minVolume=100000&limit=120&sort=rs_score&sortDir=desc" -WebSession $s -TimeoutSec 60
      } -ArgumentList $BaseUrl, $AdminUser, $AdminPassword
    }
    $done = Wait-Job $jobs -Timeout 90
    Assert-True ($done.Count -eq 10) "only $($done.Count)/10 jobs completed"
    $responses = $jobs | Receive-Job
    Remove-Job $jobs -Force
    Assert-True (($responses | Where-Object { $_.rows.Count -gt 0 }).Count -eq 10) "one or more concurrent responses empty"
    "10/10 completed"
  } "P1"

  Invoke-Timed "Data Quality" "RS monitor endpoint reports observability" {
    $m = Invoke-Json "/api/agents/rs-monitor/status"
    Assert-True ($m.PSObject.Properties.Name -contains "status") "monitor status missing"
    Assert-True ($m.PSObject.Properties.Name -contains "rollingTrend") "rolling trend missing"
    "status=$($m.status), due=$($m.dueDate), trend=$(@($m.rollingTrend).Count)"
  }

  if ($IncludeCrashRecovery) {
    Invoke-Timed "Resilience" "manual crash recovery gate" {
      "Not automated in safe mode. Use run-mtm-ui.bat after intentionally stopping node, then rerun this script to confirm state."
    } "P1"
  }
}
finally {
  if ($LoggedIn -and $null -ne $SavedScreenerView) {
    try {
      $statePath = "/api/state/$([uri]::EscapeDataString($AdminUser))/screener_view"
      Invoke-Json $statePath "POST" @{ value = $SavedScreenerView } | Out-Null
    } catch {
      Add-Result "Cleanup" "restore prior screener view" "WARN" $_.Exception.Message 0 "P1"
    }
  }
}

if (-not $ReportPath) { $ReportPath = Join-Path $Root ("data\screener-test-report-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json") }
$summary = [pscustomobject]@{
  startedAt = (Get-Date).ToString("o")
  baseUrl = $BaseUrl
  total = $Results.Count
  pass = @($Results | Where-Object Status -eq "PASS").Count
  fail = @($Results | Where-Object Status -eq "FAIL").Count
  warn = @($Results | Where-Object Status -eq "WARN").Count
  results = $Results
}

$summaryJson = $summary | ConvertTo-Json -Depth 20
Set-Content -LiteralPath $ReportPath -Value $summaryJson -NoNewline
if ($Json) {
  $summaryJson
} else {
  $Results | Format-Table Area, Test, Status, Ms, Detail -AutoSize
  ""
  "Summary: PASS=$($summary.pass) FAIL=$($summary.fail) WARN=$($summary.warn) TOTAL=$($summary.total)"
  "Report: $ReportPath"
}

if ($summary.fail -gt 0) { exit 1 }
