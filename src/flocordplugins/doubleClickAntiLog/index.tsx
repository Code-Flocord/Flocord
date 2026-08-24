/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, UserStore } from "@webpack/common";

const MessageActions = findByPropsLazy("deleteMessage", "startEditMessage", "_sendMessage");

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Activer la suppression AntiLog par double-clic",
        default: true
    },
    emptyMessage: {
        type: OptionType.BOOLEAN,
        description: "Envoyer un message vide (invisible) Ã  la place du message supprimÃ©",
        default: true
    },
    blockMessage: {
        type: OptionType.STRING,
        description: "Texte Ã  envoyer Ã  la place si le message vide est dÃ©sactivÃ©",
        default: "x"
    },
    deleteInterval: {
        type: OptionType.NUMBER,
        description: "DÃ©lai entre la suppression de l'ancien et du nouveau message (ms) - pour AntiLog",
        default: 200,
        min: 100,
        max: 5000
    },
    requireModifier: {
        type: OptionType.BOOLEAN,
        description: "NÃ©cessiter Shift ou Ctrl lors du double-clic",
        default: false
    },
    showNotification: {
        type: OptionType.BOOLEAN,
        description: "Afficher une notification lors de la suppression",
        default: false
    }
});

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendReplacementMessage(channelId: string, content: string, nonce: string): Promise<string | null> {
    if (!MessageActions?._sendMessage) {
        console.error("[DoubleClickAntiLog] MessageActions._sendMessage n'est pas disponible");
        return null;
    }

    return new Promise(resolve => {
        // Ã‰couter MESSAGE_CREATE pour rÃ©cupÃ©rer l'ID du message de remplacement
        const messageCreateListener = (event: any) => {
            const message = event?.message;
            if (message && message.channel_id === channelId && message.nonce === nonce) {
                FluxDispatcher.unsubscribe("MESSAGE_CREATE", messageCreateListener);
                resolve(message.id);
            }
        };

        FluxDispatcher.subscribe("MESSAGE_CREATE", messageCreateListener);

        // Timeout aprÃ¨s 5 secondes pour Ã©viter d'attendre indÃ©finiment
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
            console.error("[DoubleClickAntiLog] Erreur lors de l'envoi du message de remplacement:", error);
            resolve(null);
        }
    });
}

function messageDeleteWrapper(channelId: string, messageId: string) {
    if (!MessageActions?.deleteMessage) {
        console.error("[DoubleClickAntiLog] MessageActions.deleteMessage n'est pas disponible");
        return;
    }
    try {
        MessageActions.deleteMessage(channelId, messageId);
    } catch (error) {
        console.error("[DoubleClickAntiLog] Erreur lors de la suppression:", error);
    }
}

async function performAntiLogDeletion(messageId: string, channelId: string, blockMessage: string, deleteInterval: number) {
    try {
        // VÃ©rifier que MessageActions est disponible
        if (!MessageActions?.deleteMessage || !MessageActions?._sendMessage) {
            console.error("[DoubleClickAntiLog] MessageActions n'est pas disponible");
            return false;
        }

        // Ã‰TAPE 1: Dispatcher MESSAGE_DELETE avec mlDeleted: true pour que MessageLogger et MessageLoggerEnhanced ignorent le message
        FluxDispatcher.dispatch({
            type: "MESSAGE_DELETE",
            channelId: channelId,
            id: messageId,
            mlDeleted: true
        });

        // Petit dÃ©lai pour que l'Ã©vÃ©nement soit traitÃ©
        await sleep(100);

        // Ã‰TAPE 2: Envoyer un message de remplacement avec le mÃªme nonce que le message original
        // Cela remplace le message dans le cache de MessageLoggerEnhanced (cacheSentMessages) grÃ¢ce au glitch du nonce
        const replacementMessageId = await sendReplacementMessage(channelId, blockMessage, messageId);

        // DÃ©lai entre l'envoi et la suppression (rÃ©duit Ã  1 seconde minimum)
        const deleteDelay = Math.max(deleteInterval, 1000); // Minimum 1 seconde
        await sleep(deleteDelay);

        // Ã‰TAPE 3: Supprimer le message original
        messageDeleteWrapper(channelId, messageId);

        // Ã‰TAPE 4: Supprimer le message de remplacement aprÃ¨s un dÃ©lai
        if (replacementMessageId) {
            await sleep(deleteDelay);
            messageDeleteWrapper(channelId, replacementMessageId);
        }

        return true;
    } catch (error) {
        console.error("[DoubleClickAntiLog] Erreur lors de la suppression AntiLog:", error);
        return false;
    }
}

export default definePlugin({
    name: "DoubleClickAntiLog",
    description: "Double-cliquez sur vos messages pour les supprimer avec AntiLog (masque MessageLogger)",
    authors: [{ name: "Flocord", id: 0n }],
    dependencies: ["MessageEventsAPI"],
    settings,

    onMessageClick(msg: any, channel: any, event: MouseEvent) {
        try {
            // VÃ©rifier si le plugin est activÃ©
            if (!settings.store.enabled) return;

            // VÃ©rifier si c'est un double-clic
            if (!event || event.detail !== 2) return;

            // VÃ©rifier si un modificateur est requis
            if (settings.store.requireModifier && !event.ctrlKey && !event.shiftKey) return;

            // VÃ©rifier que le message et le canal sont valides
            if (!msg || !channel || !msg.id || !channel.id) return;

            // VÃ©rifier si c'est notre message
            const currentUser = UserStore.getCurrentUser();
            if (!currentUser || !msg.author || msg.author.id !== currentUser.id) return;

            // VÃ©rifier que le message n'est pas dÃ©jÃ  supprimÃ©
            if (msg.deleted === true) return;

            // VÃ©rifier que le message est envoyÃ©
            if (msg.state !== "SENT") return;

            // EmpÃªcher le comportement par dÃ©faut
            event.preventDefault();
            event.stopPropagation();

            // Afficher une notification si activÃ©e
            if (settings.store.showNotification) {
                console.log(`[DoubleClickAntiLog] Suppression AntiLog du message ${msg.id}`);
            }

            // Effectuer la suppression AntiLog de maniÃ¨re asynchrone
            performAntiLogDeletion(
                msg.id,
                channel.id,
                settings.store.emptyMessage ? "\u17B5" : settings.store.blockMessage,
                settings.store.deleteInterval
            ).catch(error => {
                console.error("[DoubleClickAntiLog] Erreur lors de la suppression:", error);
            });
        } catch (error) {
            console.error("[DoubleClickAntiLog] Erreur dans onMessageClick:", error);
        }
    }
});
