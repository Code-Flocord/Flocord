import { IpcMainInvokeEvent, app, shell, desktopCapturer, screen } from "electron";
import { spawn, execFile, ChildProcess } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execFileAsync = promisify(execFile);

let _proc: ChildProcess | null = null;
let _outPath = "";

// ── ffmpeg detection ───────────────────────────────────────────
export async function checkFfmpeg(_: IpcMainInvokeEvent): Promise<boolean> {
    try {
        await execFileAsync("ffmpeg", ["-version"], { timeout: 4000 });
        return true;
    } catch {
        return false;
    }
}

// ── Screen sources (thumbnails + display geometry for gdigrab) ─
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

// ── WASAPI device enumeration ──────────────────────────────────
// ffmpeg outputs device list to stderr even on "error", so we catch and parse.
export async function listWasapiDevices(
    _: IpcMainInvokeEvent,
    kind: "input" | "output",
): Promise<string[]> {
    let stderr = "";
    try {
        await execFileAsync("ffmpeg", ["-f", "wasapi", "-list_devices", "1", "-i", "dummy"], {
            timeout: 6000,
        });
    } catch (e: any) {
        stderr = e.stderr ?? "";
    }

    const section = kind === "input" ? "WASAPI input devices" : "WASAPI output devices";
    const lines = stderr.split("\n");
    const result: string[] = [];
    let inSection = false;
    for (const line of lines) {
        if (line.includes(section)) { inSection = true; continue; }
        if (inSection && (line.includes("WASAPI input devices") || line.includes("WASAPI output devices"))) break;
        if (inSection) {
            const m = line.match(/"([^"]+)"/);
            if (m) result.push(m[1]);
        }
    }
    return result;
}

// ── Recording ──────────────────────────────────────────────────
export interface RecordOpts {
    displayIndex: number;   // -1 = audio only
    systemAudio: boolean;   // WASAPI loopback
    micDevice: string;      // WASAPI device name | "" = default | "none" = skip
    outputDevice: string;   // WASAPI output device for loopback | "" = first available
}

export async function startRecord(
    _: IpcMainInvokeEvent,
    opts: RecordOpts,
): Promise<{ ok: boolean; error?: string }> {
    if (_proc) return { ok: false, error: "Already recording" };

    _outPath = path.join(app.getPath("temp"), `flocord_clip_${Date.now()}.mp4`);

    const args: string[] = ["-y"];
    let inputIdx = 0;
    const audioInputs: number[] = [];

    // ── Video: gdigrab on the chosen monitor ───────────────────
    const hasVideo = opts.displayIndex >= 0;
    if (hasVideo) {
        const displays = screen.getAllDisplays();
        const disp = displays[opts.displayIndex] ?? displays[0];
        const sf = disp.scaleFactor ?? 1;
        // gdigrab works in physical pixels on Windows
        const x = Math.round(disp.bounds.x * sf);
        const y = Math.round(disp.bounds.y * sf);
        const w = Math.round(disp.bounds.width * sf);
        const h = Math.round(disp.bounds.height * sf);
        args.push(
            "-f", "gdigrab",
            "-framerate", "30",
            "-offset_x", String(x),
            "-offset_y", String(y),
            "-video_size", `${w}x${h}`,
            "-draw_mouse", "1",
            "-i", "desktop",
        );
        inputIdx++;
    }

    // ── System audio: WASAPI loopback on the output device ────
    if (opts.systemAudio) {
        const dev = opts.outputDevice || "";
        args.push("-f", "wasapi", "-loopback", "1", "-i", dev);
        audioInputs.push(inputIdx++);
    }

    // ── Mic: WASAPI input ──────────────────────────────────────
    if (opts.micDevice !== "none") {
        const dev = (opts.micDevice && opts.micDevice !== "default") ? opts.micDevice : "";
        args.push("-f", "wasapi", "-i", dev);
        audioInputs.push(inputIdx++);
    }

    // ── Audio mixing ───────────────────────────────────────────
    if (audioInputs.length === 2) {
        const [a, b] = audioInputs;
        args.push(
            "-filter_complex", `[${a}:a][${b}:a]amix=inputs=2:duration=longest[aout]`,
        );
        if (hasVideo) args.push("-map", "0:v");
        args.push("-map", "[aout]");
    } else if (audioInputs.length === 1) {
        if (hasVideo) args.push("-map", "0:v");
        args.push("-map", `${audioInputs[0]}:a`);
    } else if (hasVideo) {
        args.push("-map", "0:v");
    }

    // ── Encoding ───────────────────────────────────────────────
    if (hasVideo) args.push("-c:v", "libx264", "-preset", "ultrafast", "-crf", "23");
    if (audioInputs.length > 0) args.push("-c:a", "aac", "-b:a", "192k");
    args.push("-movflags", "+faststart", _outPath);

    return new Promise(resolve => {
        let resolved = false;
        let errBuf = "";

        const done = (result: { ok: boolean; error?: string }) => {
            if (!resolved) { resolved = true; resolve(result); }
        };

        try {
            _proc = spawn("ffmpeg", args, {
                windowsHide: true,
                stdio: ["pipe", "pipe", "pipe"],
            });

            _proc.stderr?.on("data", (d: Buffer) => {
                errBuf += d.toString();
                // ffmpeg prints this when all streams are open and recording starts
                if (!resolved && errBuf.includes("Press [q] to stop")) {
                    done({ ok: true });
                }
            });

            _proc.on("error", err => {
                _proc = null;
                done({ ok: false, error: err.message });
            });

            _proc.on("exit", (code, signal) => {
                if (code !== 0 && signal !== "SIGTERM") {
                    _proc = null;
                    done({ ok: false, error: `ffmpeg exit ${code}: ${errBuf.slice(-400)}` });
                }
            });

            // Fallback: resolve ok after 6s if we never saw the ready message
            // (some builds print different text)
            setTimeout(() => done({ ok: true }), 6000);

        } catch (err: any) {
            done({ ok: false, error: err.message });
        }
    });
}

// Send 'q' to ffmpeg so it finalises the MP4 (moov atom → seekable).
export async function stopRecord(_: IpcMainInvokeEvent): Promise<string | null> {
    const proc = _proc;
    _proc = null;
    if (!proc) return null;

    return new Promise(resolve => {
        proc.once("exit", () => {
            const exists = fs.existsSync(_outPath) && fs.statSync(_outPath).size > 1000;
            resolve(exists ? _outPath : null);
        });

        try { proc.stdin?.write("q\n"); proc.stdin?.end(); } catch {}
        // Hard kill after 12s if ffmpeg doesn't respond
        setTimeout(() => { try { proc.kill(); } catch {} }, 12000);
    });
}

export async function finishClip(
    _: IpcMainInvokeEvent,
    keep: boolean,
    tmpPath: string,
    channelName: string,
): Promise<string | null> {
    if (!keep) {
        try { fs.unlinkSync(tmpPath); } catch {}
        return null;
    }

    const dir = path.join(app.getPath("documents"), "FlocordClips");
    fs.mkdirSync(dir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    const safe = channelName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const dest = path.join(dir, `${ts}_${safe}.mp4`);
    fs.renameSync(tmpPath, dest);
    return dest;
}

export async function openClipsFolder(_: IpcMainInvokeEvent): Promise<void> {
    const dir = path.join(app.getPath("documents"), "FlocordClips");
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
}
