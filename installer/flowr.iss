#define MyAppName "Flowr"
#define MyAppVersion "1.1.2"
[Setup]
AppId={{A12C0CB9-4DCE-4F43-A860-9E73B94A87F6}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=Tieddr
AppPublisherURL=https://tieddr.com
AppSupportURL=https://flowr.tieddr.com
DefaultDirName={autopf}\Flowr
DefaultGroupName=Flowr
DisableProgramGroupPage=yes
OutputDir=..\release_flowr_112b
OutputBaseFilename=Flowr-Installer-1.1.2
SetupIconFile=..\release_flowr_112b\.icon-ico\icon.ico
UninstallDisplayIcon={app}\Flowr.exe
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
WizardSizePercent=140
DisableWelcomePage=no
DisableDirPage=yes
DisableReadyPage=yes
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
Source: "..\release_flowr_112b\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "flowr-welcome.bmp"; Flags: dontcopy
[Icons]
Name: "{autoprograms}\Flowr"; Filename: "{app}\Flowr.exe"
Name: "{autodesktop}\Flowr"; Filename: "{app}\Flowr.exe"; Tasks: desktopicon
[Run]
Filename: "{app}\Flowr.exe"; Description: "Launch Flowr"; Flags: nowait postinstall skipifsilent
[Code]
var
  WelcomeArt: TBitmapImage;
  InstallButton, CancelButton: TPanel;

procedure InstallFlowr(Sender: TObject);
begin
  WizardForm.NextButton.OnClick(WizardForm.NextButton);
end;

procedure CancelInstall(Sender: TObject);
begin
  WizardForm.CancelButton.OnClick(WizardForm.CancelButton);
end;

procedure MakeAction(var P: TPanel; Caption: String; X, W: Integer; Color, TextColor: TColor; Handler: TNotifyEvent);
begin
  P := TPanel.Create(WizardForm);
  P.Parent := WizardForm;
  P.Left := X;
  P.Top := WizardForm.ClientHeight - 55;
  P.Width := W;
  P.Height := 38;
  P.BevelOuter := bvNone;
  P.Color := Color;
  P.Caption := Caption;
  P.Font.Name := 'Segoe UI';
  P.Font.Size := 10;
  P.Font.Style := [fsBold];
  P.Font.Color := TextColor;
  P.Cursor := crHand;
  P.OnClick := Handler;
end;

procedure CurPageChanged(CurPageID: Integer);
var IsWelcome: Boolean;
begin
  IsWelcome := CurPageID = wpWelcome;
  WelcomeArt.Visible := IsWelcome;
  InstallButton.Visible := IsWelcome;
  CancelButton.Visible := IsWelcome;
  WizardForm.NextButton.Visible := not IsWelcome;
  WizardForm.CancelButton.Visible := not IsWelcome;
end;

procedure InitializeWizard;
begin
  WizardForm.Caption := 'Install Flowr';
  WizardForm.Color := $10100A;
  WizardForm.MainPanel.Visible := False;
  WizardForm.Bevel.Visible := False;
  WizardForm.WelcomeLabel1.Visible := False;
  WizardForm.WelcomeLabel2.Visible := False;
  WizardForm.WizardBitmapImage.Visible := False;
  WizardForm.InnerNotebook.Left := 0;
  WizardForm.InnerNotebook.Top := 0;
  WizardForm.InnerNotebook.Width := WizardForm.ClientWidth;
  WizardForm.InnerNotebook.Height := WizardForm.ClientHeight - 66;
  WizardForm.InnerPage.Color := $10100A;

  ExtractTemporaryFile('flowr-welcome.bmp');
  WelcomeArt := TBitmapImage.Create(WizardForm);
  WelcomeArt.Parent := WizardForm.WelcomePage;
  WelcomeArt.Align := alClient;
  WelcomeArt.Stretch := True;
  WelcomeArt.Bitmap.LoadFromFile(ExpandConstant('{tmp}\flowr-welcome.bmp'));

  MakeAction(CancelButton, 'Cancel', WizardForm.ClientWidth - 286, 112, $23231D, $D0D0D0, @CancelInstall);
  MakeAction(InstallButton, 'Install Flowr', WizardForm.ClientWidth - 162, 142, $D68A51, $FFFFFF, @InstallFlowr);
end;
