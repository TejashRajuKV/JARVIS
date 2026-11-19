$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class JarvisDesktopWindow {
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
  $request = $env:JARVIS_DESKTOP_REQUEST | ConvertFrom-Json
  $AE = [System.Windows.Automation.AutomationElement]
  if ($request.operation -eq 'list') {
    $rows = @()
    $roots = $AE::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($root in $roots) {
      try {
        $info = $root.Current
        if (!$info.Name -or !$info.NativeWindowHandle -or $info.IsOffscreen -or ![JarvisDesktopWindow]::IsWindowVisible([IntPtr]$info.NativeWindowHandle)) { continue }
        $process = Get-Process -Id $info.ProcessId -ErrorAction Stop
        $rows += @{ handle = [string]$info.NativeWindowHandle; pid = $info.ProcessId; title = $info.Name; app = $process.ProcessName }
        if ($rows.Count -ge 40) { break }
      } catch {}
    }
    @{ windows = @($rows) } | ConvertTo-Json -Depth 6 -Compress
    exit
  }
  if ($request.operation -eq 'read') {
    $foreground = [JarvisDesktopWindow]::GetForegroundWindow()
    $current = $AE::FromHandle($foreground).Current
    $request | Add-Member -NotePropertyName window -NotePropertyValue @{ handle = [string]$foreground; pid = $current.ProcessId; title = $current.Name }
  }
  $root = $AE::FromHandle([IntPtr][long]$request.window.handle)
  if (!$root -or $root.Current.ProcessId -ne $request.window.pid -or $root.Current.Name -cne $request.window.title -or
      ![JarvisDesktopWindow]::IsWindowVisible([IntPtr][long]$request.window.handle)) {
    throw 'The selected window changed or closed. Inspect it again.'
  }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $queue = [Collections.Generic.Queue[object]]::new()
  $queue.Enqueue(@{ element = $root; depth = 0 })
  $controls = @()
  $visited = 0
  $limited = $false
  $match = $null
  while ($queue.Count -gt 0 -and $visited -lt 800 -and $controls.Count -lt 250) {
    $node = $queue.Dequeue()
    $element = $node.element
    $visited++
    try {
      $info = $element.Current
      if ($info.IsPassword -or ($info.IsOffscreen -and $node.depth -gt 0)) { continue }
      $runtime = ($element.GetRuntimeId() -join '.')
      $invoke = $null; $valuePattern = $null
      $patterns = $element.GetSupportedPatterns()
      $canInvoke = $patterns -contains [System.Windows.Automation.InvokePattern]::Pattern
      $canValue = $patterns -contains [System.Windows.Automation.ValuePattern]::Pattern
      if ($canInvoke) {$invoke=$element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)}
      if ($canValue) {$valuePattern=$element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)}
      $selectionPattern=$null; $togglePattern=$null; $expandPattern=$null; $scrollPattern=$null
      $canSelect=$patterns -contains [System.Windows.Automation.SelectionItemPattern]::Pattern
      $canToggle=$patterns -contains [System.Windows.Automation.TogglePattern]::Pattern
      $canExpand=$patterns -contains [System.Windows.Automation.ExpandCollapsePattern]::Pattern
      $canScroll=$patterns -contains [System.Windows.Automation.ScrollPattern]::Pattern
      if($canSelect){$selectionPattern=$element.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)}
      if($canToggle){$togglePattern=$element.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)}
      if($canExpand){$expandPattern=$element.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)}
      if($canScroll){$scrollPattern=$element.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)}
      if (!$info.IsOffscreen -and ($info.Name -or $canInvoke -or $canValue -or $canSelect -or $canToggle -or $canExpand -or $canScroll)) {
        $item = @{ runtimeId = $runtime; name = $info.Name; type = $info.ControlType.ProgrammaticName; automationId = $info.AutomationId
          enabled = $info.IsEnabled; offscreen = $info.IsOffscreen; password = $info.IsPassword; invoke = $canInvoke
          writable = ($canValue -and !$valuePattern.Current.IsReadOnly); select=$canSelect; toggle=$canToggle; expand=$canExpand; scroll=$canScroll }
        $controls += $item
        if ($request.operation -eq 'act' -and $runtime -ceq $request.target.runtimeId) {
          if ($info.Name -cne $request.target.name -or $info.AutomationId -cne $request.target.automationId -or
              $info.ControlType.ProgrammaticName -cne $request.target.type -or !$info.IsEnabled) {
            throw 'The control changed. Inspect the window again.'
          }
          $match = @{ element = $element; invoke = $invoke; value = $valuePattern; selection=$selectionPattern; toggle=$togglePattern; expand=$expandPattern; scroll=$scrollPattern }
          if (!$request.strictTarget) { break }
        }
      }
      if ($node.depth -lt 32) {
        $child = $walker.GetFirstChild($element)
        while ($child -and $queue.Count -lt 800) {
          $queue.Enqueue(@{ element = $child; depth = $node.depth + 1 })
          $child = $walker.GetNextSibling($child)
        }
        if ($child) { $limited = $true }
      } elseif ($walker.GetFirstChild($element)) {
        $limited = $true
      }
    } catch [System.Windows.Automation.ElementNotAvailableException] {}
  }
  if ($request.operation -in @('inspect', 'read')) {
    if ($request.operation -eq 'read' -and [JarvisDesktopWindow]::GetForegroundWindow() -ne [IntPtr][long]$request.window.handle) {
      throw 'The foreground window changed while reading.'
    }
    @{ controls = @($controls); title = $request.window.title; truncated = ($limited -or $queue.Count -gt 0) } | ConvertTo-Json -Depth 6 -Compress
  } elseif ($request.operation -eq 'act') {
    if (!$match) { throw 'The control is no longer available. Inspect the window again.' }
    if ($request.strictTarget) {
      if ($limited -or $queue.Count -gt 0 -or @($controls | Where-Object { $_.name -ceq $request.target.name }).Count -ne 1 -or
          ($request.expected -and @($controls | Where-Object { $_.name -ceq $request.expected }).Count -ne 0)) {
        throw 'The target or expected result changed. Inspect the window again.'
      }
      $fresh = $match.element.Current
      if ($fresh.Name -cne $request.target.name -or $fresh.AutomationId -cne $request.target.automationId -or
          $fresh.ControlType.ProgrammaticName -cne $request.target.type -or !$fresh.IsEnabled -or $fresh.IsOffscreen -or $fresh.IsPassword) {
        throw 'The exact control changed before acting.'
      }
    }
    if ($request.action -eq 'select') {
      if (!$match.selection) {throw 'Selection is not supported.'}
      $match.selection.Select()
      @{verified=$match.selection.Current.IsSelected} | ConvertTo-Json -Compress
    } elseif ($request.action -eq 'toggle') {
      if (!$match.toggle) {throw 'Toggle is not supported.'}
      $wanted=if($request.value -eq 'on'){[System.Windows.Automation.ToggleState]::On}else{[System.Windows.Automation.ToggleState]::Off}
      for($attempt=0;$attempt -lt 3 -and $match.toggle.Current.ToggleState -ne $wanted;$attempt++) {$match.toggle.Toggle()}
      @{verified=($match.toggle.Current.ToggleState -eq $wanted)} | ConvertTo-Json -Compress
    } elseif ($request.action -in @('expand','collapse')) {
      if (!$match.expand) {throw 'Expand/collapse is not supported.'}
      if($request.action -eq 'expand'){$match.expand.Expand();$wanted=[System.Windows.Automation.ExpandCollapseState]::Expanded}
      else{$match.expand.Collapse();$wanted=[System.Windows.Automation.ExpandCollapseState]::Collapsed}
      @{verified=($match.expand.Current.ExpandCollapseState -eq $wanted)} | ConvertTo-Json -Compress
    } elseif ($request.action -eq 'scroll') {
      if (!$match.scroll) {throw 'Scrolling is not supported.'}
      $oldH=$match.scroll.Current.HorizontalScrollPercent;$oldV=$match.scroll.Current.VerticalScrollPercent
      $no=[System.Windows.Automation.ScrollAmount]::NoAmount
      $increment=[System.Windows.Automation.ScrollAmount]::SmallIncrement;$decrement=[System.Windows.Automation.ScrollAmount]::SmallDecrement
      if($request.value -eq 'down'){$match.scroll.Scroll($no,$increment)}
      elseif($request.value -eq 'up'){$match.scroll.Scroll($no,$decrement)}
      elseif($request.value -eq 'left'){$match.scroll.Scroll($decrement,$no)}
      else{$match.scroll.Scroll($increment,$no)}
      @{verified=($match.scroll.Current.HorizontalScrollPercent -ne $oldH -or $match.scroll.Current.VerticalScrollPercent -ne $oldV)} | ConvertTo-Json -Compress
    } elseif ($request.action -eq 'click') {
      if (!$match.invoke) { throw 'This control does not support clicking.' }
      # Some accessibility providers accept Invoke without dispatching the action
      # when the target has lost keyboard focus. Focus only the approved element,
      # then recheck its identity and the owning window before invoking it once.
      if ($match.element.Current.IsKeyboardFocusable) { $match.element.SetFocus() }
      $clickInfo = $match.element.Current
      if ($root.Current.ProcessId -ne $request.window.pid -or $root.Current.Name -cne $request.window.title -or
          $clickInfo.Name -cne $request.target.name -or $clickInfo.AutomationId -cne $request.target.automationId -or
          $clickInfo.ControlType.ProgrammaticName -cne $request.target.type -or !$clickInfo.IsEnabled -or
          $clickInfo.IsOffscreen -or $clickInfo.IsPassword) {
        throw 'The approved click target changed while focusing. Inspect it again.'
      }
      $match.invoke.Invoke()
      $verified = $false
      if ($request.strictTarget) {
        $name = [System.Windows.Automation.PropertyCondition]::new($AE::NameProperty, [string]$request.expected)
        for ($attempt = 0; $attempt -lt 10; $attempt++) {
          try {
            $hits = @($root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $name) | Where-Object { !$_.Current.IsOffscreen -and !$_.Current.IsPassword })
            if ($hits.Count -eq 1) { $verified = $true; break }
          } catch [System.Windows.Automation.ElementNotAvailableException] { break }
          Start-Sleep -Milliseconds 100
        }
      }
      @{ verified = $verified } | ConvertTo-Json -Compress
    } elseif ($request.action -eq 'fill') {
      if (!$match.value -or $match.value.Current.IsReadOnly) { throw 'This field is read-only.' }
      $match.value.SetValue([string]$request.value)
      $verified = $false
      for ($attempt = 0; $attempt -lt 10; $attempt++) {
        if ($match.value.Current.Value -ceq [string]$request.value) { $verified = $true; break }
        Start-Sleep -Milliseconds 100
      }
      @{ verified = $verified } | ConvertTo-Json -Compress
    } else { throw 'Unknown desktop action.' }
  } else { throw 'Unknown desktop operation.' }
} catch {
  @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
}
