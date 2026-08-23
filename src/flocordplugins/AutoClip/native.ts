import { IpcMainInvokeEvent, app, shell, desktopCapturer, screen, session } from "electron";
import { spawn, execFile, ChildProcess } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execFileAsync = promisify(execFile);

// ── ffmpeg ─────────────────────────────────────────────────────

export async function checkFfmpeg(_: IpcMainInvokeEvent): Promise<boolean> {
    try { await execFileAsync("ffmpeg", ["-version"], { timeout: 4000 }); return true; }
    catch { return false; }
}

// ── Screen sources ─────────────────────────────────────────────

export async function getScreenSources(_: IpcMainInvokeEvent): Promise<Array<{
    id: string;
    name: string;
    thumbnail: string;
    displayIndex: number;
}>> {
    const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 320, height: 180 },
    });
    return sources.map((s, i) => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
        displayIndex: i,
    }));
}

// ── WASAPI device listing (for ffmpeg path) ────────────────────

export async function listWasapiDevices(
    _: IpcMainInvokeEvent,
    kind: "input" | "output",
): Promise<string[]> {
    let stderr = "";
    try {
        await execFileAsync("ffmpeg", ["-f", "wasapi", "-list_devices", "1", "-i", "dummy"], { timeout: 6000 });
    } catch (e: any) { stderr = e.stderr ?? ""; }

    const section = kind === "input" ? "WASAPI input devices" : "WASAPI output devices";
    const result: string[] = [];
    let in_ = false;
    for (const line of stderr.split("\n")) {
        if (line.includes(section)) { in_ = true; continue; }
        if (in_ && (line.includes("WASAPI input devices") || line.includes("WASAPI output devices"))) break;
        if (in_) { const m = line.match(/"([^"]+)"/); if (m) result.push(m[1]); }
    }
    return result;
}

// ── ffmpeg-based recording (full: screen + mic + system audio) ─

let _proc: ChildProcess | null = null;
let _ffmpegOut = "";

export interface FfmpegRecordOpts {
    displayIndex: number;   // -1 = audio only
    systemAudio: boolean;
    micDevice: string;      // WASAPI name | "" = default | "none" = skip
    outputDevice: string;   // WASAPI output for loopback | "" = default
}

