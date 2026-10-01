/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { createRoot, React, useEffect, useRef, useState } from "@webpack/common";

import { SIT_BLINK, SIT_OPEN, SPRITE_ASPECT, WALK_A, WALK_B } from "./sprites";

const cl = classNameFactory("vc-neko-");

/** How close the cat needs to get before it stops and sits */
const IDLE_DISTANCE = 56;
/** Pixels covered per tick while walking */
const STEP = 11;
/** Simulation rate, matching the classic "oneko" toy */
const TICK_MS = 100;
/** How often the walk-cycle sprite swaps while trotting */
const WALK_FRAME_MS = 150;
/** How often an idle blink happens, roughly */
const BLINK_EVERY_MS = 3200;
const BLINK_DURATION_MS = 160;

let root: ReturnType<typeof createRoot> | null = null;
let mountNode: HTMLDivElement | null = null;

export function mountNeko(size: number) {
    if (typeof document === "undefined") return;
    const { body } = document;
    if (!body) return;

    if (root) {
        if (mountNode && !mountNode.isConnected) body.appendChild(mountNode);
        return;
    }

    mountNode = document.createElement("div");
    body.appendChild(mountNode);

    root = createRoot(mountNode);
    root.render(
        <ErrorBoundary noop>
            <Neko size={size} />
        </ErrorBoundary>
    );
}

export function unmountNeko() {
    root?.unmount();
    root = null;

    mountNode?.remove();
    mountNode = null;
}

function Neko({ size }: { size: number; }) {
    const [pos, setPos] = useState(() => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 }));
    const [walking, setWalking] = useState(false);
    const [facingLeft, setFacingLeft] = useState(false);
    const [walkFrame, setWalkFrame] = useState(false);
    const [blinking, setBlinking] = useState(false);

    const mouse = useRef({ x: pos.x, y: pos.y });
    const catPos = useRef(pos);

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            mouse.current = { x: e.clientX, y: e.clientY };
        };
        window.addEventListener("mousemove", onMove);

        const moveInterval = window.setInterval(() => {
            const dx = mouse.current.x - catPos.current.x;
            const dy = mouse.current.y - catPos.current.y;
            const distance = Math.hypot(dx, dy);

            if (distance < IDLE_DISTANCE) {
                setWalking(prev => (prev ? false : prev));
                return;
            }

            const step = Math.min(STEP, distance - IDLE_DISTANCE + STEP);
            const next = {
                x: catPos.current.x + (dx / distance) * step,
                y: catPos.current.y + (dy / distance) * step
            };
            catPos.current = next;
            setPos(next);
            setWalking(true);
            if (Math.abs(dx) > 2) setFacingLeft(dx < 0);
        }, TICK_MS);

        const walkFrameInterval = window.setInterval(() => setWalkFrame(f => !f), WALK_FRAME_MS);

        let blinkTimer: number;
        const scheduleBlink = () => {
            blinkTimer = window.setTimeout(() => {
                setBlinking(true);
                window.setTimeout(() => setBlinking(false), BLINK_DURATION_MS);
                scheduleBlink();
            }, BLINK_EVERY_MS + Math.random() * 1500);
        };
        scheduleBlink();

        return () => {
            window.removeEventListener("mousemove", onMove);
            window.clearInterval(moveInterval);
            window.clearInterval(walkFrameInterval);
            window.clearTimeout(blinkTimer);
        };
    }, []);

    const sprite = walking ? (walkFrame ? WALK_A : WALK_B) : (blinking ? SIT_BLINK : SIT_OPEN);
    const width = size;
    const height = Math.round(size * SPRITE_ASPECT);

    return (
        <div
            className={cl("container")}
            style={{
                transform: `translate3d(${Math.round(pos.x - width / 2)}px, ${Math.round(pos.y - height / 2)}px, 0)`,
                width,
                height
            }}
        >
            <div className={classes(cl("sprite"), walking ? cl("walking") : cl("idle"), facingLeft ? cl("flip") : "")}
                style={{ backgroundImage: `url("${sprite}")` }}
            />
        </div>
    );
}
