/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FlocordDevs } from "@utils/constants";
import { relaunch } from "@utils/native";
import definePlugin, { type PluginNative } from "@utils/types";
import { Modal, openModal, React } from "@webpack/common";

import { FLOCORD_VERSION as CURRENT_VERSION } from "./version";

const Native = FlocordNative.pluginHelpers.FlocordAutoUpdater as PluginNative<typeof import("./native")>;

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
        const result = await Native.downloadAndInstall(url, `${resourcesPath}/app.asar`, version);
        if (result.success) {
            setDone(true);
        } else {
            setError(result.error ?? "Unknown error");
        }
        setInstalling(false);
    }

    return (
        <Modal
            {...modalProps}
            title={done ? "Flocord updated" : "Flocord update available"}
            notice={error ? { message: `Download failed: ${error}`, type: "critical" } : undefined}
            actions={done
                ? [{ text: "Restart Discord", variant: "primary", onClick: relaunch }]
                : [
                    {
                        text: installing ? "Installing..." : `Update to v${version}`,
                        variant: "primary",
                        onClick: handleInstall,
                        loading: installing,
                        disabled: installing,
                    },
                    {
                        text: "Later",
                        variant: "secondary",
                        onClick: modalProps.onClose,
                        disabled: installing,
                    },
                ]
            }
        >
            {done
                ? <p style={{ margin: "8px 0", color: "var(--text-normal)" }}>
                    Flocord <strong>v{version}</strong> has been installed.<br />
                    Restart Discord to apply the update.
                  </p>
                : <p style={{ margin: "8px 0", color: "var(--text-normal)" }}>
                    Version <strong>v{version}</strong> is available (you have v{CURRENT_VERSION}).<br />
                    Update now?
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
    description: "Updates Flocord automatically when Discord starts. No need to run FlocordCLI for updates.",
    authors: [FlocordDevs.Flocord],
    required: true,

    start() {
        if (!IS_DISCORD_DESKTOP) return;
        setTimeout(() => checkAndUpdate().catch(() => {}), 15_000);
    },
});
