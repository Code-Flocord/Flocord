/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { FlocordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    stereochannel: {
        description: "Stereo Channel",
        type: OptionType.SELECT,
        options: [
            { label: "1.0 Mono", value: 1 },
            { label: "2.0 Stereo", value: 2 },
            { label: "7.1 Surround", value: 7.1, default: true },
        ],
    }
});

export default definePlugin({
    name: "EnableStereo",
    description: "Allows the use of stereo and surround sound in voice chats. Note: Requires restart after every change. Noise suppression and Echo Cancellation must be disabled for it to work correctly!",
    authors: [FlocordDevs.rattles],
    settings,
    patches: [
        {
            // primary Opus codec config: {type,name,freq:48e3,pacsize:960,channels:1,rate:64e3}
            find: "Audio codecs",
            replacement: {
                match: /channels:1,(?=rate:)/,
                replace: () => {
                    const channels = settings.store.stereochannel;
                    return `channels:${channels},params:{stereo:"${channels}"},`;
                }
            }
        }
    ]
});
