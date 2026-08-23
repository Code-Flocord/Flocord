import { IpcMainInvokeEvent, app, shell, desktopCapturer } from "electron";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

let _ws: fs.WriteStream | null = null;
let _tmpPath = "";

export async function getScreenSources(_: IpcMainInvokeEvent): Promise<Array<{
    id: string;
    name: string;
    thumbnail: string;
}>> {
    const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 320, height: 180 },
    });
    return sources.map(s => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
    }));
}

// Returns the source ID of the first (or chosen) screen — used by the renderer
// to build a chromeMediaSourceId constraint for getUserMedia.
export async function resolveScreenId(
    _: IpcMainInvokeEvent,
    preferred: string,
): Promise<string> {
    const sources = await desktopCapturer.getSources({ types: ["screen"] });
    return (preferred ? sources.find(s => s.id === preferred) : null)?.id
        ?? sources[0]?.id
        ?? "";
}

export async function openTempFile(_: IpcMainInvokeEvent): Promise<void> {
    _tmpPath = path.join(app.getPath("temp"), `flocord_clip_${Date.now()}.webm`);
    _ws = fs.createWriteStream(_tmpPath);
}

export async function appendChunk(_: IpcMainInvokeEvent, data: Uint8Array): Promise<void> {
    if (_ws) _ws.write(Buffer.from(data));
}

export async function finishClip(
    _: IpcMainInvokeEvent,
    keep: boolean,
    channelName: string,
): Promise<string | null> {
    await new Promise<void>(resolve => {
        if (_ws) { _ws.end(resolve); _ws = null; }
        else resolve();
    });

    const tmp = _tmpPath;
    _tmpPath = "";

    if (!keep) {
        try { fs.unlinkSync(tmp); } catch {}
        return null;
    }

    const dir = path.join(app.getPath("documents"), "FlocordClips");
    fs.mkdirSync(dir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    const safe = channelName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const webm = path.join(dir, `${ts}_${safe}.webm`);
    fs.renameSync(tmp, webm);
    return webm;
}

// Attempts an ffmpeg re-encode from webm → mp4.
// On success: deletes the webm and returns the mp4 path.
// On failure (ffmpeg absent / error): returns null and leaves the webm intact.
export async function convertToMp4(_: IpcMainInvokeEvent, webmPath: string): Promise<string | null> {
    const mp4Path = webmPath.replace(/\.webm$/, ".mp4");
    try {
        await execFileAsync("ffmpeg", [
            "-i", webmPath,
            "-c:v", "libx264",
            "-preset", "fast",
            "-c:a", "aac",
            "-movflags", "+faststart",
            "-y", mp4Path,
        ], { timeout: 600_000 });   // 10 min max for long calls
        try { fs.unlinkSync(webmPath); } catch {}
        return mp4Path;
    } catch {
        return null;
    }
}

export async function openClipsFolder(_: IpcMainInvokeEvent): Promise<void> {
    const dir = path.join(app.getPath("documents"), "FlocordClips");
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
}
