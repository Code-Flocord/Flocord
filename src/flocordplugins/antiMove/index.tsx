/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { definePluginSettings, migratePluginSettings } from "@api/Settings";
import { FlocordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { Constants, Menu, React, RestAPI, UserStore } from "@webpack/common";

const VoiceStateStore = findStoreLazy("VoiceStateStore");
const ChannelActions = findByPropsLazy("selectVoiceChannel");
const SelectedGuildStore = findStoreLazy("SelectedGuildStore");

interface VoiceState {
    userId: string;
    channelId?: string;
    oldChannelId?: string;
    guildId?: string;
}

interface AntiMoveState {
    mode: "accroche" | "ancre" | null;
    targetId: string | null;
    targetUsername: string | null;
    anchorChannelId: string | null;
    moveTimestamps: number[];
}

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable AntiMove.",
        default: true
    },
    autoReconnectDelay: {
        type: OptionType.NUMBER,
        description: "Delay before moving the user back, in milliseconds.",
        default: 1000,
        min: 0,
        max: 5000
    },
    rateLimitMaxMoves: {
        type: OptionType.NUMBER,
        description: "Maximum number of moves allowed in Hook mode.",
        default: 5,
        min: 1,
        max: 50
    },
    rateLimitTimeWindow: {
        type: OptionType.NUMBER,
        description: "Time window for the move limit, in minutes.",
        default: 1,
        min: 1,
        max: 60
    }
});

let activeState: AntiMoveState = { mode: null, targetId: null, targetUsername: null, anchorChannelId: null, moveTimestamps: [] };

