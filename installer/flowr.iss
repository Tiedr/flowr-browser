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
  WelcomeArt, StageArt: TBitmapImage;
  StageCover, StageRightCover: TPanel;
  StageBrand, StageEyebrow, StageTitle, StageBody, StagePercent, StageRightEyebrow, StageRightTitle, StageRightBody: TLabel;
  InstallButton, CancelButton, FinishButton: TPanel;

procedure InstallFlowr(Sender: TObject);
begin
  WizardForm.NextButton.OnClick(WizardForm.NextButton);
end;

procedure CancelInstall(Sender: TObject);
begin
  WizardForm.CancelButton.OnClick(WizardForm.CancelButton);
end;

procedure FinishInstall(Sender: TObject);
begin
  WizardForm.NextButton.OnClick(WizardForm.NextButton);
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

procedure MakeLabel(var L: TLabel; ParentControl: TWinControl; X, Y, W, H, FontSize: Integer; Color: TColor; Bold: Boolean);
begin
  L := TLabel.Create(WizardForm);
  L.Parent := ParentControl;
  L.Left := X;
  L.Top := Y;
  L.Width := W;
  L.Height := H;
  L.AutoSize := False;
  L.WordWrap := True;
  L.Font.Name := 'Segoe UI';
  L.Font.Size := FontSize;
  L.Font.Color := Color;
  if Bold then L.Font.Style := [fsBold];
end;

procedure CurPageChanged(CurPageID: Integer);
var IsWelcome, IsFinished: Boolean;
begin
  IsWelcome := CurPageID = wpWelcome;
  IsFinished := CurPageID = wpFinished;
  WelcomeArt.Visible := IsWelcome;
  StageArt.Visible := not IsWelcome;
  if IsWelcome then WelcomeArt.BringToFront else StageArt.BringToFront;
  StageCover.Visible := not IsWelcome;
  StageRightCover.Visible := not IsWelcome;
  StageRightCover.BringToFront;
  StageCover.BringToFront;
  InstallButton.Visible := IsWelcome and (not WizardSilent);
  CancelButton.Visible := (not IsFinished) and (not WizardSilent);
  FinishButton.Visible := IsFinished and (not WizardSilent);
  InstallButton.BringToFront;
  CancelButton.BringToFront;
  FinishButton.BringToFront;
  { In silent installs Inno drives the standard buttons internally. Keeping
    them logically visible avoids aborting the automated page transition. }
  WizardForm.NextButton.Visible := WizardSilent;
  WizardForm.CancelButton.Visible := WizardSilent;

  if IsFinished then
  begin
    StageEyebrow.Caption := 'FLOWR IS READY';
    StageTitle.Caption := 'Your flow starts now.';
    StageBody.Caption := 'Flowr was installed successfully. Your themes, extensions, Vault, Space and Mavis are ready when the browser opens.';
    StagePercent.Caption := 'INSTALLATION COMPLETE';
    StageRightEyebrow.Caption := 'READY WHEN YOU ARE';
    StageRightTitle.Caption := 'Open Flowr.';
    StageRightBody.Caption := 'Your calmer way through the web is installed.';
    WizardForm.ProgressGauge.Visible := False;
    WizardForm.StatusLabel.Visible := False;
  end
  else if not IsWelcome then
  begin
    StageEyebrow.Caption := 'SETTING UP FLOWR';
    StageTitle.Caption := 'Building your browser.';
    StageBody.Caption := 'Installing the optimized browser engine, private browsing tools and your Tieddr integrations. This normally takes less than a minute.';
    StagePercent.Caption := 'PREPARING';
    StageRightEyebrow.Caption := 'FLOWR  /  1.1.2';
    StageRightTitle.Caption := 'Private.' + #13#10 + 'Personal.' + #13#10 + 'Yours.';
    StageRightBody.Caption := 'Optimized Chromium engine' + #13#10 + 'Tieddr Vault + Space' + #13#10 + 'Mavis built in';
    WizardForm.ProgressGauge.Visible := True;
    WizardForm.StatusLabel.Visible := True;
  end;
end;

