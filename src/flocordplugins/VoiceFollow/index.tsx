/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addContextMenuPatch, NavContextMenuPatchCallback,removeContextMenuPatch } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { FlocordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, FluxDispatcher, Menu,PermissionsBits, PermissionStore, UserStore, VoiceStateStore } from "@webpack/common";

const ChannelActions = findByPropsLazy("selectVoiceChannel");

interface VoiceStateUpdate {
    userId: string;
    guildId: string | null;
    channelId: string | null;
}

interface VoiceStateUpdateEvent {
    voiceStates: VoiceStateUpdate[];
}

let followedUserId: string | null = null;
let followedGuildId: string | null = null;

function canJoinChannel(channelId: string): boolean {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return false;
    return PermissionStore.can(PermissionsBits.VIEW_CHANNEL | PermissionsBits.CONNECT, channel);
}

function handleVoiceStateUpdates({ voiceStates }: VoiceStateUpdateEvent) {
    if (!followedUserId || !followedGuildId) return;

    for (const state of voiceStates) {
        if (state.userId !== followedUserId) continue;

        if (followedGuildId !== null && state.guildId !== followedGuildId) continue;

        if (!state.channelId) continue;

        const me = UserStore.getCurrentUser();
        const myState = VoiceStateStore.getVoiceStateForUser(me.id);

        if (myState?.channelId === state.channelId) continue;

        const channel = ChannelStore.getChannel(state.channelId);

        if (channel?.guild_id && !canJoinChannel(state.channelId)) {
            if (settings.store.disconnectOnInaccessible && myState?.channelId) {
                ChannelActions.selectVoiceChannel(null);
            }
            continue;
        }

        ChannelActions.selectVoiceChannel(state.channelId);
        break;
    }
}

const userContextPatch: NavContextMenuPatchCallback = (children, { user, guildId }) => {
    if (!user) return;

    const resolvedGuildId = guildId ?? null;
    const isFollowed = followedUserId === user.id && followedGuildId === resolvedGuildId;

    children.push(
        <Menu.MenuItem
            id="flocord-voice-follow"
            label={isFollowed ? "Stop following in voice" : "Follow in voice"}
            action={() => {
                if (isFollowed) {
                    followedUserId = null;
                    followedGuildId = null;
                } else {
                    followedUserId = user.id;
                    followedGuildId = resolvedGuildId;
                }
            }}
        />
    );
};

const settings = definePluginSettings({
    disconnectOnInaccessible: {
        type: OptionType.BOOLEAN,
        description: "Disconnect from voice if the channel the followed user joined is inaccessible.",
        default: false,
    },
});

export default definePlugin({
    name: "VoiceFollow",
    description: "Automatically joins a user's voice channel whenever they move, no friendship required.",
    authors: [FlocordDevs.Flocord],
    settings,

    start() {
        addContextMenuPatch("user-context", userContextPatch);
        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", handleVoiceStateUpdates);
    },

    stop() {
        removeContextMenuPatch("user-context", userContextPatch);
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", handleVoiceStateUpdates);
        followedUserId = null;
        followedGuildId = null;
    },
});
