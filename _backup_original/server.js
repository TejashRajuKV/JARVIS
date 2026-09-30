const express = require('express');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});
app.use(express.static(path.join(__dirname)));

// Allowed applications — Windows uses 'start' which finds apps via registry/PATH automatically
const APPS = {
  chrome:          { win: 'start chrome',       unix: 'google-chrome' },
  'google chrome': { win: 'start chrome',       unix: 'google-chrome' },
  firefox:         { win: 'start firefox',      unix: 'firefox' },
  edge:            { win: 'start msedge',       unix: 'microsoft-edge' },
  vscode:          { win: 'start code',         unix: 'code' },
  'vs code':       { win: 'start code',         unix: 'code' },
  notepad:         { win: 'start notepad',      unix: 'gedit' },
  terminal:        { win: 'start cmd',          unix: 'gnome-terminal' },
  powershell:      { win: 'start powershell',   unix: 'bash' },
  calculator:      { win: 'start calc',         unix: 'gnome-calculator' },
  'file explorer': { win: 'start explorer',     unix: 'nautilus' },
  explorer:        { win: 'start explorer',     unix: 'nautilus' },
  calendar:        { win: 'start outlookcal:',  unix: 'gnome-calendar' },
  outlook:         { win: 'start outlook',      unix: 'thunderbird' },
  mail:            { win: 'start outlook',      unix: 'thunderbird' },
  word:            { win: 'start winword',      unix: 'libreoffice --writer' },
  excel:           { win: 'start excel',        unix: 'libreoffice --calc' },
  spotify:         { win: 'start spotify',      unix: 'spotify' },
  discord:         { win: 'start discord',      unix: 'discord' },
  slack:           { win: 'start slack',        unix: 'slack' },
  zoom:            { win: 'start zoom',         unix: 'zoom' },
  teams:           { win: 'start teams',        unix: 'teams' },
  steam:           { win: 'start steam',        unix: 'steam' },
  antigravity:     { win: 'start agy',          unix: 'agy' },
  paint:           { win: 'start mspaint',      unix: 'gimp' },
  taskmanager:     { win: 'start taskmgr',      unix: 'gnome-system-monitor' },
  'task manager':  { win: 'start taskmgr',      unix: 'gnome-system-monitor' },
};

// Tool: Open Application
app.post('/api/tool/openApplication', (req, res) => {
  const { app: appName } = req.body;

  if (!appName) {
    return res.status(400).json({ error: 'App name required' });
  }

  const entry = APPS[appName.toLowerCase()];
  if (!entry) {
    return res.status(400).json({ error: `Application "${appName}" not in allowlist` });
  }

  if (process.platform === 'win32') {
    // On Windows, use 'cmd /c start' — this uses the OS registry so it works
    // regardless of exact install path. It's equivalent to typing in Run dialog.
    const cmd = entry.win;
    exec(`cmd /c ${cmd}`, (err) => {
      if (err) {
        console.warn(`Warning: failed to open ${appName} via "${cmd}":`, err.message);
        // Try direct spawn as last resort
        const fallbackName = cmd.replace('start ', '');
        const proc = spawn(fallbackName, [], { detached: true, stdio: 'ignore', shell: true });
        proc.unref();
      }
    });
    // Respond immediately — 'start' returns before the window appears which is correct
    res.json({ success: true, message: `Opening ${appName}`, command: cmd });
  } else {
    // Unix: spawn directly
    const cmd = entry.unix;
    const parts = cmd.split(' ');
    const proc = spawn(parts[0], parts.slice(1), { detached: true, stdio: 'ignore' });
    proc.unref();
    proc.on('error', (err) => console.warn(`Warning: spawn ${cmd} failed:`, err.message));
    res.json({ success: true, message: `Opening ${appName}`, command: cmd });
  }
});


