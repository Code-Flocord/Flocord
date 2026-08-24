/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { showNotification } from "@api/Notifications";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, Constants, Menu, RestAPI, UserStore } from "@webpack/common";
import { Channel } from "discord-types/general";

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Activer le plugin GroupKicker",
        default: true
    },
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Afficher les notifications lors des actions",
        default: true
    },
    confirmBeforeKick: {
        type: OptionType.BOOLEAN,
        description: "Demander confirmation avant de kicker tous les membres",
        default: true
    },
    debugMode: {
        type: OptionType.BOOLEAN,
        description: "Mode dÃ©bogage (logs dÃ©taillÃ©s)",
        default: false
    }
});

// Fonction de log avec prÃ©fixe
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

// Log de dÃ©bogage
function debugLog(message: string) {
    if (settings.store.debugMode) {
        log(`ðŸ” ${message}`, "info");
    }
}

// Fonction pour confirmer l'action
function confirmKickAll(memberCount: number): boolean {
    if (!settings.store.confirmBeforeKick) return true;

    return confirm(
        `âš ï¸ ÃŠtes-vous sÃ»r de vouloir kicker tous les ${memberCount} membres de ce groupe ?\n\n` +
        "Cette action ne peut pas Ãªtre annulÃ©e.\n" +
        "Tous les membres seront retirÃ©s du groupe instantanÃ©ment."
    );
}

// Fonction pour kicker un utilisateur spÃ©cifique d'un groupe
async function kickUserFromGroup(channelId: string, userId: string): Promise<boolean> {
    try {
        debugLog(`Tentative de kick de l'utilisateur ${userId} du groupe ${channelId}`);

        await RestAPI.del({
            url: `/channels/${channelId}/recipients/${userId}`
        });

        debugLog(`âœ… Utilisateur ${userId} kickÃ© avec succÃ¨s`);
        return true;
    } catch (error) {
        log(`âŒ Erreur lors du kick de l'utilisateur ${userId}: ${error}`, "error");
        return false;
    }
}

