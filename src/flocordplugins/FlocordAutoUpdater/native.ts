import { IpcMainInvokeEvent } from "electron";
import { rename, stat, writeFile } from "fs/promises";

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
    targetPath: string
): Promise<{ success: boolean; error?: string; }> {
    try {
        const response = await fetch(url);
        if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
        const data = Buffer.from(await response.arrayBuffer());

        // Nouveau format Discord : app.asar est un dossier → le renommer en _app.asar
        const targetStat = await stat(targetPath).catch(() => null);
        if (targetStat?.isDirectory()) {
            const originalPath = targetPath.replace(/app\.asar$/, "_app.asar");
            await rename(targetPath, originalPath);
        }

        await writeFile(targetPath, data);
        return { success: true };
    } catch (e: any) {
        return { success: false, error: String(e?.message ?? e) };
    }
}
