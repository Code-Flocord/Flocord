import definePlugin, { type PluginNative } from "@utils/types";
import { relaunch } from "@utils/native";
import { ConfirmModal, Modal, closeModal, openModal } from "@webpack/common";
import { React } from "@webpack/common";

const CURRENT_VERSION = "1.0.10";

const Native = VencordNative.pluginHelpers.FlocordAutoUpdater as PluginNative<typeof import("./native")>;

function versionGt(a: string, b: string): boolean {
    const parse = (v: string) => v.split(".").map(Number);
    const [a1 = 0, a2 = 0, a3 = 0] = parse(a);
    const [b1 = 0, b2 = 0, b3 = 0] = parse(b);
    return a1 !== b1 ? a1 > b1 : a2 !== b2 ? a2 > b2 : a3 > b3;
}

interface UpdateModalProps {
    modalProps: { transitionState: number; onClose(): void; };
    version: string;
    url: string;
    resourcesPath: string;
}

function UpdateModal({ modalProps, version, url, resourcesPath }: UpdateModalProps) {
    const [installing, setInstalling] = React.useState(false);
    const [done, setDone] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    async function handleInstall() {
        setInstalling(true);
        setError(null);
        const result = await Native.downloadAndInstall(url, `${resourcesPath}/app.asar`);
        if (result.success) {
            setDone(true);
        } else {
            setError(result.error ?? "Erreur inconnue");
        }
        setInstalling(false);
    }

    return (
        <Modal
            {...modalProps}
            title={done ? "✅ Flocord mis à jour !" : "🔄 Mise à jour Flocord disponible"}
            notice={error ? { message: `Erreur lors du téléchargement : ${error}`, type: "critical" } : undefined}
            actions={done
                ? [{ text: "Redémarrer Discord", variant: "primary", onClick: relaunch }]
                : [
                    {
                        text: installing ? "Installation…" : `Mettre à jour vers v${version}`,
                        variant: "primary",
                        onClick: handleInstall,
                        loading: installing,
                        disabled: installing,
                    },
                    {
                        text: "Plus tard",
                        variant: "secondary",
                        onClick: modalProps.onClose,
                        disabled: installing,
                    },
                ]
            }
        >
            {done
                ? <p style={{ margin: "8px 0", color: "var(--text-normal)" }}>
                    Flocord <strong>v{version}</strong> a été installé avec succès.<br />
                    Redémarre Discord pour appliquer la mise à jour.
                  </p>
                : <p style={{ margin: "8px 0", color: "var(--text-normal)" }}>
                    La version <strong>v{version}</strong> est disponible (ta version : v{CURRENT_VERSION}).<br />
                    Veux-tu mettre à jour maintenant ?
                  </p>
            }
        </Modal>
    );
}

async function checkAndUpdate() {
    const info = await Native.fetchVersionInfo();
    if (!info || !versionGt(info.version, CURRENT_VERSION)) return;

    const resourcesPath = await Native.getResourcesPath();

    openModal(props =>
        <UpdateModal
            modalProps={props}
            version={info.version}
            url={info.url}
            resourcesPath={resourcesPath}
        />
    );
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
