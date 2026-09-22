/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { FlocordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { showToast, Toasts, UserStore } from "@webpack/common";

const VoiceStateStore = findStoreLazy("VoiceStateStore");
const MediaEngineStore = findStoreLazy("MediaEngineStore");

type VoiceState = {
    userId: string;
    channelId?: string | null;
    oldChannelId?: string | null;
};

type NormalizeMode = "target" | "average";

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable automatic normalization.",
        default: true
    },
    normalizeMode: {
        type: OptionType.SELECT,
        description: "Mode de normalisation",
        options: [
            { label: "Target volume", value: "target", default: true },
            { label: "Channel average", value: "average" }
        ]
    },
    targetVolume: {
        type: OptionType.NUMBER,
        description: "Target volume (0-200%).",
        default: 100,
        min: 0,
        max: 200
    },
    applyOnJoin: {
        type: OptionType.BOOLEAN,
        description: "Apply when a member joins the channel.",
        default: true
    },
    reapplyIntervalSec: {
        type: OptionType.NUMBER,
        description: "Re-apply every X seconds (0 to disable).",
        default: 15,
        min: 0,
        max: 300
    },
    restoreOnLeave: {
        type: OptionType.BOOLEAN,
        description: "Restore the original volume when a member leaves the channel.",
        default: true
    },
    restoreOnStop: {
        type: OptionType.BOOLEAN,
        description: "Restore volumes when the plugin stops.",
        default: true
    },
    showToast: {
        type: OptionType.BOOLEAN,
        description: "Show a notification after a manual normalization.",
        default: true
    },
    debugMode: {
        type: OptionType.BOOLEAN,
        description: "Show debug logs in the console.",
        default: false
    }
});

const originalVolumes = new Map<string, number>();
let reapplyTimer: NodeJS.Timeout | null = null;
let warnedMissingSetter = false;

function clampVolume(volume: number): number {
    return Math.max(0, Math.min(200, Math.round(volume)));
}

function debugLog(message: string) {
    if (!settings.store.debugMode) return;
    console.log("[NormaliserVolume]", message);
}

function getCurrentVoiceChannelId(): string | null {
    const currentUser = UserStore.getCurrentUser();
    if (!currentUser) return null;

    const voiceState = VoiceStateStore?.getVoiceStateForUser?.(currentUser.id);
    return voiceState?.channelId ?? null;
}

function getChannelUserIds(channelId: string): string[] {
    if (!VoiceStateStore) return [];

    if (typeof VoiceStateStore.getVoiceStatesForChannel === "function") {
        const states = VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {};
        return Object.keys(states);
    }

    if (typeof VoiceStateStore.getVoiceStates === "function") {
        const states = VoiceStateStore.getVoiceStates() ?? {};
        return Object.keys(states).filter(userId => states[userId]?.channelId === channelId);
    }

    return [];
}

function getUserVolume(userId: string): number | null {
    try {
        if (MediaEngineStore?.getLocalVolume) {
            const value = MediaEngineStore.getLocalVolume(userId);
            return typeof value === "number" ? value : null;
        }
    } catch (error) {
        console.warn("[NormaliserVolume] getUserVolume failed", error);
    }

    return null;
}

function setUserVolume(userId: string, volume: number): boolean {
    const clamped = clampVolume(volume);

    try {
        const mediaEngine = MediaEngineStore?.getMediaEngine?.();
        if (mediaEngine?.setLocalVolume) {
            mediaEngine.setLocalVolume(userId, clamped);
            return true;
        }

        if (mediaEngine?.connections?.forEach) {
            mediaEngine.connections.forEach((connection: any) => {
                connection?.setLocalVolume?.(userId, clamped);
            });
            return true;
        }
    } catch (error) {
        console.warn("[NormaliserVolume] setUserVolume failed", error);
    }

    if (!warnedMissingSetter) {
        warnedMissingSetter = true;
        showToast("Could not set the local volume (API not found)", Toasts.Type.FAILURE);
    }
    return false;
}

function getTargetVolume(userIds: string[]): number {
    const mode = settings.store.normalizeMode as NormalizeMode;
    if (mode !== "average") {
        return clampVolume(settings.store.targetVolume);
    }

    const volumes: number[] = [];
    for (const userId of userIds) {
        const volume = getUserVolume(userId);
        if (typeof volume === "number") volumes.push(volume);
    }

    if (!volumes.length) {
        return clampVolume(settings.store.targetVolume);
    }

    const sum = volumes.reduce((acc, value) => acc + value, 0);
    return clampVolume(sum / volumes.length);
}

