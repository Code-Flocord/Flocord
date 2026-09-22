/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationStreamingStore, UserStore } from "@webpack/common";

export function isCurrentUserStreaming() {
    const me = UserStore.getCurrentUser()?.id;
    if (!me) return false;

    if (ApplicationStreamingStore.getActiveStreamForUser(me)) return true;
    return ApplicationStreamingStore.getAllActiveStreams().some(s => s.ownerId === me);
}
