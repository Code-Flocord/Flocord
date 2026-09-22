/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import * as DataStore from "@api/DataStore";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { coreStyleRootNode } from "@api/Styles";
import { isCurrentUserStreaming } from "@flocordplugins/_utils/streaming";
import { FlocordDevs } from "@utils/constants";
import { createAndAppendStyle } from "@utils/css";
import { getCurrentChannel } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { Menu, SelectedChannelStore } from "@webpack/common";

const DATASTORE_KEY = "StreamBlurPrivacy_BlurredChannels";
const DM = 1;
const GROUP_DM = 3;

const settings = definePluginSettings({
    blurIntensity: {
        type: OptionType.NUMBER,
        description: "Intensity of the blur effect, in pixels.",
        default: 10
    },
    autoBlurOnStream: {
        type: OptionType.BOOLEAN,
        description: "Automatically blur marked conversations while you are streaming.",
        default: true
    },
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show a notification when you mark or unmark a conversation.",
        default: true
    }
});

let blurredChannels = new Set<string>();
let style: HTMLStyleElement | null = null;

function updateBlur() {
    if (!style) return;

    const channelId = SelectedChannelStore.getChannelId();
    const shouldBlur = settings.store.autoBlurOnStream && isCurrentUserStreaming() && channelId != null && blurredChannels.has(channelId);

    style.textContent = shouldBlur
        ? `ol[data-list-id="chat-messages"] { filter: blur(${settings.store.blurIntensity}px); }`
        : "";
}

async function toggleChannel(channel: Channel) {
    const name = channel.name || (channel.type === DM ? "Direct Message" : "Group");
    const wasBlurred = blurredChannels.has(channel.id);

    if (wasBlurred) blurredChannels.delete(channel.id);
    else blurredChannels.add(channel.id);

    await DataStore.set(DATASTORE_KEY, [...blurredChannels]);
    updateBlur();

    if (settings.store.showNotifications) {
        showNotification({
            title: "Stream Blur Privacy",
            body: `Blur ${wasBlurred ? "disabled" : "enabled"} for ${name}.`
        });
    }
}

function getTargetChannel(props: { channel?: Channel; }): Channel | null {
    const candidate = props.channel ?? getCurrentChannel();
    if (!candidate) return null;
    return candidate.type === DM || candidate.type === GROUP_DM ? candidate : null;
}

const contextMenuPatch: NavContextMenuPatchCallback = (children, props: { channel?: Channel; }) => {
    const channel = getTargetChannel(props);
    if (!channel) return;

    const group = findGroupChildrenByChildId(["leave-channel", "close-dm"], children);
    if (!group) return;

    const isBlurred = blurredChannels.has(channel.id);
    group.push(
        <Menu.MenuSeparator />,
        <Menu.MenuItem
            id="stream-blur-privacy-toggle"
            label={isBlurred ? "Stream blur: on" : "Stream blur: off"}
            color={isBlurred ? "brand" : undefined}
            action={() => toggleChannel(channel)}
        />
    );
};

export default definePlugin({
    name: "StreamBlurPrivacy",
    description: "Blurs the messages of selected conversations while you are streaming.",
    authors: [FlocordDevs.Flocord],
    tags: ["Privacy"],
    settings,

    contextMenus: {
        "gdm-context": contextMenuPatch,
        "user-context": contextMenuPatch,
        "user-profile-actions": contextMenuPatch,
        "user-profile-overflow-menu": contextMenuPatch
    },

    flux: {
        STREAM_CREATE: updateBlur,
        STREAM_START: updateBlur,
        STREAM_UPDATE: updateBlur,
        STREAM_STOP: updateBlur,
        STREAM_DELETE: updateBlur,
        STREAM_CLOSE: updateBlur,
        CHANNEL_SELECT: updateBlur
    },

    async start() {
        const stored = await DataStore.get<string[]>(DATASTORE_KEY);
        blurredChannels = new Set(stored ?? []);
        style = createAndAppendStyle("flocord-stream-blur", coreStyleRootNode);
        updateBlur();
    },

    stop() {
        style?.remove();
        style = null;
    }
});
