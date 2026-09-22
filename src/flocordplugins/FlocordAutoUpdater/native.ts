/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";
// Electron patches the regular fs module to present an .asar archive as a directory, so stat() on a
// perfectly normal app.asar reports isDirectory(). original-fs is the unpatched module: it sees the
// real file, and lets the archive be overwritten in place while Discord is running.
import { promises as fs } from "original-fs";

const VERSION_URL = "https://raw.githubusercontent.com/Code-Flocord/FlocordCLI/master/version.json";

interface VersionInfo {
    version: string;
    url: string;
}

// Fetch version.json from the main process — no CSP restrictions
export async function fetchVersionInfo(_: IpcMainInvokeEvent): Promise<VersionInfo | null> {
    try {
        const res = await fetch(VERSION_URL);
        if (!res.ok) return null;
        const data = await res.json() as VersionInfo;
        if (!data.version || !data.url) return null;
        return data;
    } catch {
        return null;
    }
}

export function getResourcesPath(_: IpcMainInvokeEvent): string {
    return process.resourcesPath;
}

export async function downloadAndInstall(
    _: IpcMainInvokeEvent,
    url: string,
    targetPath: string,
    version: string
): Promise<{ success: boolean; error?: string; }> {
    try {
        const response = await fetch(url);
        if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
        const data = Buffer.from(await response.arrayBuffer());

        // app.asar may be the relay folder left by the host update hook: it only makes sense next to
        // the original _app.asar, in which case it is simply replaced by the real asar
        const targetStat = await fs.stat(targetPath).catch(() => null);
        if (targetStat?.isDirectory()) {
            const originalStat = await fs.stat(targetPath.replace(/app\.asar$/, "_app.asar")).catch(() => null);
            if (!originalStat) return { success: false, error: "Original Discord app.asar is missing, run the installer's Repair" };

            try {
                await fs.rm(targetPath, { recursive: true, force: true });
            } catch {
                // Discord is running from inside that folder, so Windows keeps its files open
                return { success: false, error: "Discord is running from an app.asar folder, which Windows will not let us replace while it is open. Close Discord and use the installer's Repair." };
            }
        }

        await fs.writeFile(targetPath, data);
        // Same marker the installer writes, so it can report the installed version
        await fs.writeFile(targetPath.replace(/app\.asar$/, "flocord.lock"), version).catch(() => { });
        return { success: true };
    } catch (e: any) {
        return { success: false, error: String(e?.message ?? e) };
    }
}
