' ===========================================================================
'  Task Management Application - stop the silent backend
'
'  Reads .server.pid (written by server.js on start) and ends that process.
' ===========================================================================
Option Explicit

Dim sh, fso, here, pidFile, raw, pid, m

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here    = fso.GetParentFolderName(WScript.ScriptFullName)
pidFile = here & "\.server.pid"

If Not fso.FileExists(pidFile) Then
    MsgBox "No running backend was found (.server.pid is missing)." & vbCrLf & _
           "If a server is still running, close it from Task Manager.", _
           vbInformation, "Task Manager"
    WScript.Quit 0
End If

raw = fso.OpenTextFile(pidFile, 1).ReadAll

' pull the first run of digits after "pid"
Set m = New RegExp
m.Pattern = """pid""\s*:\s*(\d+)"
Dim matches
Set matches = m.Execute(raw)

If matches.Count = 0 Then
    ' fall back: whole file is just a number
    pid = Trim(raw)
Else
    pid = matches(0).SubMatches(0)
End If

If Len(pid) = 0 Or Not IsNumeric(pid) Then
    MsgBox "Could not read a process id from .server.pid.", vbExclamation, "Task Manager"
    WScript.Quit 1
End If

sh.Run "cmd /c taskkill /pid " & pid & " /t /f", 0, True
On Error Resume Next
fso.DeleteFile pidFile
On Error GoTo 0

MsgBox "Task Manager backend stopped (pid " & pid & ").", vbInformation, "Task Manager"
