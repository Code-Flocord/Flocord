/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { FlocordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Constants, FluxDispatcher, MessageStore, RestAPI, UserStore } from "@webpack/common";

interface TrackedMessage {
    id: string;
    channelId: string;
    guildId?: string;
    timestamp: number;
    scheduledTime: number; // Timestamp absolu de suppression programmée
    timeoutId?: NodeJS.Timeout; // Optionnel car pas sauvegardé
    content?: string; // Contenu original pour debug
    length?: number; // Longueur du message
    hasEmbed?: boolean;
    hasAttachment?: boolean;
    hasReactions?: boolean;
    deletionMode?: string; // Mode de suppression spécifique
    priority?: number; // Priorité de suppression (1-10)
}

interface DeletionStats {
    messagesDeleted: number;
    messagesSaved: number;
    errors: number;
    restoredFromStorage: number;
    hourlyDeletions: number;
    lastHourReset: number;
    totalBytesSaved: number;
    averageMessageLength: number;
    deletionModes: Record<string, number>;
    channelStats: Record<string, number>;
}

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable automatic deletion of your messages.",
        default: false
    },
    defaultDelay: {
        type: OptionType.NUMBER,
        description: "Delay before deletion, in the unit selected below.",
        default: 300, // 5 minutes
        min: 5,
        max: 86400 // 24 hours
    },
    delayUnit: {
        type: OptionType.SELECT,
        description: "Time unit.",
        options: [
            { label: "Seconds", value: "seconds", default: true },
            { label: "Minutes", value: "minutes" },
            { label: "Hours", value: "hours" }
        ]
    },
    deletionMode: {
        type: OptionType.SELECT,
        description: "Deletion mode.",
        options: [
            { label: "Normal deletion", value: "normal", default: true },
            { label: "AntiLog (hides from MessageLogger)", value: "antilog" },
            { label: "Silent deletion", value: "silent" },
            { label: "Edit then delete", value: "edit_delete" }
        ]
    },
    channelMode: {
        type: OptionType.SELECT,
        description: "Channel filter mode.",
        options: [
            { label: "All channels", value: "all", default: true },
            { label: "Specific channels only", value: "whitelist" },
            { label: "Exclude specific channels", value: "blacklist" },
            { label: "Specific servers", value: "guilds" }
        ]
    },
    channelList: {
        type: OptionType.STRING,
        description: "Channel IDs, separated by commas.",
        default: ""
    },
    guildList: {
        type: OptionType.STRING,
        description: "Server IDs, separated by commas.",
        default: ""
    },
    preserveKeywords: {
        type: OptionType.STRING,
        description: "Keywords that prevent deletion, separated by commas.",
        default: ""
    },
    deleteKeywords: {
        type: OptionType.STRING,
        description: "Keywords that trigger immediate deletion, separated by commas.",
        default: ""
    },
    maxMessageLength: {
        type: OptionType.NUMBER,
        description: "Maximum length of messages to delete (0 = unlimited).",
        default: 0,
        min: 0,
        max: 2000
    },
    minMessageLength: {
        type: OptionType.NUMBER,
        description: "Minimum length of messages to delete.",
        default: 0,
        min: 0,
        max: 2000
    },
    preserveEmbeds: {
        type: OptionType.BOOLEAN,
        description: "Keep messages that contain embeds.",
        default: true
    },
    preserveAttachments: {
        type: OptionType.BOOLEAN,
        description: "Keep messages that contain attachments.",
        default: true
    },
    preserveReactions: {
        type: OptionType.BOOLEAN,
        description: "Keep messages that have reactions.",
        default: false
    },
    smartDelay: {
        type: OptionType.BOOLEAN,
        description: "Smart delay based on message length.",
        default: false
    },
    notifications: {
        type: OptionType.BOOLEAN,
        description: "Show deletion notifications.",
        default: false
    },
    notificationType: {
        type: OptionType.SELECT,
        description: "Notification type.",
        options: [
            { label: "Console only", value: "console", default: true },
            { label: "Toast notifications", value: "toast" },
            { label: "Both", value: "both" }
        ]
    },
    debug: {
        type: OptionType.BOOLEAN,
        description: "Debug mode (detailed logs).",
        default: false
    },
    useAntiLogDeletion: {
        type: OptionType.BOOLEAN,
        description: "Use AntiLog deletion (hides messages from MessageLogger plugins).",
        default: true
    },
    blockMessage: {
        type: OptionType.STRING,
        description: "Text shown in place of the deleted message (AntiLog).",
        default: "x"
    },
    deleteInterval: {
        type: OptionType.NUMBER,
        description: "Delay between deleting the old and the new message, in ms (AntiLog).",
        default: 200
    },
    rateLimitHandling: {
        type: OptionType.BOOLEAN,
        description: "Handle Discord rate limits automatically.",
        default: true
    },
    maxRetries: {
        type: OptionType.NUMBER,
        description: "Maximum number of deletion attempts.",
        default: 3,
        min: 1,
        max: 10
    },
    retryDelay: {
        type: OptionType.NUMBER,
        description: "Base delay between attempts (ms).",
        default: 1000,
        min: 100,
        max: 10000
    },
    adaptiveDelay: {
        type: OptionType.BOOLEAN,
        description: "Adjust delays automatically based on rate limits.",
        default: true
    },
    aggressiveThrottling: {
        type: OptionType.BOOLEAN,
        description: "Aggressive throttling to avoid rate limits.",
        default: true
    },
    maxDeletionsPerMinute: {
        type: OptionType.NUMBER,
        description: "Maximum number of deletions per minute.",
        default: 8,
        min: 1,
        max: 30
    },
    minDelayBetweenDeletions: {
        type: OptionType.NUMBER,
        description: "Minimum delay between deletions (ms).",
        default: 2000,
        min: 500,
        max: 10000
    },
    circuitBreakerThreshold: {
        type: OptionType.NUMBER,
        description: "Consecutive rate limits before the circuit breaker opens.",
        default: 5,
        min: 3,
        max: 20
    },
    circuitBreakerDuration: {
        type: OptionType.NUMBER,
        description: "Circuit breaker duration (minutes).",
        default: 5,
        min: 1,
        max: 30
    },
    editMessage: {
        type: OptionType.STRING,
        description: "Replacement text before deletion (edit mode).",
        default: "Message deleted automatically"
    },
    editDelay: {
        type: OptionType.NUMBER,
        description: "Delay between the edit and the deletion (ms).",
        default: 1000
    },
    batchDelete: {
        type: OptionType.BOOLEAN,
        description: "Delete in batches to improve performance.",
        default: false
    },
    batchSize: {
        type: OptionType.NUMBER,
        description: "Number of messages per batch.",
        default: 5,
        min: 1,
        max: 20
    },
    batchDelay: {
        type: OptionType.NUMBER,
        description: "Delay between batches (ms).",
        default: 200
    },
    emergencyStop: {
        type: OptionType.BOOLEAN,
        description: "Emergency stop: cancels every scheduled deletion.",
        default: false
    },
    maxMessagesPerHour: {
        type: OptionType.NUMBER,
        description: "Maximum number of messages to delete per hour (0 = unlimited).",
        default: 0,
        min: 0,
        max: 1000
    }
});

