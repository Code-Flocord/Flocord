/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { ErrorCard } from "@components/ErrorCard";
import { Flex } from "@components/Flex";
import { Paragraph } from "@components/Paragraph";
import { SettingsTab, wrapTab } from "@components/settings/tabs/BaseTab";
import { Margins } from "@utils/margins";
import { relaunch } from "@utils/native";
import { type PluginNative } from "@utils/types";
import { React } from "@webpack/common";

import { FLOCORD_VERSION, versionGt } from "./version";

const Native = FlocordNative.pluginHelpers.FlocordAutoUpdater as PluginNative<typeof import("./native")>;

function FlocordUpdater() {
    const [latestVersion, setLatestVersion] = React.useState<string | null>(null);
    const [checking, setChecking] = React.useState(false);
    const [installing, setInstalling] = React.useState(false);
    const [done, setDone] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => { void checkUpdates(); }, []);

    async function checkUpdates() {
        setChecking(true);
        setError(null);
        try {
            const info = await Native.fetchVersionInfo();
            setLatestVersion(info?.version ?? null);
        } catch (e: any) {
            setError(String(e?.message ?? e));
        } finally {
            setChecking(false);
        }
    }

    async function install() {
        setInstalling(true);
        setError(null);
        try {
            const result = await Native.installUpdate();
            if (result.success) {
                setDone(true);
            } else {
                setError(result.error ?? "Unknown error");
            }
        } catch (e: any) {
            setError(String(e?.message ?? e));
        } finally {
            setInstalling(false);
        }
    }

    const isOutdated = latestVersion !== null && versionGt(latestVersion, FLOCORD_VERSION);

    return (
        <SettingsTab>
            <Paragraph>
                Installed version: <strong>v{FLOCORD_VERSION}</strong>
            </Paragraph>
            <Paragraph className={Margins.bottom16}>
                Latest version:{" "}
                {checking
                    ? "Checking..."
                    : latestVersion !== null
                        ? <strong>v{latestVersion}</strong>
                        : "Could not fetch"
                }
            </Paragraph>

            {done ? (
                <>
                    <Paragraph className={Margins.bottom8}>
                        Update installed. Restart Discord to apply it.
                    </Paragraph>
                    <Button variant="primary" onClick={relaunch}>
                        Restart Discord
                    </Button>
                </>
            ) : (
                <Flex gap="8px" style={{ alignItems: "center" }}>
                    <Button disabled={checking || installing} onClick={checkUpdates}>
                        {checking ? "Checking..." : "Check for updates"}
                    </Button>
                    {isOutdated && (
                        <Button variant="primary" disabled={installing} onClick={install}>
                            {installing ? "Installing..." : `Update to v${latestVersion}`}
                        </Button>
                    )}
                    {!checking && !isOutdated && latestVersion !== null && (
                        <Paragraph>Flocord is up to date.</Paragraph>
                    )}
                </Flex>
            )}

            {error && (
                <ErrorCard className={Margins.top16} style={{ padding: "1em" }}>
                    <p>{error}</p>
                </ErrorCard>
            )}
        </SettingsTab>
    );
}

export default wrapTab(FlocordUpdater, "Flocord Updater");
