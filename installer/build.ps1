param([switch]$HebrewOnly,[switch]$ReuseSpeechPayload,[ValidateSet("he","en","de","es")][string]$DefaultLanguage="he")
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $root
function Run($exe, [string[]]$arguments) {
  & $exe @arguments
  if ($LASTEXITCODE -ne 0) {throw "$exe failed with exit code $LASTEXITCODE"}
}
$build = Join-Path $root "packaging"
$out = Join-Path $build "payload"
$cache = Join-Path $build "cache"
New-Item -ItemType Directory -Force $cache,$out | Out-Null
function Download($name,$url,$sha) {
  $file = Join-Path $cache $name
  if (!(Test-Path $file)) {Run curl.exe @("-fLsS","--retry","2",$url,"-o",$file)}
  if ($sha -and (Get-FileHash $file).Hash -ne $sha) {throw "Checksum mismatch for $name"}
}
Download "python.zip" "https://www.python.org/ftp/python/3.10.11/python-3.10.11-embed-amd64.zip" "608619F8619075629C9C69F361352A0DA6ED7E62F83A0E19C63E0EA32EB7629D"
Download "webview2.zip" "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.2903.40/microsoft.web.webview2.1.0.2903.40.nupkg" "EF128016DD1E51C59178C827ED5B8AA3322C57AFA8675D930F8109505542AD74"
Download "MicrosoftEdgeWebView2RuntimeInstallerX64.exe" "https://go.microsoft.com/fwlink/p/?LinkId=2124701" ""
$sig=Get-AuthenticodeSignature (Join-Path $cache "MicrosoftEdgeWebView2RuntimeInstallerX64.exe")
if ($sig.Status -ne "Valid" -or $sig.SignerCertificate.Subject -notmatch "O=Microsoft Corporation") {throw "Invalid Microsoft WebView2 offline installer signature"}
if ($HebrewOnly) {
    $edition = Join-Path $build "payload-hebrew"
    New-Item -ItemType Directory -Force $edition | Out-Null
    if ((Resolve-Path -LiteralPath $edition).Path -ne [IO.Path]::GetFullPath((Join-Path $root "packaging/payload-hebrew")) -or
        ((Get-Item -LiteralPath $edition).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Unexpected Hebrew staging directory" }
    if ($ReuseSpeechPayload) {
        & robocopy $out $edition /MIR /XJ /NFL /NDL /NJH /NJS /NP /XD whisper faster_whisper* ctranslate2* tokenizers* hf_xet* huggingface_hub* __pycache__ /XF *.pyc *.whl
        if ($LASTEXITCODE -ge 8) { throw "Could not stage Hebrew payload" }
    }
    if (Get-ChildItem -LiteralPath $edition -Recurse | Where-Object { $_.Name -match "whisper|ctranslate2" }) { throw "Unexpected Whisper files in Hebrew payload" }
    $out = $edition
}
if (!$ReuseSpeechPayload) {
    $runtimeArgs = @("installer/prepare_runtime.py")
    if ($HebrewOnly) { $runtimeArgs += "--hebrew-only" }
    Run ".venv/Scripts/python.exe" $runtimeArgs
}
$ttsArgs = @("installer/prepare_tts.py")
if ($HebrewOnly) { $ttsArgs += "--hebrew-only" }
Run ".venv/Scripts/python.exe" $ttsArgs
Run "node" @("scripts/prepare-scenemax.mjs")
Run "npm.cmd" @("run","build")
$desktop = if ($env:SCENEMAX_DESKTOP) {$env:SCENEMAX_DESKTOP} else {"C:/dev/scenemax_desktop"}
Copy-Item "$desktop/tools/multiplayer-server/bin/windows-x64/scenemax-mp-server.exe" "$out/relay.exe"
Copy-Item "$desktop/scenemax3d_nextgen/target/release/scenemax_web_gateway.exe" "$out/gateway.exe"
Copy-Item installer/serve.py,service/asr.py $out
New-Item -ItemType Directory -Force "$out/studio" |Out-Null
$target=(Resolve-Path -LiteralPath "$out/studio").Path
if($target -ne ([IO.Path]::GetFullPath((Join-Path $out "studio"))) -or ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw "Unexpected staging directory: $target"}
& robocopy dist $target /MIR /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) {throw "Could not stage the studio bundle"}
'{"websocket_url":"ws://127.0.0.1:21872","allowed_origin":"http://127.0.0.1:21870"}' | Set-Content -Encoding ascii "$out/studio/scenemax/network.json"
Expand-Archive "$cache/webview2.zip" "$build/webview-sdk" -Force
Copy-Item "$build/webview-sdk/lib/net462/Microsoft.Web.WebView2.Core.dll","$build/webview-sdk/lib/net462/Microsoft.Web.WebView2.WinForms.dll","$build/webview-sdk/build/native/x64/WebView2Loader.dll" $out
$notices=Join-Path $out "notices"
New-Item -ItemType Directory -Force $notices|Out-Null
Copy-Item "$desktop/LICENSE" "$notices/SceneMax-LICENSE.txt"
Copy-Item "$build/webview-sdk/LICENSE.txt" "$notices/WebView2-LICENSE.txt"
Copy-Item "installer/User-guide.md" "$out/User-guide.md"
foreach($module in @("react","react-dom","lucide-react","zod","fflate","scheduler")) {
    $license=Get-ChildItem "node_modules/$module/LICENSE*" -File |Select-Object -First 1
    if($license){Copy-Item $license.FullName "$notices/$module-LICENSE.txt"}
}
Run "$env:WINDIR/Microsoft.NET/Framework64/v4.0.30319/csc.exe" @("/nologo","/platform:x64","/target:winexe","/win32icon:$PSScriptRoot/Stagecue.ico","/out:$out/Stagecue.exe","/r:$out/Microsoft.Web.WebView2.Core.dll","/r:$out/Microsoft.Web.WebView2.WinForms.dll","/r:System.Windows.Forms.dll","/r:System.Drawing.dll",(Join-Path $PSScriptRoot "Studio.cs"))
$defines = @("/Q","/DStudioLanguage=$DefaultLanguage")
$suffix=if($DefaultLanguage -eq "he"){""}else{"-$DefaultLanguage"}
if ($HebrewOnly) {
    Set-Content -Encoding ascii -LiteralPath "$edition/hebrew-only.marker" -Value "Hebrew ASR"
    New-Item -ItemType Directory -Force "$edition/examples" | Out-Null
    Copy-Item -LiteralPath "examples/elevator/Gaon-Iris.srs" -Destination "$edition/examples"
    $defines += "/DHebrewOnly"
    $suffix = "-HebrewOnly$suffix"
}
Run "${env:ProgramFiles(x86)}/Inno Setup 6/ISCC.exe" ($defines + "installer/Stagecue.iss")
Write-Output "Built $root/release/Stagecue-Setup$suffix-x64.exe"
