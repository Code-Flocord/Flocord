/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled, plugins } from "@api/PluginManager";
import { useSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { FlocordIcon, GithubIcon, HeadphonesIcon, UpdaterIcon } from "@components/Icons";
import { FLOCORD_VERSION, versionGt } from "@flocordplugins/FlocordAutoUpdater/version";
import { REPO_URL, SUPPORT_INVITE } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { PluginNative } from "@utils/types";
import { React, SettingsRouter } from "@webpack/common";

const cl = classNameFactory("vc-flocord-hero-");

const Updater = FlocordNative.pluginHelpers.FlocordAutoUpdater as PluginNative<typeof import("@flocordplugins/FlocordAutoUpdater/native")>;

type UpdateState =
    | { kind: "checking"; }
    | { kind: "current"; }
    | { kind: "outdated"; version: string; }
    | { kind: "unknown"; };

function useUpdateState(): UpdateState {
    const [state, setState] = React.useState<UpdateState>({ kind: "checking" });

    React.useEffect(() => {
        let cancelled = false;
        Updater.fetchVersionInfo()
            .then(info => {
                if (cancelled) return;
                if (!info) return setState({ kind: "unknown" });
                setState(versionGt(info.version, FLOCORD_VERSION) ? { kind: "outdated", version: info.version } : { kind: "current" });
            })
            .catch(() => !cancelled && setState({ kind: "unknown" }));
        return () => { cancelled = true; };
    }, []);

    return state;
}

function releaseChannel() {
    const channel = window.GLOBAL_ENV?.RELEASE_CHANNEL as string | undefined;
    if (!channel) return IS_WEB ? "Web" : "Desktop";
    return channel.charAt(0).toUpperCase() + channel.slice(1);
}

function StatusPill({ state }: { state: UpdateState; }) {
    switch (state.kind) {
        case "checking":
            return <span className={cl("pill", "pill-muted")}>Checking for updates…</span>;
        case "current":
            return <span className={cl("pill", "pill-ok")}><span className={cl("dot")} />Up to date</span>;
        case "outdated":
            return <span className={cl("pill", "pill-update")}><span className={cl("dot")} />v{state.version} available</span>;
        default:
            return <span className={cl("pill", "pill-muted")}>Update check unavailable</span>;
    }
}

export function FlocordHero() {
    const settings = useSettings(["enabledThemes"]);
    const update = useUpdateState();

    const pluginList = Object.values(plugins).filter(p => !p.hidden && !p.required);
    const enabledCount = pluginList.filter(p => isPluginEnabled(p.name)).length;

    return (
        <section className={cl("card")}>
            <div className={cl("glow")} aria-hidden />
            <div className={cl("identity")}>
                <div className={cl("logo")}>
                    <FlocordIcon width={34} height={34} fill="#fff" />
                </div>
                <div className={cl("titles")}>
                    <div className={cl("name-row")}>
                        <h2 className={cl("name")}>Flocord</h2>
                        <span className={cl("version")}>v{FLOCORD_VERSION}</span>
                    </div>
                    <StatusPill state={update} />
                </div>
            </div>

            <dl className={cl("stats")}>
                <div className={cl("stat")}>
                    <dt>Plugins</dt>
                    <dd>{enabledCount}<span className={cl("stat-total")}> / {pluginList.length}</span></dd>
                </div>
                <div className={cl("stat")}>
                    <dt>Themes</dt>
                    <dd>{settings.enabledThemes.length}</dd>
                </div>
                <div className={cl("stat")}>
                    <dt>Discord</dt>
                    <dd>{releaseChannel()}</dd>
                </div>
            </dl>

            <div className={cl("actions")}>
                {update.kind === "outdated" ? (
                    <Button variant="primary" size="small" onClick={() => SettingsRouter.openUserSettings("flocord_updater_panel")}>
                        <UpdaterIcon width={16} height={16} />
                        Update to v{update.version}
                    </Button>
                ) : (
                    <Button variant="secondary" size="small" onClick={() => SettingsRouter.openUserSettings("flocord_updater_panel")}>
                        <UpdaterIcon width={16} height={16} />
                        Updater
                    </Button>
                )}
                <Button variant="secondary" size="small" onClick={() => FlocordNative.native.openExternal(`https://discord.gg/${SUPPORT_INVITE}`)}>
                    <HeadphonesIcon width={16} height={16} />
                    Support server
                </Button>
                <Button variant="secondary" size="small" onClick={() => FlocordNative.native.openExternal(REPO_URL)}>
                    <GithubIcon width={16} height={16} />
                    GitHub
                </Button>
            </div>
        </section>
    );
}
