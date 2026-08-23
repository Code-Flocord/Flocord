import { IpcMainInvokeEvent } from "electron";
import { execFile } from "child_process";
import { promisify } from "util";
import https from "https";

const execFileAsync = promisify(execFile);

// ── Spotify local token (port 4381 — no registration needed) ─

let _tok = "";
let _tokExp = 0;
let _lastImgUrl = "";
let _lastImgB64 = "";

// Fetch an image URL and return it as a base64 data URI (avoids CSP issues in renderer).
function fetchBase64(url: string): Promise<string> {
    return new Promise(resolve => {
        const req = https.get(url, res => {
            const chunks: Buffer[] = [];
            res.on("data", c => chunks.push(Buffer.from(c)));
            res.on("end", () => {
                const type = (res.headers["content-type"] as string | undefined) ?? "image/jpeg";
                resolve(`data:${type};base64,${Buffer.concat(chunks).toString("base64")}`);
            });
        });
        req.on("error", () => resolve(""));
        req.setTimeout(5000, () => { req.destroy(); resolve(""); });
    });
}

function httpsReq(
    options: https.RequestOptions,
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const r = https.request(options, res => {
            let body = "";
            res.on("data", c => (body += c));
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        });
        r.on("error", reject);
        r.setTimeout(3000, () => { r.destroy(); reject(new Error("timeout")); });
        r.end();
    });
}

async function getSpotifyToken(): Promise<string | null> {
    if (_tok && Date.now() < _tokExp - 60_000) return _tok;
    try {
        const { body } = await httpsReq({
            hostname: "127.0.0.1",
            port: 4381,
            path: "/token",
            method: "GET",
            headers: { Origin: "https://open.spotify.com" },
            rejectUnauthorized: false,
        });
        const j = JSON.parse(body);
        if (!j.accessToken) return null;
        _tok = j.accessToken;
        _tokExp = j.accessTokenExpirationTimestampMs ?? Date.now() + 3_600_000;
        return _tok;
    } catch {
        return null;
    }
}

async function spotifyReq(
    token: string,
    method: string,
    path: string,
): Promise<{ status: number; body: string } | null> {
    try {
        return await httpsReq({
            hostname: "api.spotify.com",
            path,
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Length": "0",
            },
        });
    } catch {
        return null;
    }
}

interface SpotifyPlayer {
    is_playing?: boolean;
    progress_ms?: number;
    item?: {
        name?: string;
        duration_ms?: number;
        artists?: Array<{ name: string }>;
        album?: { images?: Array<{ url: string; width: number }> };
    };
    device?: { volume_percent?: number };
}

async function getFromSpotify(): Promise<MediaInfo | null> {
    const token = await getSpotifyToken();
    if (!token) return null;

    const res = await spotifyReq(token, "GET", "/v1/me/player");
    if (!res || !res.body || res.status === 204) return null;
    if (res.status === 401) { _tok = ""; _tokExp = 0; return null; }

    try {
        const p = JSON.parse(res.body) as SpotifyPlayer;
        if (!p.item) return null;

        const images = p.item.album?.images ?? [];
        const imageUrl = (images.find(i => (i.width ?? 0) >= 300) ?? images[0])?.url ?? "";
        let thumb = "";
        if (imageUrl) {
            if (imageUrl === _lastImgUrl) {
                thumb = _lastImgB64;
            } else {
                thumb = await fetchBase64(imageUrl);
                _lastImgUrl = imageUrl;
                _lastImgB64 = thumb;
            }
        }
        const artist = (p.item.artists ?? []).map(a => a.name).join(", ");

        return {
            title: p.item.name ?? "",
            artist,
            status: p.is_playing ? "Playing" : "Paused",
            pos: Math.round((p.progress_ms ?? 0) / 1000),
            dur: Math.round((p.item.duration_ms ?? 0) / 1000),
            thumb,
            app: "Spotify.exe",
            volume: p.device?.volume_percent ?? null,
            source: "spotify",
        };
    } catch {
        return null;
    }
}

// ── SMTC fallback (VLC, Chrome, etc.) ────────────────────────

