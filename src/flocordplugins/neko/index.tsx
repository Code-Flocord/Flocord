/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { FlocordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

import { mountNeko, unmountNeko } from "./cat";
import { settings } from "./settings";

export default definePlugin({
    name: "Neko",
    description: "A little cat that follows your cursor around.",
    authors: [FlocordDevs.Flocord],
    tags: ["Fun", "Appearance"],
    settings,

    start() {
        mountNeko();
    },

    stop() {
        unmountNeko();
    }
});
