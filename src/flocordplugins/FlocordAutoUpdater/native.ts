/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createHash, createPublicKey, verify } from "crypto";
import { IpcMainInvokeEvent } from "electron";
// Electron patches the regular fs module to present an .asar archive as a directory, so stat() on a
// perfectly normal app.asar reports isDirectory(). original-fs is the unpatched module: it sees the
// real file, and lets the archive be overwritten in place while Discord is running.
import { promises as fs } from "original-fs";
import { join } from "path";

const VERSION_URL = "https://raw.githubusercontent.com/Code-Flocord/FlocordCLI/master/version.json";

// Flocord release key (ed25519). Its private half never touches GitHub, so neither a compromised repo
// nor a swapped release asset can get an update accepted.
const RELEASE_KEY = createPublicKey({
    key: Buffer.from("302a300506032b6570032100" + "1c8084d8287cd44c93613297086e1d2a0ad6421b070de9abb4bb09c5d013c856", "hex"),
    format: "der",
    type: "spki"
});

interface VersionInfo {
    version: string;
    url: string;
    sha256: string;
    cli: string;
    cli_sha256: string;
    signature: string;
}

// Fetch version.json from the main process — no CSP restrictions
async function latestManifest(): Promise<VersionInfo | null> {
    try {
        const res = await fetch(VERSION_URL);
        if (!res.ok) return null;
        const data = await res.json() as VersionInfo;
        const message = ["flocord-manifest-v1", data.version, data.url, data.sha256, data.cli, data.cli_sha256].join("\n");
        if (!/^[0-9a-f]{128}$/.test(data.signature) || !verify(null, Buffer.from(message), RELEASE_KEY, Buffer.from(data.signature, "hex"))) return null;
        return data;
    } catch {
        return null;
    }
}

export function fetchVersionInfo(_: IpcMainInvokeEvent) {
    return latestManifest();
}

// The renderer only asks for the update: the source and the destination are decided here, so a
// compromised renderer cannot turn this into an arbitrary download or an arbitrary file write
export async function installUpdate(_: IpcMainInvokeEvent): Promise<{ success: boolean; version?: string; error?: string; }> {
    try {
        const info = await latestManifest();
        if (!info) return { success: false, error: "Could not fetch version info" };

        const response = await fetch(info.url);
        if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
        const data = Buffer.from(await response.arrayBuffer());
        if (createHash("sha256").update(data).digest("hex") !== info.sha256) return { success: false, error: "The downloaded file does not match the signed release" };

        const targetPath = join(process.resourcesPath, "app.asar");

        // app.asar may be the relay folder left by the host update hook: it only makes sense next to
        // the original _app.asar, in which case it is simply replaced by the real asar
        const targetStat = await fs.stat(targetPath).catch(() => null);
        if (targetStat?.isDirectory()) {
            const originalStat = await fs.stat(join(process.resourcesPath, "_app.asar")).catch(() => null);
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
        await fs.writeFile(join(process.resourcesPath, "flocord.lock"), info.version).catch(() => { });
        return { success: true, version: info.version };
    } catch (e: any) {
        return { success: false, error: String(e?.message ?? e) };
    }
}
