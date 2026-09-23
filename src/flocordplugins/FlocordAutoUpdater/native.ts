/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createHash, createPublicKey, verify } from "crypto";
import { app, IpcMainInvokeEvent } from "electron";
// Electron patches the regular fs module to present an .asar archive as a directory, so stat() on a
// perfectly normal app.asar reports isDirectory(). original-fs is the unpatched module: it sees the
// real file, and lets the archive be overwritten in place while Discord is running.
import { promises as fs } from "original-fs";
import { join } from "path";

const VERSION_URL = "https://raw.githubusercontent.com/Code-Flocord/FlocordCLI/master/version.json";

// Flocord ROOT key (ed25519): the only trust anchor the client embeds. Its private half stays offline and
// only ever signs subkey delegations, so a compromised repo can get nothing accepted. The manifest carries
// the current release subkey and its epoch, certified by a root-signed delegation; the subkey signs the
// manifest itself. Losing or leaking the subkey is recoverable: the root delegates to a new subkey with a
// higher epoch, and clients advance an epoch floor that refuses the old one (revocation).
const ROOT_KEY_HEX = "12d164d1ec1c5548fd3ab2fefd8e5ff213894d8391edfe51209ad010111cd9ab";
const ed25519 = (pubHex: string) => createPublicKey({ key: Buffer.from("302a300506032b6570032100" + pubHex, "hex"), format: "der", type: "spki" });

// A validly signed but stale manifest is refused past this age, and a version below the highest one we
// have ever accepted is refused outright. Together they stop a compromised repo from replaying an old,
// still-signed version.json to freeze the client or walk it back to a past release.
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
// userData is stable across Discord's app-x.y.z folders, unlike resourcesPath, so the floors survive updates.
const floorPath = () => join(app.getPath("userData"), "flocord-min-version");
const epochFloorPath = () => join(app.getPath("userData"), "flocord-min-key-epoch");

interface VersionInfo {
    version: string;
    url: string;
    sha256: string;
    cli: string;
    cli_sha256: string;
    date: number;
    key: string;
    key_epoch: number;
    key_sig: string;
    signature2: string;
}

function versionGt(a: string, b: string): boolean {
    const pa = a.split(".");
    const pb = b.split(".");
    for (let i = 0; i < 3; i++) {
        const x = parseInt(pa[i], 10) || 0;
        const y = parseInt(pb[i], 10) || 0;
        if (x !== y) return x > y;
    }
    return false;
}

// Highest value ever accepted, or null when the file is absent or unreadable: a corrupt floor loses the
// protection, it never blocks a legitimate update.
async function storedFloor(): Promise<string | null> {
    try {
        const text = (await fs.readFile(floorPath(), "utf8")).trim();
        return text || null;
    } catch {
        return null;
    }
}

async function raiseFloor(version: string) {
    const floor = await storedFloor();
    if (floor && !versionGt(version, floor)) return;
    await fs.writeFile(floorPath(), version).catch(() => { });
}

async function storedEpoch(): Promise<number | null> {
    try {
        const n = parseInt((await fs.readFile(epochFloorPath(), "utf8")).trim(), 10);
        return Number.isFinite(n) ? n : null;
    } catch {
        return null;
    }
}

async function raiseEpoch(epoch: number) {
    const floor = await storedEpoch();
    if (floor !== null && epoch <= floor) return;
    await fs.writeFile(epochFloorPath(), String(epoch)).catch(() => { });
}

// Fetch version.json from the main process — no CSP restrictions
async function latestManifest(): Promise<VersionInfo | null> {
    try {
        const res = await fetch(VERSION_URL);
        if (!res.ok) return null;
        const data = await res.json() as VersionInfo;
        if (typeof data.date !== "number" || typeof data.key_epoch !== "number" || !/^[0-9a-f]{64}$/.test(data.key)) return null;
        // 1. the root delegates to the announced subkey for this epoch. A v1-only manifest (no delegation /
        // no signature2) fails here, with no fallback, so it cannot be used to downgrade the check.
        const delegation = ["flocord-key-v1", data.key, String(data.key_epoch)].join("\n");
        if (!/^[0-9a-f]{128}$/.test(data.key_sig) || !verify(null, Buffer.from(delegation), ed25519(ROOT_KEY_HEX), Buffer.from(data.key_sig, "hex"))) return null;
        // 2. the delegated subkey signs the manifest (v2 message, with the signed date)
        const message = ["flocord-manifest-v2", data.version, data.url, data.sha256, data.cli, data.cli_sha256, String(data.date)].join("\n");
        if (!/^[0-9a-f]{128}$/.test(data.signature2) || !verify(null, Buffer.from(message), ed25519(data.key), Buffer.from(data.signature2, "hex"))) return null;
        // 3. freshness, then epoch floor (revocation) and version floor (rollback)
        if (Date.now() - data.date * 1000 > MAX_AGE_MS) return null;
        const epochFloor = await storedEpoch();
        if (epochFloor !== null && data.key_epoch < epochFloor) return null;
        const floor = await storedFloor();
        if (floor && versionGt(floor, data.version)) return null;
        await raiseEpoch(data.key_epoch);
        await raiseFloor(data.version);
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

        // Stage the asar next to the target and swap it in with an atomic rename, so a crash or power
        // loss mid-update can never leave a half-written app.asar that stops Discord from starting. If
        // Windows refuses to replace the file while Discord holds it open, fall back to overwriting it
        // in place, which is exactly the previous behaviour.
        const stagingPath = join(process.resourcesPath, "app.asar.new");
        await fs.writeFile(stagingPath, data);
        try {
            await fs.rename(stagingPath, targetPath);
        } catch {
            await fs.writeFile(targetPath, data);
            await fs.rm(stagingPath, { force: true }).catch(() => { });
        }

        // Same marker the installer writes, so it can report the installed version
        await fs.writeFile(join(process.resourcesPath, "flocord.lock"), info.version).catch(() => { });
        return { success: true, version: info.version };
    } catch (e: any) {
        return { success: false, error: String(e?.message ?? e) };
    }
}