// Tool: Close Application
app.post('/api/tool/closeApplication', (req, res) => {
  const { app: appName } = req.body;
  
  if (!appName) {
    return res.status(400).json({ error: 'App name required' });
  }

  try {
    let cmd, args;
    if (process.platform === 'win32') {
      cmd = 'taskkill';
      args = ['/IM', `${appName}.exe`, '/F'];
    } else {
      cmd = 'killall';
      args = [appName];
    }
    const proc = spawn(cmd, args, { stdio: 'ignore' });
    proc.on('error', (err) => {
      console.warn(`Failed to close ${appName}:`, err.message);
    });
    res.json({ success: true, message: `Closing ${appName}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tool: Calculate
app.post('/api/tool/calculate', (req, res) => {
  const { expression } = req.body;
  
  try {
    const result = Function('"use strict";return (' + expression + ')')();
    res.json({ success: true, result });
  } catch (error) {
    res.status(400).json({ error: 'Invalid expression' });
  }
});

// Tool: Create Folder
app.post('/api/tool/createFolder', (req, res) => {
  const { name } = req.body;
  const folderPath = path.join(__dirname, name);

  if (!name || name.includes('..')) {
    return res.status(400).json({ error: 'Invalid folder name' });
  }

  try {
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
      res.json({ success: true, message: `Folder "${name}" created` });
    } else {
      res.json({ success: true, message: `Folder "${name}" already exists` });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tool: List Files
app.get('/api/tool/listFiles', (req, res) => {
  try {
    const files = fs.readdirSync(__dirname);
    res.json({ success: true, files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tool: Read File
app.get('/api/tool/readFile', (req, res) => {
  const { name } = req.query;
  const filePath = path.join(__dirname, name);

  if (!name || name.includes('..')) {
    return res.status(400).json({ error: 'Invalid file name' });
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ success: true, content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tool: Get System Info
app.get('/api/tool/systemInfo', (req, res) => {
  const os = require('os');
  
  // Calculate CPU usage percentage
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  cpus.forEach(cpu => {
    for (let type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  });
  const cpuUsage = 100 - ~~(100 * totalIdle / totalTick) || 0;
  
  // Calculate memory usage
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsagePercent = Math.round((usedMemory / totalMemory) * 100);
  
  // Get free disk space (approximate - using available memory as proxy)
  const diskFreeGB = Math.round(freeMemory / 1024 / 1024 / 1024);
  
  // Simulate temperature reading (0-80°C range)
  const loadAvg = os.loadavg()[0] / cpus.length;
  const temp = 35 + (loadAvg * 25); // Scale load average to temperature
  
  const info = {
    success: true,
    platform: process.platform,
    cpus: cpus.length,
    cpuUsage: Math.round(cpuUsage),
    totalMemory: Math.round(totalMemory / 1024 / 1024 / 1024),
    freeMemory: Math.round(freeMemory / 1024 / 1024 / 1024),
    usedMemory: Math.round(usedMemory / 1024 / 1024 / 1024),
    memoryUsagePercent: memoryUsagePercent,
    diskFreeGB: diskFreeGB,
    temperature: Math.round(temp * 10) / 10,
    uptime: Math.round(os.uptime() / 60),
    loadAverage: os.loadavg().map(x => parseFloat(x.toFixed(2)))
  };
  res.json(info);
});

// Tool: Lock System
app.post('/api/tool/lockSystem', (req, res) => {
  try {
    if (process.platform === 'win32') {
      spawn('rundll32.exe', ['user32.dll,LockWorkStation']);
    } else if (process.platform === 'darwin') {
      spawn('pmset', ['displaysleepnow']);
    } else {
      spawn('xdg-screensaver', ['lock']);
    }
    res.json({ success: true, message: 'System locked' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tool: Sleep System
app.post('/api/tool/sleepSystem', (req, res) => {
  try {
    if (process.platform === 'win32') {
      exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0');
    } else if (process.platform === 'darwin') {
      exec('pmset sleepnow');
    } else {
      exec('systemctl suspend');
    }
    res.json({ success: true, message: 'Sleeping now' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tool: Shutdown System (requires confirmation from frontend)
app.post('/api/tool/shutdownSystem', (req, res) => {
  try {
    if (process.platform === 'win32') {
      exec('shutdown /s /t 10');
    } else {
      exec('shutdown -h +1');
    }
    res.json({ success: true, message: 'Shutdown in 10 seconds' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tool: Restart System (requires confirmation from frontend)
app.post('/api/tool/restartSystem', (req, res) => {
  try {
    if (process.platform === 'win32') {
      exec('shutdown /r /t 10');
    } else {
      exec('shutdown -r +1');
    }
    res.json({ success: true, message: 'Restart in 10 seconds' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tool: Cancel Shutdown/Restart
app.post('/api/tool/cancelShutdown', (req, res) => {
  try {
    if (process.platform === 'win32') {
      exec('shutdown /a');
    } else {
      exec('shutdown -c');
    }
    res.json({ success: true, message: 'Shutdown cancelled' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tool: Volume Control (Windows via PowerShell/nircmd)
app.post('/api/tool/setVolume', (req, res) => {
  const { level, action } = req.body; // action: 'set', 'mute', 'unmute', 'up', 'down'
  try {
    if (process.platform === 'win32') {
      let cmd;
      if (action === 'mute') {
        cmd = `powershell -c "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"`;
      } else if (action === 'unmute') {
        cmd = `powershell -c "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"`;
      } else if (action === 'up') {
        cmd = `powershell -c "for($i=0;$i -lt 5;$i++){(New-Object -ComObject WScript.Shell).SendKeys([char]175)}"`;
      } else if (action === 'down') {
        cmd = `powershell -c "for($i=0;$i -lt 5;$i++){(New-Object -ComObject WScript.Shell).SendKeys([char]174)}"`;
      } else if (action === 'set' && level !== undefined) {
        const vol = Math.max(0, Math.min(100, parseInt(level)));
        cmd = `powershell -c "$wshell = New-Object -ComObject wscript.shell; $vol = [Math]::Round(${vol} * 65535 / 100); (New-Object -comObject Shell.Application).SetVolumeLevel($vol)"`;
      }
      if (cmd) exec(cmd);
    } else if (process.platform === 'darwin') {
      const vol = Math.max(0, Math.min(100, parseInt(level) || 50));
      if (action === 'mute') exec('osascript -e "set volume output muted true"');
      else if (action === 'unmute') exec('osascript -e "set volume output muted false"');
      else exec(`osascript -e "set volume output volume ${vol}"`);
    } else {
      if (action === 'mute') exec('amixer set Master mute');
      else if (action === 'unmute') exec('amixer set Master unmute');
      else if (action === 'up') exec('amixer set Master 5%+');
      else if (action === 'down') exec('amixer set Master 5%-');
    }
    res.json({ success: true, message: `Volume ${action || 'set'} ${level !== undefined ? 'to ' + level + '%' : ''}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tool: Media keys (Play/Pause/Next/Previous)
app.post('/api/tool/mediaKey', (req, res) => {
  const { key } = req.body; // 'play', 'next', 'prev', 'stop'
  try {
    if (process.platform === 'win32') {
      const keys = { play: 179, next: 176, prev: 177, stop: 178 };
      const code = keys[key] || 179;
      exec(`powershell -c "(New-Object -ComObject WScript.Shell).SendKeys([char]${code})"`);
    } else if (process.platform === 'darwin') {
      const cmds = { play: 'play', next: 'next track', prev: 'previous track', stop: 'pause' };
      exec(`osascript -e "tell application \\"Music\\" to ${cmds[key] || 'pause'}"`);
    } else {
      const keys = { play: 'XF86AudioPlay', next: 'XF86AudioNext', prev: 'XF86AudioPrev', stop: 'XF86AudioStop' };
      exec(`xdotool key ${keys[key] || 'XF86AudioPlay'}`);
    }
    res.json({ success: true, message: `Media: ${key}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tool: Screenshot (saves to desktop)
app.post('/api/tool/screenshot', (req, res) => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `JARVIS_screenshot_${timestamp}.png`;
    const desktop = path.join(os.homedir(), 'Desktop', filename);
    let cmd;
    if (process.platform === 'win32') {
      cmd = `powershell -c "Add-Type -AssemblyName System.Windows.Forms; $bmp = New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width, [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Location, [System.Drawing.Point]::Empty, $bmp.Size); $bmp.Save('${desktop.replace(/\\/g, '\\\\')}'); $g.Dispose(); $bmp.Dispose()"`;
    } else if (process.platform === 'darwin') {
      cmd = `screencapture ${desktop}`;
    } else {
      cmd = `scrot ${desktop}`;
    }
    exec(cmd, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, file: filename, path: desktop });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tool: Get Battery Status
app.post('/api/tool/batteryStatus', (req, res) => {
  try {
    if (process.platform === 'win32') {
      exec(`powershell -c "Get-WmiObject -Class Win32_Battery | Select-Object -Property EstimatedChargeRemaining, BatteryStatus | ConvertTo-Json"`, (err, stdout) => {
        if (err || !stdout.trim()) return res.json({ success: true, level: null, status: 'No battery detected (desktop)' });
        try {
          const data = JSON.parse(stdout);
          const level = data.EstimatedChargeRemaining || 0;
          const status = data.BatteryStatus === 2 ? 'Charging' : 'Discharging';
          res.json({ success: true, level, status });
        } catch {
          res.json({ success: true, level: null, status: 'No battery detected' });
        }
      });
    } else {
      exec('pmset -g batt', (err, stdout) => {
        if (err) return res.json({ success: true, level: null, status: 'Unknown' });
        const match = stdout.match(/(\d+)%/);
        const charging = /charging|AC Power/.test(stdout);
        res.json({ success: true, level: match ? parseInt(match[1]) : null, status: charging ? 'Charging' : 'Discharging' });
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tool: List Running Processes
app.post('/api/tool/listProcesses', (req, res) => {
  try {
    let cmd;
    if (process.platform === 'win32') {
      cmd = `powershell -c "Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 | Select-Object Name, @{N='CPU';E={[Math]::Round($_.CPU,1)}}, @{N='RAM_MB';E={[Math]::Round($_.WorkingSet/1MB,1)}} | ConvertTo-Json"`;
    } else {
      cmd = `ps aux --sort=-%cpu | head -11 | tail -10 | awk '{print $11, $3, $4}'`;
    }
    exec(cmd, (err, stdout) => {
      if (err) return res.status(500).json({ error: err.message });
      try {
        const procs = process.platform === 'win32' ? JSON.parse(stdout) : stdout.trim().split('\n').map(l => {
          const [name, cpu, mem] = l.split(' ');
          return { Name: name, CPU: parseFloat(cpu), RAM_MB: parseFloat(mem) };
        });
        res.json({ success: true, processes: Array.isArray(procs) ? procs : [procs] });
      } catch {
        res.json({ success: true, processes: [], raw: stdout });
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tool: Rename File
app.post('/api/tool/renameFile', (req, res) => {
  const { oldName, newName } = req.body;
  if (!oldName || !newName || oldName.includes('..') || newName.includes('..')) {
    return res.status(400).json({ error: 'Invalid names' });
  }
  const oldPath = path.join(__dirname, oldName);
  const newPath = path.join(__dirname, newName);
  try {
    fs.renameSync(oldPath, newPath);
    res.json({ success: true, message: `Renamed "${oldName}" to "${newName}"` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tool: Copy File
app.post('/api/tool/copyFile', (req, res) => {
  const { src, dest } = req.body;
  if (!src || !dest || src.includes('..') || dest.includes('..')) {
    return res.status(400).json({ error: 'Invalid paths' });
  }
  const srcPath = path.join(__dirname, src);
  const destPath = path.join(__dirname, dest);
  try {
    fs.copyFileSync(srcPath, destPath);
    res.json({ success: true, message: `Copied "${src}" to "${dest}"` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tool: Move File
app.post('/api/tool/moveFile', (req, res) => {
  const { src, dest } = req.body;
  if (!src || !dest || src.includes('..') || dest.includes('..')) {
    return res.status(400).json({ error: 'Invalid paths' });
  }
  const srcPath = path.join(__dirname, src);
  const destPath = path.join(__dirname, dest);
  try {
    fs.renameSync(srcPath, destPath);
    res.json({ success: true, message: `Moved "${src}" to "${dest}"` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tool: Search Files
app.post('/api/tool/searchFiles', (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query required' });
  try {
    const results = [];
    const walkDir = (dir, depth) => {
      if (depth > 3) return;
      const items = fs.readdirSync(dir);
      for (const item of items) {
        if (item.startsWith('.') || item === 'node_modules') continue;
        if (item.toLowerCase().includes(query.toLowerCase())) {
          results.push(path.relative(__dirname, path.join(dir, item)));
        }
        const full = path.join(dir, item);
        if (fs.statSync(full).isDirectory()) walkDir(full, depth + 1);
      }
    };
    walkDir(__dirname, 0);
    res.json({ success: true, results: results.slice(0, 20) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tool: Git Status
app.post('/api/tool/gitStatus', (req, res) => {
  exec('git status --short', { cwd: __dirname }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: 'Not a git repo or git not installed' });
    res.json({ success: true, output: stdout.trim() || 'Working tree clean' });
  });
});

// Tool: Git Log (last 5 commits)
app.post('/api/tool/gitLog', (req, res) => {
  exec('git log --oneline -5', { cwd: __dirname }, (err, stdout) => {
    if (err) return res.status(500).json({ error: 'Not a git repo or git not installed' });
    res.json({ success: true, output: stdout.trim() || 'No commits yet' });
  });
});

// Tool: Git Diff
app.post('/api/tool/gitDiff', (req, res) => {
  exec('git diff --stat', { cwd: __dirname }, (err, stdout) => {
    if (err) return res.status(500).json({ error: 'Not a git repo or git not installed' });
    res.json({ success: true, output: stdout.trim() || 'No changes' });
  });
});

// Tool: Git Commit
app.post('/api/tool/gitCommit', (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Commit message required' });
  exec(`git add -A && git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: __dirname }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.json({ success: true, output: stdout.trim() });
  });
});

// Tool: Check Port
app.post('/api/tool/checkPort', (req, res) => {
  const { port } = req.body;
  if (!port) return res.status(400).json({ error: 'Port required' });
  const cmd = process.platform === 'win32'
    ? `netstat -ano | findstr :${port}`
    : `lsof -i :${port}`;
  exec(cmd, (err, stdout) => {
    res.json({ success: true, inUse: !!stdout.trim(), output: stdout.trim() || `Port ${port} is free` });
  });
});

// Tool: Read Clipboard
app.post('/api/tool/readClipboard', (req, res) => {
  try {
    let cmd, args;
    if (process.platform === 'win32') {
      cmd = 'powershell.exe';
      args = ['-command', 'Get-Clipboard'];
    } else if (process.platform === 'darwin') {
      cmd = 'pbpaste';
      args = [];
    } else {
      cmd = 'xclip';
      args = ['-selection', 'clipboard', '-o'];
    }
    const proc = spawn(cmd, args);
    let out = '';
    proc.stdout.on('data', d => out += d);
    proc.on('close', () => res.json({ success: true, content: out.trim() }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tool: Network Info
app.post('/api/tool/networkInfo', (req, res) => {
  try {
    const interfaces = os.networkInterfaces();
    let ip = 'Unknown';
    let iface = 'Unknown';
    for (let k in interfaces) {
      for (let a of interfaces[k]) {
        if (a.family === 'IPv4' && !a.internal) { ip = a.address; iface = k; break; }
      }
    }
    res.json({ success: true, ip, interface: iface, hostname: os.hostname() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tool: Write to Clipboard
app.post('/api/tool/writeClipboard', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });
  try {
    if (process.platform === 'win32') {
      exec(`powershell -c "Set-Clipboard -Value '${text.replace(/'/g, "''")}'"`, () =>
        res.json({ success: true, message: 'Copied to clipboard' }));
    } else if (process.platform === 'darwin') {
      const p = spawn('pbcopy');
      p.stdin.write(text); p.stdin.end();
      p.on('close', () => res.json({ success: true, message: 'Copied to clipboard' }));
    } else {
      const p = spawn('xclip', ['-selection', 'clipboard']);
      p.stdin.write(text); p.stdin.end();
      p.on('close', () => res.json({ success: true, message: 'Copied to clipboard' }));
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'online', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🤖 JARVIS backend running on http://localhost:${PORT}`);
  console.log('Connected to frontend — real tool execution enabled');
});

