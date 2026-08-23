import definePlugin, { type PluginNative } from "@utils/types";
import { showNotification } from "@api/Notifications";
import { relaunch } from "@utils/native";

const VERSION_URL = "https://raw.githubusercontent.com/Code-Flocord/FlocordCLI/master/version.json";
const CURRENT_VERSION = "1.0.5";

const Native = VencordNative.pluginHelpers.FlocordAutoUpdater as PluginNative<typeof import("./native")>;

function versionGt(a: string, b: string): boolean {
    const parse = (v: string) => v.split(".").map(Number);
    const [a1 = 0, a2 = 0, a3 = 0] = parse(a);
    const [b1 = 0, b2 = 0, b3 = 0] = parse(b);
    return a1 !== b1 ? a1 > b1 : a2 !== b2 ? a2 > b2 : a3 > b3;
}

async function checkAndUpdate() {
    const res = await fetch(VERSION_URL, { cache: "no-cache" }).catch(() => null);
    if (!res?.ok) return;

    const { version, url } = await res.json().catch(() => ({}));
    if (!version || !url || !versionGt(version, CURRENT_VERSION)) return;

    showNotification({
        title: "Flocord — Mise à jour",
        body: `v${version} disponible. Téléchargement en cours...`,
        color: "#5865f2",
    });

    const resourcesPath = await Native.getResourcesPath();
    await Native.downloadAndInstall(url, `${resourcesPath}/app.asar`);

    showNotification({
        title: "Flocord mis à jour !",
        body: "Redémarre Discord pour appliquer la mise à jour.",
        color: "#43b581",
        onClick: relaunch,
    });
}

export default definePlugin({
    name: "FlocordAutoUpdater",
    description: "Met à jour Flocord automatiquement au démarrage de Discord. Plus besoin de lancer FlocordCLI pour les mises à jour.",
    authors: [{ name: "Flocord", id: 0n }],
    required: true,

    start() {
        if (!IS_DISCORD_DESKTOP) return;
        setTimeout(() => checkAndUpdate().catch(() => {}), 15_000);
    },
});
