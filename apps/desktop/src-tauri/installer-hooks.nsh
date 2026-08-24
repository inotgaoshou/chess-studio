!macro NSIS_HOOK_POSTINSTALL
  ; The packaged ONNX Runtime DLL can use the MSVC C++ runtime. Keep the
  ; official redistributable inside the installer so a clean Windows machine
  ; can start Xiangqi Studio without a separate manual download.
  SetOutPath "$PLUGINSDIR"
  File /oname=VC_redist.x64.exe "$%VC_REDIST_X64_PATH%"
  ExecWait '"$PLUGINSDIR\VC_redist.x64.exe" /install /quiet /norestart' $0
  StrCmp $0 0 runtime_done
  StrCmp $0 1638 runtime_done
  StrCmp $0 3010 runtime_done
  Abort "Microsoft Visual C++ Runtime 安装失败，错误代码：$0"
  runtime_done:
!macroend
