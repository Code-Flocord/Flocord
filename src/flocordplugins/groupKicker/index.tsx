/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { FlocordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { ChannelStore, Menu, RestAPI, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable GroupKicker.",
        default: true
    },
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show notifications for actions.",
        default: true
    },
    confirmBeforeKick: {
        type: OptionType.BOOLEAN,
        description: "Ask for confirmation before kicking every member.",
        default: true
    },
    debugMode: {
        type: OptionType.BOOLEAN,
        description: "Debug mode (detailed logs).",
        default: false
    }
});

// Fonction de log avec préfixe
function log(message: string, level: "info" | "warn" | "error" = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[GroupKicker ${timestamp}]`;

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

// Log de débogage
function debugLog(message: string) {
    if (settings.store.debugMode) {
        log(message, "info");
    }
}

// Fonction pour confirmer l'action
function confirmKickAll(memberCount: number): boolean {
    if (!settings.store.confirmBeforeKick) return true;

    return confirm(
        `Are you sure you want to kick all ${memberCount} members of this group?\n\n` +
        "This cannot be undone.\n" +
        "Every member will be removed from the group immediately."
    );
}

// Fonction pour kicker un utilisateur spécifique d'un groupe
async function kickUserFromGroup(channelId: string, userId: string): Promise<boolean> {
    try {
        debugLog(`Kicking user ${userId} from group ${channelId}`);

        await RestAPI.del({
            url: `/channels/${channelId}/recipients/${userId}`
        });

        debugLog(`User ${userId} kicked`);
        return true;
    } catch (error) {
        log(`Failed to kick user ${userId}: ${error}`, "error");
        return false;
    }
}

// Fonction principale pour kicker tous les membres d'un groupe
async function kickAllMembers(channelId: string) {
    if (!settings.store.enabled) {
        log("Plugin disabled", "warn");
        return;
    }

    try {
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
            log("Could not get the current user id", "error");
            return;
        }

        const recipients = channel.recipients || [];
        const channelName = channel.name || "Unnamed group";

        debugLog(`Group info:
- Name: ${channelName}
- ID: ${channelId}
- Owner: ${channel.ownerId}
- Recipients: ${recipients.length}
- Current user: ${currentUserId}`);

        // Vérifier si l'utilisateur est le propriétaire du groupe
        if (channel.ownerId !== currentUserId) {
            log("Only the group owner can use this", "error");

            if (settings.store.showNotifications) {
                showNotification({
                    title: "GroupKicker",
                    body: "Only the group owner can kick every member.",
                    icon: undefined
                });
            }
            return;
        }

        if (recipients.length === 0) {
            log("No members to kick", "warn");

            if (settings.store.showNotifications) {
                showNotification({
                    title: "GroupKicker",
                    body: "There is nobody to kick in this group.",
                    icon: undefined
                });
            }
            return;
        }

        // Demander confirmation
        if (!confirmKickAll(recipients.length)) {
            log("Cancelled by the user");
            return;
        }

        log(`Kicking ${recipients.length} member(s) from group "${channelName}"`);

        let successCount = 0;
        let failureCount = 0;

        // Notification de début
        if (settings.store.showNotifications) {
            showNotification({
                title: "GroupKicker",
                body: `Kicking ${recipients.length} member(s)...`,
                icon: undefined
            });
        }

        // Kicker chaque membre (sauf l'utilisateur actuel)
        for (const recipientId of recipients) {
            if (recipientId === currentUserId) {
                debugLog(`Skipping current user: ${recipientId}`);
                continue;
            }

            const success = await kickUserFromGroup(channelId, recipientId);
            if (success) {
                successCount++;
            } else {
                failureCount++;
            }

            // Petit délai pour éviter le rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        const totalProcessed = successCount + failureCount;

        log(`Finished:
- Processed: ${totalProcessed}
- Kicked: ${successCount}
- Failed: ${failureCount}`);

        // Notification finale
        if (settings.store.showNotifications) {
            const title = failureCount > 0 ? "GroupKicker finished with errors" : "GroupKicker finished";
            const body = failureCount > 0
                ? `${successCount} members kicked, ${failureCount} failed.`
                : `${successCount} members kicked.`;

            showNotification({
                title,
                body,
                icon: undefined
            });
        }

    } catch (error) {
        log(`Kick failed: ${error}`, "error");

        if (settings.store.showNotifications) {
            showNotification({
                title: "GroupKicker",
                body: "Something went wrong while kicking members.",
                icon: undefined
            });
        }
    }
}

// Patch du menu contextuel des groupes
const GroupContextMenuPatch: NavContextMenuPatchCallback = (children, { channel }: { channel: Channel; }) => {
    if (!channel || channel.type !== 3) return; // 3 = GROUP_DM

    const currentUserId = UserStore.getCurrentUser()?.id;
    const isOwner = channel.ownerId === currentUserId;
    const memberCount = (channel.recipients?.length || 0);

    // Ne pas afficher l'option si l'utilisateur n'est pas propriétaire ou s'il n'y a pas de membres
    if (!isOwner || memberCount === 0) return;

    const group = findGroupChildrenByChildId("leave-channel", children);

    if (group) {
        group.push(
            <Menu.MenuSeparator />,
            <Menu.MenuItem
                id="vc-kick-all-members"
                label={`Kick all members (${memberCount})`}
                color="danger"
                action={() => kickAllMembers(channel.id)}
                icon={() => (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2ZM21 9V7L15 7V9C15 9.55 14.55 10 14 10S13 9.55 13 9V7H11V9C11 9.55 10.45 10 10 10S9 9.55 9 9V7L3 7V9H5V19C5 20.1 5.9 21 7 21H17C18.1 21 19 20.1 19 19V9H21Z" />
                    </svg>
                )}
            />
        );
    }
};

export default definePlugin({
    name: "GroupKicker",
    description: "Lets a group owner kick every member in one click.",
    authors: [FlocordDevs.Flocord],
    dependencies: ["ContextMenuAPI"],
    settings,

    contextMenus: {
        "gdm-context": GroupContextMenuPatch
    },

    start() {
        log("Plugin started");
        debugLog(`Debug mode: ${settings.store.debugMode ? "on" : "off"}`);
        debugLog(`Notifications: ${settings.store.showNotifications ? "on" : "off"}`);
        debugLog(`Confirmation: ${settings.store.confirmBeforeKick ? "on" : "off"}`);

        if (settings.store.showNotifications) {
            showNotification({
                title: "GroupKicker enabled",
                body: "Right-click a group to kick every member.",
                icon: undefined
            });
        }
    },

    stop() {
        log("Plugin stopped");

        if (settings.store.showNotifications) {
            showNotification({
                title: "GroupKicker disabled",
                body: "Plugin stopped.",
                icon: undefined
            });
        }
    }
});
