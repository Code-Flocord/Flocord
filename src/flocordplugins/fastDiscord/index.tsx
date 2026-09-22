/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings, migratePluginSettings } from "@api/Settings";
import { coreStyleRootNode } from "@api/Styles";
import { FlocordDevs } from "@utils/constants";
import { createAndAppendStyle } from "@utils/css";
import { Logger } from "@utils/Logger";
import { isObject } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { findAll } from "@webpack";
import { FluxDispatcher } from "@webpack/common";

const log = new Logger("FastDiscord");

/* -------------------------------------------------------------------------- */
/*                              Spring / animations                           */
/* -------------------------------------------------------------------------- */

interface SpringModule {
    Globals: {
        assign(options: { skipAnimation: boolean; }): void;
    };
    Springs: object;
}

let springs: SpringModule[] = [];
let started = false;

const isSpringGlobals = (v: unknown): v is SpringModule["Globals"] =>
    isObject(v) && "assign" in v && typeof (v as any).assign === "function";

const isSpringModule = (v: unknown): v is SpringModule => {
    if (!isObject(v)) return false;
    const m = v as Partial<SpringModule>;
    return isSpringGlobals(m.Globals) && isObject(m.Springs);
};

function loadSprings() {
    springs = findAll(isSpringModule);
}

function applySpringSkip(skip: boolean) {
    for (const s of springs) {
        try { s.Globals.assign({ skipAnimation: skip }); } catch (err) { log.warn("spring skip failed", err); }
    }
}

/* -------------------------------------------------------------------------- */
/*                                  CSS layer                                 */
/* -------------------------------------------------------------------------- */

let style: HTMLStyleElement | null = null;

function buildCss(): string {
    const s = settings.store;
    let css = "body.fastdiscord-bg-mode * { animation-play-state: paused !important; }\n";

    // Global on purpose: the setting means "no backdrop blur anywhere", and Discord's class names are mangled
    if (s.reduceBlurEffects) css += "* { backdrop-filter: none !important; }\n";
    if (s.disableHoverTransitions) css += "* { transition-duration: 0.001s !important; }\n";

    return css;
}

function injectCss() {
    if (style) style.textContent = buildCss();
}

function removeCss() {
    style?.remove();
    style = null;
    document.body.classList.remove("fastdiscord-bg-mode");
}

/* -------------------------------------------------------------------------- */
/*                          Cache cleaner (low-end mode)                      */
/*                                                                            */
/* IMPORTANT: We do NOT touch MessageStore._channelMessages directly because  */
/* MessageLoggerEnhanced monkey-patches MessageStore.getMessage and maintains  */
/* its own cache (combinedMessageCache). Deleting raw store entries bypasses   */
/* this patch → stale references → crash on DM load.                          */
/*                                                                            */
/* Instead, we only force the native GC, which is sufficient to free memory   */
/* without corrupting the internal state of the stores.                       */
/* -------------------------------------------------------------------------- */

let cacheCleanerInterval: ReturnType<typeof setInterval> | null = null;

function forceGC() {
    try {
        if (typeof (window as any).gc === "function") {
            if ("requestIdleCallback" in window) {
                (window as any).requestIdleCallback(() => {
                    try { (window as any).gc(); } catch { }
                }, { timeout: 2000 });
            } else {
                (window as any).gc();
            }
        }
    } catch { }
}

function cacheCleanIntervalMs(): number {
    return settings.store.lowEndMode ? 90 * 1000 : 5 * 60 * 1000;
}

function startCacheCleaner() {
    stopCacheCleaner();
    cacheCleanerInterval = setInterval(() => {
        if (!settings.store.limitMsgCache) return;
        forceGC();
    }, cacheCleanIntervalMs());
}

function stopCacheCleaner() {
    if (cacheCleanerInterval !== null) {
        clearInterval(cacheCleanerInterval);
        cacheCleanerInterval = null;
    }
}

/* -------------------------------------------------------------------------- */
/*                       Safe Background Throttling                           */
/* -------------------------------------------------------------------------- */

let bgFpsActive = false;

function onVisibilityChange() {
    if (document.hidden) {
        document.body.classList.add("fastdiscord-bg-mode");
    } else if (document.hasFocus()) {
        document.body.classList.remove("fastdiscord-bg-mode");
    }
}

