/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { isPluginEnabled, plugins as registeredPlugins, startPlugin, stopPlugin } from "@api/PluginManager";
import { definePluginSettings, Settings } from "@api/Settings";
import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import { FlocordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { PresenceStore, UserStore } from "@webpack/common";

import managedStyle from "./style.css?managed";

const UserSettingsProtoStore = findByPropsLazy("updateRemoteSettings");

const logger = new Logger("StreamSafeMode");

/** Plugins turned on together with safe mode, and turned back off when leaving it */
const PROTECTORS = ["StreamBlurPrivacy", "NoDMWhileStreaming", "StreamProof", "StreamerModeOn"] as const;

const settings = definePluginSettings({
    plugins: {
        type: OptionType.BOOLEAN,
        description: "Turn on the privacy plugins (StreamBlurPrivacy, NoDMWhileStreaming, StreamProof, StreamerModeOn).",
        default: true
    },
    hideDmList: {
        type: OptionType.BOOLEAN,
        description: "Hide the direct message list and the friends list.",
        default: true,
        onChange: () => refresh()
    },
    hideNames: {
        type: OptionType.BOOLEAN,
        description: "Blur usernames and avatars in the member list and the DM list.",
        default: false,
        onChange: () => refresh()
    },
    muteNotifications: {
        type: OptionType.BOOLEAN,
        description: "Silence Flocord notifications while safe mode is on.",
        default: true
    },
    invisible: {
        type: OptionType.BOOLEAN,
        description: "Also switch your status to invisible.",
        default: false
    },
    auto: {
        type: OptionType.BOOLEAN,
        description: "Turn safe mode on automatically when you start streaming, and off when you stop.",
        default: true
    },
    notify: {
        type: OptionType.BOOLEAN,
        description: "Show a notification when safe mode turns on or off.",
        default: true
    },
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Safe mode is on.",
        default: false,
        hidden: true
    }
});

/** Plugins this plugin started, so ones the user already had on are never turned off */
const startedByUs = new Set<string>();
let previousNotifications: "always" | "never" | "not-focused" | undefined;
let previousStatus: string | undefined;

function refresh() {
    const on = settings.store.enabled;
    document.documentElement.classList.toggle("flocord-stream-safe", on);
    document.documentElement.classList.toggle("flocord-stream-safe-dms", on && settings.store.hideDmList);
    document.documentElement.classList.toggle("flocord-stream-safe-names", on && settings.store.hideNames);
}

function setProtectors(on: boolean) {
    if (!settings.store.plugins) return;

    for (const name of PROTECTORS) {
        const plugin = registeredPlugins[name];
        if (!plugin) continue;

        try {
            if (on) {
                if (isPluginEnabled(name)) continue;
                if (startPlugin(plugin)) startedByUs.add(name);
            } else if (startedByUs.delete(name)) {
                stopPlugin(plugin);
            }
        } catch (err) {
            logger.warn(`Could not toggle ${name}`, err);
        }
    }
}

function setNotifications(on: boolean) {
    if (!settings.store.muteNotifications) return;

    const store = Settings.notifications;
    if (on) {
        previousNotifications ??= store.useNative ?? "not-focused";
        store.useNative = "never";
    } else if (previousNotifications !== undefined) {
        store.useNative = previousNotifications;
        previousNotifications = undefined;
    }
}

function setStatus(on: boolean) {
    if (!settings.store.invisible) return;

    try {
        if (on) {
            previousStatus ??= PresenceStore.getStatus(UserStore.getCurrentUser()?.id) ?? "online";
            UserSettingsProtoStore?.updateRemoteSettings?.({ status: "invisible" });
        } else if (previousStatus !== undefined) {
            UserSettingsProtoStore?.updateRemoteSettings?.({ status: previousStatus });
            previousStatus = undefined;
        }
    } catch (err) {
        logger.warn("Could not change status", err);
    }
}

export function toggle(on = !settings.store.enabled) {
    if (settings.store.enabled === on) return;

    settings.store.enabled = on;
    refresh();
    setProtectors(on);
    setNotifications(on);
    setStatus(on);

    if (settings.store.notify) {
        showNotification({
            title: "Stream safe mode",
            body: on ? "Private information is hidden while you stream." : "Everything is back to normal.",
            noPersist: true
        });
    }
}

function ShieldIcon({ className, enabled = false }: { className?: string; enabled?: boolean; }) {
    return (
        <svg className={className} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
                fill="currentColor"
                d="M12 2 4 5v6.5c0 4.7 3.4 9.1 8 10.5 4.6-1.4 8-5.8 8-10.5V5l-8-3Z"
                style={{ opacity: enabled ? 1 : 0.55 }}
            />
            {enabled && <path fill="var(--background-base-lowest, #111)" d="m10.9 15.4-2.8-2.8 1.4-1.4 1.4 1.4 3.6-3.6 1.4 1.4-5 5Z" />}
        </svg>
    );
}

function SafeModeButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const { enabled } = settings.use(["enabled"]);

    return (
        <UserAreaButton
            tooltipText={hideTooltips ? void 0 : enabled ? "Stream safe mode on" : "Stream safe mode off"}
            icon={<ShieldIcon className={iconForeground} enabled={enabled} />}
            role="switch"
            aria-checked={enabled}
            redGlow={enabled}
            plated={nameplate != null}
            onClick={() => toggle()}
        />
    );
}

export default definePlugin({
    name: "StreamSafeMode",
    description: "One switch that hides everything private before you go live: DMs, names, notifications, and the Flocord UI. Turns itself on when you start streaming.",
    authors: [FlocordDevs.Flocord],
    tags: ["Privacy"],
    dependencies: ["UserAreaAPI"],
    settings,
    managedStyle,

    userAreaButton: {
        icon: ShieldIcon,
        render: SafeModeButton
    },

    patches: [
        {
            find: "DISCONNECT_FROM_VOICE_CHANNEL]",
            replacement: {
                match: /\[\i\.\i\.DISCONNECT_FROM_VOICE_CHANNEL/,
                replace: '["FLOCORD_STREAM_SAFE"]:{onTrigger(){$self.toggle()},keyEvents:{keyUp:!0,keyDown:!1,blurred:!0,focused:!0}},$&'
            }
        },
        {
            find: '"push-to-talk-priority"',
            replacement: {
                match: /(\{id:.{0,25}?value:\i\.\i\.UNASSIGNED)/,
                replace: '{id:"flocord-stream-safe",value:"FLOCORD_STREAM_SAFE",label:"Stream Safe Mode (Flocord)"},$1'
            }
        }
    ],

    toggle,

    flux: {
        STREAM_CREATE() {
            if (settings.store.auto) toggle(true);
        },
        STREAM_DELETE() {
            if (settings.store.auto) toggle(false);
        }
    },

    start() {
        // Never come back locked into safe mode after a restart
        settings.store.enabled = false;
        refresh();
    },

    stop() {
        toggle(false);
        document.documentElement.classList.remove("flocord-stream-safe", "flocord-stream-safe-dms", "flocord-stream-safe-names");
    }
});
