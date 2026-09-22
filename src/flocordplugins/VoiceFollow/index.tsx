/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { FlocordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, FluxDispatcher, Menu, PermissionsBits, PermissionStore, showToast, Toasts, UserStore, VoiceStateStore } from "@webpack/common";

const ChannelActions = findByPropsLazy("selectVoiceChannel");

interface VoiceStateUpdate {
    userId: string;
    channelId: string | null;
}

interface VoiceStateUpdateEvent {
    voiceStates: VoiceStateUpdate[];
}

/** The followed user is tracked wherever they go: no guild is pinned. */
let followedUserId: string | null = null;

/**
 * A guild channel needs the permissions to see and connect to it. A DM or group call needs nothing:
 * a private channel we are not part of never reaches the channel store in the first place.
 */
function canJoin(channelId: string): boolean {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return false;
    if (!channel.guild_id) return true;

    return PermissionStore.can(PermissionsBits.VIEW_CHANNEL | PermissionsBits.CONNECT, channel);
}

function myChannelId(): string | null {
    const me = UserStore.getCurrentUser();
    if (!me) return null;
    return VoiceStateStore.getVoiceStateForUser(me.id)?.channelId ?? null;
}

function join(channelId: string) {
    const current = myChannelId();
    if (current === channelId) return;

    if (!canJoin(channelId)) {
        if (settings.store.disconnectOnInaccessible && current) ChannelActions.selectVoiceChannel(null);
        return;
    }

    ChannelActions.selectVoiceChannel(channelId);
}

function handleVoiceStateUpdates({ voiceStates }: VoiceStateUpdateEvent) {
    if (!followedUserId) return;

    for (const state of voiceStates) {
        if (state.userId !== followedUserId) continue;
        // They hung up: we stay where we are rather than being dragged out
        if (!state.channelId) continue;

        join(state.channelId);
        break;
    }
}

const userContextPatch: NavContextMenuPatchCallback = (children, { user }) => {
    if (!user || user.id === UserStore.getCurrentUser()?.id) return;

    const isFollowed = followedUserId === user.id;

    children.push(
        <Menu.MenuItem
            id="flocord-voice-follow"
            label={isFollowed ? "Stop following in voice" : "Follow in voice"}
            action={() => {
                if (isFollowed) {
                    followedUserId = null;
                    showToast("No longer following in voice.", Toasts.Type.MESSAGE);
                    return;
                }

                followedUserId = user.id;
                showToast(`Following ${user.username} in voice, across servers and DMs.`, Toasts.Type.SUCCESS);

                // Catch up straight away when they are already in a call
                const currentChannel = VoiceStateStore.getVoiceStateForUser(user.id)?.channelId;
                if (currentChannel) join(currentChannel);
            }}
        />
    );
};

const settings = definePluginSettings({
    disconnectOnInaccessible: {
        type: OptionType.BOOLEAN,
        description: "Disconnect from voice if the channel the followed user joined is one you cannot join.",
        default: false,
    },
});

export default definePlugin({
    name: "VoiceFollow",
    description: "Follows a user into every voice channel they join, in any server and in DM or group calls. No friendship required.",
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
    },
});
