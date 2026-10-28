// Reports when a full-screen app (video, game, presentation, F11 browser) is in front:
// the foreground window covers its whole monitor, taskbar included. A maximized window
// stops at the taskbar, so it doesn't count. Polled by a small long-lived PowerShell helper.
// (SHQueryUserNotificationState isn't used: it reports maximized frameless windows,
// such as Claude or Cursor, as full screen.)
//
// Ignored as foreground: the desktop and taskbar, the island's own windows, and overlays
// that cover the screen without being an app (click-through, tool or non-activating
// windows, e.g. the NVIDIA GeForce overlay, which takes focus when the island lets go of it).
const { spawn } = require('child_process');

const POLL_MS = 1000;
const CONFIRM_POLLS = 2; // full screen must hold this many polls before the island hides

const script = (ownPid) => `
Add-Type -Namespace DynamicIsland -Name User32 -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
[StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; }
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
[DllImport("user32.dll")] public static extern int GetWindowLong(System.IntPtr h, int index);
[DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr h, out int pid);
[DllImport("user32.dll")] public static extern System.IntPtr MonitorFromWindow(System.IntPtr h, int flags);
[DllImport("user32.dll")] public static extern bool GetMonitorInfo(System.IntPtr m, ref MONITORINFO mi);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(System.IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
'@
[void][DynamicIsland.User32]::SetProcessDPIAware()
$shell = @('Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd')
$overlay = 0x20 -bor 0x80 -bor 0x08000000  # WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE
$last = ''
$streak = 0
while ($true) {
  $full = 0
  $h = [DynamicIsland.User32]::GetForegroundWindow()
  if ($h -ne [System.IntPtr]::Zero -and [DynamicIsland.User32]::IsWindowVisible($h)) {
    $cls = New-Object System.Text.StringBuilder 64
    [void][DynamicIsland.User32]::GetClassName($h, $cls, 64)
    $owner = 0
    [void][DynamicIsland.User32]::GetWindowThreadProcessId($h, [ref]$owner)
    $ex = [DynamicIsland.User32]::GetWindowLong($h, -20)
    $r = New-Object DynamicIsland.User32+RECT
    $mi = New-Object DynamicIsland.User32+MONITORINFO
    $mi.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($mi)
    if (($shell -notcontains $cls.ToString()) -and $owner -ne ${ownPid} -and -not ($ex -band $overlay) -and
        [DynamicIsland.User32]::GetWindowRect($h, [ref]$r) -and
        [DynamicIsland.User32]::GetMonitorInfo([DynamicIsland.User32]::MonitorFromWindow($h, 2), [ref]$mi)) {
      $m = $mi.rcMonitor
      if ($r.L -le $m.L -and $r.T -le $m.T -and $r.R -ge $m.R -and $r.B -ge $m.B) { $full = 1 }
    }
  }
  # Leaving full screen shows the island at once; entering it must hold for a moment.
  if ($full) { $streak++ } else { $streak = 0 }
  $state = if ($streak -ge ${CONFIRM_POLLS}) { 1 } else { 0 }
  if ("$state" -ne $last) { [Console]::Out.WriteLine($state); [Console]::Out.Flush(); $last = "$state" }
  Start-Sleep -Milliseconds ${POLL_MS}
}`;

// Calls onChange(isFullscreen) on every change; returns stop().
function watchFullscreen(onChange) {
  if (process.platform !== 'win32') return () => {};

  const encoded = Buffer.from(script(process.pid), 'utf16le').toString('base64');
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  let buf = '';
  ps.stdout.setEncoding('utf8');
  ps.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line === '0' || line === '1') onChange(line === '1');
    }
  });
  ps.on('error', () => {}); // no PowerShell: the island just never hides

  return () => ps.kill();
}

module.exports = { watchFullscreen };
