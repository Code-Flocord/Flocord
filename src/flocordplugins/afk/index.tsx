/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import { FlocordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, Constants, RestAPI, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    afkEnabled: {
        type: OptionType.BOOLEAN,
        description: "Enable AFK mode.",
        default: false
    },
    autoReplyMessage: {
        type: OptionType.STRING,
        description: "Automatic reply sent while AFK mode is on.",
        default: "I'm currently AFK, I'll get back to you as soon as I can."
    },
    secondReplyThreshold: {
        type: OptionType.SLIDER,
        description: "Number of received messages before switching to the second AFK reply.",
        default: 2,
        markers: [2, 3, 5, 10, 20],
        minValue: 2,
        maxValue: 50,
        stickToMarkers: false
    },
    secondAutoReplyMessage: {
        type: OptionType.STRING,
        description: "AFK reply used from the second threshold on. Leave empty to keep the main reply.",
        default: "Still AFK, I'll get back to you as soon as I can."
    },
    thirdReplyThreshold: {
        type: OptionType.SLIDER,
        description: "Number of received messages before switching to the third AFK reply.",
        default: 3,
        markers: [3, 5, 10, 20, 30],
        minValue: 3,
        maxValue: 100,
        stickToMarkers: false
    },
    thirdAutoReplyMessage: {
        type: OptionType.STRING,
        description: "AFK reply used from the third threshold on. Leave empty to keep the previous reply.",
        default: "Still AFK, thanks for your patience."
    },
    replyInDm: {
        type: OptionType.BOOLEAN,
        description: "Reply automatically in DMs.",
        default: true
    },
    replyInGroupDm: {
        type: OptionType.BOOLEAN,
        description: "Reply automatically in group DMs.",
        default: true
    },
    replyInGuildWhenMentioned: {
        type: OptionType.BOOLEAN,
        description: "Reply in servers only when you are mentioned.",
        default: true
    },
    muteConversationOnAutoReply: {
        type: OptionType.BOOLEAN,
        description: "Mute the conversation after sending an AFK reply.",
        default: false
    },
    cooldownMs: {
        type: OptionType.SLIDER,
        description: "Minimum delay between two automatic replies in the same conversation (ms). Messages received during this delay get no reply.",
        default: 5000,
        markers: [0, 10000, 30000, 60000, 120000],
        minValue: 0,
        maxValue: 300000,
        stickToMarkers: false
    },
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show a notification when AFK mode changes.",
        default: true
    }
});

let startTime = 0;
const lastAutoReplyByChannel = new Map<string, number>();
const receivedCountByChannel = new Map<string, number>();
const mutedChannels = new Set<string>();

function toggleAfk() {
    settings.store.afkEnabled = !settings.store.afkEnabled;

    if (settings.store.afkEnabled) {
        startTime = Date.now();
        lastAutoReplyByChannel.clear();
        receivedCountByChannel.clear();
        mutedChannels.clear();
    }

    if (settings.store.showNotifications) {
        showNotification({
            title: "AFK",
            body: settings.store.afkEnabled ? "AFK mode enabled" : "AFK mode disabled",
            icon: undefined
        });
    }
}

function AfkIcon({ className, enabled = false }: { className?: string; enabled?: boolean; }) {
    return (
        <svg className={className} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
                fill="currentColor"
                d="M12 2a7 7 0 0 0-7 7v5l-1.5 2a1 1 0 0 0 .8 1.6h15.4a1 1 0 0 0 .8-1.6L19 14V9a7 7 0 0 0-7-7Zm0 20a3 3 0 0 0 2.82-2H9.18A3 3 0 0 0 12 22Z"
                style={{ opacity: enabled ? 1 : 0.55 }}
            />
            {enabled && <circle cx="18" cy="6" r="3" fill="var(--status-danger)" />}
        </svg>
    );
}

function AfkButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const { afkEnabled } = settings.use(["afkEnabled"]);

    return (
        <UserAreaButton
            tooltipText={hideTooltips ? void 0 : afkEnabled ? "AFK on" : "AFK off"}
            icon={<AfkIcon className={iconForeground} enabled={afkEnabled} />}
            role="switch"
            aria-checked={afkEnabled}
            redGlow={afkEnabled}
            plated={nameplate != null}
            onClick={toggleAfk}
        />
    );
}

function getMessageChannelId(message: any): string | null {
    return message?.channel_id ?? message?.channelId ?? null;
}

function getMessageTimestampMs(message: any): number {
    if (!message?.timestamp) return Date.now();
    const ts = new Date(message.timestamp).getTime();
    return Number.isFinite(ts) ? ts : Date.now();
}

