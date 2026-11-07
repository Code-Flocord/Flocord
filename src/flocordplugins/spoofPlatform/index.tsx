/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { FlocordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { Margins } from "@utils/margins";
import definePlugin, { OptionType, StartAt } from "@utils/types";
import { Forms } from "@webpack/common";

const logger = new Logger("SpoofPlatform", "#7289da");

const QUEST_USER_AGENT = "Mozilla/5.0 (Linux; Android 12L; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/39.2.0.0.56 Chrome/136.0.7103.177 SamsungBrowser/4.0 VR Safari/537.36";
const IOS_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21D61 Discord/263.0";
const ANDROID_USER_AGENT = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Mobile Safari/537.36 Discord/263.0";

interface SpoofConfig {
    label: string;
    /** Fields mixed into the properties of the IDENTIFY / UPDATE PRESENCE gateway packets */
    props: Record<string, string | number>;
}

/**
 * What others see depends on the `properties.browser` field the client sends Discord's gateway in the
 * IDENTIFY packet on connect:
 * - "Discord Client" + os -> desktop icon (Windows/Mac/Linux)
 * - "Chrome" etc -> browser icon
 * - "Discord iOS" / "Discord Android" -> phone icon (+ "sent from iPhone" tag)
 * - "Discord Embedded" -> console status (Xbox/PlayStation icon)
 * - "Discord VR" -> VR headset icon
 * Console and VR need the full field set (browser_user_agent, client_build_number, release_channel) —
 * that's what a real client of that type sends.
 */
const PLATFORMS: Record<string, SpoofConfig> = {
    windows: {
        label: "Desktop — Windows",
        props: { browser: "Discord Client", os: "Windows" },
    },
    macos: {
        label: "Desktop — macOS",
        props: { browser: "Discord Client", os: "Mac" },
    },
    linux: {
        label: "Desktop — Linux",
        props: { browser: "Discord Client", os: "Linux" },
    },
    ios: {
        label: "Phone — iPhone (iOS)",
        props: {
            browser: "Discord iOS",
            os: "iOS",
            os_version: "18.3.2",
            browser_user_agent: IOS_USER_AGENT,
        },
    },
    android: {
        label: "Phone — Android",
        props: {
            browser: "Discord Android",
            os: "Android",
            os_version: "35",
            browser_user_agent: ANDROID_USER_AGENT,
        },
    },
    web: {
        label: "Browser (Chrome)",
        props: { browser: "Chrome" },
    },
    console: {
        label: "Console (Xbox/PlayStation icon)",
        props: {
            browser: "Discord Embedded",
            browser_user_agent: "Discord Embedded/0.0.8",
            browser_version: "0.0.8",
            client_build_number: 4440,
            release_channel: "unknown",
        },
    },
    vr: {
        label: "VR (Quest)",
        props: {
            browser: "Discord VR",
            os: "Android",
            os_version: "12L",
            browser_user_agent: QUEST_USER_AGENT,
        },
    },
};

const settings = definePluginSettings({
    platform: {
        type: OptionType.SELECT,
        description: "Device other people will see on your profile, member list and messages.",
        restartNeeded: true,
        default: "windows",
        options: Object.entries(PLATFORMS).map(([value, p]) => ({
            label: p.label,
            value,
            default: value === "windows",
        })),
    },
});

type WsSend = (this: WebSocket, data: string | ArrayBufferLike | Blob | ArrayBufferView) => void;

let originalWsSend: WsSend | null = null;

const diag = {
    identifyBuiltCount: 0,
    lastIdentifyBuilt: null as string | null,
    fastConnectDisabled: false,
    wsInstalled: false,
    wsFramesRewritten: 0,
    lastWsEvent: null as string | null,
};

function getSpoofProps(source = "patch"): Record<string, string | number> {
    const { platform } = settings.store;
    const conf = PLATFORMS[platform];

    if (source === "patch") {
        diag.identifyBuiltCount++;
        diag.lastIdentifyBuilt = new Date().toLocaleTimeString();
    }

    if (!conf) {
        logger.warn(`[${source}] Unknown platform "${platform}" — no properties mixed in`);
        return {};
    }

    return conf.props;
}

export default definePlugin({
    name: "SpoofPlatform",
    description: "Changes the device icon others see next to your name: desktop, phone, browser, console or VR.",
    authors: [FlocordDevs.Flocord],
    tags: ["Appearance"],
    settings,

    // Starts as early as possible — before Discord's "fast connect" early script — otherwise the
    // IDENTIFY packet goes out before our patch gets a chance to touch it.
    startAt: StartAt.Init,

    getSpoofProps,

    patches: [
        {
            // Main mechanism: patches IDENTIFY packet assembly in the gateway manager. Webpack patches
            // apply when the module loads, which is guaranteed to be before the packet is sent, so the
            // spoof is in place for the very first connection.
            find: "_doIdentify(){",
            replacement: {
                match: /(\[IDENTIFY\].*let.{0,5}=\{.*properties:)(.*),presence/,
                replace: "$1{...$2,...$self.getSpoofProps()},presence"
            }
        }
    ],

    start() {
        if (originalWsSend) return;

        /**
         * Discord uses "fast connect": an early script opens the gateway WebSocket before the main code
         * loads, stores it on window._ws, and the IDENTIFY packet goes out through it — bypassing our
         * patch — in binary ETF encoding. We start before that script runs, so we just neutralise
         * window._ws: without it fast-connect bails out immediately and the client connects the normal
         * way through _doIdentify, which we do patch. The cost is a slightly slower initial connection.
         */
        const closeWs = (v: unknown) => {
            try {
                (v as { ws?: { close?: () => void; }; })?.ws?.close?.();
            } catch { /* already closed, doesn't matter */ }
        };

        const w = window as unknown as Record<string, unknown>;
        if (w._ws != null) {
            closeWs(w._ws);
            delete w._ws;
        }

        Object.defineProperty(window, "_ws", {
            configurable: true,
            set(v) {
                closeWs(v);
            },
            get() {
                return undefined;
            }
        });
        diag.fastConnectDisabled = true;

        /**
         * Fallback: intercept native WebSocket.send for JSON frames (op 2/3). The desktop client mainly
         * sends ETF, handled by the webpack patch above; this covers cases where a frame goes out as
         * JSON instead (e.g. a web build, or a fallback path).
         */
        const proto = WebSocket.prototype as unknown as { send: WsSend; };
        originalWsSend = proto.send;

        proto.send = function (data) {
            if (typeof data === "string" && (data.includes("\"op\":2") || data.includes("\"op\":3"))) {
                try {
                    const frame = JSON.parse(data);
                    if (frame.op === 2 || frame.op === 3) {
                        const props = frame.d?.properties;
                        if (props && typeof props === "object") {
                            const before = String(props.browser);
                            Object.assign(props, getSpoofProps("ws"));
                            diag.wsFramesRewritten++;
                            diag.lastWsEvent = frame.op === 2
                                ? `op2: browser "${before}" -> "${props.browser}"`
                                : `op3: presence, browser -> "${props.browser}"`;
                            data = JSON.stringify(frame);
                        }
                    }
                } catch (e) {
                    logger.warn("[ws] Could not parse frame — sending as-is", e);
                }
            }
            return originalWsSend!.call(this, data);
        };

        diag.wsInstalled = true;
    },

    stop() {
        if (!originalWsSend) return;
        (WebSocket.prototype as unknown as { send: WsSend; }).send = originalWsSend;
        originalWsSend = null;
        diag.wsInstalled = false;
        try {
            delete (window as unknown as Record<string, unknown>)._ws;
        } catch { /* already gone, doesn't matter */ }
    },

    settingsAboutComponent() {
        return (
            <>
                <Forms.FormText>
                    The platform is sent to Discord's servers when you connect, so changing it needs a
                    restart (Ctrl+R). After that, everyone sees the chosen icon next to your name — in the
                    member list, your profile, and on your messages (if they have platform icons enabled).
                </Forms.FormText>
                <Forms.FormText className={Margins.top8}>
                    Your own green status dot next to your own avatar never changes — Discord always draws
                    your own status locally regardless of this setting.
                </Forms.FormText>
                <Forms.FormText className={Margins.top8}>
                    Extras: "iPhone" adds a "sent from iPhone" tag to your messages, and "Console" shows a
                    gamepad icon like real Xbox/PlayStation players. VR is experimental.
                </Forms.FormText>

                <Forms.FormTitle className={Margins.top16}>Diagnostics</Forms.FormTitle>
                <Forms.FormText>Selected platform: "{String(settings.store.platform)}"</Forms.FormText>
                <Forms.FormText>
                    fast-connect disabled: {diag.fastConnectDisabled ? "yes" : "NO (started too late!)"}
                </Forms.FormText>
                <Forms.FormText>
                    IDENTIFY patch fired: {diag.identifyBuiltCount} time(s)
                    {diag.lastIdentifyBuilt ? ` (last at ${diag.lastIdentifyBuilt})` : ""}
                </Forms.FormText>
                <Forms.FormText>
                    WS intercept: {diag.wsInstalled ? "installed" : "NOT installed"},
                    frames rewritten: {diag.wsFramesRewritten}
                    {diag.lastWsEvent ? `, last: ${diag.lastWsEvent}` : ""}
                </Forms.FormText>
                <Forms.FormText className={Margins.top8}>
                    Reading this: "patch fired 0 times" after reconnecting means the patch isn't applying;
                    "platform windows" while a phone is selected means the setting didn't save. Full logs
                    are in the console (Ctrl+Shift+I), filter "SpoofPlatform". Reopen this page to refresh
                    the numbers.
                </Forms.FormText>
            </>
        );
    },
});
