' ===========================================================================
'  Task Management Application - silent launcher (Windows)
'
'  Double-click this file. It:
'    1. starts  node server.js  with NO console window,
'    2. waits for the backend to answer /health,
'    3. opens the app in your default browser.
'
'  Nothing is shown except the browser. Run "Stop Task Manager.vbs" to stop it.
' ===========================================================================
Option Explicit

Dim sh, fso, here, port, appUrl, healthUrl, tries

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here      = fso.GetParentFolderName(WScript.ScriptFullName)
port      = 3000
appUrl    = "http://localhost:" & port & "/"
healthUrl = "http://localhost:" & port & "/health"

sh.CurrentDirectory = here

' --- already running?  just open it ---------------------------------------
If BackendUp(healthUrl) Then
    sh.Run appUrl, 1, False
    WScript.Quit 0
End If

' --- verify Node is available -------------------------------------------
If Not HasNode(sh) Then
    MsgBox "Node.js was not found on your PATH." & vbCrLf & vbCrLf & _
           "Install the LTS build from https://nodejs.org/ and try again.", _
           vbExclamation, "Task Manager"
    WScript.Quit 1
End If

' --- start the server, hidden window (0), do not wait (False) -----------
sh.Run "cmd /c node server.js", 0, False

' --- poll for readiness (~20s max) ------------------------------------
tries = 0
Do While tries < 50
    WScript.Sleep 400
    If BackendUp(healthUrl) Then Exit Do
    tries = tries + 1
Loop

If BackendUp(healthUrl) Then
    sh.Run appUrl, 1, False
Else
    MsgBox "The backend did not come up in time." & vbCrLf & vbCrLf & _
           "Run start.bat in this folder to see the error output.", _
           vbExclamation, "Task Manager"
    WScript.Quit 1
End If

WScript.Quit 0

' ---------------------------------------------------------------------------
Function BackendUp(url)
    Dim http
    BackendUp = False
    On Error Resume Next
    Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
    http.Open "GET", url, False
    http.SetTimeouts 1500, 1500, 1500, 1500
    http.Send
    If Err.Number = 0 Then
        If http.Status = 200 Then BackendUp = True
    End If
    On Error GoTo 0
End Function

Function HasNode(shell)
    Dim rc
    HasNode = False
    On Error Resume Next
    rc = shell.Run("cmd /c node --version", 0, True)   ' hidden, wait
    If Err.Number = 0 And rc = 0 Then HasNode = True
    On Error GoTo 0
End Function
