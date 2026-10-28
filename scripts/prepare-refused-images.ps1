param(
  [Parameter(Mandatory = $true)]
  [string]$InputXlsx,

  [Parameter(Mandatory = $true)]
  [string]$OutputCsv,

  [Parameter(Mandatory = $true)]
  [string]$SummaryJson
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-CellColumn([string]$Reference) {
  return [regex]::Match($Reference, "^[A-Z]+").Value
}

function Get-CellValue($Cell) {
  if ($null -eq $Cell.v) { return "" }
  return [string]$Cell.v
}

$archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $InputXlsx))
try {
  $entry = $archive.GetEntry("xl/worksheets/sheet2.xml")
  if ($null -eq $entry) { throw "La feuille 'Cartes refusees' est introuvable." }
  $reader = [System.IO.StreamReader]::new($entry.Open())
  try { [xml]$sheet = $reader.ReadToEnd() } finally { $reader.Dispose() }
} finally {
  $archive.Dispose()
}

$namespace = [System.Xml.XmlNamespaceManager]::new($sheet.NameTable)
$namespace.AddNamespace("x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")
$xmlRows = $sheet.SelectNodes("//x:sheetData/x:row", $namespace)
if ($xmlRows.Count -lt 2) { throw "La feuille ne contient aucune carte." }

$headers = @{}
foreach ($cell in $xmlRows[0].SelectNodes("x:c", $namespace)) {
  $headers[(Get-CellColumn $cell.r)] = (Get-CellValue $cell)
}

$columnNames = @(
  "operation", "identifiant", "nom", "categorie", "franchise", "rarete",
  "ancienne rarete", "image source", "erreur", "code http", "source",
  "source id", "correspondance"
)
foreach ($name in $columnNames) {
  if ($headers.Values -notcontains $name) { throw "Colonne Excel manquante : $name" }
}

$cards = [System.Collections.Generic.List[object]]::new()
foreach ($xmlRow in $xmlRows | Select-Object -Skip 1) {
  $values = @{}
  foreach ($cell in $xmlRow.SelectNodes("x:c", $namespace)) {
    $column = Get-CellColumn $cell.r
    if ($headers.ContainsKey($column)) { $values[$headers[$column]] = Get-CellValue $cell }
  }
  if ([string]::IsNullOrWhiteSpace($values["nom"]) -and
      [string]::IsNullOrWhiteSpace($values["source id"])) { continue }

  $url = [string]$values["image source"]
  $domain = ""
  $urlValid = $false
  try {
    $uri = [Uri]$url
    $urlValid = $uri.IsAbsoluteUri -and $uri.Scheme -eq "https" -and -not [string]::IsNullOrWhiteSpace($uri.Host)
    if ($urlValid) { $domain = $uri.IdnHost.ToLowerInvariant() }
  } catch {}

  $cards.Add([pscustomobject][ordered]@{
    record = [int]$xmlRow.r
    operation = [string]$values["operation"]
    id = [string]$values["identifiant"]
    nom = [string]$values["nom"]
    categorie = [string]$values["categorie"]
    franchise = [string]$values["franchise"]
    rarete = [string]$values["rarete"]
    ancienne_rarete = [string]$values["ancienne rarete"]
    image_url = $url
    erreur_initiale = [string]$values["erreur"]
    code_http_initial = [string]$values["code http"]
    source = [string]$values["source"]
    source_id = [string]$values["source id"]
    correspondance = [string]$values["correspondance"]
    domaine = $domain
    url_valide = $urlValid
  })
}

$identityGroups = $cards | Group-Object { "{0}`0{1}" -f $_.source, $_.source_id }
$duplicates = @($identityGroups | Where-Object Count -gt 1 | ForEach-Object {
  [pscustomobject]@{ identite = $_.Name; lignes = @($_.Group.record); nombre = $_.Count }
})
$categories = [ordered]@{}
foreach ($group in ($cards | Group-Object categorie | Sort-Object Name)) { $categories[$group.Name] = $group.Count }
$domains = [ordered]@{}
foreach ($group in ($cards | Group-Object domaine | Sort-Object Name)) { $domains[$group.Name] = $group.Count }

$summary = [ordered]@{
  total_lignes = $cards.Count
  cartes_uniques = $identityGroups.Count
  categories = $categories
  urls_static_wikia = @($cards | Where-Object domaine -eq "static.wikia.nocookie.net").Count
  urls_autres_domaines = @($cards | Where-Object { $_.url_valide -and $_.domaine -ne "static.wikia.nocookie.net" }).Count
  urls_vides_ou_invalides = @($cards | Where-Object { -not $_.url_valide }).Count
  doublons = $duplicates.Count
  details_doublons = $duplicates
  domaines = $domains
}

$outputDirectory = Split-Path -Parent $OutputCsv
if ($outputDirectory) { New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null }
$summaryDirectory = Split-Path -Parent $SummaryJson
if ($summaryDirectory) { New-Item -ItemType Directory -Force -Path $summaryDirectory | Out-Null }
$cards | Export-Csv -LiteralPath $OutputCsv -NoTypeInformation -Encoding utf8
$summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $SummaryJson -Encoding utf8
$summary | ConvertTo-Json -Depth 8
