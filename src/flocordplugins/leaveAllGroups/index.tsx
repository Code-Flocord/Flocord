/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { settings as pinDmsSettings } from "@plugins/pinDms";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { findStoreLazy } from "@webpack";
import { ChannelStore, Menu, RestAPI, showToast, Toasts, UserStore } from "@webpack/common";

const PrivateChannelSortStore = findStoreLazy("PrivateChannelSortStore") as { getPrivateChannelIds: () => string[]; };

const settings = definePluginSettings({
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show notifications and toasts for actions.",
        default: true
    },
    confirmBeforeLeave: {
        type: OptionType.BOOLEAN,
        description: "Ask for confirmation before leaving all groups.",
        default: false
    },
    leaveSilently: {
        type: OptionType.BOOLEAN,
        description: "Leave without notifying other members by default.",
        default: true
    },
    excludePinnedGroups: {
        type: OptionType.BOOLEAN,
        description: "Skip groups pinned with the PinDMs plugin.",
        default: true
    },
    delayBetweenLeaves: {
        type: OptionType.NUMBER,
        description: "Delay in milliseconds between each group leave, to avoid rate limits.",
        default: 200,
        min: 50,
        max: 5000
    },
    debugMode: {
        type: OptionType.BOOLEAN,
        description: "Debug mode with detailed console logs.",
        default: false
    }
});

function log(message: string, level: "info" | "warn" | "error" = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[LeaveAllGroups ${timestamp}]`;

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
        log(message);
    }
}

function notify(title: string, body: string, toastType?: string, toastBody?: string) {
    if (!settings.store.showNotifications) return;

    showNotification({
        title,
        body,
        icon: undefined
    });

    if (toastType != null && toastBody) {
        showToast(toastBody, toastType);
    }
}

function confirmLeaveAll(groupCount: number): boolean {
    if (!settings.store.confirmBeforeLeave) return true;

    return confirm(
        `Are you sure you want to leave all ${groupCount} groups?\n\n` +
        "This cannot be undone.\n" +
        "You will be removed from every group instantly."
    );
}

async function leaveGroup(channelId: string): Promise<boolean> {
    try {
        debugLog(`Leaving group ${channelId}`);

        await RestAPI.del({
            url: `/channels/${channelId}`,
            query: {
                silent: settings.store.leaveSilently
            }
        });

        debugLog(`Left group ${channelId}`);
        return true;
    } catch (error) {
        log(`Failed to leave group ${channelId}: ${error}`, "error");
        return false;
    }
}

function getAllGroups(): Channel[] {
    const privateChannelIds = PrivateChannelSortStore.getPrivateChannelIds();
    const groups: Channel[] = [];

    privateChannelIds.forEach((channelId: string) => {
        const channel = ChannelStore.getChannel(channelId);

        if (channel && channel.type === 3) {
            groups.push(channel);
        }
    });

    return groups;
}

function getPinnedChannelIdsForUser(userId: string): Set<string> {
    const categoryList = pinDmsSettings.store.userBasedCategoryList[userId] ?? [];
    const pinnedIds = categoryList.flatMap(category => category.channels ?? []);
    return new Set(pinnedIds);
}

async function leaveAllGroups() {
    try {
        const currentUserId = UserStore.getCurrentUser()?.id;

        if (!currentUserId) {
            log("Could not get the current user ID", "error");
            return;
        }

        const allGroups = getAllGroups();
        const pinnedChannelIds = settings.store.excludePinnedGroups
            ? getPinnedChannelIdsForUser(currentUserId)
            : new Set<string>();

        const groups = allGroups.filter(group => !pinnedChannelIds.has(group.id));
        const excludedPinnedCount = allGroups.length - groups.length;

        debugLog(`Summary:
- Groups found: ${allGroups.length}
- Pinned groups skipped: ${excludedPinnedCount}
- Current user: ${currentUserId}`);

        if (groups.length === 0) {
            const emptyMessage = excludedPinnedCount > 0
                ? "No group to leave (every group found is pinned)"
                : "No group to leave";

            log(emptyMessage, "warn");
            notify("LeaveAllGroups", emptyMessage, Toasts.Type.MESSAGE, emptyMessage);
            return;
        }

        if (!confirmLeaveAll(groups.length)) {
            log("Cancelled by the user");
            return;
        }

        log(`Leaving ${groups.length} group(s)${excludedPinnedCount > 0 ? ` (${excludedPinnedCount} pinned skipped)` : ""}`);

        let successCount = 0;
        let failureCount = 0;

        notify(
            "LeaveAllGroups in progress",
            `Leaving ${groups.length} group(s)...`,
            Toasts.Type.MESSAGE,
            `Leaving ${groups.length} group(s)...`
        );

        for (const group of groups) {
            const groupName = group.name || `Group ${group.id}`;
            debugLog(`Processing group: ${groupName} (${group.id})`);

            const success = await leaveGroup(group.id);
            if (success) {
                successCount++;
                debugLog(`Left: ${groupName}`);
            } else {
                failureCount++;
                debugLog(`Failed: ${groupName}`);
            }

            if (settings.store.delayBetweenLeaves > 0) {
                await new Promise(resolve => setTimeout(resolve, settings.store.delayBetweenLeaves));
            }
        }

        const totalProcessed = successCount + failureCount;

        log(`Done:
- Groups processed: ${totalProcessed}
- Succeeded: ${successCount}
- Failed: ${failureCount}`);

        const title = failureCount > 0 ? "LeaveAllGroups finished with errors" : "LeaveAllGroups finished";
        const body = failureCount > 0
            ? `${successCount} groups left, ${failureCount} failed`
            : `${successCount} groups left successfully`;

        if (failureCount > 0) {
            notify(title, body, Toasts.Type.FAILURE, `${successCount} groups left, ${failureCount} failed`);
        } else {
            notify(title, body, Toasts.Type.SUCCESS, `${successCount} groups left successfully`);
        }

    } catch (error) {
        log(`Unexpected error: ${error}`, "error");

        notify(
            "LeaveAllGroups error",
            "Something went wrong while leaving groups",
            Toasts.Type.FAILURE,
            "Failed to leave groups"
        );
    }
}

const GroupContextMenuPatch: NavContextMenuPatchCallback = (children, { channel }: { channel: Channel; }) => {
    if (channel?.type !== 3) return;

    const container = findGroupChildrenByChildId("leave-channel", children);

    if (container) {
        container.push(
            <Menu.MenuItem
                id="vc-leave-all-groups"
                label="Leave all groups"
                action={leaveAllGroups}
                color="danger"
            />
        );
    }
};

const ServerContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    const group = findGroupChildrenByChildId("privacy", children);

    if (group) {
        group.push(
            <Menu.MenuItem
                id="vc-leave-all-groups-server"
                label="Leave all groups"
                action={leaveAllGroups}
                color="danger"
            />
        );
    }
};

const UserContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    const container = findGroupChildrenByChildId("block", children) || findGroupChildrenByChildId("remove-friend", children);

    if (container) {
        container.push(
            <Menu.MenuItem
                id="vc-leave-all-groups-user"
                label="Leave all groups"
                action={leaveAllGroups}
                color="danger"
            />
        );
    }
};

export default definePlugin({
    name: "LeaveAllGroups",
    description: "Leave every group DM in one click, with configurable rate limiting.",
    authors: [Devs.BigDuck],
    settings,

    contextMenus: {
        "gdm-context": GroupContextMenuPatch,
        "guild-context": ServerContextMenuPatch,
        "user-context": UserContextMenuPatch
    },

    start() {
        log("Plugin started");
    },

    stop() {
        log("Plugin stopped");
    }
});
