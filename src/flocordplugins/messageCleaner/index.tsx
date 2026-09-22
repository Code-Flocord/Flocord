/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Channel, Guild, Message } from "@vencord/discord-types";
import { ChannelStore, GuildStore, Menu, RestAPI, UserStore } from "@webpack/common";
function flattenGuildChannels(container: any): any[] {
    if (!container) return [];
    if (Array.isArray(container)) return container;

    if (Array.isArray(container.SELECTABLE)) {
        return container.SELECTABLE.map((entry: any) => entry?.channel ?? entry).filter(Boolean);
    }

    if (Array.isArray(container.channels)) {
        return container.channels.map((entry: any) => entry?.channel ?? entry).filter(Boolean);
    }

    if (typeof container === "object") {
        return Object.values(container).map((entry: any) => entry?.channel ?? entry).filter(Boolean);
    }

    return [];
}

function getGuildChannels(guildId: string): any[] {
    const cs: any = ChannelStore;

    if (typeof cs.getChannelIds === "function") {
        const ids = cs.getChannelIds(guildId);
        if (Array.isArray(ids)) {
            return ids.map((id: string) => ChannelStore.getChannel(id)).filter(Boolean);
        }
    }

    if (typeof cs.getMutableGuildChannels === "function") {
        return flattenGuildChannels(cs.getMutableGuildChannels(guildId));
    }

    if (typeof cs.getGuildChannels === "function") {
        return flattenGuildChannels(cs.getGuildChannels(guildId));
    }

    if (typeof cs.getAllChannels === "function") {
        const all = cs.getAllChannels();
        return flattenGuildChannels(all).filter((ch: any) => ch.guild_id === guildId);
    }

    if (cs.channels) {
        return flattenGuildChannels(cs.channels).filter((ch: any) => ch.guild_id === guildId);
    }

    log(`Could not get the channel list. Available methods: ${Object.keys(cs).join(", ")}`, "error");
    return [];
}

async function cleanGuild(guildId: string) {
    if (isCleaningInProgress) {
        log("A cleanup is already running", "warn");
        return;
    }
    const guild: Guild | undefined = GuildStore.getGuild(guildId);
    if (!guild) {
        log("Server not found", "error");
        return;
    }
    isCleaningInProgress = true;
    shouldStopCleaning = false;
    cleaningStats = {
        total: 0,
        deleted: 0,
        failed: 0,
        skipped: 0,
        startTime: Date.now()
    };

    try {
        const currentUserId = UserStore.getCurrentUser()?.id;
        if (!currentUserId) {
            log("Could not get the current user ID", "error");
            return;
        }

        log(`Searching messages across the server: ${guild.name}...`);

        const allMessages: Message[] = [];
        let offset = 0;
        let totalResults = 1;
        let searchAttempts = 0;

        while (offset < totalResults && !shouldStopCleaning && offset < 5000) {
            const { messages, total } = await searchGuildMessages(guildId, currentUserId, offset);

            if (searchAttempts === 0) {
                totalResults = total;
                log(`Total indexed messages: ${total}`);
            }

            if (messages.length === 0) break;

            allMessages.push(...messages);
            offset += 25; // Discord search results are paginated by 25
            searchAttempts++;

            if (searchAttempts % 4 === 0) {
                log(`Searching: ${allMessages.length} messages fetched...`);
            }

            await sleep(1000);
        }

        const uniqueMessages = Array.from(new Map(allMessages.map(m => [m.id, m])).values());

        if (uniqueMessages.length === 0) {
            log("No message found", "warn");
            return;
        }

        const validMessages = uniqueMessages.filter(msg => canDeleteMessage(msg, currentUserId));
        cleaningStats.total = validMessages.length;

        if (validMessages.length === 0) {
            log("No deletable message found on this server", "warn");
            return;
        }

        log(`Deleting ${validMessages.length} message(s) found by server search`);
        let processed = 0;
        for (const message of validMessages) {
            if (shouldStopCleaning) break;

            const success = await deleteMessage(message.channel_id, message.id);
            if (success) {
                cleaningStats.deleted++;
            } else {
                cleaningStats.failed++;
            }

            processed++;
            if (settings.store.delayBetweenDeletes > 0) {
                await sleep(settings.store.delayBetweenDeletes);
            }
            if (processed % 10 === 0) {
                updateProgress();
            }
        }

        cleaningStats.skipped += uniqueMessages.length - validMessages.length;
        log(`Server cleanup finished: ${guild.name}`);
    } finally {
        isCleaningInProgress = false;
    }
}
const GuildContextMenuPatch: NavContextMenuPatchCallback = (children, ctx: { guild?: Guild; } = {}) => {
    const { guild } = ctx;
    if (!guild) return;

    const group = findGroupChildrenByChildId("guild-header", children) ?? children;

    if (group) {
        const menuItems = [<Menu.MenuSeparator key="separator-guild" />];

        if (isCleaningInProgress) {
            menuItems.push(
                <Menu.MenuItem
                    key="cleaning-status-guild"
                    id="vc-cleaning-status-guild"
                    label="Cleanup in progress (server)"
                    color="brand"
                    disabled={true}
                />
            );
        } else {
            menuItems.push(
                <Menu.MenuItem
                    key="clean-guild-messages"
                    id="vc-clean-guild-messages"
                    label="Delete all my messages on this server"
                    color="danger"
                    action={() => cleanGuild(guild.id)}
                />
            );
        }
        group.push(...menuItems);
    }
};

