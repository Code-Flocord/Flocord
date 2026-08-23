import { IpcMainInvokeEvent } from "electron";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function runPS(script: string): Promise<string> {
    return execFileAsync("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-Command", script
    ], { timeout: 10000 })
        .then(r => r.stdout.trim())
        .catch(() => "{}");
}

// PS5.1 doesn't support .GetAwaiter() on WinRT IAsyncOperation (it's a C# extension method).
// Use spin-wait on .Status (IAsyncInfo property, accessible via COM dispatch) then .GetResults().
const AWAIT_FN = `function WrtWait($op,[int]$ms=5000){$t=0;while($op.Status -eq 0 -and $t -lt $ms){[Threading.Thread]::Sleep(10);$t+=10};if($op.Status -eq 1){$op.GetResults()}}`;

const INFO_SCRIPT = String.raw`
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
$ErrorActionPreference='Stop'
${AWAIT_FN}
try {
    [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
    $sm=WrtWait([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync())
    if(-not $sm){'{}';exit}
    $s=$sm.GetSessions()|Where-Object{$_.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing'}|Select-Object -First 1
    if(-not $s){$s=$sm.GetCurrentSession()}
    if(-not $s){'{}';exit}
    $p=WrtWait($s.TryGetMediaPropertiesAsync())
    $pb=$s.GetPlaybackInfo()
    $tl=$s.GetTimelineProperties()
    $b64=''
    try{
        [void][Windows.Storage.Streams.DataReader,Windows.Storage,ContentType=WindowsRuntime]
        $st=WrtWait($p.Thumbnail.OpenReadAsync(),1500)
        if($st){
            $dr=[Windows.Storage.Streams.DataReader]::new($st.GetInputStreamAt(0))
            $n=[int](WrtWait($dr.LoadAsync([uint32]$st.Size),1500))
            if($n -gt 0){$buf=[byte[]]::new($n);$dr.ReadBytes($buf);$b64=[Convert]::ToBase64String($buf)}
        }
    }catch{}
    [ordered]@{
        title=if($p.Title){$p.Title}else{''}
        artist=if($p.Artist){$p.Artist}else{''}
        status=$pb.PlaybackStatus.ToString()
        pos=[Math]::Round($tl.Position.TotalSeconds,1)
        dur=[Math]::Round($tl.EndTime.TotalSeconds,1)
        thumb=$b64
        app=$s.SourceAppUserModelId
    }|ConvertTo-Json -Compress
}catch{'{}'}
`.trim();

function controlScript(method: string): string {
    return String.raw`
${AWAIT_FN}
try{
    [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
    $sm=WrtWait([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync())
    $s=$sm.GetSessions()|Where-Object{$_.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing'}|Select-Object -First 1
    if(-not $s){$s=$sm.GetCurrentSession()}
    if($s){WrtWait($s.${method}())|Out-Null}
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