export async function startFfmpegRecord(
    _: IpcMainInvokeEvent,
    opts: FfmpegRecordOpts,
): Promise<{ ok: boolean; error?: string }> {
    if (_proc) return { ok: false, error: "Already recording" };

    _ffmpegOut = path.join(app.getPath("temp"), `flocord_clip_${Date.now()}.mp4`);

    const args: string[] = ["-y"];
    let idx = 0;
    const audioIdx: number[] = [];

    const hasVideo = opts.displayIndex >= 0;
    if (hasVideo) {
        const displays = screen.getAllDisplays();
        const d = displays[opts.displayIndex] ?? displays[0];
        const sf = d.scaleFactor ?? 1;
        args.push(
            "-f", "gdigrab", "-framerate", "30",
            "-offset_x", String(Math.round(d.bounds.x * sf)),
            "-offset_y", String(Math.round(d.bounds.y * sf)),
            "-video_size", `${Math.round(d.bounds.width * sf)}x${Math.round(d.bounds.height * sf)}`,
            "-draw_mouse", "1", "-i", "desktop",
        );
        idx++;
    }

    if (opts.systemAudio) {
        args.push("-f", "wasapi", "-loopback", "1", "-i", opts.outputDevice || "");
        audioIdx.push(idx++);
    }

    if (opts.micDevice !== "none") {
        const dev = (opts.micDevice && opts.micDevice !== "default") ? opts.micDevice : "";
        args.push("-f", "wasapi", "-i", dev);
        audioIdx.push(idx++);
    }

    if (audioIdx.length === 2) {
        const [a, b] = audioIdx;
        args.push("-filter_complex", `[${a}:a][${b}:a]amix=inputs=2:duration=longest[aout]`);
        if (hasVideo) args.push("-map", "0:v");
        args.push("-map", "[aout]");
    } else if (audioIdx.length === 1) {
        if (hasVideo) args.push("-map", "0:v");
        args.push("-map", `${audioIdx[0]}:a`);
    } else if (hasVideo) {
        args.push("-map", "0:v");
    }

    if (hasVideo) args.push("-c:v", "libx264", "-preset", "ultrafast", "-crf", "23");
    if (audioIdx.length > 0) args.push("-c:a", "aac", "-b:a", "192k");
    args.push("-movflags", "+faststart", _ffmpegOut);

    return new Promise(resolve => {
        let resolved = false;
        let errBuf = "";
        const done = (r: { ok: boolean; error?: string }) => { if (!resolved) { resolved = true; resolve(r); } };

        try {
            _proc = spawn("ffmpeg", args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
            _proc.stderr?.on("data", (d: Buffer) => {
                errBuf += d.toString();
                if (!resolved && errBuf.includes("Press [q] to stop")) done({ ok: true });
            });
            _proc.on("error", err => { _proc = null; done({ ok: false, error: err.message }); });
            _proc.on("exit", code => {
                if (code !== 0 && code !== null) { _proc = null; done({ ok: false, error: `exit ${code}: ${errBuf.slice(-300)}` }); }
            });
            setTimeout(() => done({ ok: true }), 6000);
        } catch (err: any) { done({ ok: false, error: err.message }); }
    });
}

export async function stopFfmpegRecord(_: IpcMainInvokeEvent): Promise<string | null> {
    const proc = _proc; _proc = null;
    if (!proc) return null;
    return new Promise(resolve => {
        proc.once("exit", () => {
            const ok = fs.existsSync(_ffmpegOut) && fs.statSync(_ffmpegOut).size > 1000;
            resolve(ok ? _ffmpegOut : null);
        });
        try { proc.stdin?.write("q\n"); proc.stdin?.end(); } catch {}
        setTimeout(() => { try { proc.kill(); } catch {} }, 12000);
    });
}

// ── Renderer-based recording helpers (fallback: screen + mic, no system audio) ─

// Fulfils getDisplayMedia() silently with the selected screen (no loopback audio).
export async function setupCapture(_: IpcMainInvokeEvent, screenId: string): Promise<boolean> {
    try {
        session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
            const sources = await desktopCapturer.getSources({ types: ["screen"] });
            const target = (screenId ? sources.find(s => s.id === screenId) : null) ?? sources[0];
            cb(target ? { video: target } : {});
        });
        return true;
    } catch { return false; }
}

export async function teardownCapture(_: IpcMainInvokeEvent): Promise<void> {
    try { (session.defaultSession as any).setDisplayMediaRequestHandler(null); } catch {}
}

let _ws: fs.WriteStream | null = null;
let _webmOut = "";

export async function openTempFile(_: IpcMainInvokeEvent): Promise<void> {
    _webmOut = path.join(app.getPath("temp"), `flocord_clip_${Date.now()}.webm`);
    _ws = fs.createWriteStream(_webmOut);
}

export async function appendChunk(_: IpcMainInvokeEvent, data: Uint8Array): Promise<void> {
    if (_ws) _ws.write(Buffer.from(data));
}

export async function closeTempFile(_: IpcMainInvokeEvent): Promise<string | null> {
    return new Promise(resolve => {
        if (!_ws) { resolve(_webmOut || null); return; }
        _ws.end(() => {
            _ws = null;
            const p = _webmOut; _webmOut = "";
            const ok = fs.existsSync(p) && fs.statSync(p).size > 1000;
            resolve(ok ? p : null);
        });
    });
}

// ── Shared finish / open ───────────────────────────────────────

export async function finishClip(
    _: IpcMainInvokeEvent,
    keep: boolean,
    tmpPath: string,
    channelName: string,
): Promise<string | null> {
    if (!keep) { try { fs.unlinkSync(tmpPath); } catch {} return null; }

    const dir = path.join(app.getPath("documents"), "FlocordClips");
    fs.mkdirSync(dir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    const safe = channelName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const ext = tmpPath.endsWith(".mp4") ? "mp4" : "webm";
    const dest = path.join(dir, `${ts}_${safe}.${ext}`);
    fs.renameSync(tmpPath, dest);
    return dest;
}

export async function openClipsFolder(_: IpcMainInvokeEvent): Promise<void> {
    const dir = path.join(app.getPath("documents"), "FlocordClips");
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
}