function log(message: string, level: "info" | "warn" | "error" = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[AntiMove ${timestamp}]`;
    if (level === "warn") console.warn(prefix, message);
    else if (level === "error") console.error(prefix, message);
    else console.log(prefix, message);
}

async function moveUserToVoiceChannel(userId: string, channelId: string): Promise<void> {
    const guildId = SelectedGuildStore.getGuildId();
    if (!guildId) return;

    try {
        await RestAPI.patch({
            url: Constants.Endpoints.GUILD_MEMBER(guildId, userId),
            body: { channel_id: channelId }
        });
        log(`User ${userId} moved back to channel ${channelId}`);
    } catch (error) {
        log(`Move failed: ${error}`, "error");
    }
}

async function activerAntiMove(mode: "accroche" | "ancre", userId: string, username: string) {
    const currentUserId = UserStore.getCurrentUser()?.id;
    const userVoiceState = VoiceStateStore.getVoiceStateForUser(userId);
    const myVoiceState = VoiceStateStore.getVoiceStateForUser(currentUserId);

    let targetChannelId = null;
    if (mode === "accroche") {
        if (!myVoiceState?.channelId) {
            showNotification({ title: "AntiMove", body: "You need to be in a voice channel to use Hook mode." });
            return;
        }
        targetChannelId = myVoiceState.channelId;
    } else {
        if (!userVoiceState?.channelId) {
            showNotification({ title: "AntiMove", body: `${username} is not in a voice channel.` });
            return;
        }
        targetChannelId = userVoiceState.channelId;
    }

    activeState = {
        mode,
        targetId: userId,
        targetUsername: username,
        anchorChannelId: targetChannelId,
        moveTimestamps: []
    };

    const modeName = mode === "accroche" ? "Hook" : "Anchor";
    log(`${modeName} enabled on ${username}`);
    showNotification({ title: "AntiMove", body: `${modeName} enabled on ${username}.` });
}

function desactiverAntiMove() {
    if (!activeState.mode) return;
    const modeName = activeState.mode === "accroche" ? "Hook" : "Anchor";
    const username = activeState.targetUsername;

    activeState = { mode: null, targetId: null, targetUsername: null, anchorChannelId: null, moveTimestamps: [] };
    log(`${modeName} disabled`);
    showNotification({ title: "AntiMove", body: `${modeName} disabled for ${username}.` });
}

const UserContextMenuPatch: NavContextMenuPatchCallback = (children, { user }: { user: any; }) => {
    if (!settings.store.enabled || !user) return;

    const currentUser = UserStore.getCurrentUser();
    if (!currentUser) return;

    const isMe = user.id === currentUser.id;
    const isCurrentlyAccroche = activeState.mode === "accroche" && activeState.targetId === user.id;
    const isCurrentlyAncre = activeState.mode === "ancre" && activeState.targetId === user.id;

    if (!isMe) {
        children.push(
            React.createElement(Menu.MenuSeparator, {}),
            React.createElement(Menu.MenuItem, {
                id: "antimove-accroche",
                label: isCurrentlyAccroche ? `Unhook ${user.username}` : `Hook ${user.username}`,
                action: async () => {
                    if (isCurrentlyAccroche) desactiverAntiMove();
                    else await activerAntiMove("accroche", user.id, user.username);
                }
            }),
            React.createElement(Menu.MenuItem, {
                id: "antimove-ancre",
                label: isCurrentlyAncre ? `Unanchor from ${user.username}` : `Anchor to ${user.username}`,
                action: async () => {
                    if (isCurrentlyAncre) desactiverAntiMove();
                    else await activerAntiMove("ancre", user.id, user.username);
                }
            })
        );
    }
};

migratePluginSettings("AntiMove", "Anti Move");
export default definePlugin({
    name: "AntiMove",
    description: "Prevents unwanted voice channel moves with Hook mode (keep a user with you) and Anchor mode (stay in your channel).",
    authors: [FlocordDevs.Flocord],
    settings,

    contextMenus: {
        "user-context": UserContextMenuPatch
    },

    flux: {
        async VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            if (!settings.store.enabled || !activeState.mode) return;

            const currentUser = UserStore.getCurrentUser();
            if (!currentUser) return;
            const currentUserId = currentUser.id;

            for (const voiceState of voiceStates) {
                const { userId, channelId } = voiceState;

                if (!channelId) continue;

                if (activeState.mode === "accroche" && activeState.anchorChannelId) {
                    // Accroche (Antimove) : La cible doit rester avec moi.
                    if (userId === activeState.targetId && channelId !== activeState.anchorChannelId) {
                        const now = Date.now();
                        const timeWindowMs = settings.store.rateLimitTimeWindow * 60000;

                        // Nettoyer les anciens timestamps
                        activeState.moveTimestamps = activeState.moveTimestamps.filter(t => now - t < timeWindowMs);

                        if (activeState.moveTimestamps.length >= settings.store.rateLimitMaxMoves) {
                            showNotification({ title: "AntiMove", body: `Move limit reached for ${activeState.targetUsername}. Hook mode was disabled to avoid spam.` });
                            desactiverAntiMove();
                            return;
                        }

                        activeState.moveTimestamps.push(now);

                        // La cible s'éloigne -> on la ramène
                        setTimeout(() => {
                            moveUserToVoiceChannel(userId, activeState.anchorChannelId!).catch(() => {});
                        }, settings.store.autoReconnectDelay);
                    } else if (userId === currentUserId && channelId !== activeState.anchorChannelId) {
                        // Je me déplace (ou suis déplacé) -> la cible me suit
                        activeState.anchorChannelId = channelId;
                        setTimeout(() => {
                            moveUserToVoiceChannel(activeState.targetId!, channelId).catch(() => {});
                        }, settings.store.autoReconnectDelay);
                    }
                } else if (activeState.mode === "ancre" && activeState.anchorChannelId) {
                    // Ancre (S'ancrer à) : Je reste dans le salon défini à l'activation.
                    // Je ne suis pas la cible si elle bouge (pas de conflit avec followVoiceUser).
                    if (userId === currentUserId && channelId !== activeState.anchorChannelId) {
                        // J'ai été déplacé -> je retourne au salon ancré
                        setTimeout(() => {
                            if (ChannelActions?.selectVoiceChannel) {
                                ChannelActions.selectVoiceChannel(activeState.anchorChannelId!);
                            }
                        }, settings.store.autoReconnectDelay);
                    }
                }
            }
        }
    },

    start() {
        log("AntiMove started");
    },

    stop() {
        desactiverAntiMove();
        log("AntiMove stopped");
    }
});