const AWAIT_HELPER = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime -EA SilentlyContinue
$_asT=([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name-eq'AsTask'-and$_.IsGenericMethodDefinition-and$_.GetParameters().Count-eq 1})[0]
function WrtAwait($op,[type]$t){$_asT.MakeGenericMethod($t).Invoke($null,@($op)).GetAwaiter().GetResult()}
`.trim();

function runPS(script: string): Promise<string> {
    return execFileAsync("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-Command", script,
    ], { timeout: 12000 })
        .then(r => r.stdout.trim())
        .catch(() => "{}");
}

const INFO_SCRIPT = String.raw`
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
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
    try{
        [void][Windows.Storage.Streams.DataReader,Windows.Storage,ContentType=WindowsRuntime]
        $st=WrtAwait ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
        $dr=[Windows.Storage.Streams.DataReader]::new($st.GetInputStreamAt(0))
        $n=[int](WrtAwait ($dr.LoadAsync([uint32]$st.Size)) ([uint32]))
        if($n -gt 0){$buf=[byte[]]::new($n);$dr.ReadBytes($buf);$b64="data:image/jpeg;base64,$([Convert]::ToBase64String($buf))"}
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

async function getFromSMTC(): Promise<MediaInfo | null> {
    const raw = await runPS(INFO_SCRIPT);
    try {
        const p = JSON.parse(raw);
        if (!p?.title && !p?.artist) return null;
        const st = p.status;
        if (st === "Stopped" || st === "Closed") return null;
        return {
            title: p.title ?? "",
            artist: p.artist ?? "",
            status: st === "Playing" ? "Playing" : "Paused",
            pos: p.pos ?? 0,
            dur: p.dur ?? 0,
            thumb: p.thumb ?? "",
            app: p.app ?? "",
            volume: null,
            source: "smtc",
        };
    } catch {
        return null;
    }
}

// ── Exports ───────────────────────────────────────────────────

export interface MediaInfo {
    title: string;
    artist: string;
    status: "Playing" | "Paused";
    pos: number;
    dur: number;
    thumb: string;       // HTTPS URL (Spotify) or data URI (SMTC)
    app: string;
    volume: number | null; // 0-100, only for Spotify
    source: "spotify" | "smtc";
}

export async function getMediaInfo(_: IpcMainInvokeEvent): Promise<MediaInfo | null> {
    const spotify = await getFromSpotify();
    if (spotify) return spotify;
    return getFromSMTC();
}

export async function sendControl(
    _: IpcMainInvokeEvent,
    action: "play" | "pause" | "next" | "previous",
): Promise<void> {
    const token = await getSpotifyToken();
    if (token) {
        const routes: Record<string, [string, string]> = {
            play: ["PUT", "/v1/me/player/play"],
            pause: ["PUT", "/v1/me/player/pause"],
            next: ["POST", "/v1/me/player/next"],
            previous: ["POST", "/v1/me/player/previous"],
        };
        const [method, path] = routes[action];
        await spotifyReq(token, method, path);
        return;
    }
    // SMTC fallback
    const m = { play: "TryPlayAsync", pause: "TryPauseAsync", next: "TrySkipNextAsync", previous: "TrySkipPreviousAsync" }[action];
    await runPS(`${AWAIT_HELPER}
try{
    [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
    $sm=WrtAwait ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $s=$sm.GetSessions()|Where-Object{$_.GetPlaybackInfo().PlaybackStatus.ToString()-eq'Playing'}|Select-Object -First 1
    if(-not $s){$s=$sm.GetCurrentSession()}
    if($s){WrtAwait ($s.${m}()) ([bool])|Out-Null}
}catch{}`);
}

export async function setSpotifyVolume(
    _: IpcMainInvokeEvent,
    percent: number,
): Promise<void> {
    const token = await getSpotifyToken();
    if (!token) return;
    const pct = Math.max(0, Math.min(100, Math.round(percent)));
    await spotifyReq(token, "PUT", `/v1/me/player/volume?volume_percent=${pct}`);
}
