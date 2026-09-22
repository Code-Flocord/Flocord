/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { FlocordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, UserStore } from "@webpack/common";

const MessageActions = findByPropsLazy("deleteMessage", "startEditMessage", "_sendMessage");

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable AntiLog deletion on double-click.",
        default: true
    },
    emptyMessage: {
        type: OptionType.BOOLEAN,
        description: "Send an empty (invisible) message in place of the deleted one.",
        default: true
    },
    blockMessage: {
        type: OptionType.STRING,
        description: "Text to send instead when the empty message is disabled.",
        default: "x"
    },
    deleteInterval: {
        type: OptionType.NUMBER,
        description: "Delay between deleting the old and the new message, in ms (AntiLog).",
        default: 200,
        min: 100,
        max: 5000
    },
    requireModifier: {
        type: OptionType.BOOLEAN,
        description: "Require Shift or Ctrl while double-clicking.",
        default: false
    },
    showNotification: {
        type: OptionType.BOOLEAN,
        description: "Log a message in the console when deleting.",
        default: false
    }
});

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendReplacementMessage(channelId: string, content: string, nonce: string): Promise<string | null> {
    if (!MessageActions?._sendMessage) {
        console.error("[DoubleClickAntiLog] MessageActions._sendMessage is not available");
        return null;
    }

    return new Promise(resolve => {
        // Écouter MESSAGE_CREATE pour récupérer l'ID du message de remplacement
        const messageCreateListener = (event: any) => {
            const message = event?.message;
            if (message && message.channel_id === channelId && message.nonce === nonce) {
                FluxDispatcher.unsubscribe("MESSAGE_CREATE", messageCreateListener);
                resolve(message.id);
            }
        };

        FluxDispatcher.subscribe("MESSAGE_CREATE", messageCreateListener);

        // Timeout après 5 secondes pour éviter d'attendre indéfiniment
        setTimeout(() => {
            FluxDispatcher.unsubscribe("MESSAGE_CREATE", messageCreateListener);
            resolve(null);
        }, 5000);

        try {
            // Utiliser _sendMessage avec le nonce pour remplacer le message dans cacheSentMessages
            MessageActions._sendMessage(channelId, {
                content: content,
                tts: false,
                invalidEmojis: [],
                validNonShortcutEmojis: []
            }, { nonce: nonce });
        } catch (error) {
            FluxDispatcher.unsubscribe("MESSAGE_CREATE", messageCreateListener);
            console.error("[DoubleClickAntiLog] Failed to send the replacement message:", error);
            resolve(null);
        }
    });
}

function messageDeleteWrapper(channelId: string, messageId: string) {
    if (!MessageActions?.deleteMessage) {
        console.error("[DoubleClickAntiLog] MessageActions.deleteMessage is not available");
        return;
    }
    try {
        MessageActions.deleteMessage(channelId, messageId);
    } catch (error) {
        console.error("[DoubleClickAntiLog] Deletion failed:", error);
    }
}

async function performAntiLogDeletion(messageId: string, channelId: string, blockMessage: string, deleteInterval: number) {
    try {
        // Vérifier que MessageActions est disponible
        if (!MessageActions?.deleteMessage || !MessageActions?._sendMessage) {
            console.error("[DoubleClickAntiLog] MessageActions is not available");
            return false;
        }

        // ÉTAPE 1: Dispatcher MESSAGE_DELETE avec mlDeleted: true pour que MessageLogger et MessageLoggerEnhanced ignorent le message
        FluxDispatcher.dispatch({
            type: "MESSAGE_DELETE",
            channelId: channelId,
            id: messageId,
            mlDeleted: true
        });

        // Petit délai pour que l'événement soit traité
        await sleep(100);

        // ÉTAPE 2: Envoyer un message de remplacement avec le même nonce que le message original
        // Cela remplace le message dans le cache de MessageLoggerEnhanced (cacheSentMessages) grâce au glitch du nonce
        const replacementMessageId = await sendReplacementMessage(channelId, blockMessage, messageId);

        // Délai entre l'envoi et la suppression (réduit à 1 seconde minimum)
        const deleteDelay = Math.max(deleteInterval, 1000); // Minimum 1 seconde
        await sleep(deleteDelay);

        // ÉTAPE 3: Supprimer le message original
        messageDeleteWrapper(channelId, messageId);

        // ÉTAPE 4: Supprimer le message de remplacement après un délai
        if (replacementMessageId) {
            await sleep(deleteDelay);
            messageDeleteWrapper(channelId, replacementMessageId);
        }

        return true;
    } catch (error) {
        console.error("[DoubleClickAntiLog] AntiLog deletion failed:", error);
        return false;
    }
}

export default definePlugin({
    name: "DoubleClickAntiLog",
    description: "Double-click your own messages to delete them with AntiLog, which hides them from MessageLogger.",
    authors: [FlocordDevs.Flocord],
    dependencies: ["MessageEventsAPI"],
    settings,

    onMessageClick(msg: any, channel: any, event: MouseEvent) {
        try {
            // Vérifier si le plugin est activé
            if (!settings.store.enabled) return;

            // Vérifier si c'est un double-clic
            if (!event || event.detail !== 2) return;

            // Vérifier si un modificateur est requis
            if (settings.store.requireModifier && !event.ctrlKey && !event.shiftKey) return;

            // Vérifier que le message et le canal sont valides
            if (!msg || !channel || !msg.id || !channel.id) return;

            // Vérifier si c'est notre message
            const currentUser = UserStore.getCurrentUser();
            if (!currentUser || !msg.author || msg.author.id !== currentUser.id) return;

            // Vérifier que le message n'est pas déjà supprimé
            if (msg.deleted === true) return;

            // Vérifier que le message est envoyé
            if (msg.state !== "SENT") return;

            // Empêcher le comportement par défaut
            event.preventDefault();
            event.stopPropagation();

            // Afficher une notification si activée
            if (settings.store.showNotification) {
                console.log(`[DoubleClickAntiLog] AntiLog deletion of message ${msg.id}`);
            }

            // Effectuer la suppression AntiLog de manière asynchrone
            performAntiLogDeletion(
                msg.id,
                channel.id,
                settings.store.emptyMessage ? "\u17B5" : settings.store.blockMessage,
                settings.store.deleteInterval
            ).catch(error => {
                console.error("[DoubleClickAntiLog] Deletion failed:", error);
            });
        } catch (error) {
            console.error("[DoubleClickAntiLog] Error in onMessageClick:", error);
        }
    }
});
