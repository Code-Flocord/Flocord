/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { FlocordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { createRoot, React, showToast, Toasts, useEffect, useRef, useState } from "@webpack/common";
import type { Root } from "react-dom/client";

import managedStyle from "./style.css?managed";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const;

const settings = definePluginSettings({
    pin: {
        type: OptionType.STRING,
        description: "PIN used to unlock. Digits only, at least 4. Leave empty to unlock with a single click.",
        default: "",
        isValid: (value: string) => !value || /^\d{4,}$/.test(value) || "Use at least 4 digits, or leave empty."
    },
    lockAfter: {
        type: OptionType.SLIDER,
        description: "Lock after this many minutes without activity. 0 disables the timer.",
        markers: [0, 1, 5, 10, 15, 30, 60],
        default: 10,
        stickToMarkers: false
    },
    lockOnBlur: {
        type: OptionType.BOOLEAN,
        description: "Lock as soon as the Discord window loses focus.",
        default: false
    },
    blurContent: {
        type: OptionType.BOOLEAN,
        description: "Blur the app behind the lock screen, so nothing is readable.",
        default: true
    }
});

let setLockedExternal: ((locked: boolean) => void) | null = null;
let container: HTMLDivElement | null = null;
let root: Root | null = null;

function lock() {
    setLockedExternal?.(true);
}

function LockIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" width={20} height={20} {...props}>
            <path
                fill="currentColor"
                d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm0 2a3 3 0 0 1 3 3v3H9V7a3 3 0 0 1 3-3Zm0 10a2 2 0 0 1 1 3.73V19a1 1 0 0 1-2 0v-1.27A2 2 0 0 1 12 14Z"
            />
        </svg>
    );
}

function LockButton() {
    return <HeaderBarButton icon={LockIcon} tooltip="Lock Discord" onClick={lock} />;
}

function LockOverlay() {
    const [locked, setLocked] = useState(false);
    const [entry, setEntry] = useState("");
    const [shake, setShake] = useState(false);
    const lastActivity = useRef(Date.now());

    useEffect(() => {
        setLockedExternal = setLocked;
        return () => { setLockedExternal = null; };
    }, []);

    // Inactivity timer
    useEffect(() => {
        const onActivity = () => { lastActivity.current = Date.now(); };
        ACTIVITY_EVENTS.forEach(event => window.addEventListener(event, onActivity, true));

        const interval = window.setInterval(() => {
            const minutes = settings.store.lockAfter;
            if (!minutes || locked) return;
            if (Date.now() - lastActivity.current >= minutes * 60_000) setLocked(true);
        }, 5_000);

        return () => {
            ACTIVITY_EVENTS.forEach(event => window.removeEventListener(event, onActivity, true));
            clearInterval(interval);
        };
    }, [locked]);

    // Lock when the window loses focus. The setting is read inside the handler so that
    // turning it on takes effect without a restart
    useEffect(() => {
        const onBlur = () => {
            if (settings.store.lockOnBlur) setLocked(true);
        };
        window.addEventListener("blur", onBlur);
        return () => window.removeEventListener("blur", onBlur);
    }, []);

    useEffect(() => {
        document.documentElement.classList.toggle("flocord-locked", locked);
        document.documentElement.classList.toggle("flocord-locked-blur", locked && settings.store.blurContent);
        if (locked) setEntry("");
        else lastActivity.current = Date.now();
    }, [locked]);

    if (!locked) return null;

    const { pin } = settings.store;

    function unlock(candidate: string) {
        if (!pin || candidate === pin) {
            setLocked(false);
            return;
        }
        setEntry("");
        setShake(true);
        window.setTimeout(() => setShake(false), 400);
    }

    function press(digit: string) {
        const next = entry + digit;
        setEntry(next);
        if (next.length >= pin.length) unlock(next);
    }

    return (
        <div className="flocord-lock" onContextMenu={e => e.preventDefault()}>
            <div className={`flocord-lock-card${shake ? " flocord-lock-shake" : ""}`}>
                <LockIcon className="flocord-lock-icon" width={40} height={40} />
                <h2 className="flocord-lock-title">Discord is locked</h2>
                <p className="flocord-lock-subtitle">
                    {pin ? "Enter your PIN to unlock." : "Click below to unlock."}
                </p>

                {pin ? (
                    <>
                        <div className="flocord-lock-dots">
                            {Array.from({ length: pin.length }, (_, i) => (
                                <span key={i} className={`flocord-lock-dot${i < entry.length ? " flocord-lock-dot-filled" : ""}`} />
                            ))}
                        </div>
                        <div className="flocord-lock-pad">
                            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(digit => (
                                <button key={digit} className="flocord-lock-key" onClick={() => press(digit)}>{digit}</button>
                            ))}
                            <button className="flocord-lock-key flocord-lock-key-wide" onClick={() => setEntry("")}>Clear</button>
                            <button className="flocord-lock-key" onClick={() => press("0")}>0</button>
                        </div>
                    </>
                ) : (
                    <button className="flocord-lock-key flocord-lock-unlock" onClick={() => setLocked(false)}>Unlock</button>
                )}
            </div>
        </div>
    );
}

export default definePlugin({
    name: "LockScreen",
    description: "Locks Discord behind a PIN after a while, when the window loses focus, or on demand. Your conversations stay private when you step away.",
    authors: [FlocordDevs.Flocord],
    tags: ["Privacy"],
    dependencies: ["HeaderBarAPI"],
    settings,
    managedStyle,

    headerBarButton: {
        icon: LockIcon,
        render: LockButton,
        priority: 900
    },

    patches: [
        {
            find: "DISCONNECT_FROM_VOICE_CHANNEL]",
            replacement: {
                match: /\[\i\.\i\.DISCONNECT_FROM_VOICE_CHANNEL/,
                replace: '["FLOCORD_LOCK_SCREEN"]:{onTrigger(){$self.lock()},keyEvents:{keyUp:!0,keyDown:!1,blurred:!0,focused:!0}},$&'
            }
        },
        {
            find: '"push-to-talk-priority"',
            replacement: {
                match: /(\{id:.{0,25}?value:\i\.\i\.UNASSIGNED)/,
                replace: '{id:"flocord-lock-screen",value:"FLOCORD_LOCK_SCREEN",label:"Lock Discord (Flocord)"},$1'
            }
        }
    ],

    lock,

    start() {
        // The overlay is mounted next to the app, outside React's tree, so navigation never unmounts it
        container = document.createElement("div");
        container.id = "flocord-lock-root";
        document.body.append(container);
        root = createRoot(container);
        root.render(<LockOverlay />);

        if (!settings.store.pin) {
            showToast("LockScreen: set a PIN in the plugin settings for real protection.", Toasts.Type.MESSAGE);
        }
    },

    stop() {
        root?.unmount();
        root = null;
        container?.remove();
        container = null;
        document.documentElement.classList.remove("flocord-locked", "flocord-locked-blur");
    }
});
