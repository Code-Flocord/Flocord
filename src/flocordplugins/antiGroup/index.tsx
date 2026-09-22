/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { FlocordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, Constants, RestAPI, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable AntiGroup.",
        default: true
    },
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show a notification when a group is left automatically.",
        default: true
    },
    verboseLogs: {
        type: OptionType.BOOLEAN,
        description: "Write detailed logs to the console.",
        default: true
    },
    delay: {
        type: OptionType.NUMBER,
        description: "Delay before leaving the group, in milliseconds.",
        default: 1000,
        min: 100,
        max: 10000
    },
    whitelist: {
        type: OptionType.STRING,
        description: "IDs of users allowed to add you to groups, separated by commas.",
        default: ""
    },
    autoReply: {
        type: OptionType.BOOLEAN,
        description: "Send an automatic message before leaving.",
        default: true
    },
    replyMessage: {
        type: OptionType.STRING,
        description: "Message to send before leaving.",
        default: "I don't want to be added to group DMs. Please message me directly instead."
    }
});

function log(message: string, level: "info" | "warn" | "error" = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[AntiGroup ${timestamp}]`;

    switch (level) {
        case "warn":
            console.warn(prefix, message);
            break;
        case "error":
            console.error(prefix, message);
            break;
        default:
            console.log(prefix, message);
    }
}

function verboseLog(message: string) {
    if (settings.store.verboseLogs) {
        log(message);
    }
}

async function leaveGroupDM(channelId: string) {
    try {
        const channel = ChannelStore.getChannel(channelId);
        const channelName = channel?.name || "Unnamed group";
        const recipients = channel?.recipients || [];

        log(`Leaving group "${channelName}" (ID: ${channelId})`);
        verboseLog(`Group info:
- Name: ${channelName}
- ID: ${channelId}
- Type: ${channel?.type}
- Owner: ${channel?.ownerId}
- Members: ${recipients.length + 1}`);

        if (settings.store.autoReply && settings.store.replyMessage.trim()) {
            log(`Sending automatic message: "${settings.store.replyMessage}"`);

            try {
                await RestAPI.post({
                    url: Constants.Endpoints.MESSAGES(channelId),
                    body: {
                        content: settings.store.replyMessage
                    }
                });

                log("Automatic message sent");
                verboseLog("Waiting 500ms for the message to be delivered");

                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (msgError) {
                log(`Failed to send the automatic message: ${msgError}`, "error");
            }
        } else {
            verboseLog("Automatic message disabled or empty");
        }

        log("Leaving the group");
        await RestAPI.del({
            url: Constants.Endpoints.CHANNEL(channelId)
        });

        log(`Left group "${channelName}"`);

        if (settings.store.showNotifications) {
            showNotification({
                title: "AntiGroup: group left",
                body: `You automatically left the group "${channelName}".`,
                icon: undefined
            });
            verboseLog("Success notification shown");
        }

        log(`Leave summary:
- Group: "${channelName}" (${channelId})
- Automatic message sent: ${settings.store.autoReply ? "yes" : "no"}
- Delay applied: ${settings.store.delay}ms
- Notification shown: ${settings.store.showNotifications ? "yes" : "no"}`);

    } catch (error) {
        const channel = ChannelStore.getChannel(channelId);
        const channelName = channel?.name || "Unknown group";

        log(`Failed to leave group "${channelName}" (${channelId}): ${error}`, "error");

        if (settings.store.verboseLogs) {
            console.error("[AntiGroup] Error details:", {
                channelId,
                channelName,
                error,
                stack: error instanceof Error ? error.stack : undefined
            });
        }

        if (settings.store.showNotifications) {
            showNotification({
                title: "AntiGroup: error",
                body: `Could not automatically leave the group "${channelName}".`,
                icon: undefined
            });
            verboseLog("Error notification shown");
        }
    }
}

function isUserWhitelisted(userId: string): boolean {
    const whitelist = settings.store.whitelist
        .split(",")
        .map(id => id.trim())
        .filter(id => id.length > 0);

    const isWhitelisted = whitelist.includes(userId);
    verboseLog(`Whitelist check for user ${userId}: ${isWhitelisted ? "allowed" : "not allowed"}`);

    return isWhitelisted;
}

function wasRecentlyAdded(channel: any, currentUserId: string): boolean {
    if (channel.type !== 3) {
        verboseLog(`Channel ${channel.id} is not a group DM (type: ${channel.type})`);
        return false;
    }

    const wasAdded = channel.ownerId !== currentUserId;
    verboseLog(`Recent add check: ${wasAdded ? "added by someone else" : "created by you"} (owner: ${channel.ownerId})`);

    return wasAdded;
}

export default definePlugin({
    name: "AntiGroup",
    description: "Automatically leaves group DMs as soon as you are added to one.",
    authors: [FlocordDevs.Flocord],
    settings,

    flux: {
        CHANNEL_CREATE(event: { channel: any; }) {
            verboseLog(`CHANNEL_CREATE received for channel ${event.channel?.id}`);

            if (!settings.store.enabled) {
                verboseLog("Plugin disabled, ignoring");
                return;
            }

            const { channel } = event;
            const currentUserId = UserStore.getCurrentUser()?.id;

            if (!channel || !currentUserId) {
                verboseLog(`Missing data: channel=${!!channel}, currentUserId=${!!currentUserId}`);
                return;
            }

            verboseLog(`Channel details:
- ID: ${channel.id}
- Type: ${channel.type}
- Name: ${channel.name || "Unnamed"}
- Owner: ${channel.ownerId}
- Current user: ${currentUserId}`);

            if (channel.type !== 3) {
                verboseLog(`Ignored: not a group DM (type ${channel.type})`);
                return;
            }

            if (!wasRecentlyAdded(channel, currentUserId)) {
                verboseLog("Ignored: you created this group");
                return;
            }

            log(`New group DM detected: "${channel.name || "Unnamed"}" (${channel.id})`);

            if (channel.ownerId && isUserWhitelisted(channel.ownerId)) {
                log(`Owner ${channel.ownerId} is whitelisted, group allowed`);
                return;
            }

            const whitelistedMember = channel.recipients?.find((recipient: any) =>
                isUserWhitelisted(recipient.id)
            );

            if (whitelistedMember) {
                log(`Member ${whitelistedMember.id} is whitelisted, group allowed`);
                return;
            }

            log(`No whitelisted member found, leaving automatically in ${settings.store.delay}ms`);

            if (settings.store.showNotifications) {
                showNotification({
                    title: "AntiGroup: group detected",
                    body: `Added to group "${channel.name || "Unnamed"}". Leaving automatically in ${settings.store.delay / 1000}s.`,
                    icon: undefined
                });
            }

            setTimeout(() => {
                verboseLog("Delay elapsed, leaving the group");
                leaveGroupDM(channel.id);
            }, settings.store.delay);
        }
    },

    start() {
        log("AntiGroup started");
        log(`Current configuration:
- Notifications: ${settings.store.showNotifications ? "on" : "off"}
- Verbose logs: ${settings.store.verboseLogs ? "on" : "off"}
- Automatic message: ${settings.store.autoReply ? "on" : "off"}
- Delay: ${settings.store.delay}ms
- Whitelist: ${settings.store.whitelist || "empty"}`);

        if (settings.store.showNotifications) {
            showNotification({
                title: "AntiGroup enabled",
                body: "Protection against unwanted group DMs is on.",
                icon: undefined
            });
        }
    },

    stop() {
        log("AntiGroup stopped");

        if (settings.store.showNotifications) {
            showNotification({
                title: "AntiGroup disabled",
                body: "Protection against unwanted group DMs is off.",
                icon: undefined
            });
        }
    }
});
