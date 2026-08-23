import { IpcMainInvokeEvent } from "electron";
import { execFile } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { join } from "path";

const execFileAsync = promisify(execFile);

const VOL_DLL = join(tmpdir(), "FlocordVol.dll").replace(/\\/g, "\\\\");

// C# WASAPI class — compiled once to a temp DLL, reloaded on subsequent PS processes.
const VOLUME_CS = `
using System;using System.Runtime.InteropServices;
[ComImport,ClassInterface(ClassInterfaceType.None),Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDE{}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown),ComImport]
interface IMMDevEnum{void _e();int GetDefault(int df,int role,out IMMD d);}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown),ComImport]
interface IMMD{int Act(ref Guid g,uint c,IntPtr p,[MarshalAs(UnmanagedType.IUnknown)]out object v);void _p();void _i();void _s();}
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown),ComImport]
interface IAEV{
  void _rc();void _uc();int _gc(out uint n);
  void _sl1();int SetSc(float f,ref Guid g);
  void _gl1();int GetSc(out float f);
  void _sc1();void _sc2();void _gc1();void _gc2();
  int SetMute([MarshalAs(UnmanagedType.Bool)]bool m,ref Guid g);
  int GetMute([MarshalAs(UnmanagedType.Bool)]out bool m);
}
public static class MasterVol{
  static IAEV EP(){
    var e=(IMMDevEnum)new MMDE();IMMD d;e.GetDefault(0,1,out d);
    var g=new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");object v;
    d.Act(ref g,23,IntPtr.Zero,out v);return(IAEV)v;
  }
  public static float Get(){float f;EP().GetSc(out f);return f;}
  public static void Set(float l){var g=Guid.Empty;EP().SetSc(Math.Max(0f,Math.Min(1f,l)),ref g);}
  public static bool Muted(){bool m;EP().GetMute(out m);return m;}
  public static void Mute(bool m){var g=Guid.Empty;EP().SetMute(m,ref g);}
}`.trim();

// Load or compile the WASAPI DLL — fast reload on subsequent processes.
const VOL_LOADER = `
$_vdll="${VOL_DLL}"
if(Test-Path $_vdll){Add-Type -Path $_vdll -EA SilentlyContinue}
else{Add-Type -TypeDefinition @'
${VOLUME_CS}
'@ -OutputAssembly $_vdll -EA SilentlyContinue;if(Test-Path $_vdll){Add-Type -Path $_vdll -EA SilentlyContinue}}`.trim();

// PS5.1 WinRT async helper via reflection on WindowsRuntimeSystemExtensions.AsTask<T>.
const AWAIT_HELPER = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime -EA SilentlyContinue
$_asT=([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name-eq'AsTask'-and$_.IsGenericMethodDefinition-and$_.GetParameters().Count-eq 1})[0]
function WrtAwait($op,[type]$t){$_asT.MakeGenericMethod($t).Invoke($null,@($op)).GetAwaiter().GetResult()}
`.trim();

function runPS(script: string): Promise<string> {
    return execFileAsync("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-Command", script
    ], { timeout: 12000 })
        .then(r => r.stdout.trim())
        .catch(() => "{}");
}

const INFO_SCRIPT = String.raw`
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
$ErrorActionPreference='Stop'
${AWAIT_HELPER}
${VOL_LOADER}
$vol=1.0;$muted=$false
try{$vol=[MasterVol]::Get();$muted=[MasterVol]::Muted()}catch{}
try {
    [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
    $sm=WrtAwait ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    if(-not $sm){'{}';exit}
    $s=$sm.GetSessions()|Where-Object{$_.GetPlaybackInfo().PlaybackStatus.ToString()-eq'Playing'}|Select-Object -First 1
    if(-not $s){$s=$sm.GetCurrentSession()}
    if(-not $s){'{}';exit}
    $p=WrtAwait ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $pb=$s.GetPlaybackInfo()
    $tl=$s.GetTimelineProperties()
    $b64=''
    try{
        [void][Windows.Storage.Streams.DataReader,Windows.Storage,ContentType=WindowsRuntime]
        $st=WrtAwait ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
        $dr=[Windows.Storage.Streams.DataReader]::new($st.GetInputStreamAt(0))
        $n=[int](WrtAwait ($dr.LoadAsync([uint32]$st.Size)) ([uint32]))
        if($n -gt 0){$buf=[byte[]]::new($n);$dr.ReadBytes($buf);$b64=[Convert]::ToBase64String($buf)}
    }catch{}
    [ordered]@{
        title=if($p.Title){$p.Title}else{''}
        artist=if($p.Artist){$p.Artist}else{''}
        status=$pb.PlaybackStatus.ToString()
        pos=[Math]::Round($tl.Position.TotalSeconds,1)
        dur=[Math]::Round($tl.EndTime.TotalSeconds,1)
        thumb=$b64
        app=$s.SourceAppUserModelId
        volume=[Math]::Round($vol,3)
        muted=[bool]$muted
    }|ConvertTo-Json -Compress
}catch{'{}'}
`.trim();

function controlScript(method: string): string {
    return String.raw`
${AWAIT_HELPER}
try{
    [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
    $sm=WrtAwait ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $s=$sm.GetSessions()|Where-Object{$_.GetPlaybackInfo().PlaybackStatus.ToString()-eq'Playing'}|Select-Object -First 1
    if(-not $s){$s=$sm.GetCurrentSession()}
    if($s){WrtAwait ($s.${method}()) ([bool])|Out-Null}
}catch{}
`.trim();
}

export interface MediaInfo {
    title: string;
    artist: string;
    status: "Playing" | "Paused" | "Stopped" | "Closed" | "Opened" | "Changing";
    pos: number;
    dur: number;
    thumb: string;
    app: string;
    volume: number;
    muted: boolean;
}

export async function getMediaInfo(_: IpcMainInvokeEvent): Promise<MediaInfo | null> {
    const raw = await runPS(INFO_SCRIPT);
    try {
        const parsed = JSON.parse(raw);
        if (!parsed?.title && !parsed?.artist) return null;
        return parsed as MediaInfo;
    } catch {
        return null;
    }
}

export async function sendControl(_: IpcMainInvokeEvent, action: "play" | "pause" | "next" | "previous"): Promise<void> {
    const methodMap = {
        play: "TryPlayAsync",
        pause: "TryPauseAsync",
        next: "TrySkipNextAsync",
        previous: "TrySkipPreviousAsync",
    };
    await runPS(controlScript(methodMap[action]));
}

export async function setVolume(_: IpcMainInvokeEvent, level: number): Promise<void> {
    await runPS(`${VOL_LOADER}\ntry{[MasterVol]::Set(${level.toFixed(3)})}catch{}`);
}

export async function toggleMute(_: IpcMainInvokeEvent): Promise<void> {
    await runPS(`${VOL_LOADER}\ntry{$m=[MasterVol]::Muted();[MasterVol]::Mute(-not $m)}catch{}`);
}