const settings = definePluginSettings({
    delayBetweenDeletes: {
        type: OptionType.SLIDER,
        description: "Delay between each deletion (ms), to avoid rate limits.",
        default: 1000,
        markers: [100, 500, 1000, 2000, 5000],
        minValue: 100,
        maxValue: 10000,
        stickToMarkers: false
    },
    batchSize: {
        type: OptionType.SLIDER,
        description: "Number of messages to process per batch.",
        default: 100,
        markers: [10, 25, 50, 100],
        minValue: 1,
        maxValue: 100,
        stickToMarkers: false
    },
    showProgress: {
        type: OptionType.BOOLEAN,
        description: "Show progress in real time.",
        default: true
    },
    debugMode: {
        type: OptionType.BOOLEAN,
        description: "Debug mode with detailed console logs.",
        default: false
    },
    skipSystemMessages: {
        type: OptionType.BOOLEAN,
        description: "Skip system messages (join, leave, etc.).",
        default: true
    },
    skipReplies: {
        type: OptionType.BOOLEAN,
        description: "Skip replies.",
        default: false
    },
    maxAge: {
        type: OptionType.SLIDER,
        description: "Maximum age of messages to delete, in days (0 for no limit).",
        default: 0,
        markers: [0, 1, 7, 30, 90],
        minValue: 0,
        maxValue: 365,
        stickToMarkers: false
    }
});

let isCleaningInProgress = false;
let shouldStopCleaning = false;
let cleaningStats = {
    total: 0,
    deleted: 0,
    failed: 0,
    skipped: 0,
    startTime: 0
};

