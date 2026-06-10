using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

// 小红书矩阵 启动器：双击即调用同目录的「启动.bat」（隐藏黑窗），失败给提示。
class Launcher
{
    [STAThread]
    static void Main()
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string bat = Path.Combine(dir, "启动.bat");
        if (!File.Exists(bat))
        {
            MessageBox.Show("找不到 启动.bat，请确认本程序与「启动.bat」在同一文件夹。\n" + dir,
                "小红书矩阵", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = "/c \"\"" + bat + "\"\"",
                WorkingDirectory = dir,
                UseShellExecute = false,
                CreateNoWindow = true,       // 不弹黑色控制台
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            Process.Start(psi);
            // 启动器使命完成即退出；后端/界面由 启动.bat 接管
        }
        catch (Exception ex)
        {
            MessageBox.Show("启动失败：" + ex.Message, "小红书矩阵",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
