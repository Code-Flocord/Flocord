/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { ChannelStore, Menu, RestAPI, UserStore } from "@webpack/common";

const lockedGroups = new Set<string>();

const settings = definePluginSettings({
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show notifications for actions.",
        default: true
    },
    debugMode: {
        type: OptionType.BOOLEAN,
        description: "Debug mode with detailed console logs.",
        default: false
    }
});

function log(message: string, level: "info" | "warn" | "error" = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[LockGroup ${timestamp}]`;

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

function debugLog(message: string) {
    if (settings.store.debugMode) {
        log(`DEBUG: ${message}`);
    }
}

function interceptAddMember(originalMethod: any) {
    return function (this: any, ...args: any[]) {
        const [requestData] = args;

        // PUT /channels/{channelId}/recipients/{userId}
        if (requestData?.url?.match(/^\/channels\/\d+\/recipients\/\d+$/)) {
            const urlParts = requestData.url.split("/");
            const channelId = urlParts[2];
            const targetUserId = urlParts[4];

            if (lockedGroups.has(channelId)) {
                const channel = ChannelStore.getChannel(channelId);
                const currentUserId = UserStore.getCurrentUser()?.id;

                debugLog(`Member add detected in a locked group:
- Channel: ${channelId}
- Target user: ${targetUserId}
- Locked: yes
- Channel owner: ${channel?.ownerId}
- Current user: ${currentUserId}`);

                if (channel && channel.type === 3 && channel.ownerId === currentUserId) {
                    const channelName = channel.name || "Unnamed group";

                    debugLog(`Owner allowed to add members in "${channelName}"`);

                    if (settings.store.showNotifications && settings.store.debugMode) {
                        showNotification({
                            title: "LockGroup: add allowed",
                            body: `Owner allowed to add a member in "${channelName}"`,
                            icon: undefined
                        });
                    }

                    return originalMethod.apply(this, args);
                }

                if (channel && channel.type === 3) {
                    const channelName = channel.name || "Unnamed group";
                    log(`Unauthorized add detected in "${channelName}", scheduling auto-kick`);

                    setTimeout(async () => {
                        try {
                            debugLog(`Auto-kicking ${targetUserId}`);

                            await RestAPI.del({
                                url: `/channels/${channelId}/recipients/${targetUserId}`
                            });

                            log(`User ${targetUserId} auto-kicked from the locked group`);

                            if (settings.store.showNotifications) {
                                showNotification({
                                    title: "LockGroup: auto-kick",
                                    body: `Unauthorized member removed from locked group "${channelName}"`,
                                    icon: undefined
                                });
                            }
                        } catch (error) {
                            log(`Auto-kick failed: ${error}`, "error");
                        }
                    }, 100);

                    if (settings.store.showNotifications) {
                        showNotification({
                            title: "LockGroup: unauthorized add",
                            body: `Unauthorized add detected in "${channelName}", auto-kick in progress...`,
                            icon: undefined
                        });
                    }
                }
            }
        }

        return originalMethod.apply(this, args);
    };
}

function toggleGroupLock(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);
    const currentUserId = UserStore.getCurrentUser()?.id;

    if (!channel) {
        log("Channel not found", "error");
        return;
    }

    if (channel.type !== 3) { // 3 = GROUP_DM
        log("Not a group DM", "error");
        return;
    }

    if (!currentUserId) {
        log("Could not get the current user ID", "error");
        return;
    }

    const channelName = channel.name || "Unnamed group";

    if (channel.ownerId !== currentUserId) {
        log("Only the group owner can use this", "error");

        if (settings.store.showNotifications) {
            showNotification({
                title: "LockGroup",
                body: "Only the group owner can lock or unlock the group",
                icon: undefined
            });
        }
        return;
    }

    const isCurrentlyLocked = lockedGroups.has(channelId);

    if (isCurrentlyLocked) {
        lockedGroups.delete(channelId);
        log(`Group "${channelName}" unlocked`);

        if (settings.store.showNotifications) {
            showNotification({
                title: "LockGroup",
                body: `Group "${channelName}" unlocked, members can be added again`,
                icon: undefined
            });
        }
    } else {
        lockedGroups.add(channelId);
        log(`Group "${channelName}" locked`);

        if (settings.store.showNotifications) {
            showNotification({
                title: "LockGroup",
                body: `Group "${channelName}" locked, adding members is blocked`,
                icon: undefined
            });
        }
    }

    debugLog(`Locked groups: ${Array.from(lockedGroups).join(", ")}`);
}

const GroupContextMenuPatch: NavContextMenuPatchCallback = (children, { channel }: { channel: Channel; }) => {
    if (!channel || channel.type !== 3) return; // 3 = GROUP_DM

    const currentUserId = UserStore.getCurrentUser()?.id;
    const isOwner = channel.ownerId === currentUserId;

    if (!isOwner) return;

    const isLocked = lockedGroups.has(channel.id);
    const group = findGroupChildrenByChildId("leave-channel", children);

    if (group) {
        const menuItems = [<Menu.MenuSeparator key="separator" />];

        if (!isLocked) {
            menuItems.push(
                <Menu.MenuItem
                    key="lock-group"
                    id="vc-lock-group"
                    label="Lock group"
                    color="danger"
                    action={() => toggleGroupLock(channel.id)}
                    icon={() => (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h2c0-1.66 1.34-3 3-3s3 1.34 3 3v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2z" />
                        </svg>
                    )}
                />
            );
        }

        if (isLocked) {
            menuItems.push(
                <Menu.MenuItem
                    key="unlock-group"
                    id="vc-unlock-group"
                    label="Unlock group"
                    color="brand"
                    action={() => toggleGroupLock(channel.id)}
                    icon={() => (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6z" />
                        </svg>
                    )}
                />
            );
        }

        group.push(...menuItems);
    }
};

let originalPutMethod: any = null;

export default definePlugin({
    name: "LockGroup",
    description: "Lock or unlock group DMs from the context menu, preventing anyone else from adding members.",
    authors: [{
        name: "Bash",
        id: 1327483363518582784n
    }],
    dependencies: ["ContextMenuAPI"],
    settings,

    contextMenus: {
        "gdm-context": GroupContextMenuPatch
    },

    flux: {
        MESSAGE_CREATE(event: { message: any; }) {
            const { message } = event;
            const currentUserId = UserStore.getCurrentUser()?.id;

            if (message && message.type === 1) { // RECIPIENT_ADD
                const channelId = message.channel_id;

                if (lockedGroups.has(channelId)) {
                    const channel = ChannelStore.getChannel(channelId);

                    if (channel && channel.type === 3 && channel.ownerId === currentUserId) {
                        const channelName = channel.name || "Unnamed group";
                        const addedUserId = message.mentions?.[0]?.id;
                        const addedByUserId = message.author?.id;

                        log(`Member add message detected in "${channelName}"`);
                        debugLog(`Added by: ${addedByUserId}, added user: ${addedUserId}, owner: ${currentUserId}`);

                        if (addedByUserId === currentUserId) {
                            debugLog("Added by the owner, allowed");

                            if (settings.store.showNotifications && settings.store.debugMode) {
                                showNotification({
                                    title: "LockGroup: owner add",
                                    body: `Member added by the owner in "${channelName}", allowed`,
                                    icon: undefined
                                });
                            }
                            return;
                        }

                        if (addedUserId && addedByUserId !== currentUserId) {
                            debugLog(`Unauthorized add by ${addedByUserId}, scheduling kick`);

                            setTimeout(async () => {
                                try {
                                    await RestAPI.del({
                                        url: `/channels/${channelId}/recipients/${addedUserId}`
                                    });
                                    log(`Safety kick done for ${addedUserId} (added by ${addedByUserId})`);
                                } catch (error) {
                                    debugLog(`Safety kick failed: ${error}`);
                                }
                            }, 150);

                            if (settings.store.showNotifications) {
                                showNotification({
                                    title: "LockGroup: unauthorized add",
                                    body: `Member added without permission in "${channelName}" and removed`,
                                    icon: undefined
                                });
                            }
                        }
                    }
                }
            }
        }
    },

    start() {
        log("Plugin started");
        debugLog(`Current configuration:
- Notifications: ${settings.store.showNotifications ? "ON" : "OFF"}
- Debug: ${settings.store.debugMode ? "ON" : "OFF"}`);

        if (RestAPI && RestAPI.put) {
            originalPutMethod = RestAPI.put;
            RestAPI.put = interceptAddMember(originalPutMethod);
            debugLog("REST API interception installed");
        }

        if (settings.store.showNotifications) {
            showNotification({
                title: "LockGroup enabled",
                body: "Right-click a group to lock or unlock it",
                icon: undefined
            });
        }
    },

    stop() {
        log("Plugin stopped");

        if (originalPutMethod && RestAPI) {
            RestAPI.put = originalPutMethod;
            originalPutMethod = null;
            debugLog("REST API interception restored");
        }

        lockedGroups.clear();

        if (settings.store.showNotifications) {
            showNotification({
                title: "LockGroup disabled",
                body: "All locks have been removed",
                icon: undefined
            });
        }
    }
});
