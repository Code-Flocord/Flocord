/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { FlocordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { ChannelStore, UserStore } from "@webpack/common";

const UserSettingsProto = findByPropsLazy("updateRemoteSettings");
const PresenceStore = findStoreLazy("PresenceStore");

let previousStatus: string | null = null;

const settings = definePluginSettings({
    autoDND: {
        type: OptionType.BOOLEAN,
        description: "Automatically switch to Do Not Disturb while the plugin is enabled.",
        default: true,
    },
    allowMentions: {
        type: OptionType.BOOLEAN,
        description: "Still get notified for direct mentions (@you, @everyone, @here).",
        default: false,
    },
    allowDMs: {
        type: OptionType.BOOLEAN,
        description: "Still get notified for direct messages.",
        default: false,
    },
    keywords: {
        type: OptionType.STRING,
        description: "Keywords that trigger a notification, separated by commas.",
        default: "",
        placeholder: "urgent, meeting, bug",
    },
    whitelistedUsers: {
        type: OptionType.STRING,
        description: "IDs of users you always want notifications from, separated by commas.",
        default: "",
        placeholder: "123456789012345678",
    },
});

function shouldShowNotification(message: any, channelId: string): boolean {
    const { allowMentions, allowDMs } = settings.store;
    const me = UserStore.getCurrentUser();
    if (!me) return true;

    const channel = ChannelStore.getChannel(channelId);
    if (allowDMs && (channel?.type === 1 || channel?.type === 3)) return true;

    if (allowMentions) {
        if (message?.mention_everyone) return true;
        if (message?.mentions?.some((u: any) => u.id === me.id)) return true;
    }

    const content = (message?.content ?? "").toLowerCase();
    const keywords = settings.store.keywords
        .split(",")
        .map((k: string) => k.trim().toLowerCase())
        .filter(Boolean);
    if (keywords.some((k: string) => content.includes(k))) return true;

    const whitelist = settings.store.whitelistedUsers
        .split(",")
        .map((id: string) => id.trim())
        .filter(Boolean);
    if (whitelist.includes(message?.author?.id)) return true;

    return false;
}

export default definePlugin({
    name: "SmartNotifications",
    description: "Only get notifications for mentions, keywords or selected users, and switch to Do Not Disturb automatically.",
    authors: [FlocordDevs.Flocord],
    settings,

    patches: [
        {
            find: '"NotificationStore"',
            replacement: {
                // `let shouldNotify = notify(message, channelId, ...)` in the MESSAGE_CREATE handler
                match: /(let (\i)=\(0,\i\.\i\)\((\i),(\i),!\i\))(?=,\i=\i\.\i\.getNotifyMessagesInSelectedChannel)/,
                replace: "$1&&$self.shouldShowNotification($3,$4)"
            }
        }
    ],

    shouldShowNotification,

    start() {
        if (!settings.store.autoDND) return;
        const me = UserStore.getCurrentUser();
        if (!me) return;
        try {
            previousStatus = (PresenceStore as any).getStatus?.(me.id) ?? "online";
            UserSettingsProto.updateRemoteSettings?.({ status: "dnd" });
        } catch { /* ignore */ }
    },

    stop() {
        if (previousStatus !== null) {
            try {
                UserSettingsProto.updateRemoteSettings?.({ status: previousStatus });
            } catch { /* ignore */ }
            previousStatus = null;
        }
    },
});
