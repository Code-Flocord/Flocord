/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";
import { rm, stat, writeFile } from "fs/promises";

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
        const targetStat = await stat(targetPath).catch(() => null);
        if (targetStat?.isDirectory()) {
            const originalStat = await stat(targetPath.replace(/app\.asar$/, "_app.asar")).catch(() => null);
            if (!originalStat) return { success: false, error: "Original Discord app.asar is missing, run the installer's Repair" };
            await rm(targetPath, { recursive: true, force: true });
        }

        await writeFile(targetPath, data);
        // Same marker the installer writes, so it can report the installed version
        await writeFile(targetPath.replace(/app\.asar$/, "flocord.lock"), version).catch(() => { });
        return { success: true };
    } catch (e: any) {
        return { success: false, error: String(e?.message ?? e) };
    }
}