procedure CurInstallProgressChanged(CurProgress, MaxProgress: Integer);
begin
  if MaxProgress > 0 then
    StagePercent.Caption := IntToStr((CurProgress * 100) div MaxProgress) + '%  /  INSTALLING';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = wpSelectTasks) or (PageID = wpSelectProgramGroup) or
    (PageID = wpSelectDir) or (PageID = wpReady);
end;

procedure InitializeWizard;
begin
  WizardForm.Caption := 'Install Flowr';
  WizardForm.Color := $10100A;
  WizardForm.BorderStyle := bsSingle;
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

  StageArt := TBitmapImage.Create(WizardForm);
  StageArt.Parent := WizardForm;
  StageArt.Align := alClient;
  StageArt.Stretch := True;
  StageArt.Bitmap.Assign(WelcomeArt.Bitmap);
  StageArt.Visible := False;

  StageCover := TPanel.Create(WizardForm);
  StageCover.Parent := WizardForm;
  StageCover.Left := 0;
  StageCover.Top := 0;
  StageCover.Width := WizardForm.ClientWidth div 2;
  StageCover.Height := WizardForm.ClientHeight;
  StageCover.BevelOuter := bvNone;
  StageCover.Color := $10100A;
  StageCover.ParentBackground := False;

  StageRightCover := TPanel.Create(WizardForm);
  StageRightCover.Parent := WizardForm;
  StageRightCover.Left := WizardForm.ClientWidth div 2;
  StageRightCover.Top := 0;
  StageRightCover.Width := WizardForm.ClientWidth - StageRightCover.Left;
  StageRightCover.Height := WizardForm.ClientHeight;
  StageRightCover.BevelOuter := bvNone;
  StageRightCover.Color := $17140F;
  StageRightCover.ParentBackground := False;

  MakeLabel(StageRightEyebrow, StageRightCover, 48, 102, StageRightCover.Width - 90, 24, 9, $E8B899, True);
  MakeLabel(StageRightTitle, StageRightCover, 48, 154, StageRightCover.Width - 90, 150, 25, $FFFFFF, True);
  MakeLabel(StageRightBody, StageRightCover, 48, 330, StageRightCover.Width - 90, 90, 10, $9E9A97, False);

  MakeLabel(StageBrand, StageCover, 56, 35, StageCover.Width - 100, 30, 14, $FFFFFF, True);
  StageBrand.Caption := 'FLOWR';
  MakeLabel(StageEyebrow, StageCover, 56, 102, StageCover.Width - 100, 24, 9, $E8B899, True);
  MakeLabel(StageTitle, StageCover, 56, 148, StageCover.Width - 100, 110, 27, $FFFFFF, True);
  MakeLabel(StageBody, StageCover, 56, 267, StageCover.Width - 100, 100, 11, $BEBAB7, False);
  MakeLabel(StagePercent, StageCover, 56, 390, StageCover.Width - 100, 24, 9, $E8B899, True);

  WizardForm.ProgressGauge.Parent := StageCover;
  WizardForm.ProgressGauge.Left := 56;
  WizardForm.ProgressGauge.Top := 426;
  WizardForm.ProgressGauge.Width := StageCover.Width - 100;
  WizardForm.ProgressGauge.Height := 8;

  WizardForm.StatusLabel.Parent := StageCover;
  WizardForm.StatusLabel.Left := 56;
  WizardForm.StatusLabel.Top := 452;
  WizardForm.StatusLabel.Width := StageCover.Width - 100;
  WizardForm.StatusLabel.Height := 42;
  WizardForm.StatusLabel.Font.Name := 'Segoe UI';
  WizardForm.StatusLabel.Font.Size := 9;
  WizardForm.StatusLabel.Font.Color := $AAA6A3;

  MakeAction(CancelButton, 'Cancel', WizardForm.ClientWidth - 286, 112, $23231D, $D0D0D0, @CancelInstall);
  MakeAction(InstallButton, 'Install Flowr', WizardForm.ClientWidth - 162, 142, $D68A51, $FFFFFF, @InstallFlowr);
  MakeAction(FinishButton, 'Open Flowr', WizardForm.ClientWidth - 162, 142, $D68A51, $FFFFFF, @FinishInstall);
end;
