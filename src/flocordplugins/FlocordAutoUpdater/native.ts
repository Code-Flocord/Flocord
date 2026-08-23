import { IpcMainInvokeEvent } from "electron";
import { writeFile } from "fs/promises";

export function getResourcesPath(_: IpcMainInvokeEvent): string {
    return process.resourcesPath;
}

export async function downloadAndInstall(_: IpcMainInvokeEvent, url: string, targetPath: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    await writeFile(targetPath, data);
}
