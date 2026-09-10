using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

internal static class PortableAgentLauncher
{
    private const string MutexName = "KOLCRM.DouyinAgent.Portable";
    private static readonly object LogLock = new object();
    private static Mutex instanceMutex;
    private static Process agentProcess;
    private static NotifyIcon trayIcon;
    private static string dataRoot;
    private static string logFile;
    private static bool exiting;

    [STAThread]
    private static void Main()
    {
        bool createdNew;
        instanceMutex = new Mutex(true, MutexName, out createdNew);
        if (!createdNew)
        {
            MessageBox.Show("达人采集助手已经在运行，请查看系统托盘。", "达人采集助手", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        string root = AppDomain.CurrentDomain.BaseDirectory;
        string appRoot = Path.Combine(root, "app");
        string nodePath = Path.Combine(appRoot, "runtime", "node", "node.exe");
        string pythonPath = Path.Combine(appRoot, "runtime", "python", "python.exe");
        string serverPath = Path.Combine(appRoot, "local-agent", "server.mjs");
        string crawlerRoot = Path.Combine(appRoot, "MediaCrawler-main");

        dataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "KOLCRM", "Agent");
        Directory.CreateDirectory(dataRoot);
        Directory.CreateDirectory(Path.Combine(dataRoot, "logs"));
        logFile = Path.Combine(dataRoot, "logs", "agent.log");

        string missing = FirstMissing(nodePath, pythonPath, serverPath, Path.Combine(crawlerRoot, "main.py"));
        if (missing != null)
        {
            MessageBox.Show("便携包不完整，缺少：\n" + missing + "\n\n请重新解压完整压缩包。", "达人采集助手", MessageBoxButtons.OK, MessageBoxIcon.Error);
            ReleaseMutex();
            return;
        }

        BuildTrayIcon();
        Application.ApplicationExit += delegate { StopAgent(); ReleaseMutex(); };

        try
        {
            StartAgent(appRoot, nodePath, pythonPath, serverPath, crawlerRoot);
        }
        catch (Exception error)
        {
            AppendLog("Launcher error: " + error);
            MessageBox.Show("达人采集助手启动失败：\n" + error.Message + "\n\n日志：" + logFile, "达人采集助手", MessageBoxButtons.OK, MessageBoxIcon.Error);
            trayIcon.Dispose();
            ReleaseMutex();
            return;
        }

        Application.Run();
    }

    private static string FirstMissing(params string[] paths)
    {
        foreach (string path in paths) if (!File.Exists(path)) return path;
        return null;
    }

    private static void BuildTrayIcon()
    {
        ContextMenuStrip menu = new ContextMenuStrip();
        ToolStripMenuItem status = new ToolStripMenuItem("状态：正在启动");
        status.Name = "status";
        status.Enabled = false;
        menu.Items.Add(status);
        menu.Items.Add("打开运行日志", null, delegate { OpenPath(logFile); });
        menu.Items.Add("检查本地连接", null, delegate { OpenPath("http://127.0.0.1:17321/health"); });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("退出", null, delegate { exiting = true; Application.Exit(); });

        trayIcon = new NotifyIcon();
        trayIcon.Icon = SystemIcons.Application;
        trayIcon.Text = "达人采集助手";
        trayIcon.ContextMenuStrip = menu;
        trayIcon.Visible = true;
        trayIcon.DoubleClick += delegate { OpenPath("http://127.0.0.1:17321/health"); };
    }

    private static void StartAgent(string appRoot, string nodePath, string pythonPath, string serverPath, string crawlerRoot)
    {
        ProcessStartInfo startInfo = new ProcessStartInfo();
        startInfo.FileName = nodePath;
        startInfo.Arguments = "--experimental-strip-types \"" + serverPath + "\"";
        startInfo.WorkingDirectory = appRoot;
        startInfo.UseShellExecute = false;
        startInfo.CreateNoWindow = true;
        startInfo.RedirectStandardOutput = true;
        startInfo.RedirectStandardError = true;
        startInfo.EnvironmentVariables["KOL_AGENT_PORTABLE"] = "1";
        startInfo.EnvironmentVariables["KOL_AGENT_AUTO_OPEN_CHROME"] = "1";
        startInfo.EnvironmentVariables["KOL_CRM_ROOT"] = appRoot;
        startInfo.EnvironmentVariables["KOL_AGENT_DATA_ROOT"] = dataRoot;
        startInfo.EnvironmentVariables["MEDIACRAWLER_ROOT"] = crawlerRoot;
        startInfo.EnvironmentVariables["MEDIACRAWLER_OUTPUT_ROOT"] = Path.Combine(dataRoot, "mediacrawler-data");
        startInfo.EnvironmentVariables["CRAWLER_PYTHON_COMMAND"] = pythonPath;
        startInfo.EnvironmentVariables["CDP_USER_DATA_DIR"] = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "KOLCRM", "ChromeProfile");
        startInfo.EnvironmentVariables["KOL_CRM_CDP_LOCK_DIR"] = Path.Combine(dataRoot, "cdp.lock");
        startInfo.EnvironmentVariables["PYTHONUTF8"] = "1";
        startInfo.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
        startInfo.EnvironmentVariables["PATH"] = Path.GetDirectoryName(pythonPath) + ";" + (Environment.GetEnvironmentVariable("PATH") ?? "");
        LoadCentralConfig(startInfo, Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "central-agent.conf"));

