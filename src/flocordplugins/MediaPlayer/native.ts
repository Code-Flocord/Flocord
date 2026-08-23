import { IpcMainInvokeEvent } from "electron";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function runPS(script: string): Promise<string> {
    return execFileAsync("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-Command", script
    ], { timeout: 6000 })
        .then(r => r.stdout.trim())
        .catch(() => "{}");
}

// WinRT SMTC — picks the actively Playing session across ALL registered sessions,
// falls back to the current session if none is explicitly playing.
const INFO_SCRIPT = String.raw`
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
$ErrorActionPreference='Stop'
try {
    [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
    $sm=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync().GetAwaiter().GetResult()
    # Prefer any session with status Playing; fall back to current session
    $s = $sm.GetSessions() | Where-Object {
        $_.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing'
    } | Select-Object -First 1
    if (-not $s) { $s = $sm.GetCurrentSession() }
    if (-not $s) { '{}'; exit }
    $p=$s.TryGetMediaPropertiesAsync().GetAwaiter().GetResult()
    $pb=$s.GetPlaybackInfo()
    $tl=$s.GetTimelineProperties()
    $b64=''
    try {
        $st=$p.Thumbnail.OpenReadAsync().GetAwaiter().GetResult()
        [void][Windows.Storage.Streams.DataReader,Windows.Storage,ContentType=WindowsRuntime]
        $dr=[Windows.Storage.Streams.DataReader]::new($st.GetInputStreamAt(0))
        $n=$dr.LoadAsync([uint32]$st.Size).GetAwaiter().GetResult()
        $buf=[byte[]]::new($n)
        $dr.ReadBytes($buf)
        $b64=[Convert]::ToBase64String($buf)
    } catch {}
    [ordered]@{
        title  = if($p.Title){$p.Title}else{''}
        artist = if($p.Artist){$p.Artist}else{''}
        status = $pb.PlaybackStatus.ToString()
        pos    = [Math]::Round($tl.Position.TotalSeconds,1)
        dur    = [Math]::Round($tl.EndTime.TotalSeconds,1)
        thumb  = $b64
        app    = $s.SourceAppUserModelId
    } | ConvertTo-Json -Compress
} catch { '{}' }
`.trim();

function controlScript(method: string): string {
    return String.raw`
try {
    [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
    $sm=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync().GetAwaiter().GetResult()
    $s = $sm.GetSessions() | Where-Object {
        $_.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing'
    } | Select-Object -First 1
    if (-not $s) { $s = $sm.GetCurrentSession() }
    if ($s) { $s.${method}().GetAwaiter().GetResult() | Out-Null }
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
