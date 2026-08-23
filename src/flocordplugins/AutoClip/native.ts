import { IpcMainInvokeEvent, app, session, desktopCapturer, shell } from "electron";
import fs from "fs";
import path from "path";

let _ws: fs.WriteStream | null = null;
let _tmpPath = "";

// Sets up the display-media handler so getDisplayMedia() in the renderer
// automatically gets system loopback audio without any OS picker dialog.
export async function setupCapture(_: IpcMainInvokeEvent): Promise<boolean> {
    try {
        session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
            const sources = await desktopCapturer.getSources({ types: ["screen"] });
            if (sources.length > 0) {
                callback({ video: sources[0], audio: "loopback" });
            } else {
                callback({});
            }
        });
        return true;
    } catch {
        return false;
    }
}

// Removes our handler — must be called when recording ends.
export async function teardownCapture(_: IpcMainInvokeEvent): Promise<void> {
    try {
        (session.defaultSession as any).setDisplayMediaRequestHandler(null);
    } catch {}
}

// Opens a temp file to stream audio chunks into during the recording.
export async function openTempFile(_: IpcMainInvokeEvent): Promise<void> {
    _tmpPath = path.join(app.getPath("temp"), `flocord_clip_${Date.now()}.webm`);
    _ws = fs.createWriteStream(_tmpPath);
}

// Writes a chunk from MediaRecorder directly to the temp file.
export async function appendChunk(_: IpcMainInvokeEvent, data: Uint8Array): Promise<void> {
    if (_ws) _ws.write(Buffer.from(data));
}

// Called when the user decides keep or discard.
// Returns the final file path if kept, null if discarded.
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
    const dest = path.join(dir, `${ts}_${safe}.webm`);
    fs.renameSync(tmp, dest);
    return dest;
}

// Opens Documents/FlocordClips/ in Explorer.
export async function openClipsFolder(_: IpcMainInvokeEvent): Promise<void> {
    const dir = path.join(app.getPath("documents"), "FlocordClips");
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
}