        agentProcess = new Process();
        agentProcess.StartInfo = startInfo;
        agentProcess.EnableRaisingEvents = true;
        agentProcess.OutputDataReceived += delegate(object sender, DataReceivedEventArgs args) { if (args.Data != null) AppendLog(args.Data); };
        agentProcess.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs args) { if (args.Data != null) AppendLog(args.Data); };
        agentProcess.Exited += delegate
        {
            if (exiting) return;
            AppendLog("Agent process exited unexpectedly with code " + agentProcess.ExitCode + ".");
            SetStatus("状态：运行异常");
            ShowBalloon("达人采集助手运行异常", "请打开运行日志查看原因。", ToolTipIcon.Error);
        };

        AppendLog("Starting portable agent " + DateTime.Now.ToString("s"));
        if (!agentProcess.Start()) throw new InvalidOperationException("无法启动内置 Node 运行环境。");
        agentProcess.BeginOutputReadLine();
        agentProcess.BeginErrorReadLine();

        ThreadPool.QueueUserWorkItem(delegate
        {
            bool ready = WaitForHealth(15000);
            SetStatus(ready ? "状态：运行正常" : "状态：启动超时");
            ShowBalloon("达人采集助手", ready ? "本地采集能力已就绪。" : "启动超时，请检查运行日志。", ready ? ToolTipIcon.Info : ToolTipIcon.Warning);
        });
    }

    private static void LoadCentralConfig(ProcessStartInfo startInfo, string file)
    {
        if (!File.Exists(file)) return;
        foreach (string rawLine in File.ReadAllLines(file))
        {
            string line = rawLine.Trim();
            if (line.Length == 0 || line.StartsWith("#")) continue;
            int separator = line.IndexOf('=');
            if (separator <= 0) continue;
            string key = line.Substring(0, separator).Trim();
            string value = line.Substring(separator + 1).Trim();
            if (key == "CENTRAL_APP_URL" || key == "CENTRAL_AGENT_TOKEN" || key == "CENTRAL_AGENT_NAME")
                startInfo.EnvironmentVariables[key] = value;
        }
    }

    private static bool WaitForHealth(int timeoutMilliseconds)
    {
        DateTime deadline = DateTime.UtcNow.AddMilliseconds(timeoutMilliseconds);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:17321/health");
                request.Timeout = 1000;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                {
                    if (response.StatusCode == HttpStatusCode.OK) return true;
                }
            }
            catch { }
            Thread.Sleep(300);
        }
        return false;
    }

    private static void SetStatus(string text)
    {
        if (trayIcon == null || trayIcon.ContextMenuStrip == null) return;
        Action action = delegate
        {
            ToolStripItem item = trayIcon.ContextMenuStrip.Items["status"];
            if (item != null) item.Text = text;
        };
        if (trayIcon.ContextMenuStrip.InvokeRequired) trayIcon.ContextMenuStrip.BeginInvoke(action);
        else action();
    }

    private static void ShowBalloon(string title, string text, ToolTipIcon icon)
    {
        if (trayIcon == null) return;
        Action action = delegate { trayIcon.ShowBalloonTip(3000, title, text, icon); };
        if (trayIcon.ContextMenuStrip != null && trayIcon.ContextMenuStrip.InvokeRequired) trayIcon.ContextMenuStrip.BeginInvoke(action);
        else action();
    }

    private static void AppendLog(string line)
    {
        try
        {
            lock (LogLock) File.AppendAllText(logFile, "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + line + Environment.NewLine);
        }
        catch { }
    }

    private static void OpenPath(string target)
    {
        try { Process.Start(target); }
        catch (Exception error) { MessageBox.Show(error.Message, "无法打开", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
    }

    private static void StopAgent()
    {
        if (trayIcon != null) { trayIcon.Visible = false; trayIcon.Dispose(); }
        try
        {
            if (agentProcess != null && !agentProcess.HasExited)
            {
                agentProcess.Kill();
                agentProcess.WaitForExit(3000);
            }
        }
        catch { }
    }

    private static void ReleaseMutex()
    {
        try { if (instanceMutex != null) instanceMutex.ReleaseMutex(); }
        catch { }
        if (instanceMutex != null) instanceMutex.Dispose();
    }
}
