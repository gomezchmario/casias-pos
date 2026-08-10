' The register's server, started with no window at all.
'
' start.bat used to launch it minimised, which is not the same thing. A
' minimised window is still a button on the taskbar, and a button on the
' taskbar eventually gets clicked and closed by whoever is tidying the desktop
' at the end of a shift. That takes the register down in the middle of a
' ticket, and the person who did it does not know they did it -- from where
' they were standing they closed a black window full of text nobody reads.
' Hidden, there is nothing there to close by accident.
'
' The output still goes somewhere. Hiding the window would otherwise hide the
' only place a crash gets to say why, and "the register just stopped" with no
' log is a phone call nobody can answer. Overwritten per launch rather than
' appended, because the question is always about this morning.

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Already running? Then leave it alone.
'
' This script is now launched two ways -- by Windows at sign-in, and by hand
' when somebody deploys -- so it has to be safe to run twice. Without this, the
' second launch starts a node that finds port 3000 taken, dies, and overwrites
' data\server.log with its own failure. The register would still be up, but the
' only record of how it started would have been replaced by the story of a
' process that never served anything.
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
For Each p In wmi.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name='node.exe'")
  If Not IsNull(p.CommandLine) Then
    If InStr(LCase(p.CommandLine), "server.mjs") > 0 Then WScript.Quit 0
  End If
Next

' Up two, since this file lives in scripts\ and npm has to run from the root.
sh.CurrentDirectory = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

' 0 = hidden window, False = don't wait for it to exit.
sh.Run "cmd /c npm start > ""data\server.log"" 2>&1", 0, False
