#define MyAppName "Flowr"
#define MyAppVersion "1.0.6"
#define MyAppPublisher "Tieddr"
[Setup]
AppId={{A12C0CB9-4DCE-4F43-A860-9E73B94A87F6}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL=https://tieddr.com
AppSupportURL=https://flowr.tieddr.com
DefaultDirName={autopf}\Flowr
DefaultGroupName=Flowr
DisableProgramGroupPage=yes
OutputDir=..\release_flowr_106
OutputBaseFilename=Flowr-Installer-1.0.6
SetupIconFile=..\release_flowr_106\.icon-ico\icon.ico
UninstallDisplayIcon={app}\Flowr.exe
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
WizardSizePercent=120
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
CloseApplications=yes
RestartApplications=no
[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts"; Flags: checkedonce
[Files]
Source: "..\release_flowr_106\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{autoprograms}\Flowr"; Filename: "{app}\Flowr.exe"
Name: "{autodesktop}\Flowr"; Filename: "{app}\Flowr.exe"; Tasks: desktopicon
[Run]
Filename: "{app}\Flowr.exe"; Description: "Launch Flowr"; Flags: nowait postinstall skipifsilent
[Code]
procedure InitializeWizard;
begin
  WizardForm.Color := $101111;
  WizardForm.MainPanel.Color := $101111;
  WizardForm.InnerPage.Color := $171918;
  WizardForm.WelcomeLabel1.Font.Name := 'Segoe UI';
  WizardForm.WelcomeLabel1.Font.Size := 22;
  WizardForm.WelcomeLabel1.Font.Style := [fsBold];
  WizardForm.WelcomeLabel1.Font.Color := $FFFFFF;
  WizardForm.WelcomeLabel1.Caption := 'Your browser should flow with you.';
  WizardForm.WelcomeLabel2.Font.Name := 'Segoe UI';
  WizardForm.WelcomeLabel2.Font.Size := 11;
  WizardForm.WelcomeLabel2.Font.Color := $B8BDBA;
  WizardForm.WelcomeLabel2.Caption := 'Meet Flowr 1.0.6 — fast, focused, private, and connected to Tieddr Vault, Space, and Mavis.' + #13#10#13#10 + 'A few seconds from now, your calmer web begins.';
  WizardForm.NextButton.Caption := 'Install Flowr  →';
  WizardForm.NextButton.Font.Style := [fsBold];
  WizardForm.NextButton.Width := 128;
  WizardForm.CancelButton.Caption := 'Not now';
end;
