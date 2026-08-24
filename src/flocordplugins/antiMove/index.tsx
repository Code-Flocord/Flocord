/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { showNotification } from "@api/Notifications";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { UserStore, Constants, RestAPI, Menu, React } from "@webpack/common";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";

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
    mode: 'accroche' | 'ancre' | null;
    targetId: string | null;
    targetUsername: string | null;
    anchorChannelId: string | null;
    moveTimestamps: number[];
}

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Activer le plugin Anti Move",
        default: true
    },
    autoReconnectDelay: {
        type: OptionType.NUMBER,
        description: "DÃ©lai avant de reconnecter l'utilisateur (en ms)",
        default: 1000,
        min: 0,
        max: 5000
    },
    rateLimitMaxMoves: {
        type: OptionType.NUMBER,
        description: "Nombre max de dÃ©placements autorisÃ©s (Accroche)",
        default: 5,
        min: 1,
        max: 50
    },
    rateLimitTimeWindow: {
        type: OptionType.NUMBER,
        description: "FenÃªtre de temps pour la limite (en minutes)",
        default: 1,
        min: 1,
        max: 60
    }
});

let activeState: AntiMoveState = { mode: null, targetId: null, targetUsername: null, anchorChannelId: null, moveTimestamps: [] };

function log(message: string, level: "info" | "warn" | "error" = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[Anti Move ${timestamp}]`;
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
        log(`âœ… Utilisateur ${userId} replacÃ© dans le canal ${channelId}`);
    } catch (error) {
        log(`Erreur de dÃ©placement: ${error}`, "error");
    }
}

async function activerAntiMove(mode: 'accroche' | 'ancre', userId: string, username: string) {
    const currentUserId = UserStore.getCurrentUser()?.id;
    const userVoiceState = VoiceStateStore.getVoiceStateForUser(userId);
    const myVoiceState = VoiceStateStore.getVoiceStateForUser(currentUserId);
    
    let targetChannelId = null;
    if (mode === 'accroche') {
        if (!myVoiceState?.channelId) {
            showNotification({ title: "Anti Move", body: "Vous devez Ãªtre dans un salon vocal pour utiliser l'accroche." });
            return;
        }
        targetChannelId = myVoiceState.channelId;
    } else {
        if (!userVoiceState?.channelId) {
            showNotification({ title: "Anti Move", body: `${username} n'est pas dans un salon vocal.` });
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

    const modeName = mode === 'accroche' ? "Antimove" : "Ancrage";
    log(`âœ… ${modeName} activÃ© pour/sur ${username}`);
    showNotification({ title: `Anti Move`, body: `${modeName} activÃ© sur ${username}` });
}

function desactiverAntiMove() {
    if (!activeState.mode) return;
    const modeName = activeState.mode === 'accroche' ? "Antimove" : "Ancrage";
    const username = activeState.targetUsername;
    
    activeState = { mode: null, targetId: null, targetUsername: null, anchorChannelId: null, moveTimestamps: [] };
    log(`ðŸ”“ ${modeName} dÃ©sactivÃ©`);
    showNotification({ title: `Anti Move`, body: `${modeName} dÃ©sactivÃ© pour ${username}` });
}

const UserContextMenuPatch: NavContextMenuPatchCallback = (children, { user }: { user: any; }) => {
    if (!settings.store.enabled || !user) return;

    const currentUser = UserStore.getCurrentUser();
    if (!currentUser) return;

    const isMe = user.id === currentUser.id;
    const isCurrentlyAccroche = activeState.mode === 'accroche' && activeState.targetId === user.id;
    const isCurrentlyAncre = activeState.mode === 'ancre' && activeState.targetId === user.id;

    if (!isMe) {
        children.push(
            React.createElement(Menu.MenuSeparator, {}),
            React.createElement(Menu.MenuItem, {
                id: "antimove-accroche",
                label: isCurrentlyAccroche ? `ðŸ”“ DÃ©sactiver Antimove (${user.username})` : `ðŸ”— Antimove ${user.username}`,
                action: async () => {
                    if (isCurrentlyAccroche) desactiverAntiMove();
                    else await activerAntiMove('accroche', user.id, user.username);
                }
            }),
            React.createElement(Menu.MenuItem, {
                id: "antimove-ancre",
                label: isCurrentlyAncre ? `ðŸ”“ Se dÃ©sancrer (${user.username})` : `âš“ S'ancrer Ã  ${user.username}`,
                action: async () => {
                    if (isCurrentlyAncre) desactiverAntiMove();
                    else await activerAntiMove('ancre', user.id, user.username);
                }
            })
        );
    }
};

export default definePlugin({
    name: "Anti Move",
    description: "EmpÃªche les dÃ©placements vocaux non dÃ©sirÃ©s via les modes Accroche et Ancre",
    authors: [{ name: "Flocord", id: 0n }],
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

                if (activeState.mode === 'accroche' && activeState.anchorChannelId) {
                    // Accroche (Antimove) : La cible doit rester avec moi.
                    if (userId === activeState.targetId && channelId !== activeState.anchorChannelId) {
                        const now = Date.now();
                        const timeWindowMs = settings.store.rateLimitTimeWindow * 60000;
                        
                        // Nettoyer les anciens timestamps
                        activeState.moveTimestamps = activeState.moveTimestamps.filter(t => now - t < timeWindowMs);
                        
                        if (activeState.moveTimestamps.length >= settings.store.rateLimitMaxMoves) {
                            showNotification({ title: "Anti Move", body: `Limite de dÃ©placements atteinte pour ${activeState.targetUsername}. L'accroche est dÃ©sactivÃ©e pour Ã©viter le spam.` });
                            desactiverAntiMove();
                            return;
                        }
                        
                        activeState.moveTimestamps.push(now);

                        // La cible s'Ã©loigne -> on la ramÃ¨ne
                        setTimeout(() => {
                            moveUserToVoiceChannel(userId, activeState.anchorChannelId!).catch(() => {});
                        }, settings.store.autoReconnectDelay);
                    } else if (userId === currentUserId && channelId !== activeState.anchorChannelId) {
                        // Je me dÃ©place (ou suis dÃ©placÃ©) -> la cible me suit
                        activeState.anchorChannelId = channelId;
                        setTimeout(() => {
                            moveUserToVoiceChannel(activeState.targetId!, channelId).catch(() => {});
                        }, settings.store.autoReconnectDelay);
                    }
                } else if (activeState.mode === 'ancre' && activeState.anchorChannelId) {
                    // Ancre (S'ancrer Ã ) : Je reste dans le salon dÃ©fini Ã  l'activation.
                    // Je ne suis pas la cible si elle bouge (pas de conflit avec followVoiceUser).
                    if (userId === currentUserId && channelId !== activeState.anchorChannelId) {
                        // J'ai Ã©tÃ© dÃ©placÃ© -> je retourne au salon ancrÃ©
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
        log("ðŸš€ Plugin Anti Move dÃ©marrÃ©");
    },

    stop() {
        desactiverAntiMove();
        log("ðŸ›‘ Plugin Anti Move arrÃªtÃ©");
    }
});
