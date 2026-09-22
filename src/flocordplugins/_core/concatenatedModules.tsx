/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Icon } from "@vencord/discord-types";

export type IconsDef = Record<string, Icon>;

export let iconsModule: IconsDef;

export default definePlugin({
    name: "ConcatenatedModules",
    description: "Extract modules that have been concatenated by the bundler",
    authors: [Devs.thororen],
    patches: [
        {
            find: "AngleBracketsIcon",
            replacement: {
                match: /\i\.\i\((\i)\),\i\.\i\(\i,\{AIcon/,
                replace: "$self.setIconsModule($1),$&"
            }
        }
    ],
    setIconsModule(value: IconsDef) {
        iconsModule = value;
        this.iconsModule = value;
    },
});