function isMentioningCurrentUser(message: any, currentUserId: string): boolean {
    if (!message) return false;

    const mentions = Array.isArray(message.mentions) ? message.mentions : [];
    if (mentions.some((m: any) => m?.id === currentUserId)) return true;

    const content = String(message.content ?? "");
    return content.includes(`<@${currentUserId}>`) || content.includes(`<@!${currentUserId}>`);
}

function resolveAutoReplyContent(messageCount: number): string {
    const first = String(settings.store.autoReplyMessage ?? "").trim();
    const second = String(settings.store.secondAutoReplyMessage ?? "").trim();
    const third = String(settings.store.thirdAutoReplyMessage ?? "").trim();

    const secondThreshold = Math.max(2, Number(settings.store.secondReplyThreshold) || 2);
    const rawThirdThreshold = Math.max(3, Number(settings.store.thirdReplyThreshold) || 3);
    const thirdThreshold = Math.max(rawThirdThreshold, secondThreshold + 1);

    if (messageCount >= thirdThreshold) {
        if (third) return third;
        if (second) return second;
        return first;
    }

    if (messageCount >= secondThreshold) {
        if (second) return second;
        return first;
    }

    return first;
}

async function sendAutoReplyForCount(channelId: string, messageCount: number): Promise<void> {
    const content = resolveAutoReplyContent(messageCount);
    if (!content) return;

    await RestAPI.post({
        url: Constants.Endpoints.MESSAGES(channelId),
        body: { content }
    });
}

function resolveChannelSettingsEndpoint(channelId: string): string {
    const endpoints = (Constants as any)?.Endpoints;
    const fn = endpoints?.USER_CHANNEL_SETTINGS;
    if (typeof fn === "function") {
        return fn(channelId);
    }

    return `/users/@me/channels/${channelId}`;
}

async function muteConversation(channelId: string): Promise<void> {
    if (mutedChannels.has(channelId)) return;

    const url = resolveChannelSettingsEndpoint(channelId);
    await RestAPI.patch({
        url,
        body: {
            muted: true
        }
    });

    mutedChannels.add(channelId);
}

export default definePlugin({
    name: "AFK",
    description: "AFK mode with automatic replies in DMs and when mentioned in servers, toggled from the user panel.",
    authors: [FlocordDevs.Flocord],
    tags: ["Activity"],
    dependencies: ["UserAreaAPI"],
    settings,

    userAreaButton: {
        icon: AfkIcon,
        render: AfkButton
    },

    start() {
        startTime = Date.now();
        lastAutoReplyByChannel.clear();
        receivedCountByChannel.clear();
        mutedChannels.clear();
    },

    stop() {
        lastAutoReplyByChannel.clear();
        receivedCountByChannel.clear();
        mutedChannels.clear();
    },

    flux: {
        async MESSAGE_CREATE({ message }: { message: any; }) {
            const me = UserStore.getCurrentUser();
            const myId = me?.id;
            if (!myId || !message) return;

            const authorId = message.author?.id;
            const isOwnMessage = authorId === myId;
            if (isOwnMessage) return;

            if (!settings.store.afkEnabled) return;
            if (message.author?.bot) return;

            const timestamp = getMessageTimestampMs(message);
            if (timestamp < startTime) return;

            const channelId = getMessageChannelId(message);
            if (!channelId) return;

            const messageCount = (receivedCountByChannel.get(channelId) ?? 0) + 1;
            receivedCountByChannel.set(channelId, messageCount);

            const channel = ChannelStore.getChannel(channelId);
            const channelType = channel?.type;

            let shouldReply = false;

            if (channelType === 1) {
                shouldReply = settings.store.replyInDm;
            } else if (channelType === 3) {
                shouldReply = settings.store.replyInGroupDm;
            } else {
                shouldReply = settings.store.replyInGuildWhenMentioned && isMentioningCurrentUser(message, myId);
            }

            if (!shouldReply) return;

            const now = Date.now();
            const lastReplyAt = lastAutoReplyByChannel.get(channelId) ?? 0;
            if (now - lastReplyAt < settings.store.cooldownMs) return;

            try {
                await sendAutoReplyForCount(channelId, messageCount);
                lastAutoReplyByChannel.set(channelId, now);

                if (settings.store.muteConversationOnAutoReply) {
                    try {
                        await muteConversation(channelId);
                    } catch (muteError) {
                        console.warn("[Afk] Failed to mute the conversation:", muteError);
                    }
                }
            } catch (error) {
                console.error("[Afk] Failed to send the automatic reply:", error);
            }
        }
    }
});
