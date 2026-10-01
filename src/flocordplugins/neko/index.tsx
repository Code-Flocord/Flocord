/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { FlocordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

import { mountNeko, unmountNeko } from "./cat";

const settings = definePluginSettings({
    size: {
        type: OptionType.SLIDER,
        description: "Size of the cat, in pixels.",
        markers: [24, 32, 40, 48, 64],
        default: 36,
        stickToMarkers: false,
        onChange: () => {
            unmountNeko();
            mountNeko(settings.store.size);
        }
    }
});

export default definePlugin({
    name: "Neko",
    description: "A little cat that follows your cursor around.",
    authors: [FlocordDevs.Flocord],
    tags: ["Fun", "Appearance"],
    settings,

    start() {
        mountNeko(settings.store.size);
    },

    stop() {
        unmountNeko();
    }
});
