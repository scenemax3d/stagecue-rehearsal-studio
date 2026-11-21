param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
$text = [Console]::In.ReadToEnd()
$token = New-Object -ComObject SAPI.SpObjectToken
$token.SetId('HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_heIL_Asaf')
$speaker = New-Object -ComObject SAPI.SpVoice
$speaker.Voice = $token
$stream = New-Object -ComObject SAPI.SpFileStream
$stream.Open($OutputPath, 3, $false)
try {
    $speaker.AudioOutputStream = $stream
    [void]$speaker.Speak($text, 16)
} finally { $stream.Close() }
