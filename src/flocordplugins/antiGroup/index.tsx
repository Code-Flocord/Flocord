/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { showNotification } from "@api/Notifications";
import definePlugin, { OptionType } from "@utils/types";
import { Constants, ChannelStore, RestAPI, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Activer le plugin AntiGroup",
        default: true
    },
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Afficher les notifications lors de la sortie automatique",
        default: true
    },
    verboseLogs: {
        type: OptionType.BOOLEAN,
        description: "Afficher des logs dÃ©taillÃ©s dans la console",
        default: true
    },
    delay: {
        type: OptionType.NUMBER,
        description: "DÃ©lai avant de quitter le groupe (en millisecondes)",
        default: 1000,
        min: 100,
        max: 10000
    },
    whitelist: {
        type: OptionType.STRING,
        description: "IDs des utilisateurs autorisÃ©s Ã  vous ajouter (sÃ©parÃ©s par des virgules)",
        default: ""
    },
    autoReply: {
        type: OptionType.BOOLEAN,
        description: "Envoyer un message automatique avant de quitter",
        default: true
    },
    replyMessage: {
        type: OptionType.STRING,
        description: "Message Ã  envoyer avant de quitter",
        default: "Je ne souhaite pas Ãªtre ajoutÃ© Ã  des groupes. Merci de me contacter en privÃ©."
    }
});

// Fonction de log avec prÃ©fixe
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

// Fonction de log verbose (seulement si activÃ©)
function verboseLog(message: string) {
    if (settings.store.verboseLogs) {
        log(message);
    }
}

