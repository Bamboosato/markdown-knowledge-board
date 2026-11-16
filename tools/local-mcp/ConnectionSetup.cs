using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal sealed class SetupConfig
{
    public string nodePath { get; set; }
    public string stateDirectory { get; set; }
    public string mkbShortcut { get; set; }
}

internal sealed class ConnectionSetup : Form
{
    private readonly SetupConfig config;
    private readonly string directory = AppDomain.CurrentDomain.BaseDirectory;
    private readonly Label status = new Label();
    private readonly Button copy = new Button();

    private ConnectionSetup(SetupConfig settings)
    {
        config = settings;
        Text = "MKB Connection Setup";
        AutoScaleMode = AutoScaleMode.Dpi;
        AutoScaleDimensions = new SizeF(96, 96);
        ClientSize = new Size(360, 216);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        Font = new Font("Segoe UI", 10);
        string iconPath = Path.Combine(directory, "mkb.ico");
        if (File.Exists(iconPath)) Icon = new Icon(iconPath);

        copy.Text = "Copy connection code";
        copy.SetBounds(20, 20, 320, 42);
        copy.TabIndex = 0;
        copy.Click += CopyCode;
        Button open = new Button();
        open.Text = "Open MKB";
        open.SetBounds(20, 72, 320, 42);
        open.TabIndex = 1;
        open.Click += OpenMkb;
        status.Text = "Ready.";
        status.SetBounds(20, 122, 320, 36);
        status.AccessibleName = "Status";
        Button close = new Button();
        close.Text = "Close";
        close.SetBounds(240, 164, 100, 36);
        close.TabIndex = 2;
        close.DialogResult = DialogResult.Cancel;
        close.Click += delegate { Close(); };
        CancelButton = close;
        Controls.AddRange(new Control[] { copy, open, status, close });
    }

    private void CopyCode(object sender, EventArgs args)
    {
        copy.Enabled = false;
        try
        {
            ProcessStartInfo info = new ProcessStartInfo(config.nodePath);
            info.Arguments = "\"" + Path.Combine(directory, "setup-code.mjs") + "\"";
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            info.EnvironmentVariables["MKB_MCP_STATE_DIR"] = config.stateDirectory;
            using (Process process = Process.Start(info))
            {
                if (!process.WaitForExit(5000))
                {
                    process.Kill();
                    throw new InvalidOperationException();
                }
                string code = process.StandardOutput.ReadToEnd();
                if (process.ExitCode != 0 || !System.Text.RegularExpressions.Regex.IsMatch(
                    code, @"\AMKB1\|http://127\.0\.0\.1:[0-9]{1,5}\|[a-f0-9]{64}\z"))
                    throw new InvalidOperationException();
                Clipboard.SetText(code);
            }
            status.Text = "Copied.";
        }
        catch { status.Text = "Could not copy. Check settings and retry."; }
        finally { copy.Enabled = true; }
    }

    private void OpenMkb(object sender, EventArgs args)
    {
        try
        {
            if (!File.Exists(config.mkbShortcut)) throw new FileNotFoundException();
            // Preserve the installed PWA's browser profile and local notes.
            Process.Start(new ProcessStartInfo(config.mkbShortcut) { UseShellExecute = true });
            status.Text = "MKB opened.";
        }
        catch { status.Text = "Could not open MKB. Reinstall its shortcut."; }
    }

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try
        {
            string path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "setup-config.json");
            SetupConfig config = new JavaScriptSerializer().Deserialize<SetupConfig>(File.ReadAllText(path));
            using (ConnectionSetup form = new ConnectionSetup(config)) Application.Run(form);
        }
        catch { MessageBox.Show("Please reinstall MKB Connection Setup.", "MKB Connection Setup"); }
    }
}
