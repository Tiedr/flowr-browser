Unicode true
Name "Flowr"
OutFile "..\release_flowr_105\Flowr-Setup-1.0.5.exe"
InstallDir "$LOCALAPPDATA\Programs\Flowr"
RequestExecutionLevel user
SetCompressor zlib
Icon "..\release_flowr_105\.icon-ico\icon.ico"

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Flowr" SEC_FLOWR
  SetOutPath "$INSTDIR"
  File /r "..\release_flowr_105\win-unpacked\*.*"
  WriteUninstaller "$INSTDIR\Uninstall Flowr.exe"
  CreateDirectory "$SMPROGRAMS\Flowr"
  CreateShortcut "$SMPROGRAMS\Flowr\Flowr.lnk" "$INSTDIR\Flowr.exe"
  CreateShortcut "$SMPROGRAMS\Flowr\Uninstall Flowr.lnk" "$INSTDIR\Uninstall Flowr.exe"
  CreateShortcut "$DESKTOP\Flowr.lnk" "$INSTDIR\Flowr.exe"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\Flowr.lnk"
  RMDir /r "$SMPROGRAMS\Flowr"
  RMDir /r "$INSTDIR"
SectionEnd