// Fonction pour quitter un groupe DM
async function leaveGroupDM(channelId: string) {
    try {
        const channel = ChannelStore.getChannel(channelId);
        const channelName = channel?.name || "Groupe sans nom";
        const recipients = channel?.recipients || [];

        log(`ðŸš€ DÃ©but de la procÃ©dure de sortie du groupe "${channelName}" (ID: ${channelId})`);
        verboseLog(`ðŸ“Š Informations du groupe:
- Nom: ${channelName}
- ID: ${channelId}
- Type: ${channel?.type}
- Owner: ${channel?.ownerId}
- Nombre de membres: ${recipients.length + 1}`);

        // Envoyer un message automatique si activÃ©
        if (settings.store.autoReply && settings.store.replyMessage.trim()) {
            log(`ðŸ’¬ Envoi du message automatique: "${settings.store.replyMessage}"`);

            try {
                await RestAPI.post({
                    url: Constants.Endpoints.MESSAGES(channelId),
                    body: {
                        content: settings.store.replyMessage
                    }
                });

                log(`âœ… Message automatique envoyÃ© avec succÃ¨s`);
                verboseLog(`â±ï¸ Attente de 500ms pour que le message soit dÃ©livrÃ©...`);

                // Attendre un peu avant de quitter pour que le message soit envoyÃ©
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (msgError) {
                log(`âŒ Erreur lors de l'envoi du message automatique: ${msgError}`, "error");
            }
        } else {
            verboseLog(`ðŸ”‡ Message automatique dÃ©sactivÃ© ou vide`);
        }

        // Quitter le groupe
        log(`ðŸšª Tentative de sortie du groupe...`);
        await RestAPI.del({
            url: Constants.Endpoints.CHANNEL(channelId)
        });

        log(`âœ… Groupe quittÃ© avec succÃ¨s: "${channelName}"`);

        // Notification de succÃ¨s
        if (settings.store.showNotifications) {
            showNotification({
                title: "ðŸ›¡ï¸ AntiGroup - Groupe quittÃ©",
                body: `Vous avez automatiquement quittÃ© le groupe "${channelName}"`,
                icon: undefined
            });
            verboseLog(`ðŸ”” Notification de succÃ¨s affichÃ©e`);
        }

        // Log final avec statistiques
        log(`ðŸ“ˆ Statistiques de la sortie:
- Groupe: "${channelName}" (${channelId})
- Message auto envoyÃ©: ${settings.store.autoReply ? "Oui" : "Non"}
- DÃ©lai appliquÃ©: ${settings.store.delay}ms
- Notification affichÃ©e: ${settings.store.showNotifications ? "Oui" : "Non"}`);

    } catch (error) {
        const channel = ChannelStore.getChannel(channelId);
        const channelName = channel?.name || "Groupe inconnu";

        log(`âŒ ERREUR lors de la sortie du groupe "${channelName}" (${channelId}): ${error}`, "error");

        // Log dÃ©taillÃ© de l'erreur
        if (settings.store.verboseLogs) {
            console.error("[AntiGroup] DÃ©tails de l'erreur:", {
                channelId,
                channelName,
                error,
                stack: error instanceof Error ? error.stack : undefined
            });
        }

        // Notification d'erreur
        if (settings.store.showNotifications) {
            showNotification({
                title: "âŒ AntiGroup - Erreur",
                body: `Impossible de quitter automatiquement le groupe "${channelName}"`,
                icon: undefined
            });
            verboseLog(`ðŸ”” Notification d'erreur affichÃ©e`);
        }
    }
}

// Fonction pour vÃ©rifier si un utilisateur est dans la whitelist
function isUserWhitelisted(userId: string): boolean {
    const whitelist = settings.store.whitelist
        .split(",")
        .map(id => id.trim())
        .filter(id => id.length > 0);

    const isWhitelisted = whitelist.includes(userId);
    verboseLog(`ðŸ” VÃ©rification whitelist pour utilisateur ${userId}: ${isWhitelisted ? "AUTORISÃ‰" : "NON AUTORISÃ‰"}`);

    return isWhitelisted;
}

// Fonction pour vÃ©rifier si l'utilisateur actuel a Ã©tÃ© ajoutÃ© rÃ©cemment au groupe
function wasRecentlyAdded(channel: any, currentUserId: string): boolean {
    // VÃ©rifier si c'est un groupe DM (type 3)
    if (channel.type !== 3) {
        verboseLog(`âŒ Canal ${channel.id} n'est pas un groupe DM (type: ${channel.type})`);
        return false;
    }

    // Si le canal vient d'Ãªtre crÃ©Ã© et que l'utilisateur n'en est pas l'owner
    const wasAdded = channel.ownerId !== currentUserId;
    verboseLog(`ðŸ” VÃ©rification ajout rÃ©cent: ${wasAdded ? "AJOUTÃ‰ PAR QUELQU'UN D'AUTRE" : "CRÃ‰Ã‰ PAR VOUS"} (Owner: ${channel.ownerId})`);

    return wasAdded;
}

export default definePlugin({
    name: "AntiGroup",
    description: "Quitte automatiquement les groupes DM dÃ¨s qu'on y est ajoutÃ©",
    authors: [{ name: "Flocord", id: 0n }],
    settings,

    flux: {
        // Ã‰vÃ©nement dÃ©clenchÃ© quand un nouveau canal est crÃ©Ã© (incluant les groupes DM)
        CHANNEL_CREATE(event: { channel: any; }) {
            verboseLog(`ðŸ“º Ã‰vÃ©nement CHANNEL_CREATE dÃ©tectÃ© pour canal ${event.channel?.id}`);

            if (!settings.store.enabled) {
                verboseLog(`ðŸ”’ Plugin dÃ©sactivÃ©, ignorÃ©`);
                return;
            }

            const { channel } = event;
            const currentUserId = UserStore.getCurrentUser()?.id;

            if (!channel || !currentUserId) {
                verboseLog(`âŒ DonnÃ©es manquantes: channel=${!!channel}, currentUserId=${!!currentUserId}`);
                return;
            }

            verboseLog(`ðŸ“‹ Analyse du canal:
- ID: ${channel.id}
- Type: ${channel.type}
- Nom: ${channel.name || "Sans nom"}
- Owner: ${channel.ownerId}
- Utilisateur actuel: ${currentUserId}`);

            // VÃ©rifier si c'est un groupe DM (type 3)
            if (channel.type !== 3) {
                verboseLog(`â­ï¸ IgnorÃ©: pas un groupe DM (type ${channel.type})`);
                return;
            }

            // VÃ©rifier si l'utilisateur a Ã©tÃ© rÃ©cemment ajoutÃ©
            if (!wasRecentlyAdded(channel, currentUserId)) {
                verboseLog(`â­ï¸ IgnorÃ©: vous Ãªtes le crÃ©ateur du groupe`);
                return;
            }

            log(`ðŸŽ¯ NOUVEAU GROUPE DM DÃ‰TECTÃ‰: "${channel.name || 'Sans nom'}" (${channel.id})`);

            // VÃ©rifier si l'owner du groupe est dans la whitelist
            if (channel.ownerId && isUserWhitelisted(channel.ownerId)) {
                log(`âœ… Owner ${channel.ownerId} est dans la whitelist, groupe autorisÃ©`);
                return;
            }

            // VÃ©rifier si d'autres membres du groupe sont dans la whitelist
            const whitelistedMember = channel.recipients?.find((recipient: any) =>
                isUserWhitelisted(recipient.id)
            );

            if (whitelistedMember) {
                log(`âœ… Membre ${whitelistedMember.id} est dans la whitelist, groupe autorisÃ©`);
                return;
            }

            log(`âš ï¸ AUCUN MEMBRE AUTORISÃ‰ TROUVÃ‰ - Programmation de la sortie automatique dans ${settings.store.delay}ms`);

            // Notification immÃ©diate de dÃ©tection
            if (settings.store.showNotifications) {
                showNotification({
                    title: "ðŸš¨ AntiGroup - Groupe dÃ©tectÃ©",
                    body: `AjoutÃ© au groupe "${channel.name || 'Sans nom'}" - Sortie automatique dans ${settings.store.delay / 1000}s`,
                    icon: undefined
                });
            }

            // Attendre le dÃ©lai configurÃ© avant de quitter
            setTimeout(() => {
                verboseLog(`â° DÃ©lai Ã©coulÃ©, exÃ©cution de la sortie automatique`);
                leaveGroupDM(channel.id);
            }, settings.store.delay);
        }
    },

    start() {
        log(`ðŸš€ Plugin AntiGroup dÃ©marrÃ©`);
        log(`âš™ï¸ Configuration actuelle:
- Notifications: ${settings.store.showNotifications ? "ON" : "OFF"}
- Logs verbeux: ${settings.store.verboseLogs ? "ON" : "OFF"}
- Message auto: ${settings.store.autoReply ? "ON" : "OFF"}
- DÃ©lai: ${settings.store.delay}ms
- Whitelist: ${settings.store.whitelist || "Vide"}`);

        if (settings.store.showNotifications) {
            showNotification({
                title: "ðŸ›¡ï¸ AntiGroup activÃ©",
                body: "Protection contre les groupes DM non dÃ©sirÃ©s activÃ©e",
                icon: undefined
            });
        }
    },

    stop() {
        log(`ðŸ›‘ Plugin AntiGroup arrÃªtÃ©`);

        if (settings.store.showNotifications) {
            showNotification({
                title: "ðŸ›¡ï¸ AntiGroup dÃ©sactivÃ©",
                body: "Protection contre les groupes DM dÃ©sactivÃ©e",
                icon: undefined
            });
        }
    }
});
