Add-Type -AssemblyName PresentationFramework
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class JarvisFixtureWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
}
'@
$form = [Windows.Window]::new()
$form.Title = $env:JARVIS_FIXTURE_TITLE
$form.Width = 460
$form.Height = 350
$stack = [Windows.Controls.StackPanel]::new()
$stack.Margin = [Windows.Thickness]::new(20)
$field = [Windows.Controls.TextBox]::new()
$field.Name = 'MessageInput'
$field.Height = 30
[Windows.Automation.AutomationProperties]::SetName($field, 'Message')
$button = [Windows.Controls.Button]::new()
$button.Content = 'Apply'
$button.Height = 30
$button.Margin = [Windows.Thickness]::new(0, 10, 0, 10)
$label = [Windows.Controls.Label]::new()
$label.Content = 'Waiting'
$password = [Windows.Controls.PasswordBox]::new()
$password.Password = 'hidden-private-fixture'
[Windows.Automation.AutomationProperties]::SetName($password, 'Secret fixture')
$button.Add_Click({ $label.Content = 'Applied: ' + $field.Text })
[void]$stack.Children.Add($field)
[void]$stack.Children.Add($button)
[void]$stack.Children.Add($label)
[void]$stack.Children.Add($password)
$check = [Windows.Controls.CheckBox]::new()
$check.Content = 'Fixture option'
[void]$stack.Children.Add($check)
$choices = [Windows.Controls.ListBox]::new()
$choices.Height = 65
[void]$choices.Items.Add('DBMS fixture')
[void]$choices.Items.Add('OS fixture')
[void]$stack.Children.Add($choices)
$form.Content = $stack
$form.Add_ContentRendered({
  $native = [Windows.Interop.WindowInteropHelper]::new($form)
  [void][JarvisFixtureWindow]::ShowWindow($native.Handle, 5)
})
$timer = [Windows.Threading.DispatcherTimer]::new()
$timer.Interval = [TimeSpan]::FromSeconds(90)
$timer.Add_Tick({ $form.Close() })
$timer.Start()
try { [void]$form.ShowDialog() } finally { $timer.Stop(); $form.Close() }
