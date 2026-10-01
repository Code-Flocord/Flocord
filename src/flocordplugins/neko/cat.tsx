/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { createRoot, React, useEffect, useRef, useState } from "@webpack/common";

import { SCRATCH, SIT_BLINK, SIT_OPEN, SPRITE_ASPECT, WALK_A, WALK_B } from "./sprites";

const cl = classNameFactory("vc-neko-");

/** How close the cat needs to get before it stops and sits */
const IDLE_DISTANCE = 56;
/** Pixels covered per tick while walking */
const STEP = 11;
/** Simulation rate, matching the classic "oneko" toy */
const TICK_MS = 100;
/** How often the walk-cycle sprite swaps while trotting */
const WALK_FRAME_MS = 150;

/** Ticks of stillness before a random idle animation (scratch/sleep) can start */
const IDLE_ANIMATION_AFTER_TICKS = 10;
/** Roughly once every this many ticks, on average, while eligible */
const IDLE_ANIMATION_CHANCE = 1 / 60;
const SCRATCH_TICKS = 8;
const SLEEP_TICKS = 24;
const BLINK_EVERY_MS = 3200;
const BLINK_DURATION_MS = 160;

type Behavior = "idle" | "scratch" | "sleep" | "alert" | "walk";

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
    const [behavior, setBehavior] = useState<Behavior>("idle");
    const [facingLeft, setFacingLeft] = useState(false);
    const [frameToggle, setFrameToggle] = useState(false);
    const [blinking, setBlinking] = useState(false);

    const mouse = useRef({ x: pos.x, y: pos.y });
    const catPos = useRef(pos);
    const idleTicks = useRef(0);
    const behaviorTicks = useRef(0);

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            mouse.current = { x: e.clientX, y: e.clientY };
        };
        window.addEventListener("mousemove", onMove);

        const tick = window.setInterval(() => {
            const dx = mouse.current.x - catPos.current.x;
            const dy = mouse.current.y - catPos.current.y;
            const distance = Math.hypot(dx, dy);

            if (distance < IDLE_DISTANCE) {
                idleTicks.current += 1;

                setBehavior(prev => {
                    if (prev === "scratch" || prev === "sleep") {
                        behaviorTicks.current += 1;
                        const limit = prev === "scratch" ? SCRATCH_TICKS : SLEEP_TICKS;
                        if (behaviorTicks.current > limit) {
                            behaviorTicks.current = 0;
                            return "idle";
                        }
                        return prev;
                    }

                    if (idleTicks.current > IDLE_ANIMATION_AFTER_TICKS && Math.random() < IDLE_ANIMATION_CHANCE) {
                        behaviorTicks.current = 0;
                        return Math.random() < 0.5 ? "scratch" : "sleep";
                    }

                    return "idle";
                });
                return;
            }

            // Just noticed the cursor wandered off: a brief surprised pause before chasing it
            if (idleTicks.current > 2) {
                idleTicks.current = 0;
                behaviorTicks.current = 0;
                setBehavior("alert");
                return;
            }

            idleTicks.current = 0;
            const step = Math.min(STEP, distance - IDLE_DISTANCE + STEP);
            const next = {
                x: catPos.current.x + (dx / distance) * step,
                y: catPos.current.y + (dy / distance) * step
            };
            catPos.current = next;
            setPos(next);
            setBehavior("walk");
            if (Math.abs(dx) > 2) setFacingLeft(dx < 0);
        }, TICK_MS);

        const frameInterval = window.setInterval(() => setFrameToggle(f => !f), WALK_FRAME_MS);

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
            window.clearInterval(tick);
            window.clearInterval(frameInterval);
            window.clearTimeout(blinkTimer);
        };
    }, []);

    let sprite = SIT_OPEN;
    if (behavior === "walk") sprite = frameToggle ? WALK_A : WALK_B;
    else if (behavior === "scratch") sprite = frameToggle ? SCRATCH : SIT_OPEN;
    else if (behavior === "sleep") sprite = SIT_BLINK;
    else if (behavior === "idle") sprite = blinking ? SIT_BLINK : SIT_OPEN;
    else if (behavior === "alert") sprite = SIT_OPEN;

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
            {behavior === "sleep" && <div className={cl("zzz")}>z</div>}
            <div
                className={classes(
                    cl("sprite"),
                    behavior === "walk" ? cl("walking") : cl("idle"),
                    behavior === "alert" ? cl("alert") : "",
                    facingLeft ? cl("flip") : ""
                )}
                style={{ backgroundImage: `url("${sprite}")` }}
            />
        </div>
    );
}