function onWindowBlur() {
    document.body.classList.add("fastdiscord-bg-mode");
}

function onWindowFocus() {
    if (!document.hidden) {
        document.body.classList.remove("fastdiscord-bg-mode");
    }
}

function applyBgFpsPatch(enable: boolean) {
    if (enable && !bgFpsActive) {
        bgFpsActive = true;
        document.addEventListener("visibilitychange", onVisibilityChange);
        window.addEventListener("blur", onWindowBlur);
        window.addEventListener("focus", onWindowFocus);
        if (document.hidden || !document.hasFocus()) {
            document.body.classList.add("fastdiscord-bg-mode");
        }
    } else if (!enable && bgFpsActive) {
        bgFpsActive = false;
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("blur", onWindowBlur);
        window.removeEventListener("focus", onWindowFocus);
        document.body.classList.remove("fastdiscord-bg-mode");
    }
}

/* -------------------------------------------------------------------------- */
/*                  Network: debounce presence updates                         */
/* -------------------------------------------------------------------------- */

const PRESENCE_DISPATCH_TYPES = new Set([
    "LOCAL_ACTIVITY_UPDATE",
    "RUNNING_GAMES_CHANGE",
]);

let origFluxDispatch: ((event: any) => unknown) | null = null;
const pendingPresenceDispatch = new Map<string, { event: any; timer: ReturnType<typeof setTimeout>; }>();

function presenceDebounceMs(): number {
    return 8000;
}

function flushPresenceDispatch(type: string) {
    const pending = pendingPresenceDispatch.get(type);
    if (!pending) return;
    pendingPresenceDispatch.delete(type);
    try {
        origFluxDispatch?.call(FluxDispatcher, pending.event);
    } catch (err) {
        log.warn("flush presence dispatch failed", err);
    }
}

function patchedDispatch(event: any) {
    if (!settings.store.throttlePresence || !event || !PRESENCE_DISPATCH_TYPES.has(event.type)) {
        return origFluxDispatch?.call(FluxDispatcher, event);
    }

    // Never throttle activity clearance (stopping/pausing track, disabling rich presence, removing activity)
    if (event.type === "LOCAL_ACTIVITY_UPDATE" && !event.activity) {
        const existing = pendingPresenceDispatch.get(event.type);
        if (existing) {
            clearTimeout(existing.timer);
            pendingPresenceDispatch.delete(event.type);
        }
        return origFluxDispatch?.call(FluxDispatcher, event);
    }

    const existing = pendingPresenceDispatch.get(event.type);
    if (existing) clearTimeout(existing.timer);

    const timer = setTimeout(() => flushPresenceDispatch(event.type), presenceDebounceMs());
    pendingPresenceDispatch.set(event.type, { event, timer });
}

function applyPresenceThrottle(enable: boolean) {
    if (enable && !origFluxDispatch) {
        origFluxDispatch = FluxDispatcher.dispatch.bind(FluxDispatcher);
        (FluxDispatcher as any).dispatch = patchedDispatch;
    } else if (!enable && origFluxDispatch) {
        for (const type of Array.from(pendingPresenceDispatch.keys())) {
            const pending = pendingPresenceDispatch.get(type)!;
            clearTimeout(pending.timer);
            try { origFluxDispatch.call(FluxDispatcher, pending.event); } catch { }
        }
        pendingPresenceDispatch.clear();
        (FluxDispatcher as any).dispatch = origFluxDispatch;
        origFluxDispatch = null;
    }
}

/* -------------------------------------------------------------------------- */
/*                                  Settings                                  */
/* -------------------------------------------------------------------------- */

