# Serveur local Gestio — sert l'application sur http://localhost:8080
# Aucune installation requise. Ferme la fenetre (ou Ctrl+C) pour arreter.
#
# Utilisation :  clic droit sur ce fichier > "Executer avec PowerShell"
#   ou dans un terminal :  powershell -ExecutionPolicy Bypass -File .\serve.ps1

param([int]$Port = 8080)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$prefix = "http://localhost:$Port/"

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".json" = "application/json; charset=utf-8"
  ".webmanifest" = "application/manifest+json; charset=utf-8"
  ".png"  = "image/png"
  ".ico"  = "image/x-icon"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try {
  $listener.Start()
} catch {
  Write-Host "Impossible de demarrer le serveur sur $prefix" -ForegroundColor Red
  Write-Host $_.Exception.Message
  Write-Host "Essaie un autre port :  powershell -ExecutionPolicy Bypass -File .\serve.ps1 -Port 8090"
  exit 1
}

Write-Host ""
Write-Host "  Gestio est servi sur : $prefix" -ForegroundColor Green
Write-Host "  Ouvre cette adresse dans Chrome ou Edge, puis installe l'app." -ForegroundColor Cyan
Write-Host "  (Ferme cette fenetre pour arreter le serveur.)" -ForegroundColor DarkGray
Write-Host ""

try { Start-Process $prefix } catch {}

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
  } catch { break }

  $rawPath = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
  if ($rawPath -eq "/") { $rawPath = "/index.html" }
  $safe = $rawPath.TrimStart("/").Replace("/", [IO.Path]::DirectorySeparatorChar)
  $full = Join-Path $root $safe

  # empeche de sortir du dossier
  $fullResolved = [IO.Path]::GetFullPath($full)
  if (-not $fullResolved.StartsWith([IO.Path]::GetFullPath($root))) {
    $ctx.Response.StatusCode = 403
    $ctx.Response.Close()
    continue
  }

  if (Test-Path $fullResolved -PathType Leaf) {
    $ext = [IO.Path]::GetExtension($fullResolved).ToLower()
    $type = $mime[$ext]
    if (-not $type) { $type = "application/octet-stream" }
    try {
      $bytes = [IO.File]::ReadAllBytes($fullResolved)
      $ctx.Response.ContentType = $type
      $ctx.Response.Headers.Add("Cache-Control", "no-cache")
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
      $ctx.Response.StatusCode = 500
    }
  } else {
    $ctx.Response.StatusCode = 404
    $msg = [Text.Encoding]::UTF8.GetBytes("404 - introuvable : $rawPath")
    $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
  }
  $ctx.Response.Close()
}
