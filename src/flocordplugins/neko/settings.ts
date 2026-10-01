/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    size: {
        type: OptionType.SLIDER,
        description: "Size of the cat, in pixels.",
        markers: [24, 32, 40, 48, 64],
        default: 36,
        stickToMarkers: false
    }
});
