param(
  [Parameter(Mandatory = $true)] [string]$TemplateXlsx,
  [Parameter(Mandatory = $true)] [string]$ReportJson,
  [Parameter(Mandatory = $true)] [string]$OutputXlsx
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

$report = Get-Content -Raw -LiteralPath $ReportJson | ConvertFrom-Json
$failures = @($report.failures)
if ($failures.Count -ne 159) { throw "Le rapport ne contient pas exactement 159 échecs." }
$failedRows = [Collections.Generic.HashSet[int]]::new()
foreach ($failure in $failures) { [void]$failedRows.Add([int]$failure.record) }
if ($failedRows.Count -ne 159) { throw "Le rapport contient des numéros de ligne dupliqués." }

$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("yokkai-failed-xlsx-" + [guid]::NewGuid().ToString("N"))
$resolvedOutput = [IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputXlsx))
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
try {
  [IO.Compression.ZipFile]::ExtractToDirectory((Resolve-Path -LiteralPath $TemplateXlsx), $temporaryRoot)

  $sheetPath = Join-Path $temporaryRoot "xl/worksheets/sheet2.xml"
  [xml]$sheet = Get-Content -Raw -LiteralPath $sheetPath
  $ns = [Xml.XmlNamespaceManager]::new($sheet.NameTable)
  $ns.AddNamespace("x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")
  $sheetData = $sheet.SelectSingleNode("//x:sheetData", $ns)
  $sourceRows = @($sheetData.SelectNodes("x:row", $ns))
  $kept = @($sourceRows | Where-Object { [int]$_.r -eq 1 -or $failedRows.Contains([int]$_.r) })
  foreach ($row in $sourceRows) { [void]$sheetData.RemoveChild($row) }
  for ($index = 0; $index -lt $kept.Count; $index++) {
    $row = $kept[$index]
    $newNumber = $index + 1
    $row.r = [string]$newNumber
    foreach ($cell in $row.SelectNodes("x:c", $ns)) {
      $column = [regex]::Match([string]$cell.r, "^[A-Z]+").Value
      $cell.r = "$column$newNumber"
    }
    [void]$sheetData.AppendChild($row)
  }
  $sheet.Save($sheetPath)

  $tablePath = Join-Path $temporaryRoot "xl/tables/table1.xml"
  [xml]$table = Get-Content -Raw -LiteralPath $tablePath
  $table.DocumentElement.SetAttribute("ref", "A1:M160")
  $autoFilter = $table.DocumentElement.SelectSingleNode("*[local-name()='autoFilter']")
  if ($null -ne $autoFilter) { $autoFilter.SetAttribute("ref", "A1:M160") }
  $table.Save($tablePath)

  $summaryPath = Join-Path $temporaryRoot "xl/worksheets/sheet1.xml"
  [xml]$summary = Get-Content -Raw -LiteralPath $summaryPath
  $summaryNs = [Xml.XmlNamespaceManager]::new($summary.NameTable)
  $summaryNs.AddNamespace("x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")

  function Set-Value([xml]$Document, $Namespace, [string]$Reference, [object]$Value, [bool]$Numeric = $false) {
    $cell = $Document.SelectSingleNode("//x:c[@r='$Reference']", $Namespace)
    if ($null -eq $cell) { throw "Cellule absente du modèle : $Reference" }
    $cell.SetAttribute("t", $(if ($Numeric) { "n" } else { "str" }))
    $valueNode = $cell.SelectSingleNode("x:v", $Namespace)
    if ($null -eq $valueNode) {
      $valueNode = $Document.CreateElement("x", "v", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")
      [void]$cell.AppendChild($valueNode)
    }
    $valueNode.InnerText = [string]$Value
  }

  Set-Value $summary $summaryNs "B5" 159 $true
  Set-Value $summary $summaryNs "B6" (@($failures | Where-Object record -ge 60).Count) $true
  Set-Value $summary $summaryNs "B7" (@($failures | Where-Object record -le 59).Count) $true

  $errorGroups = @($failures | Group-Object message | Sort-Object @{ Expression = "Count"; Descending = $true }, Name)
  $categoryGroups = @($failures | Group-Object categorie | Sort-Object @{ Expression = "Count"; Descending = $true }, Name)
  for ($row = 10; $row -le 19; $row++) {
    $errorIndex = $row - 10
    Set-Value $summary $summaryNs "A$row" $(if ($errorIndex -lt $errorGroups.Count) { $errorGroups[$errorIndex].Name } else { "" })
    Set-Value $summary $summaryNs "B$row" $(if ($errorIndex -lt $errorGroups.Count) { $errorGroups[$errorIndex].Count } else { "" }) ($errorIndex -lt $errorGroups.Count)
  }
  for ($row = 10; $row -le 21; $row++) {
    $categoryIndex = $row - 10
    Set-Value $summary $summaryNs "D$row" $(if ($categoryIndex -lt $categoryGroups.Count) { $categoryGroups[$categoryIndex].Name } else { "" })
    Set-Value $summary $summaryNs "E$row" $(if ($categoryIndex -lt $categoryGroups.Count) { $categoryGroups[$categoryIndex].Count } else { "" }) ($categoryIndex -lt $categoryGroups.Count)
  }
  $summary.Save($summaryPath)

  $outputDirectory = Split-Path -Parent $resolvedOutput
  New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
  if (Test-Path -LiteralPath $resolvedOutput) { Remove-Item -LiteralPath $resolvedOutput -Force }
  $outputArchive = [IO.Compression.ZipFile]::Open($resolvedOutput, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($file in Get-ChildItem -LiteralPath $temporaryRoot -File -Recurse) {
      $entryName = $file.FullName.Substring($temporaryRoot.Length + 1).Replace("\", "/")
      [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $outputArchive, $file.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal
      )
    }
  } finally {
    $outputArchive.Dispose()
  }
} finally {
  $resolvedTemporary = [IO.Path]::GetFullPath($temporaryRoot)
  $resolvedSystemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if ($resolvedTemporary.StartsWith($resolvedSystemTemp, [StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path -Leaf $resolvedTemporary).StartsWith("yokkai-failed-xlsx-")) {
    Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force
  }
}

Get-Item -LiteralPath $resolvedOutput | Select-Object FullName, Length, LastWriteTime