function normalizeUser(userId: string, targetVolume: number) {
    const current = getUserVolume(userId);
    if (!originalVolumes.has(userId)) {
        originalVolumes.set(userId, typeof current === "number" ? current : 100);
    }

    if (typeof current === "number" && current === targetVolume) return;
    setUserVolume(userId, targetVolume);
}

function normalizeChannel(channelId: string) {
    if (!settings.store.enabled) return;

    const userIds = getChannelUserIds(channelId);
    if (!userIds.length) return;

    const currentUser = UserStore.getCurrentUser();
    const target = getTargetVolume(userIds);

    debugLog(`Normalizing channel ${channelId} -> ${target}% (${userIds.length} members)`);

    for (const userId of userIds) {
        if (currentUser && userId === currentUser.id) continue;
        normalizeUser(userId, target);
    }
}

function restoreUser(userId: string) {
    if (!originalVolumes.has(userId)) return;
    const previous = originalVolumes.get(userId) ?? 100;
    setUserVolume(userId, previous);
    originalVolumes.delete(userId);
}

function restoreAll() {
    debugLog(`Restoring volumes (${originalVolumes.size} members)`);
    originalVolumes.forEach((volume, userId) => {
        setUserVolume(userId, volume);
    });
    originalVolumes.clear();
}

function normalizeCurrentChannel(showFeedback = false) {
    const channelId = getCurrentVoiceChannelId();
    if (!channelId) {
        debugLog("No active voice channel to normalize");
        if (showFeedback) showToast("No active voice channel", Toasts.Type.MESSAGE);
        return;
    }

    normalizeChannel(channelId);

    if (showFeedback && settings.store.showToast) {
        showToast("Volumes normalized for the current channel", Toasts.Type.SUCCESS);
    }
}

function refreshInterval() {
    if (reapplyTimer) {
        clearInterval(reapplyTimer);
        reapplyTimer = null;
    }

    const intervalSec = Math.max(0, settings.store.reapplyIntervalSec);
    if (!intervalSec) return;

    debugLog(`Re-applying every ${intervalSec} seconds`);

    reapplyTimer = setInterval(() => {
        if (!settings.store.enabled) return;
        const channelId = getCurrentVoiceChannelId();
        if (!channelId) return;
        normalizeChannel(channelId);
    }, intervalSec * 1000);
}

function handleVoiceStateUpdates(voiceStates: VoiceState[]) {
    const currentUser = UserStore.getCurrentUser();
    if (!currentUser) return;

    const currentChannelId = getCurrentVoiceChannelId();

    for (const state of voiceStates) {
        if (state.userId === currentUser.id) {
            if (state.oldChannelId && state.oldChannelId !== state.channelId) {
                if (settings.store.restoreOnLeave) restoreAll();
            }

            if (state.channelId && state.oldChannelId !== state.channelId) {
                normalizeChannel(state.channelId);
            }

            continue;
        }

        if (settings.store.applyOnJoin && state.channelId && state.channelId === currentChannelId) {
            const target = getTargetVolume(getChannelUserIds(state.channelId));
            normalizeUser(state.userId, target);
        }

        if (
            settings.store.restoreOnLeave
            && state.oldChannelId
            && state.oldChannelId === currentChannelId
            && state.channelId !== currentChannelId
        ) {
            restoreUser(state.userId);
        }
    }
}

export default definePlugin({
    name: "NormaliserVolume",
    description: "Automatically normalizes the volume of everyone in your current voice channel.",
    authors: [FlocordDevs.Flocord],
    settings,

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[] }) {
            if (!settings.store.enabled) return;
            handleVoiceStateUpdates(voiceStates);
        }
    },

    toolboxActions: {
        "Normalize voice channel": () => normalizeCurrentChannel(true)
    },

    start() {
        refreshInterval();
        normalizeCurrentChannel(false);
    },

    stop() {
        if (reapplyTimer) {
            clearInterval(reapplyTimer);
            reapplyTimer = null;
        }

        if (settings.store.restoreOnStop) {
            restoreAll();
        }
    }
});
