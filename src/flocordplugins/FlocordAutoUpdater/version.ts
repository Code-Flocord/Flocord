/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const FLOCORD_VERSION = "2.9.3";

export function versionGt(a: string, b: string) {
    const [a1 = 0, a2 = 0, a3 = 0] = a.split(".").map(Number);
    const [b1 = 0, b2 = 0, b3 = 0] = b.split(".").map(Number);
    return a1 !== b1 ? a1 > b1 : a2 !== b2 ? a2 > b2 : a3 > b3;
}
