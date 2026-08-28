import { Button } from "@components/Button";
import { ErrorCard } from "@components/ErrorCard";
import { Flex } from "@components/Flex";
import { Paragraph } from "@components/Paragraph";
import { SettingsTab, wrapTab } from "@components/settings/tabs/BaseTab";
import { Margins } from "@utils/margins";
import { relaunch } from "@utils/native";
import { type PluginNative } from "@utils/types";
import { React } from "@webpack/common";

import { FLOCORD_VERSION } from "./version";

const Native = VencordNative.pluginHelpers.FlocordAutoUpdater as PluginNative<typeof import("./native")>;

function versionGt(a: string, b: string): boolean {
    const parse = (v: string) => v.split(".").map(Number);
    const [a1 = 0, a2 = 0, a3 = 0] = parse(a);
    const [b1 = 0, b2 = 0, b3 = 0] = parse(b);
    return a1 !== b1 ? a1 > b1 : a2 !== b2 ? a2 > b2 : a3 > b3;
}

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
            const info = await Native.fetchVersionInfo();
            if (!info) throw new Error("Impossible de récupérer les infos de version");
            const resourcesPath = await Native.getResourcesPath();
            const result = await Native.downloadAndInstall(info.url, `${resourcesPath}/app.asar`);
            if (result.success) {
                setDone(true);
            } else {
                setError(result.error ?? "Erreur inconnue");
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
                Version installée : <strong>v{FLOCORD_VERSION}</strong>
            </Paragraph>
            <Paragraph className={Margins.bottom16}>
                Dernière version :{" "}
                {checking
                    ? "Vérification..."
                    : latestVersion !== null
                        ? <strong>v{latestVersion}</strong>
                        : "Impossible de récupérer"
                }
            </Paragraph>

            {done ? (
                <>
                    <Paragraph className={Margins.bottom8}>
                        Mise à jour installée avec succès. Redémarre Discord pour appliquer.
                    </Paragraph>
                    <Button variant="primary" onClick={relaunch}>
                        Redémarrer Discord
                    </Button>
                </>
            ) : (
                <Flex gap="8px" style={{ alignItems: "center" }}>
                    <Button disabled={checking || installing} onClick={checkUpdates}>
                        {checking ? "Vérification..." : "Vérifier les mises à jour"}
                    </Button>
                    {isOutdated && (
                        <Button variant="primary" disabled={installing} onClick={install}>
                            {installing ? "Installation..." : `Mettre à jour vers v${latestVersion}`}
                        </Button>
                    )}
                    {!checking && !isOutdated && latestVersion !== null && (
                        <Paragraph>Flocord est à jour.</Paragraph>
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
