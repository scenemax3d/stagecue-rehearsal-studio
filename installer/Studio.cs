using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

class Studio : Form {
    static readonly string Root = AppDomain.CurrentDomain.BaseDirectory;
    static readonly string Data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Stagecue","Workspace");
    readonly List<Process> children = new List<Process>();
    readonly WebView2 browser = new WebView2();
    readonly Label loading = new Label {Text="Starting rehearsal studio…",Dock=DockStyle.Fill,TextAlign=System.Drawing.ContentAlignment.MiddleCenter};
    readonly object logLock = new object();
    IntPtr job;
    bool closing;
    [DllImport("kernel32.dll")] static extern IntPtr CreateJobObject(IntPtr attrs,string name);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job,int cls,IntPtr info,uint length);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    void CreateJob() {
        job=CreateJobObject(IntPtr.Zero,null);
        // x64 JOBOBJECT_EXTENDED_LIMIT_INFORMATION, KILL_ON_JOB_CLOSE.
        byte[] info=new byte[144];BitConverter.GetBytes(0x2000).CopyTo(info,16);
        var ptr=Marshal.AllocHGlobal(info.Length);
        try { Marshal.Copy(info,0,ptr,info.Length);
            if(job==IntPtr.Zero || !SetInformationJobObject(job,9,ptr,(uint)info.Length))throw new Exception("Cannot initialize studio services.");
        } finally {Marshal.FreeHGlobal(ptr);}
    }
    void Log(string line){if(line!=null)lock(logLock)File.AppendAllText(Path.Combine(Data,"studio.log"),line+Environment.NewLine);}
    void StartService(string exe,string args,params string[] environment){
        var si=new ProcessStartInfo(Path.Combine(Root,exe),args){WorkingDirectory=Data,UseShellExecute=false,CreateNoWindow=true,RedirectStandardError=true,RedirectStandardOutput=true};
        for(int i=0;i<environment.Length;i+=2)si.EnvironmentVariables[environment[i]]=environment[i+1];
        var p=new Process{StartInfo=si};
        p.OutputDataReceived+=(s,e)=>Log(e.Data);p.ErrorDataReceived+=(s,e)=>Log(e.Data);
        p.Start();children.Add(p);
        if(!AssignProcessToJobObject(job,p.Handle))throw new Exception("Cannot supervise "+exe);
        p.BeginErrorReadLine();p.BeginOutputReadLine();
    }
    string Quote(string path){return "\""+Path.Combine(Root,path)+"\"";}
    bool Ready(int port){return Array.Exists(IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners(), e=>e.Port==port);}
    async void Launch(object sender,EventArgs args) {
        try{
            Directory.CreateDirectory(Data);
            File.WriteAllText(Path.Combine(Data,"studio.log"),"");
            CreateJob();
            foreach(int port in new[]{21870,21871,21872})if(Ready(port))throw new Exception("Studio port "+port+" is already in use.");
            StartService("relay.exe","","SCENEMAX_MP_BIND_ADDRESS","127.0.0.1","SCENEMAX_MP_PORT","21873");
            StartService("gateway.exe","127.0.0.1:21872 127.0.0.1:21873 http://127.0.0.1:21870");
            StartService(@"python\python.exe","-u "+Quote("asr.py"),"CUE_PORT","21871","CUE_HEBREW_MODEL",Path.Combine(Root,@"models\hebrew"),"CUE_MODEL",Path.Combine(Root,@"models\whisper"),"HF_HUB_OFFLINE","1","CUE_ASR","streaming");
            StartService(@"python\python.exe","-u "+Quote("serve.py"));
            for(int i=0;;i++){
                if(closing)return;
                foreach(var p in children)if(p.HasExited)throw new Exception("A local service stopped. See "+Path.Combine(Data,"studio.log"));
                if(Ready(21870)&&Ready(21871)&&Ready(21872))break;
                if(i==300)throw new Exception("Timed out starting studio services. See "+Path.Combine(Data,"studio.log"));
                await Task.Delay(200);
            }
            var options=new CoreWebView2EnvironmentOptions();
            options.AdditionalBrowserArguments="--enable-features=PreferredAudioOutputDevices --enable-blink-features=PreferredAudioOutputDevices";
            var env=await CoreWebView2Environment.CreateAsync(null,Path.Combine(Data,"WebView"),options);
            if(closing)return;
            await browser.EnsureCoreWebView2Async(env);
            browser.CoreWebView2.Settings.IsStatusBarEnabled=false;
            browser.CoreWebView2.Settings.IsNonClientRegionSupportEnabled=true;
            browser.CoreWebView2.WebMessageReceived+=WindowCommand;
            browser.Source=new Uri("http://127.0.0.1:21870/");
            loading.Visible=false;browser.Visible=true;
        }catch(Exception e){if(!closing){MessageBox.Show(this,e.Message,"Stagecue startup");Close();}}
    }
    const int FrameWidth = 4;
    protected override CreateParams CreateParams {
        get {
            var p = base.CreateParams;
            // Keep native sizing, snapping and taskbar controls with a client-drawn frame.
            p.Style |= 0x40000 | 0x20000 | 0x10000 | 0x80000;
            return p;
        }
    }
    protected override void WndProc(ref Message m) {
        if (m.Msg == 0x83) { m.Result = IntPtr.Zero; return; } // WM_NCCALCSIZE
        if (m.Msg == 0x84 && WindowState == FormWindowState.Normal) {
            int coords = unchecked((int)m.LParam.ToInt64());
            var pt = PointToClient(new Point((short)coords, (short)(coords >> 16)));
            bool left = pt.X < FrameWidth, right = pt.X >= ClientSize.Width - FrameWidth;
            bool top = pt.Y < FrameWidth, bottom = pt.Y >= ClientSize.Height - FrameWidth;
            int hit = top ? (left ? 13 : right ? 14 : 12) :
                      bottom ? (left ? 16 : right ? 17 : 15) : left ? 10 : right ? 11 : 0;
            if (hit != 0) { m.Result = new IntPtr(hit); return; }
        }
        base.WndProc(ref m);
    }
    static bool StudioPage(string source) {
        Uri uri;
        return Uri.TryCreate(source, UriKind.Absolute, out uri) &&
            uri.Scheme == "http" && uri.Host == "127.0.0.1" && uri.Port == 21870 && uri.AbsolutePath == "/";
    }
    void ReportWindowState() {
        if (!closing && browser.CoreWebView2 != null && StudioPage(browser.CoreWebView2.Source))
            browser.CoreWebView2.PostWebMessageAsString(WindowState == FormWindowState.Maximized ? "window:maximized" : "window:normal");
    }
    void WindowCommand(object sender, CoreWebView2WebMessageReceivedEventArgs e) {
        if (!StudioPage(e.Source)) return;
        switch(e.WebMessageAsJson) {
            case "\"window:minimize\"": WindowState = FormWindowState.Minimized; break;
            case "\"window:toggle\"": WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized; break;
            case "\"window:state\"": ReportWindowState(); break;
            case "\"window:close\"": Close(); break;
        }
    }
    Studio(){ Text="Stagecue"; FormBorderStyle=FormBorderStyle.None; Icon=System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath); ShowIcon=true;
        BackColor=Color.Black; Padding=new Padding(FrameWidth); MinimumSize=new Size(580,380);
        loading.BackColor=Color.White;
        Resize+=(s,e)=>{ Padding=new Padding(WindowState==FormWindowState.Maximized ? 0 : FrameWidth); ReportWindowState(); };
        LocationChanged+=(s,e)=>{
            if (WindowState==FormWindowState.Normal) {
                var screen=Screen.FromControl(this);
                var bounds=screen.WorkingArea;
                bounds.Offset(-screen.Bounds.X,-screen.Bounds.Y);
                MaximizedBounds=bounds;
            }
        };
        Width=1280; Height=850; browser.Dock=DockStyle.Fill;browser.Visible=false;
        Controls.Add(browser);Controls.Add(loading);Shown+=Launch;
        FormClosing+=(s,e)=>{closing=true;foreach(var p in children){try{if(!p.HasExited)p.Kill();}catch(InvalidOperationException){}}
            if(job!=IntPtr.Zero)CloseHandle(job);};
    }
    [STAThread] static void Main(){bool first;using(var mutex=new Mutex(true,@"Local\Stagecue.RehearsalStudio",out first)){
        if(!first){MessageBox.Show("Stagecue is already running.");return;}
        Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);Application.Run(new Studio());}}
}
