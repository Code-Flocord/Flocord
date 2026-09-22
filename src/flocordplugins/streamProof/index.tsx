/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { coreStyleRootNode } from "@api/Styles";
import { isCurrentUserStreaming } from "@flocordplugins/_utils/streaming";
import { FlocordDevs } from "@utils/constants";
import { createAndAppendStyle } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { ApplicationStreamingStore, useStateFromStores } from "@webpack/common";

const settings = definePluginSettings({
    hideSettingsSection: {
        type: OptionType.BOOLEAN,
        description: "Hide the Flocord section in Discord settings while you are streaming.",
        default: true
    },
    hideToolboxButton: {
        type: OptionType.BOOLEAN,
        description: "Hide the Flocord Toolbox button in the channel header while you are streaming.",
        default: true
    },
    customSelectors: {
        type: OptionType.STRING,
        description: "Extra CSS selectors to hide while streaming, separated by commas.",
        default: ""
    }
});

let customStyle: HTMLStyleElement | null = null;

export function shouldHideSettingsSection() {
    return isPluginEnabled("StreamProof") && settings.store.hideSettingsSection && isCurrentUserStreaming();
}

export function useShouldHideToolbox() {
    return useStateFromStores(
        [ApplicationStreamingStore],
        () => isPluginEnabled("StreamProof") && settings.store.hideToolboxButton && isCurrentUserStreaming()
    );
}

function applyCustomSelectors() {
    if (!customStyle) return;

    const selectors = settings.store.customSelectors
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
        .join(", ");

    customStyle.textContent = selectors && isCurrentUserStreaming()
        ? `${selectors} { display: none !important; }`
        : "";
}

export default definePlugin({
    name: "StreamProof",
    description: "Hides Flocord from Discord's settings and header while you are streaming, so viewers never see it.",
    authors: [FlocordDevs.Flocord],
    tags: ["Privacy"],
    settings,

    flux: {
        STREAM_CREATE: applyCustomSelectors,
        STREAM_START: applyCustomSelectors,
        STREAM_UPDATE: applyCustomSelectors,
        STREAM_STOP: applyCustomSelectors,
        STREAM_DELETE: applyCustomSelectors,
        STREAM_CLOSE: applyCustomSelectors
    },

    start() {
        customStyle = createAndAppendStyle("flocord-streamproof", coreStyleRootNode);
        applyCustomSelectors();
    },

    stop() {
        customStyle?.remove();
        customStyle = null;
    }
});