function log(message: string, level: "info" | "warn" | "error" = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[MessageCleaner ${timestamp}]`;

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

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function debugLog(message: string) {
    if (settings.store.debugMode) {
        log(message, "info");
    }
}

function canDeleteMessage(message: Message, currentUserId: string): boolean {
    try {
        debugLog(`[CHECK] Message ${message.id}:`);
        debugLog(`  - type: ${message.type} (19=REPLY, 0=DEFAULT)`);
        debugLog(`  - author.id: ${message.author?.id}`);
        debugLog(`  - messageReference: ${!!message.messageReference}`);
        debugLog(`  - message_reference: ${!!(message as any).message_reference}`);
        debugLog(`  - keys: ${Object.keys(message).join(", ")}`);

        // Only ever delete our own messages
        if (message.author?.id !== currentUserId) {
            debugLog(`  Not your message (${message.author?.id} != ${currentUserId})`);
            return false;
        }

        if (settings.store.skipSystemMessages) {
            const allowedTypes = [0, 19, 20]; // DEFAULT, REPLY, CHAT_INPUT_COMMAND
            if (!allowedTypes.includes(message.type)) {
                debugLog(`  System message (type ${message.type})`);
                return false;
            }
        }

        const isReply = message.type === 19 || !!message.messageReference || !!(message as any).message_reference;
        if (isReply) {
            debugLog(`  Detected as a reply (type=${message.type}, ref=${!!message.messageReference})`);
            if (settings.store.skipReplies) {
                debugLog("  Skipped: skipReplies=true");
                return false;
            } else {
                debugLog("  Will be deleted: skipReplies=false");
            }
        }

        if (settings.store.maxAge > 0) {
            let messageTime: number;

            if (typeof message.timestamp === "string") {
                messageTime = new Date(message.timestamp).getTime();
            } else if (message.timestamp && typeof message.timestamp === "object" && "toISOString" in message.timestamp) {
                messageTime = new Date(message.timestamp.toISOString()).getTime();
            } else if (typeof message.timestamp === "number") {
                messageTime = message.timestamp;
            } else {
                debugLog("  Invalid timestamp");
                return false;
            }

            if (isNaN(messageTime) || messageTime <= 0) {
                debugLog(`  Invalid timestamp (${message.timestamp})`);
                return false;
            }

            const messageAge = Date.now() - messageTime;
            const maxAgeMs = settings.store.maxAge * 24 * 60 * 60 * 1000;

            if (messageAge > maxAgeMs) {
                debugLog(`  Too old (${Math.round(messageAge / (24 * 60 * 60 * 1000))} days)`);
                return false;
            }
        }

        debugLog("  Can be deleted");
        return true;
    } catch (error) {
        debugLog(`  Error: ${error}`);
        return false;
    }
}

async function deleteMessage(channelId: string, messageId: string, maxRetries = 3): Promise<boolean> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (shouldStopCleaning) return false;

        try {
            debugLog(`Deleting message ${messageId} in channel ${channelId} (attempt ${attempt})`);

            const response = await RestAPI.del({
                url: `/channels/${channelId}/messages/${messageId}`
            });

            debugLog(`Message ${messageId} deleted`);
            return true;
        } catch (error: any) {
            const errorMessage = error?.message || error?.toString() || "Unknown error";
            const statusCode = error?.status || error?.statusCode || "N/A";

            debugLog(`Failed to delete message ${messageId}: ${errorMessage} (status ${statusCode})`);

            if (statusCode === 429) {
                const retryAfter = error?.body?.retry_after || error?.retry_after;
                let waitTime = 5000;

                if (retryAfter) {
                    const ra = Number(retryAfter);
                    waitTime = ra < 1000 ? Math.ceil(ra * 1000) : ra;
                    if (waitTime > 60000) waitTime = 60000;
                }

                log(`Rate limited (429). Pausing for ${waitTime / 1000}s... (attempt ${attempt}/${maxRetries})`, "warn");
                await sleep(waitTime + 500);
                continue;
            } else if (statusCode === 404) {
                debugLog(`Message ${messageId} not found (already deleted?)`);
                return true;
            } else if (statusCode === 403) {
                debugLog(`Permission denied to delete message ${messageId}`);
                return false;
            }

            if (attempt === maxRetries) {
                return false;
            }
        }
    }
    return false;
}

async function getChannelMessages(channelId: string, before?: string): Promise<Message[]> {
    try {
        const url = before
            ? `/channels/${channelId}/messages?limit=${settings.store.batchSize}&before=${before}`
            : `/channels/${channelId}/messages?limit=${settings.store.batchSize}`;

        debugLog(`Fetching messages from: ${url}`);

        const response = await RestAPI.get({ url });

        if (!response || !response.body) {
            debugLog(`Empty or invalid response for ${url}`);
            return [];
        }

        const messages = Array.isArray(response.body) ? response.body : [];
        debugLog(`Fetched ${messages.length} messages from channel ${channelId}`);

        return messages;
    } catch (error: any) {
        const errorMessage = error?.message || error?.toString() || "Unknown error";
        const statusCode = error?.status || error?.statusCode || "N/A";

        log(`Failed to fetch messages: ${errorMessage} (status ${statusCode})`, "error");

        if (statusCode === 403) {
            log(`Permission denied for channel ${channelId}`, "error");
        } else if (statusCode === 404) {
            log(`Channel ${channelId} not found`, "error");
        } else if (statusCode === 429) {
            log("Rate limited while fetching messages", "error");
        }

        return [];
    }
}

async function searchGuildMessages(guildId: string, userId: string, offset: number, maxRetries = 3): Promise<{ messages: Message[], total: number }> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const url = `/guilds/${guildId}/messages/search?author_id=${userId}&include_nsfw=true&offset=${offset}`;
            debugLog(`Searching messages: ${url}`);

            const response = await RestAPI.get({ url });
            const body = response?.body;
            const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
            const total = body?.total_results || 0;

            const flattened: Message[] = [];
            for (const entry of rawMessages) {
                if (Array.isArray(entry)) {
                    const targetMsg = entry.find((m: any) => m?.hit) || entry.find((m: any) => m?.author?.id === userId) || entry[0];
                    if (targetMsg) flattened.push(targetMsg);
                } else if (entry) {
                    flattened.push(entry);
                }
            }

            debugLog(`Search: ${flattened.length} message(s) received for offset ${offset}`);
            return { messages: flattened, total };
        } catch (error: any) {
            const statusCode = error?.status || error?.statusCode || "N/A";

            if (statusCode === 429) {
                const retryAfter = error?.body?.retry_after || error?.retry_after;
                let waitTime = 5000;
                if (retryAfter) {
                    const ra = Number(retryAfter);
                    waitTime = ra < 1000 ? Math.ceil(ra * 1000) : ra;
                    if (waitTime > 60000) waitTime = 60000;
                }
                log(`Rate limited (429) on server search. Pausing for ${waitTime / 1000}s... (attempt ${attempt}/${maxRetries})`, "warn");
                await sleep(waitTime + 500);
                continue;
            }

            if (attempt === maxRetries) {
                const errorMessage = error?.message || error?.toString() || "Unknown error";
                log(`Server search failed: ${errorMessage} (status ${statusCode})`, "error");
                return { messages: [], total: 0 };
            }
        }
    }
    return { messages: [], total: 0 };
}

async function searchChannelMessages(channelId: string, userId: string, offset: number, maxRetries = 3): Promise<{ messages: Message[], total: number }> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const url = `/channels/${channelId}/messages/search?author_id=${userId}&include_nsfw=true&offset=${offset}`;
            debugLog(`Searching channel messages: ${url}`);

            const response = await RestAPI.get({ url });
            const body = response?.body;
            const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
            const total = body?.total_results || 0;

            const flattened: Message[] = [];
            for (const entry of rawMessages) {
                if (Array.isArray(entry)) {
                    const targetMsg = entry.find((m: any) => m?.hit) || entry.find((m: any) => m?.author?.id === userId) || entry[0];
                    if (targetMsg) flattened.push(targetMsg);
                } else if (entry) {
                    flattened.push(entry);
                }
            }

            debugLog(`Channel search: ${flattened.length} message(s) received for offset ${offset}`);
            return { messages: flattened, total };
        } catch (error: any) {
            const statusCode = error?.status || error?.statusCode || "N/A";

            if (statusCode === 429) {
                const retryAfter = error?.body?.retry_after || error?.retry_after;
                let waitTime = 5000;
                if (retryAfter) {
                    const ra = Number(retryAfter);
                    waitTime = ra < 1000 ? Math.ceil(ra * 1000) : ra;
                    if (waitTime > 60000) waitTime = 60000;
                }
                log(`Rate limited (429) on channel search. Pausing for ${waitTime / 1000}s... (attempt ${attempt}/${maxRetries})`, "warn");
                await sleep(waitTime + 500);
                continue;
            }

            if (attempt === maxRetries) {
                const errorMessage = error?.message || error?.toString() || "Unknown error";
                log(`Channel search failed: ${errorMessage} (status ${statusCode})`, "error");
                return { messages: [], total: 0 };
            }
        }
    }
    return { messages: [], total: 0 };
}

function updateProgress() {
    if (!settings.store.showProgress) return;

    const { total, deleted, failed, skipped, startTime } = cleaningStats;
    const processed = deleted + failed + skipped;
    const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;

    const elapsed = Date.now() - startTime;
    const elapsedStr = elapsed < 60000
        ? `${Math.round(elapsed / 1000)}s`
        : `${Math.round(elapsed / 60000)}min`;

    let etaStr = "";
    if (processed > 0 && percentage > 0) {
        const remaining = total - processed;
        const rate = processed / (elapsed / 1000);
        const eta = remaining / rate;
        etaStr = eta < 60
            ? ` (~${Math.round(eta)}s left)`
            : ` (~${Math.round(eta / 60)}min left)`;
    }
}

async function cleanChannel(channelId: string, options?: { skipSessionControl?: boolean }) {
    if (!options?.skipSessionControl && isCleaningInProgress) {
        log("A cleanup is already running", "warn");
        return;
    }

    try {
        const channel = ChannelStore.getChannel(channelId);
        const currentUserId = UserStore.getCurrentUser()?.id;

        if (!channel) {
            log("Channel not found", "error");
            return;
        }

        if (!currentUserId) {
            log("Could not get the current user ID", "error");
            return;
        }

        const channelName = channel.name || channel.recipients?.map((id: string) => {
            const user = UserStore.getUser(id);
            return user?.username || "Unknown user";
        }).join(", ") || "Private channel";

        log(`Analyzing channel "${channelName}"...`);
        log(`Configuration: delay ${settings.store.delayBetweenDeletes}ms, batch ${settings.store.batchSize}`);

        if (!options?.skipSessionControl) {
            isCleaningInProgress = true;
            shouldStopCleaning = false;
        }
        cleaningStats = {
            total: 0,
            deleted: 0,
            failed: 0,
            skipped: 0,
            startTime: Date.now()
        };

        log(`Searching messages in "${channelName}"...`);
        const allMessages: Message[] = [];
        let offset = 0;
        let totalResults = 1;
        let searchAttempts = 0;

        while (offset < totalResults && !shouldStopCleaning && offset < 5000) {
            const { messages, total } = await searchChannelMessages(channelId, currentUserId, offset);

            if (searchAttempts === 0) {
                totalResults = total;
                log(`Total indexed messages: ${total}`);
            }

            if (messages.length === 0) break;

            allMessages.push(...messages);
            offset += 25;
            searchAttempts++;

            if (searchAttempts % 4 === 0) {
                log(`Searching: ${allMessages.length} messages fetched...`);
            }

            await sleep(1000);
        }

        const uniqueMessages = Array.from(new Map(allMessages.map(m => [m.id, m])).values());

        if (uniqueMessages.length === 0) {
            log("No message found", "warn");
        } else {
            const validMessages = uniqueMessages.filter(msg => canDeleteMessage(msg, currentUserId));
            cleaningStats.total = validMessages.length;

            if (validMessages.length === 0) {
                log("No deletable message found", "warn");
            } else {
                log(`Deleting ${validMessages.length} message(s) found by search`);
                let processed = 0;
                for (const message of validMessages) {
                    if (shouldStopCleaning) break;

                    const success = await deleteMessage(channelId, message.id);
                    if (success) {
                        cleaningStats.deleted++;
                    } else {
                        cleaningStats.failed++;
                    }

                    processed++;
                    if (settings.store.delayBetweenDeletes > 0) {
                        await sleep(settings.store.delayBetweenDeletes);
                    }
                    if (processed % 10 === 0) {
                        updateProgress();
                    }
                }
                cleaningStats.skipped += uniqueMessages.length - validMessages.length;
            }
        }

        if (!options?.skipSessionControl) {
            isCleaningInProgress = false;
        }

        const { deleted, failed, skipped, startTime } = cleaningStats;
        const finalTotal = deleted + failed + skipped;
        const totalTime = Date.now() - startTime;
        const totalTimeStr = totalTime < 60000
            ? `${Math.round(totalTime / 1000)} seconds`
            : `${Math.round(totalTime / 60000)} min ${Math.round((totalTime % 60000) / 1000)}s`;

        const avgTimePerMessage = deleted > 0 ? Math.round(totalTime / deleted) : 0;
        const successRate = finalTotal > 0 ? Math.round((deleted / finalTotal) * 100) : 0;

        log(`Cleanup finished:
• Messages processed: ${finalTotal}
• Deleted: ${deleted}
• Failed: ${failed}
• Skipped: ${skipped}
• Total time: ${totalTimeStr}
• Success rate: ${successRate}%
• Average time per message: ${avgTimePerMessage}ms`);

    } catch (error) {
        if (!options?.skipSessionControl) {
            isCleaningInProgress = false;
        }
        log(`Cleanup failed: ${error}`, "error");
    }
}

function stopCleaning() {
    if (isCleaningInProgress) {
        shouldStopCleaning = true;
        log("Cleanup stop requested");
    }
}

const ChannelContextMenuPatch: NavContextMenuPatchCallback = (children, ctx: { channel?: Channel; } = {}) => {
    const { channel } = ctx;
    if (!channel) return;

    const group = findGroupChildrenByChildId("mark-channel-read", children) ?? children;

    if (group) {
        const menuItems = [<Menu.MenuSeparator key="separator" />];

        if (isCleaningInProgress) {
            const { total, deleted, failed, skipped, startTime } = cleaningStats;
            const processed = deleted + failed + skipped;
            const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;
            const elapsed = Math.round((Date.now() - startTime) / 1000);

            menuItems.push(
                <Menu.MenuItem
                    key="cleaning-status"
                    id="vc-cleaning-status"
                    label={`Cleanup in progress: ${percentage}% (${processed}/${total})`}
                    color="brand"
                    disabled={true}
                />,
                <Menu.MenuItem
                    key="stop-cleaning"
                    id="vc-stop-cleaning"
                    label="Stop cleanup"
                    color="danger"
                    action={stopCleaning}
                />
            );
        } else {
            menuItems.push(
                <Menu.MenuItem
                    key="clean-messages"
                    id="vc-clean-messages"
                    label="Delete my messages here"
                    color="danger"
                    action={() => cleanChannel(channel.id)}
                />
            );
        }

        group.push(...menuItems);
    }
};

export default definePlugin({
    name: "MessageCleaner",
    description: "Deletes all your messages in a channel or server, with rate limit handling and progress stats.",
    authors: [{
        name: "Bash",
        id: 1327483363518582784n
    }],
    dependencies: ["ContextMenuAPI"],
    settings,

    contextMenus: {
        "channel-context": ChannelContextMenuPatch,
        "gdm-context": ChannelContextMenuPatch,
        "user-context": ChannelContextMenuPatch,
        "guild-context": GuildContextMenuPatch
    },

    start() {
        log("Plugin started");

        log("Dependency check:");
        log(`- RestAPI: ${typeof RestAPI}`);
        log(`- ChannelStore: ${typeof ChannelStore}`);
        log(`- UserStore: ${typeof UserStore}`);
        log(`- Menu: ${typeof Menu}`);

        debugLog(`Configuration:
• Delay: ${settings.store.delayBetweenDeletes}ms
• Batch: ${settings.store.batchSize}
• Skip replies: ${settings.store.skipReplies}
• Max age: ${settings.store.maxAge} days
• Debug mode: ${settings.store.debugMode}`);
    },

    stop() {
        log("Plugin stopped");

        if (isCleaningInProgress) {
            shouldStopCleaning = true;
        }
    }
});
