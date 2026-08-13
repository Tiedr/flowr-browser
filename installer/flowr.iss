#define MyAppName "Flowr"
#define MyAppVersion "1.0.10"
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
OutputDir=..\release_flowr_110
OutputBaseFilename=Flowr-Installer-1.0.10
SetupIconFile=..\release_flowr_110\.icon-ico\icon.ico
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
Source: "..\release_flowr_110\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{autoprograms}\Flowr"; Filename: "{app}\Flowr.exe"
Name: "{autodesktop}\Flowr"; Filename: "{app}\Flowr.exe"; Tasks: desktopicon
[Run]
Filename: "{app}\Flowr.exe"; Description: "Launch Flowr"; Flags: nowait postinstall skipifsilent
[Code]
var Hero, Art: TPanel;
  Kicker, Headline, BodyCopy, F1, F2, F3, BrandText, VersionText: TNewStaticText;
  Beam1, Beam2, Beam3, Beam4, Beam5: TNewStaticText;

procedure AddCopy(var L: TNewStaticText; Parent: TWinControl; S: String; X, Y, W, H, FontSize: Integer; C: TColor; Bold: Boolean);
begin
  L := TNewStaticText.Create(WizardForm); L.Parent := Parent; L.Caption := S;
  L.Left := X; L.Top := Y; L.Width := W; L.Height := H; L.AutoSize := False; L.WordWrap := True;
  L.Font.Name := 'Segoe UI'; L.Font.Size := FontSize; L.Font.Color := C;
  if Bold then L.Font.Style := [fsBold];
end;

procedure InitializeWizard;
begin
  WizardForm.Caption := 'Install Flowr'; WizardForm.Color := $0D0F0F;
  WizardForm.MainPanel.Visible := False; WizardForm.Bevel.Visible := False;
  WizardForm.WelcomeLabel1.Visible := False; WizardForm.WelcomeLabel2.Visible := False;
  WizardForm.WizardBitmapImage.Visible := False;
  WizardForm.InnerNotebook.Left := 0; WizardForm.InnerNotebook.Top := 0;
  WizardForm.InnerNotebook.Width := WizardForm.ClientWidth;
  WizardForm.InnerNotebook.Height := WizardForm.ClientHeight - 68;
  WizardForm.InnerPage.Color := $0D0F0F;
  Hero := TPanel.Create(WizardForm); Hero.Parent := WizardForm.WelcomePage;
  Hero.Align := alClient; Hero.Color := $0D0F0F; Hero.BevelOuter := bvNone;
  AddCopy(BrandText, Hero, 'FLOWR', 34, 24, 150, 26, 14, $FFFFFF, True);
  AddCopy(VersionText, Hero, 'TIEDDR  /  1.0.10', Hero.Width - 180, 27, 150, 20, 9, $8D9692, True);
  AddCopy(Kicker, Hero, 'BROWSER FOR YOUR FLOW', 42, 110, 300, 22, 9, $51FFCA, True);
  AddCopy(Headline, Hero, 'Install' + #13#10 + 'Flowr.', 40, 142, 310, 106, 31, $FFFFFF, True);
  AddCopy(BodyCopy, Hero, 'A calmer, faster browser with your Tieddr world already connected.', 43, 258, 292, 60, 11, $AAB2AF, False);
  AddCopy(F1, Hero, '✓  Vault passwords and cards built in', 43, 338, 320, 24, 10, $E8ECEA, False);
  AddCopy(F2, Hero, '✓  Space bookmarks and notes in sync', 43, 372, 320, 24, 10, $E8ECEA, False);
  AddCopy(F3, Hero, '✓  Mavis assistance when you need it', 43, 406, 320, 24, 10, $E8ECEA, False);
  Art := TPanel.Create(WizardForm); Art.Parent := Hero; Art.Left := Hero.Width div 2;
  Art.Top := 68; Art.Width := Hero.Width div 2 - 28; Art.Height := Hero.Height - 94;
  Art.Color := $121515; Art.BevelOuter := bvNone;
  AddCopy(Beam1, Art, '╲', 155, 28, 120, 330, 96, $51FFCA, False);
  AddCopy(Beam2, Art, '╲', 127, 53, 120, 310, 90, $65E5B2, False);
  AddCopy(Beam3, Art, '╲', 100, 79, 120, 285, 84, $5CCBA5, False);
  AddCopy(Beam4, Art, '╲', 73, 105, 120, 260, 78, $4FB698, False);
  AddCopy(Beam5, Art, '╲', 47, 131, 120, 235, 72, $429C84, False);
  WizardForm.NextButton.Caption := 'Install Flowr  →'; WizardForm.NextButton.Font.Style := [fsBold];
  WizardForm.NextButton.Width := 138; WizardForm.NextButton.Height := 38;
  WizardForm.NextButton.Left := WizardForm.ClientWidth - 156; WizardForm.NextButton.Top := WizardForm.ClientHeight - 52;
  WizardForm.CancelButton.Caption := 'Not now'; WizardForm.CancelButton.Width := 100; WizardForm.CancelButton.Height := 38;
  WizardForm.CancelButton.Left := WizardForm.NextButton.Left - 112; WizardForm.CancelButton.Top := WizardForm.NextButton.Top;
end;