const STORAGE_KEY = "AutoDeleter_TrackedMessages";

// Fonctions utilitaires pour la suppression AntiLog
function messageSendWrapper(content: string, nonce: string, channelId: string) {
    const wrapperResponse = RestAPI.post({
        url: Constants.Endpoints.MESSAGES(channelId),
        body: {
            content: content,
            flags: 0,
            mobile_network_type: "unknown",
            nonce: nonce,
            tts: false,
        }
    });
    return wrapperResponse;
}

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseCsvList(raw: string): string[] {
    return raw
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);
}

function getAntiLogReplacementContent() {
    // Keep an invisible fallback to avoid Discord rejecting an empty content payload.
    const configured = settings.store.blockMessage?.trim();
    return configured && configured.length > 0 ? configured : "\u17B5";
}

async function messageDeleteWrapper(channelId: string, messageId: string) {
    await RestAPI.del({
        url: `/channels/${channelId}/messages/${messageId}`
    });
}

export default definePlugin({
    name: "AutoDeleter",
    description: "Automatically deletes your messages after a configurable delay. Scheduled deletions survive restarts.",
    authors: [FlocordDevs.Flocord],
    settings,

    // Map pour suivre les messages en attente de suppression
    trackedMessages: new Map<string, TrackedMessage>(),

    // Fonction liée pour l'événement MESSAGE_CREATE
    boundOnMessageCreate: null as any,

    // Statistiques avancées
    stats: {
        messagesDeleted: 0,
        messagesSaved: 0,
        errors: 0,
        restoredFromStorage: 0,
        hourlyDeletions: 0,
        lastHourReset: Date.now(),
        totalBytesSaved: 0,
        averageMessageLength: 0,
        deletionModes: {} as Record<string, number>,
        channelStats: {} as Record<string, number>
    } as DeletionStats,

    // Cache pour optimiser les performances
    messageCache: new Map<string, any>(),
    channelCache: new Map<string, any>(),

    // Queue de suppression par lots
    deletionQueue: [] as Array<{ messageId: string; channelId: string; mode: string; }>,
    batchProcessor: null as NodeJS.Timeout | null,

    // Gestion des rate limits avancée
    rateLimitInfo: {
        isRateLimited: false,
        retryAfter: 0,
        lastRateLimit: 0,
        consecutiveRateLimits: 0,
        backoffMultiplier: 1,
        globalCooldown: false,
        globalCooldownUntil: 0,
        circuitBreakerOpen: false,
        circuitBreakerUntil: 0,
        totalRateLimits: 0,
        lastSuccessfulDeletion: 0
    },

    // Cache des tentatives de suppression
    retryQueue: [] as Array<{ messageId: string; channelId: string; mode: string; attempts: number; nextRetry: number; }>,
    retryProcessor: null as NodeJS.Timeout | null,

    // Horodatage de démarrage pour les stats d'uptime
    startTime: 0,

    // Throttling intelligent
    throttlingInfo: {
        lastDeletionTime: 0,
        deletionCount: 0,
        windowStart: 0,
        maxDeletionsPerMinute: 10,
        minDelayBetweenDeletions: 2000 // 2 secondes minimum
    },

    async start() {
        this.log("Plugin started");
        this.startTime = Date.now();

        // Lier le contexte pour onMessageCreate
        this.boundOnMessageCreate = this.onMessageCreate.bind(this);

        // Écouter les nouveaux messages
        FluxDispatcher.subscribe("MESSAGE_CREATE", this.boundOnMessageCreate);

        // Restaurer les messages depuis le stockage
        await this.restoreTrackedMessages();

        this.log(`Restore finished: ${this.stats.restoredFromStorage} messages restored`);
    },

    stop() {
        this.log("Plugin stopped");

        // Arrêter d'écouter les messages
        if (this.boundOnMessageCreate) {
            FluxDispatcher.unsubscribe("MESSAGE_CREATE", this.boundOnMessageCreate);
        }

        // Annuler tous les timeouts en cours
        this.trackedMessages.forEach(message => {
            if (message.timeoutId) {
                clearTimeout(message.timeoutId);
            }
        });

        // Arrêter les processeurs pour éviter les boucles résiduelles
        if (this.batchProcessor) {
            clearInterval(this.batchProcessor);
            this.batchProcessor = null;
        }

        if (this.retryProcessor) {
            clearInterval(this.retryProcessor);
            this.retryProcessor = null;
        }

        // Sauvegarder les messages restants
        this.saveTrackedMessages();
    },

    // Sauvegarder les messages programmés
    async saveTrackedMessages() {
        try {
            const messagesToSave = Array.from(this.trackedMessages.values()).map(msg => ({
                id: msg.id,
                channelId: msg.channelId,
                timestamp: msg.timestamp,
                scheduledTime: msg.scheduledTime
            }));

            await DataStore.set(STORAGE_KEY, messagesToSave);
            this.debug(`Saved ${messagesToSave.length} tracked messages`);
        } catch (error) {
            this.error("Failed to save tracked messages:", error);
        }
    },

    // Restaurer les messages depuis le stockage
    async restoreTrackedMessages() {
        try {
            const savedMessages = await DataStore.get<TrackedMessage[]>(STORAGE_KEY);

            if (!savedMessages || savedMessages.length === 0) {
                this.debug("No messages to restore");
                return;
            }

            const now = Date.now();
            let restoredCount = 0;

            for (const savedMsg of savedMessages) {
                const timeUntilDeletion = savedMsg.scheduledTime - now;

                // Si le message aurait dû être supprimé, le supprimer maintenant
                if (timeUntilDeletion <= 0) {
                    this.debug(`Message ${savedMsg.id} was due for deletion, deleting now`);
                    await this.deleteMessage(savedMsg.id, savedMsg.channelId);
                    continue;
                }

                // Vérifier si le message existe encore
                try {
                    const message = MessageStore.getMessage(savedMsg.channelId, savedMsg.id);
                    if (!message) {
                        this.debug(`Message ${savedMsg.id} no longer exists, skipping`);
                        continue;
                    }

                    // Reprogrammer la suppression
                    this.scheduleMessageDeletionFromRestore(savedMsg, timeUntilDeletion);
                    restoredCount++;
                } catch (error) {
                    this.debug(`Message ${savedMsg.id} not found, skipping`);
                }
            }

            this.stats.restoredFromStorage = restoredCount;
            this.debug(`Restore: ${restoredCount} messages rescheduled`);

        } catch (error) {
            this.error("Failed to restore tracked messages:", error);
        }
    },

    onMessageCreate(event: any) {
        try {
            if (!settings.store.enabled || settings.store.emergencyStop) return;

            const message = event?.message;
            if (!message) return;

            // Vérifier si c'est notre message
            const currentUser = UserStore.getCurrentUser();
            if (!message.author || !currentUser || message.author.id !== currentUser.id) {
                return;
            }

            // Vérifier le circuit breaker
            if (this.rateLimitInfo.circuitBreakerOpen) {
                const now = Date.now();
                if (now < this.rateLimitInfo.circuitBreakerUntil) {
                    this.debug("Circuit breaker open, skipping deletion");
                    return;
                } else {
                    // Reset du circuit breaker
                    this.rateLimitInfo.circuitBreakerOpen = false;
                    this.rateLimitInfo.circuitBreakerUntil = 0;
                    this.log("Circuit breaker closed, resuming deletions");
                }
            }

            // Vérifier le cooldown global
            if (this.rateLimitInfo.globalCooldown) {
                const now = Date.now();
                if (now < this.rateLimitInfo.globalCooldownUntil) {
                    this.debug("Global cooldown active, skipping deletion");
                    return;
                } else {
                    this.rateLimitInfo.globalCooldown = false;
                    this.rateLimitInfo.globalCooldownUntil = 0;
                }
            }

            // Vérifier la limite horaire
            if (!this.checkHourlyLimit()) {
                this.debug("Hourly deletion limit reached");
                return;
            }

            // Vérifier le throttling intelligent
            if (!this.checkThrottlingLimits()) {
                this.debug("Throttling limits reached");
                return;
            }

            // Vérifier les filtres de canal
            if (!this.shouldProcessChannel(message.channel_id)) {
                this.debug(`Channel ${message.channel_id} skipped by filters`);
                return;
            }

            // Vérifier les filtres de serveur
            if (!this.shouldProcessGuild(message.guild_id)) {
                this.debug(`Server ${message.guild_id} skipped by filters`);
                return;
            }

            // Vérifier les mots-clés à préserver
            if (this.shouldPreserveMessage(message)) {
                this.debug(`Message kept because of filters: ${message.content}`);
                this.stats.messagesSaved++;
                return;
            }

            // Vérifier les mots-clés de suppression immédiate
            if (this.shouldDeleteImmediately(message.content)) {
                this.debug(`Immediate deletion requested: ${message.content}`);
                this.scheduleMessageDeletion(message, 2000); // 2 secondes minimum
                return;
            }

            // Programmer la suppression avec délai intelligent
            const delay = this.calculateSmartDelay(message);
            this.scheduleMessageDeletion(message, delay);
        } catch (error) {
            this.error("Error in onMessageCreate:", error);
        }
    },

    shouldProcessChannel(channelId: string): boolean {
        const mode = settings.store.channelMode;
        const channelList = parseCsvList(settings.store.channelList);

        switch (mode) {
            case "all":
                return true;
            case "whitelist":
                return channelList.includes(channelId);
            case "blacklist":
                return !channelList.includes(channelId);
            case "guilds":
                // Pour le mode guilds, on vérifie dans shouldProcessGuild
                return true;
            default:
                return true;
        }
    },

    shouldProcessGuild(guildId: string): boolean {
        const mode = settings.store.channelMode;

        if (mode !== "guilds") return true;

        const guildList = parseCsvList(settings.store.guildList);

        return guildList.includes(guildId);
    },

    shouldPreserveMessage(message: any): boolean {
        const content = message.content || "";

        // Vérifier les mots-clés de préservation
        const keywords = parseCsvList(settings.store.preserveKeywords)
            .map(keyword => keyword.toLowerCase())
            .filter(keyword => keyword.length > 0);

        if (keywords.length > 0) {
            const lowerContent = content.toLowerCase();
            if (keywords.some(keyword => lowerContent.includes(keyword))) {
                return true;
            }
        }

        // Vérifier la longueur du message
        if (settings.store.maxMessageLength > 0 && content.length > settings.store.maxMessageLength) {
            return true;
        }

        if (settings.store.minMessageLength > 0 && content.length < settings.store.minMessageLength) {
            return true;
        }

        // Vérifier les embeds
        if (settings.store.preserveEmbeds && message.embeds && message.embeds.length > 0) {
            return true;
        }

        // Vérifier les fichiers joints
        if (settings.store.preserveAttachments && message.attachments && message.attachments.length > 0) {
            return true;
        }

        // Vérifier les réactions
        if (settings.store.preserveReactions && message.reactions && message.reactions.length > 0) {
            return true;
        }

        return false;
    },

    shouldDeleteImmediately(content: string): boolean {
        if (!content) return false;

        const keywords = parseCsvList(settings.store.deleteKeywords)
            .map(keyword => keyword.toLowerCase())
            .filter(keyword => keyword.length > 0);

        if (keywords.length === 0) return false;

        const lowerContent = content.toLowerCase();
        return keywords.some(keyword => lowerContent.includes(keyword));
    },

    calculateSmartDelay(message: any): number {
        if (!settings.store.smartDelay) {
            return this.getDelayInMs();
        }

        const baseDelay = this.getDelayInMs();
        const contentLength = (message.content || "").length;

        // Délai basé sur la longueur : plus le message est long, plus on attend
        const lengthMultiplier = Math.min(1 + (contentLength / 1000), 3); // Max 3x le délai de base

        // Délai basé sur les embeds/attachments
        const mediaMultiplier = (message.embeds?.length || 0) > 0 || (message.attachments?.length || 0) > 0 ? 1.5 : 1;

        return Math.floor(baseDelay * lengthMultiplier * mediaMultiplier);
    },

    checkHourlyLimit(): boolean {
        const now = Date.now();
        const hourInMs = 60 * 60 * 1000;

        // Reset du compteur horaire si nécessaire
        if (now - this.stats.lastHourReset > hourInMs) {
            this.stats.hourlyDeletions = 0;
            this.stats.lastHourReset = now;
        }

        const maxPerHour = settings.store.maxMessagesPerHour;
        if (maxPerHour > 0 && this.stats.hourlyDeletions >= maxPerHour) {
            return false;
        }

        return true;
    },

    checkThrottlingLimits(): boolean {
        if (!settings.store.aggressiveThrottling) return true;

        const now = Date.now();
        const minuteInMs = 60 * 1000;

        // Reset de la fenêtre de temps si nécessaire
        if (now - this.throttlingInfo.windowStart > minuteInMs) {
            this.throttlingInfo.deletionCount = 0;
            this.throttlingInfo.windowStart = now;
        }

        // Vérifier le nombre de suppressions par minute
        const maxPerMinute = settings.store.maxDeletionsPerMinute;
        if (this.throttlingInfo.deletionCount >= maxPerMinute) {
            this.debug(`Limit of ${maxPerMinute} deletions per minute reached`);
            return false;
        }

        // Vérifier le délai minimum entre les suppressions
        const minDelay = settings.store.minDelayBetweenDeletions;
        const timeSinceLastDeletion = now - this.throttlingInfo.lastDeletionTime;
        if (timeSinceLastDeletion < minDelay) {
            this.debug(`Minimum delay of ${minDelay}ms not elapsed yet`);
            return false;
        }

        return true;
    },

    updateThrottlingInfo() {
        const now = Date.now();
        this.throttlingInfo.lastDeletionTime = now;
        this.throttlingInfo.deletionCount++;
        this.rateLimitInfo.lastSuccessfulDeletion = now;
    },

    scheduleMessageDeletion(message: any, customDelay?: number) {
        const delay = customDelay || this.getDelayInMs();
        const scheduledTime = Date.now() + delay;
        const { deletionMode } = settings.store;

        const existing = this.trackedMessages.get(message.id);
        if (existing?.timeoutId) {
            clearTimeout(existing.timeoutId);
        }

        this.debug(`Scheduled deletion of message ${message.id} in ${delay}ms (${new Date(scheduledTime).toLocaleString()}), mode: ${deletionMode}`);

        const timeoutId = setTimeout(() => {
            if (settings.store.batchDelete) {
                this.addToDeletionQueue(message.id, message.channel_id, deletionMode);
            } else {
                this.deleteMessage(message.id, message.channel_id, deletionMode);
            }
        }, delay);

        // Suivre le message avec plus d'informations
        const trackedMessage: TrackedMessage = {
            id: message.id,
            channelId: message.channel_id,
            guildId: message.guild_id,
            timestamp: Date.now(),
            scheduledTime: scheduledTime,
            timeoutId: timeoutId,
            content: message.content,
            length: (message.content || "").length,
            hasEmbed: !!(message.embeds && message.embeds.length > 0),
            hasAttachment: !!(message.attachments && message.attachments.length > 0),
            hasReactions: !!(message.reactions && message.reactions.length > 0),
            deletionMode: deletionMode,
            priority: this.calculatePriority(message)
        };

        this.trackedMessages.set(message.id, trackedMessage);
        this.messageCache.set(message.id, message);

        // Sauvegarder immédiatement
        this.saveTrackedMessages();
    },

    calculatePriority(message: any): number {
        let priority = 5; // Priorité par défaut

        // Messages plus longs = priorité plus élevée
        const contentLength = (message.content || "").length;
        if (contentLength > 500) priority += 2;
        if (contentLength > 1000) priority += 1;

        // Messages avec médias = priorité plus élevée
        if (message.embeds?.length > 0 || message.attachments?.length > 0) {
            priority += 1;
        }

        return Math.min(priority, 10);
    },

    addToDeletionQueue(messageId: string, channelId: string, mode: string) {
        this.deletionQueue.push({ messageId, channelId, mode });

        if (!this.batchProcessor) {
            this.startBatchProcessor();
        }
    },

    startBatchProcessor() {
        this.batchProcessor = setInterval(() => {
            this.processBatchDeletion();
        }, settings.store.batchDelay);
    },

    async processBatchDeletion() {
        if (this.deletionQueue.length === 0) {
            if (this.batchProcessor) {
                clearInterval(this.batchProcessor);
                this.batchProcessor = null;
            }
            return;
        }

        const batch = this.deletionQueue.splice(0, settings.store.batchSize);

        for (const item of batch) {
            try {
                await this.deleteMessage(item.messageId, item.channelId, item.mode);
            } catch (error) {
                this.error("Error in deletion batch:", error);
            }
        }
    },

    scheduleMessageDeletionFromRestore(savedMsg: TrackedMessage, delay: number) {
        this.debug(`Rescheduled deletion of message ${savedMsg.id} in ${delay}ms`);

        const timeoutId = setTimeout(() => {
            this.deleteMessage(savedMsg.id, savedMsg.channelId);
        }, delay);

        // Mettre à jour le message avec le nouveau timeout
        const trackedMessage: TrackedMessage = {
            ...savedMsg,
            timeoutId: timeoutId
        };

        this.trackedMessages.set(savedMsg.id, trackedMessage);
    },

    async deleteMessage(messageId: string, channelId: string, mode?: string, attempt: number = 1) {
        try {
            const deletionMode = mode || settings.store.deletionMode;
            this.debug(`Deleting message ${messageId}, mode: ${deletionMode} (attempt ${attempt})`);

            // Vérifier si on est en rate limit
            if (this.rateLimitInfo.isRateLimited && settings.store.rateLimitHandling) {
                const timeSinceLastRateLimit = Date.now() - this.rateLimitInfo.lastRateLimit;
                if (timeSinceLastRateLimit < this.rateLimitInfo.retryAfter * 1000) {
                    this.debug(`Rate limited, queued for retry: ${messageId}`);
                    this.addToRetryQueue(messageId, channelId, deletionMode, attempt);
                    return;
                } else {
                    // Reset du rate limit
                    this.rateLimitInfo.isRateLimited = false;
                    this.rateLimitInfo.consecutiveRateLimits = 0;
                    this.rateLimitInfo.backoffMultiplier = 1;
                }
            }

            // Vérifier le throttling avant la suppression
            if (!this.checkThrottlingLimits()) {
                this.debug(`Throttled, queued for retry: ${messageId}`);
                this.addToRetryQueue(messageId, channelId, deletionMode, attempt, 5000);
                return;
            }

            switch (deletionMode) {
                case "antilog":
                    if (settings.store.useAntiLogDeletion) {
                        await this.performAntiLogDeletion(messageId, channelId);
                    } else {
                        await this.performNormalDeletion(messageId, channelId);
                    }
                    break;
                case "silent":
                    await this.performSilentDeletion(messageId, channelId);
                    break;
                case "edit_delete":
                    await this.performEditThenDelete(messageId, channelId);
                    break;
                default:
                    await this.performNormalDeletion(messageId, channelId);
                    break;
            }

            // Mettre à jour les statistiques seulement après succès réel
            this.stats.hourlyDeletions++;
            this.stats.deletionModes[deletionMode] = (this.stats.deletionModes[deletionMode] || 0) + 1;
            this.stats.channelStats[channelId] = (this.stats.channelStats[channelId] || 0) + 1;

            const trackedMessage = this.trackedMessages.get(messageId);
            if (trackedMessage) {
                this.stats.totalBytesSaved += trackedMessage.length || 0;
                this.updateAverageMessageLength(trackedMessage.length || 0);
            }

            this.log(`Message ${messageId} deleted (${deletionMode})`);
            this.stats.messagesDeleted++;

            // Mettre à jour les informations de throttling
            this.updateThrottlingInfo();

            // Reset du compteur de rate limits en cas de succès
            if (this.rateLimitInfo.consecutiveRateLimits > 0) {
                this.rateLimitInfo.consecutiveRateLimits = Math.max(0, this.rateLimitInfo.consecutiveRateLimits - 1);
            }

            if (settings.store.notifications) {
                this.showNotification(`Message deleted (${deletionMode})`, "success");
            }

        } catch (error: any) {
            this.handleDeletionError(error, messageId, channelId, mode || settings.store.deletionMode, attempt);
        } finally {
            // Retirer le message du suivi et du cache seulement si pas en retry
            if (!this.retryQueue.some(item => item.messageId === messageId)) {
                this.trackedMessages.delete(messageId);
                this.messageCache.delete(messageId);
                // Sauvegarder après suppression
                this.saveTrackedMessages();
            }
        }
    },

    handleDeletionError(error: any, messageId: string, channelId: string, mode: string, attempt: number) {
        this.error(`Failed to delete message ${messageId}:`, error);
        this.stats.errors++;

        // Gestion spécifique des rate limits
        if (error.status === 429 && settings.store.rateLimitHandling) {
            this.handleRateLimit(error, messageId, channelId, mode, attempt);
        } else if (error.status === 404) {
            // Message déjà supprimé ou introuvable
            this.debug(`Message ${messageId} already deleted or not found`);
            this.trackedMessages.delete(messageId);
            this.messageCache.delete(messageId);
        } else if (attempt < settings.store.maxRetries) {
            // Autres erreurs - retry
            this.debug(`Attempt ${attempt + 1} for message ${messageId}`);
            this.addToRetryQueue(messageId, channelId, mode, attempt + 1);
        } else {
            // Trop de tentatives
            this.error(`Giving up on message ${messageId} after ${attempt} attempts`);
            this.trackedMessages.delete(messageId);
            this.messageCache.delete(messageId);
        }

        if (settings.store.notifications) {
            this.showNotification("Deletion failed", "error");
        }
    },

    handleRateLimit(error: any, messageId: string, channelId: string, mode: string, attempt: number) {
        const retryAfter = error.body?.retry_after || 1;

        this.rateLimitInfo.isRateLimited = true;
        this.rateLimitInfo.retryAfter = retryAfter;
        this.rateLimitInfo.lastRateLimit = Date.now();
        this.rateLimitInfo.consecutiveRateLimits++;
        this.rateLimitInfo.totalRateLimits++;

        // Augmenter le multiplicateur de backoff
        if (settings.store.adaptiveDelay) {
            this.rateLimitInfo.backoffMultiplier = Math.min(10, 1 + (this.rateLimitInfo.consecutiveRateLimits * 0.5));
        }

        // Activer le cooldown global si trop de rate limits
        if (this.rateLimitInfo.consecutiveRateLimits >= 3) {
            const cooldownDuration = Math.min(30000, retryAfter * 1000 * 2); // Max 30 secondes
            this.rateLimitInfo.globalCooldown = true;
            this.rateLimitInfo.globalCooldownUntil = Date.now() + cooldownDuration;
            this.log(`Global cooldown enabled for ${cooldownDuration}ms`);
        }

        // Ouvrir le circuit breaker si trop de rate limits consécutifs
        const threshold = settings.store.circuitBreakerThreshold;
        if (this.rateLimitInfo.consecutiveRateLimits >= threshold) {
            const duration = settings.store.circuitBreakerDuration * 60 * 1000; // Convertir en ms
            this.rateLimitInfo.circuitBreakerOpen = true;
            this.rateLimitInfo.circuitBreakerUntil = Date.now() + duration;
            this.log(`Circuit breaker opened for ${settings.store.circuitBreakerDuration} minutes`);
        }

        this.log(`Rate limit hit, retrying after ${retryAfter}s (attempt ${attempt}), total: ${this.rateLimitInfo.totalRateLimits}`);

        if (attempt < settings.store.maxRetries) {
            // Délai plus long pour les retries
            const retryDelay = Math.max(retryAfter * 1000, 5000); // Minimum 5 secondes
            this.addToRetryQueue(messageId, channelId, mode, attempt, retryDelay);
        } else {
            this.error(`Giving up after rate limit on message ${messageId}`);
            this.trackedMessages.delete(messageId);
            this.messageCache.delete(messageId);
        }
    },

    addToRetryQueue(messageId: string, channelId: string, mode: string, attempts: number, delay: number = 0) {
        const baseDelay = delay || (settings.store.retryDelay * this.rateLimitInfo.backoffMultiplier);
        const nextRetry = Date.now() + baseDelay;

        const existing = this.retryQueue.find(item => item.messageId === messageId);
        if (existing) {
            existing.channelId = channelId;
            existing.mode = mode;
            existing.attempts = Math.max(existing.attempts, attempts);
            existing.nextRetry = Math.min(existing.nextRetry, nextRetry);
            this.debug(`Retry already queued: ${messageId} (updated)`);
            return;
        }

        this.retryQueue.push({
            messageId,
            channelId,
            mode,
            attempts,
            nextRetry
        });

        this.debug(`Queued for retry: ${messageId} (in ${baseDelay}ms)`);

        if (!this.retryProcessor) {
            this.startRetryProcessor();
        }
    },

    startRetryProcessor() {
        this.retryProcessor = setInterval(() => {
            this.processRetryQueue();
        }, 1000); // Vérifier chaque seconde
    },

    processRetryQueue() {
        const now = Date.now();
        const readyToRetry = this.retryQueue.filter(item => item.nextRetry <= now);

        if (readyToRetry.length === 0) {
            if (this.retryQueue.length === 0 && this.retryProcessor) {
                clearInterval(this.retryProcessor);
                this.retryProcessor = null;
            }
            return;
        }

        // Traiter les retries prêts
        for (const item of readyToRetry) {
            const index = this.retryQueue.indexOf(item);
            if (index > -1) {
                this.retryQueue.splice(index, 1);
            }

            this.debug(`Retrying message ${item.messageId} (attempt ${item.attempts})`);
            this.deleteMessage(item.messageId, item.channelId, item.mode, item.attempts);
        }
    },

    async performNormalDeletion(messageId: string, channelId: string) {
        await RestAPI.del({
            url: `/channels/${channelId}/messages/${messageId}`
        });
    },

    async performSilentDeletion(messageId: string, channelId: string) {
        // Suppression silencieuse - pas de logs Discord
        try {
            await RestAPI.del({
                url: `/channels/${channelId}/messages/${messageId}`
            });
        } catch (error) {
            // Fallback antiLog uniquement si explicitement activé
            if (settings.store.useAntiLogDeletion) {
                await this.performAntiLogDeletion(messageId, channelId);
            } else {
                throw error;
            }
        }
    },

    async performEditThenDelete(messageId: string, channelId: string) {
        try {
            // Éditer le message d'abord
            await RestAPI.patch({
                url: `/channels/${channelId}/messages/${messageId}`,
                body: {
                    content: settings.store.editMessage
                }
            });

            // Attendre le délai configuré
            await sleep(settings.store.editDelay);

            // Puis supprimer
            await RestAPI.del({
                url: `/channels/${channelId}/messages/${messageId}`
            });
        } catch (error) {
            // En cas d'erreur, essayer la suppression normale
            await this.performNormalDeletion(messageId, channelId);
        }
    },

    // Nouvelle fonction pour la suppression AntiLog avec gestion des rate limits
    async performAntiLogDeletion(messageId: string, channelId: string) {
        if (!settings.store.useAntiLogDeletion) {
            await this.performNormalDeletion(messageId, channelId);
            return;
        }

        try {
            this.debug(`AntiLog deletion of message ${messageId}`);

            // Hint pour les plugins de logging côté client
            FluxDispatcher.dispatch({
                type: "MESSAGE_DELETE",
                channelId,
                id: messageId,
                mlDeleted: true
            });

            // Délai plus long et aléatoire pour éviter les rate limits
            const randomDelay = Math.random() * 500 + 1000; // 1000-1500ms
            await sleep(randomDelay);

            // Envoyer un message de remplacement
            const buggedMsgResponse = await messageSendWrapper(
                getAntiLogReplacementContent(),
                messageId,
                channelId
            );
            const buggedMsgId = buggedMsgResponse?.body?.id;
            if (!buggedMsgId) {
                throw new Error("AntiLog: could not get the replacement message id");
            }

            // Délai beaucoup plus long entre les suppressions
            const deleteDelay = Math.max(settings.store.deleteInterval, 3000); // Minimum 3 secondes
            await sleep(deleteDelay);

            // Supprimer le message original
            await messageDeleteWrapper(channelId, messageId);

            // Attendre le délai configuré
            await sleep(deleteDelay);

            // Supprimer le message de remplacement
            await messageDeleteWrapper(channelId, buggedMsgId);

            this.debug(`AntiLog deletion finished for message ${messageId}`);

        } catch (error) {
            this.error(`AntiLog deletion failed for message ${messageId}:`, error);
            throw error; // Re-throw pour que la fonction parent puisse gérer l'erreur
        }
    },

    getDelayInMs(): number {
        const delay = settings.store.defaultDelay;
        const unit = settings.store.delayUnit;

        switch (unit) {
            case "seconds":
                return delay * 1000;
            case "minutes":
                return delay * 60 * 1000;
            case "hours":
                return delay * 60 * 60 * 1000;
            default:
                return delay * 1000;
        }
    },

    showNotification(message: string, type: "success" | "error" | "info" = "info") {
        const { notificationType } = settings.store;
        const prefix = type === "error" ? "Error:" : type === "success" ? "OK:" : "Info:";
        const logMessage = `[AutoDeleter] ${prefix} ${message}`;

        if (notificationType === "console" || notificationType === "both") {
            console.log(logMessage);
        }

        if (notificationType === "toast" || notificationType === "both") {
            // TODO: Implémenter les toast notifications si l'API est disponible
            this.showToastNotification(message, type);
        }
    },

    showToastNotification(message: string, type: "success" | "error" | "info") {
        // Placeholder pour les toast notifications
        // Peut être implémenté avec l'API de notification de Flocord si disponible
        console.log(`[AutoDeleter Toast] ${message}`);
    },

    updateAverageMessageLength(newLength: number) {
        const totalMessages = this.stats.messagesDeleted;
        if (totalMessages === 1) {
            this.stats.averageMessageLength = newLength;
        } else {
            this.stats.averageMessageLength =
                (this.stats.averageMessageLength * (totalMessages - 1) + newLength) / totalMessages;
        }
    },

    // Méthodes de logging
    log(message: string, ...args: any[]) {
        console.log(`[AutoDeleter] ${message}`, ...args);
    },

    debug(message: string, ...args: any[]) {
        if (settings.store.debug) {
            console.debug(`[AutoDeleter DEBUG] ${message}`, ...args);
        }
    },

    error(message: string, ...args: any[]) {
        console.error(`[AutoDeleter ERROR] ${message}`, ...args);
    },

    // Méthodes utilitaires pour les statistiques
    getStats() {
        return {
            ...this.stats,
            trackedMessages: this.trackedMessages.size,
            queueSize: this.deletionQueue.length,
            retryQueueSize: this.retryQueue.length,
            cacheSize: this.messageCache.size,
            uptime: Date.now() - (this.startTime || Date.now()),
            efficiency: this.calculateEfficiency(),
            rateLimitInfo: this.getRateLimitInfo()
        };
    },

    calculateEfficiency(): number {
        const total = this.stats.messagesDeleted + this.stats.messagesSaved;
        if (total === 0) return 0;
        return Math.round((this.stats.messagesDeleted / total) * 100);
    },

    resetStats() {
        this.stats = {
            messagesDeleted: 0,
            messagesSaved: 0,
            errors: 0,
            restoredFromStorage: 0,
            hourlyDeletions: 0,
            lastHourReset: Date.now(),
            totalBytesSaved: 0,
            averageMessageLength: 0,
            deletionModes: {},
            channelStats: {}
        };
        this.log("Statistics reset");
    },

    // Méthodes de gestion d'urgence
    emergencyStopAll() {
        this.log("Emergency stop: cancelling every scheduled deletion");

        // Annuler tous les timeouts
        this.trackedMessages.forEach(message => {
            if (message.timeoutId) {
                clearTimeout(message.timeoutId);
            }
        });

        // Vider les queues
        this.deletionQueue = [];
        this.retryQueue = [];

        // Arrêter les processeurs
        if (this.batchProcessor) {
            clearInterval(this.batchProcessor);
            this.batchProcessor = null;
        }

        if (this.retryProcessor) {
            clearInterval(this.retryProcessor);
            this.retryProcessor = null;
        }

        // Reset des rate limits
        this.rateLimitInfo = {
            isRateLimited: false,
            retryAfter: 0,
            lastRateLimit: 0,
            consecutiveRateLimits: 0,
            backoffMultiplier: 1,
            globalCooldown: false,
            globalCooldownUntil: 0,
            circuitBreakerOpen: false,
            circuitBreakerUntil: 0,
            totalRateLimits: 0,
            lastSuccessfulDeletion: 0
        };

        // Reset du throttling
        this.throttlingInfo = {
            lastDeletionTime: 0,
            deletionCount: 0,
            windowStart: 0,
            maxDeletionsPerMinute: settings.store.maxDeletionsPerMinute,
            minDelayBetweenDeletions: settings.store.minDelayBetweenDeletions
        };

        // Vider les caches
        this.messageCache.clear();
        this.channelCache.clear();

        this.log("Emergency stop finished");
    },

    // Méthode pour obtenir les informations de rate limit
    getRateLimitInfo() {
        return {
            ...this.rateLimitInfo,
            retryQueueSize: this.retryQueue.length,
            isProcessing: !!this.retryProcessor,
            throttlingInfo: this.throttlingInfo
        };
    },

    // Méthode pour forcer le reset des rate limits
    resetRateLimits() {
        this.rateLimitInfo = {
            isRateLimited: false,
            retryAfter: 0,
            lastRateLimit: 0,
            consecutiveRateLimits: 0,
            backoffMultiplier: 1,
            globalCooldown: false,
            globalCooldownUntil: 0,
            circuitBreakerOpen: false,
            circuitBreakerUntil: 0,
            totalRateLimits: 0,
            lastSuccessfulDeletion: 0
        };

        this.throttlingInfo = {
            lastDeletionTime: 0,
            deletionCount: 0,
            windowStart: 0,
            maxDeletionsPerMinute: settings.store.maxDeletionsPerMinute,
            minDelayBetweenDeletions: settings.store.minDelayBetweenDeletions
        };

        this.log("Rate limits and throttling reset");
    },

    // Méthode pour forcer la fermeture du circuit breaker
    closeCircuitBreaker() {
        this.rateLimitInfo.circuitBreakerOpen = false;
        this.rateLimitInfo.circuitBreakerUntil = 0;
        this.log("Circuit breaker closed manually");
    },

    // Méthode pour forcer l'arrêt du cooldown global
    stopGlobalCooldown() {
        this.rateLimitInfo.globalCooldown = false;
        this.rateLimitInfo.globalCooldownUntil = 0;
        this.log("Global cooldown stopped manually");
    },

    // Méthode pour récupérer les messages en attente
    getPendingMessages() {
        return Array.from(this.trackedMessages.values()).map((msg: TrackedMessage) => ({
            id: msg.id,
            channelId: msg.channelId,
            scheduledTime: new Date(msg.scheduledTime).toLocaleString(),
            timeRemaining: Math.max(0, msg.scheduledTime - Date.now()),
            content: (msg.content || "").substring(0, 50) + ((msg.content?.length || 0) > 50 ? "..." : ""),
            priority: msg.priority || 5
        }));
    },

    // Méthode pour annuler la suppression d'un message spécifique
    cancelMessageDeletion(messageId: string) {
        const trackedMessage = this.trackedMessages.get(messageId);
        if (trackedMessage && trackedMessage.timeoutId) {
            clearTimeout(trackedMessage.timeoutId);
            this.trackedMessages.delete(messageId);
            this.messageCache.delete(messageId);
            this.saveTrackedMessages();
            this.log(`Deletion cancelled for message ${messageId}`);
            return true;
        }
        return false;
    },

    // Méthode pour nettoyer le stockage (utile pour le debug)
    async clearStorage() {
        try {
            await DataStore.del(STORAGE_KEY);
            this.log("Storage cleared");
        } catch (error) {
            this.error("Failed to clear storage:", error);
        }
    },

    // Méthode pour exporter les statistiques
    exportStats() {
        const stats = this.getStats();
        const dataStr = JSON.stringify(stats, null, 2);
        const dataBlob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `autodeleter-stats-${new Date().toISOString().split("T")[0]}.json`;
        link.click();
        URL.revokeObjectURL(url);
        this.log("Statistics exported");
    },

    // Méthode pour importer des paramètres
    async importSettings(settingsData: string) {
        try {
            const importedSettings = JSON.parse(settingsData);
            // Valider et appliquer les paramètres importés
            Object.keys(importedSettings).forEach(key => {
                if (Object.prototype.hasOwnProperty.call(settings.store, key)) {
                    settings.store[key] = importedSettings[key];
                }
            });
            this.log("Settings imported");
        } catch (error) {
            this.error("Failed to import settings:", error);
        }
    },

    // Méthode pour optimiser les performances
    optimizePerformance() {
        // Nettoyer les caches anciens
        const now = Date.now();
        const maxCacheAge = 30 * 60 * 1000; // 30 minutes

        this.messageCache.forEach((message, id) => {
            if (now - message.timestamp > maxCacheAge) {
                this.messageCache.delete(id);
            }
        });

        this.channelCache.forEach((channel, id) => {
            if (now - channel.timestamp > maxCacheAge) {
                this.channelCache.delete(id);
            }
        });

        this.debug(`Cleanup finished, cache: ${this.messageCache.size} messages, ${this.channelCache.size} channels`);
    }
});
