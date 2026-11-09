using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Threading;
using System.Windows.Forms;

// Runs outside the extracted application so the original NSIS launcher can exit.
internal static class PortableUpdate
{
    private static void StartLauncher(string target)
    {
        Process.Start(new ProcessStartInfo(target) {
            WorkingDirectory = Path.GetDirectoryName(target), UseShellExecute = false
        }).Dispose();
    }

    private static int Main(string[] args)
    {
        if (args.Length != 4) return 1;
        string target = args[1], staged = args[2];
        string directory = Path.GetDirectoryName(staged);
        string backup = Path.Combine(directory, "previous.exe");
        bool approved = false, stopped = false, restarted = false;
        try
        {
            using (Process launcher = Process.GetProcessById(int.Parse(args[0])))
            {
                if (!String.Equals(launcher.MainModule.FileName, target, StringComparison.OrdinalIgnoreCase))
                    return 1;
                using (var sha = SHA256.Create())
                using (var input = File.OpenRead(staged))
                {
                    string digest = BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "");
                    if (!String.Equals(digest, args[3], StringComparison.OrdinalIgnoreCase)) return 1;
                }
                Console.Write("READY\n");
                Console.Out.Flush();
                if (Console.ReadLine() != "INSTALL") return 1;
                approved = true;
                if (!launcher.WaitForExit(90000)) throw new IOException("等待旧版退出超时。");
                stopped = true;
            }
            for (int attempt = 0; ; attempt++)
            {
                try { File.Replace(staged, target, backup); break; }
                catch (IOException) {
                    if (attempt >= 20 || File.Exists(backup)) throw;
                    Thread.Sleep(250);
                }
            }
            StartLauncher(target);
            restarted = true;
        }
        catch (Exception error)
        {
            if (!approved) return 1;
            string message = "更新未完成：" + error.Message;
            try
            {
                if (File.Exists(backup)) {
                    if (File.Exists(target)) File.Replace(backup, target, null);
                    else File.Move(backup, target);
                }
                if (stopped) StartLauncher(target);
            }
            catch (Exception recovery)
            {
                message += "\n请从原路径重新打开 Egent。\n" + recovery.Message;
                if (File.Exists(backup)) message += "\n旧版备份：" + backup;
            }
            MessageBox.Show(message, "Egent 更新", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return 1;
        }
        finally
        {
            if (approved) {
                try {
                    File.Delete(staged);
                    if (restarted) File.Delete(backup);
                    if (!File.Exists(backup)) Directory.Delete(directory);
                } catch (IOException) { } catch (UnauthorizedAccessException) { }
            }
        }
        return 0;
    }
}
