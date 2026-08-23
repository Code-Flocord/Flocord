import { IpcMainInvokeEvent } from "electron";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function runPS(script: string): Promise<string> {
    return execFileAsync("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-Command", script
    ], { timeout: 12000 })
        .then(r => r.stdout.trim())
        .catch(() => "{}");
}

// PS5.1 fix: GetAwaiter() is a C# extension method — not visible via COM dispatch.
// Solution: use reflection to call AsTask<T>(IAsyncOperation<T>) from
// System.WindowsRuntimeSystemExtensions, which returns a real .NET Task<T>
// on which .GetAwaiter().GetResult() works normally.
const AWAIT_HELPER = String.raw`
Add-Type -AssemblyName System.Runtime.WindowsRuntime -EA SilentlyContinue
$_asTaskDef=([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name-eq'AsTask'-and$_.IsGenericMethodDefinition-and$_.GetParameters().Count-eq 1})[0]
function WrtAwait($op,[type]$t){$_asTaskDef.MakeGenericMethod($t).Invoke($null,@($op)).GetAwaiter().GetResult()}
`.trim();

const INFO_SCRIPT = String.raw`
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
$ErrorActionPreference='Stop'
${AWAIT_HELPER}
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
    try {
        [void][Windows.Storage.Streams.DataReader,Windows.Storage,ContentType=WindowsRuntime]
        $st=WrtAwait ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
        $dr=[Windows.Storage.Streams.DataReader]::new($st.GetInputStreamAt(0))
        $n=[int](WrtAwait ($dr.LoadAsync([uint32]$st.Size)) ([uint32]))
        if($n -gt 0){$buf=[byte[]]::new($n);$dr.ReadBytes($buf);$b64=[Convert]::ToBase64String($buf)}
    } catch {}
    [ordered]@{
        title=if($p.Title){$p.Title}else{''}
        artist=if($p.Artist){$p.Artist}else{''}
        status=$pb.PlaybackStatus.ToString()
        pos=[Math]::Round($tl.Position.TotalSeconds,1)
        dur=[Math]::Round($tl.EndTime.TotalSeconds,1)
        thumb=$b64
        app=$s.SourceAppUserModelId
    }|ConvertTo-Json -Compress
} catch {'{}'}
`.trim();

function controlScript(method: string): string {
    return String.raw`
${AWAIT_HELPER}
try {
    [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
    $sm=WrtAwait ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $s=$sm.GetSessions()|Where-Object{$_.GetPlaybackInfo().PlaybackStatus.ToString()-eq'Playing'}|Select-Object -First 1
    if(-not $s){$s=$sm.GetCurrentSession()}
    if($s){WrtAwait ($s.${method}()) ([bool])|Out-Null}
} catch {}
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