// Fonction principale pour kicker tous les membres d'un groupe
async function kickAllMembers(channelId: string) {
    if (!settings.store.enabled) {
        log("Plugin dÃ©sactivÃ©", "warn");
        return;
    }

    try {
        const channel = ChannelStore.getChannel(channelId);
        const currentUserId = UserStore.getCurrentUser()?.id;

        if (!channel) {
            log("Canal introuvable", "error");
            return;
        }

        if (channel.type !== 3) { // 3 = GROUP_DM
            log("Ce n'est pas un groupe DM", "error");
            return;
        }

        if (!currentUserId) {
            log("Impossible d'obtenir l'ID de l'utilisateur actuel", "error");
            return;
        }

        const recipients = channel.recipients || [];
        const channelName = channel.name || "Groupe sans nom";

        debugLog(`ðŸ“Š Informations du groupe:
- Nom: ${channelName}
- ID: ${channelId}
- PropriÃ©taire: ${channel.ownerId}
- Nombre de destinataires: ${recipients.length}
- Utilisateur actuel: ${currentUserId}`);

        // VÃ©rifier si l'utilisateur est le propriÃ©taire du groupe
        if (channel.ownerId !== currentUserId) {
            log("âŒ Seul le propriÃ©taire du groupe peut utiliser cette fonction", "error");

            if (settings.store.showNotifications) {
                showNotification({
                    title: "âŒ GroupKicker",
                    body: "Seul le propriÃ©taire du groupe peut kicker tous les membres",
                    icon: undefined
                });
            }
            return;
        }

        if (recipients.length === 0) {
            log("Aucun membre Ã  kicker", "warn");

            if (settings.store.showNotifications) {
                showNotification({
                    title: "â„¹ï¸ GroupKicker",
                    body: "Aucun membre Ã  kicker dans ce groupe",
                    icon: undefined
                });
            }
            return;
        }

        // Demander confirmation
        if (!confirmKickAll(recipients.length)) {
            log("Action annulÃ©e par l'utilisateur");
            return;
        }

        log(`ðŸš€ DÃ©but du kick de ${recipients.length} membre(s) du groupe "${channelName}"`);

        let successCount = 0;
        let failureCount = 0;

        // Notification de dÃ©but
        if (settings.store.showNotifications) {
            showNotification({
                title: "ðŸ”„ GroupKicker en cours",
                body: `Kick de ${recipients.length} membre(s) en cours...`,
                icon: undefined
            });
        }

        // Kicker chaque membre (sauf l'utilisateur actuel)
        for (const recipientId of recipients) {
            if (recipientId === currentUserId) {
                debugLog(`â­ï¸ Saut de l'utilisateur actuel: ${recipientId}`);
                continue;
            }

            const success = await kickUserFromGroup(channelId, recipientId);
            if (success) {
                successCount++;
            } else {
                failureCount++;
            }

            // Petit dÃ©lai pour Ã©viter le rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        const totalProcessed = successCount + failureCount;

        log(`âœ… OpÃ©ration terminÃ©e:
- Membres traitÃ©s: ${totalProcessed}
- SuccÃ¨s: ${successCount}
- Ã‰checs: ${failureCount}`);

        // Notification finale
        if (settings.store.showNotifications) {
            const title = failureCount > 0 ? "âš ï¸ GroupKicker terminÃ© avec erreurs" : "âœ… GroupKicker terminÃ©";
            const body = failureCount > 0
                ? `${successCount} membres kickÃ©s, ${failureCount} Ã©checs`
                : `${successCount} membres kickÃ©s avec succÃ¨s`;

            showNotification({
                title,
                body,
                icon: undefined
            });
        }

    } catch (error) {
        log(`âŒ Erreur globale lors du kick: ${error}`, "error");

        if (settings.store.showNotifications) {
            showNotification({
                title: "âŒ GroupKicker - Erreur",
                body: "Une erreur est survenue lors du kick",
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

    // Ne pas afficher l'option si l'utilisateur n'est pas propriÃ©taire ou s'il n'y a pas de membres
    if (!isOwner || memberCount === 0) return;

    const group = findGroupChildrenByChildId("leave-channel", children);

    if (group) {
        group.push(
            <Menu.MenuSeparator />,
            <Menu.MenuItem
                id="vc-kick-all-members"
                label={`ðŸ¦¶ Kicker tous les membres (${memberCount})`}
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
    description: "Permet au propriÃ©taire d'un groupe de kicker tous les membres d'un clic",
    authors: [{ name: "Flocord", id: 0n }],
    dependencies: ["ContextMenuAPI"],
    settings,

    contextMenus: {
        "gdm-context": GroupContextMenuPatch
    },

    start() {
        log("ðŸš€ Plugin GroupKicker dÃ©marrÃ©");
        debugLog(`Mode dÃ©bogage: ${settings.store.debugMode ? "ACTIVÃ‰" : "DÃ‰SACTIVÃ‰"}`);
        debugLog(`Notifications: ${settings.store.showNotifications ? "ACTIVÃ‰ES" : "DÃ‰SACTIVÃ‰ES"}`);
        debugLog(`Confirmation: ${settings.store.confirmBeforeKick ? "ACTIVÃ‰E" : "DÃ‰SACTIVÃ‰E"}`);

        if (settings.store.showNotifications) {
            showNotification({
                title: "ðŸ¦¶ GroupKicker activÃ©",
                body: "Clic droit sur un groupe pour kicker tous les membres",
                icon: undefined
            });
        }
    },

    stop() {
        log("ðŸ›‘ Plugin GroupKicker arrÃªtÃ©");

        if (settings.store.showNotifications) {
            showNotification({
                title: "ðŸ¦¶ GroupKicker dÃ©sactivÃ©",
                body: "Plugin arrÃªtÃ©",
                icon: undefined
            });
        }
    }
});
