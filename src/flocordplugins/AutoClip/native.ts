import { IpcMainInvokeEvent, app, session, desktopCapturer, shell } from "electron";
import fs from "fs";
import path from "path";

let _ws: fs.WriteStream | null = null;
let _tmpPath = "";

// Returns all screen sources with a 320×180 thumbnail (data URL) for the settings picker.
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

// Sets up the display-media handler so getDisplayMedia() in the renderer
// is silently fulfilled with the chosen screen + loopback audio.
export async function setupCapture(_: IpcMainInvokeEvent, screenId: string): Promise<boolean> {
    try {
        session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
            const sources = await desktopCapturer.getSources({ types: ["screen"] });
            const target =
                (screenId ? sources.find(s => s.id === screenId) : null) ?? sources[0];
            if (target) {
                callback({ video: target, audio: "loopback" });
            } else {
                callback({});
            }
        });
        return true;
    } catch {
        return false;
    }
}

export async function teardownCapture(_: IpcMainInvokeEvent): Promise<void> {
    try {
        (session.defaultSession as any).setDisplayMediaRequestHandler(null);
    } catch {}
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
    const dest = path.join(dir, `${ts}_${safe}.webm`);
    fs.renameSync(tmp, dest);
    return dest;
}

export async function openClipsFolder(_: IpcMainInvokeEvent): Promise<void> {
    const dir = path.join(app.getPath("documents"), "FlocordClips");
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
}