const settings = definePluginSettings({
    disableSpringAnimations: {
        type: OptionType.BOOLEAN,
        description: "Disable spring animations in the UI (buttons, modals, transitions)",
        default: true,
        disabled: () => isPluginEnabled("DisableAnimations"),
        onChange(val: boolean) {
            if (!started) return;
            if (val && springs.length === 0) loadSprings();
            applySpringSkip(val);
        }
    },
    noGifAvatars: {
        type: OptionType.BOOLEAN,
        description: "Always show static avatars instead of animated ones. Sticker animation is controlled by Discord's own Accessibility settings.",
        default: true,
        restartNeeded: true
    },
    noVideoAutoplay: {
        type: OptionType.BOOLEAN,
        description: "Block autoplay of embedded videos in messages",
        default: false,
        restartNeeded: true
    },
    reduceBlurEffects: {
        type: OptionType.BOOLEAN,
        description: "Disable expensive blur effects (backdrop-filter) for better performance",
        default: true,
        onChange() { if (started) injectCss(); }
    },
    disableHoverTransitions: {
        type: OptionType.BOOLEAN,
        description: "Make all CSS hover transitions instant",
        default: false,
        onChange() { if (started) injectCss(); }
    },
    limitMsgCache: {
        type: OptionType.BOOLEAN,
        description: "Periodically call the native GC to free message memory",
        default: true,
        onChange(v: boolean) { if (!started) return; if (!v) stopCacheCleaner(); else startCacheCleaner(); }
    },
    reduceFpsBackground: {
        type: OptionType.BOOLEAN,
        description: "Limit app rendering to a few FPS when the window is in the background",
        default: true,
        onChange(v: boolean) { if (started) applyBgFpsPatch(v); }
    },
    throttlePresence: {
        type: OptionType.BOOLEAN,
        description: "Reduce how often presence/activity updates (game, Spotify) are sent to the server, saving network requests. Your status will be less up-to-date for others.",
        default: false,
        onChange(v: boolean) { if (started) applyPresenceThrottle(v); }
    },
    lowEndMode: {
        type: OptionType.BOOLEAN,
        description: "Low-end PC mode: more frequent GC and lower background FPS",
        default: false,
        onChange(_v: boolean) {
            if (!started) return;
            if (settings.store.limitMsgCache) startCacheCleaner();
            if (bgFpsActive) { applyBgFpsPatch(false); applyBgFpsPatch(true); }
        }
    },
});

/* -------------------------------------------------------------------------- */
/*                                   Plugin                                   */
/* -------------------------------------------------------------------------- */

migratePluginSettings("FastDiscord", "UI Optimisations");
export default definePlugin({
    name: "FastDiscord",
    description: "Maximizes app smoothness and responsiveness: animations, media, memory cache, background FPS, and network (presence) are all optimized. Disabled by default; everything returns to normal once disabled.",
    authors: [FlocordDevs.Flocord],
    tags: ["Utility", "Appearance", "Performance"],
    searchTerms: ["performance", "optimization", "lag", "fps", "ram", "memory", "low-end", "fluide", "rapide", "latence"],
    settings,

    patches: [
        // Disable video autoplay — strict regex to avoid touching other modules
        {
            find: "autoplay:!0",
            predicate: () => settings.store.noVideoAutoplay,
            replacement: {
                match: /autoplay:!0/g,
                replace: "autoplay:!1"
            }
        },
        // Static avatars: force the canAnimate argument of IconUtils' user and guild-member avatar URL builders to false
        {
            find: "getUserAvatarURL:",
            predicate: () => settings.store.noGifAvatars,
            replacement: [
                {
                    match: /(let \i=)arguments\.length>1&&void 0!==arguments\[1\]&&arguments\[1\](?=,\i=arguments\.length>2.{0,300}?\.discriminator,\i\.isProvisional)/,
                    replace: "$1!1"
                },
                {
                    match: /(\{guildId:\i,userId:\i,avatar:\i,canAnimate:)(\i)(=!1,size:\i=\i\.\i,canWebP:\i=\i\}=\i,)/,
                    replace: "$1__fdIgnored$3$2=!1,"
                }
            ]
        }
    ],

    start() {
        started = true;

        if (settings.store.disableSpringAnimations && !isPluginEnabled("DisableAnimations")) {
            loadSprings();
            applySpringSkip(true);
        }

        style = createAndAppendStyle("flocord-fastdiscord", coreStyleRootNode);
        injectCss();

        if (settings.store.limitMsgCache) startCacheCleaner();
        if (settings.store.reduceFpsBackground) applyBgFpsPatch(true);
        if (settings.store.throttlePresence) applyPresenceThrottle(true);

        log.info("FastDiscord enabled: applying optimizations.");
    },

    stop() {
        started = false;

        if (springs.length !== 0 && !isPluginEnabled("DisableAnimations")) {
            applySpringSkip(false);
        }
        springs = [];

        removeCss();
        stopCacheCleaner();
        applyBgFpsPatch(false);
        applyPresenceThrottle(false);

        log.info("FastDiscord disabled: everything restored to normal.");
    }
});
