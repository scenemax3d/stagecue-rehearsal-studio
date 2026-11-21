#ifndef StudioLanguage
#define StudioLanguage "he"
#endif
[Setup]
#ifdef HebrewOnly
AppId={{34F7950C-A5D0-4E13-BDF0-6A0BB1882511}
AppName=Stagecue Rehearsal Studio (Hebrew)
DefaultDirName={localappdata}\Programs\Stagecue-Hebrew
DefaultGroupName=Stagecue Hebrew
#else
AppId={{BF4188C7-B2BE-456D-A843-4F740C366C61}
AppName=Stagecue Rehearsal Studio
DefaultDirName={localappdata}\Programs\Stagecue
DefaultGroupName=Stagecue
#endif
AppVersion=1.4.0
PrivilegesRequired=lowest
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
MinVersion=10.0.19041
OutputDir=..\release
#ifdef HebrewOnly
  #if StudioLanguage == "he"
OutputBaseFilename=Stagecue-Setup-HebrewOnly-x64
  #else
OutputBaseFilename=Stagecue-Setup-HebrewOnly-{#StudioLanguage}-x64
  #endif
#elif StudioLanguage == "he"
OutputBaseFilename=Stagecue-Setup-x64
#else
OutputBaseFilename=Stagecue-Setup-{#StudioLanguage}-x64
#endif
Compression=zip/3
SolidCompression=no
UninstallDisplayIcon={app}\Stagecue.exe
AppMutex=Local\Stagecue.RehearsalStudio
WizardStyle=modern
[Files]
#ifdef HebrewOnly
Source: "..\packaging\payload-hebrew\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
#else
Source: "..\packaging\payload\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
#endif
Source: "..\packaging\cache\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; DestDir: "{tmp}"; Flags: dontcopy nocompression
[Icons]
Name: "{group}\Stagecue Rehearsal Studio"; Filename: "{app}\Stagecue.exe"
[Run]
Filename: "{app}\Stagecue.exe"; Description: "Open Stagecue Rehearsal Studio"; Flags: nowait postinstall skipifsilent
[Code]
function HasWebView: Boolean;
var V: String; K: String;
begin
  K := 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  Result := (RegQueryStringValue(HKLM32,K,'pv',V) or RegQueryStringValue(HKCU32,K,'pv',V)) and (V <> '') and (V <> '0.0.0.0');
end;
function PrepareToInstall(var NeedsRestart: Boolean): String;
var Code: Integer;
begin
  Result := '';
  if not HasWebView then begin
    ExtractTemporaryFile('MicrosoftEdgeWebView2RuntimeInstallerX64.exe');
    if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebView2RuntimeInstallerX64.exe'),'/silent /install','',SW_HIDE,ewWaitUntilTerminated,Code) or (Code <> 0) then
      Result := 'WebView2 installation failed. Exit code ' + IntToStr(Code);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    SaveStringToFile(ExpandConstant('{app}\studio\interface-default.js'), 'window.stagecueDefaultLanguage = "{#StudioLanguage}";', False);
end;
