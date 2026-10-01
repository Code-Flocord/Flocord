/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { createRoot, React, useEffect, useRef, useState } from "@webpack/common";

import { settings } from "./settings";
import { SCRATCH, SIT_BLINK, SIT_OPEN, SPRITE_ASPECT, WALK_A, WALK_B } from "./sprites";

const cl = classNameFactory("vc-neko-");

/** How close the cat needs to get before it stops and sits */
const IDLE_DISTANCE = 56;
/** How quickly the cat eases toward the cursor, per 16.67ms frame (0..1, higher = snappier) */
const FOLLOW_FACTOR = 0.07;
/** How often the walk-cycle sprite swaps while trotting */
const WALK_FRAME_MS = 150;

/** Milliseconds of stillness before a random idle animation (scratch/sleep) can start */
const IDLE_ANIMATION_AFTER_MS = 1000;
/** Roughly once every this many ms, on average, while eligible */
const IDLE_ANIMATION_CHANCE_PER_MS = 1 / 6000;
const SCRATCH_MS = 800;
const SLEEP_MS = 2400;
const BLINK_EVERY_MS = 3200;
const BLINK_DURATION_MS = 160;
/** A brief surprised pause before chasing the cursor again after sitting a while */
const ALERT_MS = 180;

type Behavior = "idle" | "scratch" | "sleep" | "alert" | "walk";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

let root: ReturnType<typeof createRoot> | null = null;
let mountNode: HTMLDivElement | null = null;

export function mountNeko() {
    if (typeof document === "undefined") return;
    const { body } = document;
    if (!body) return;

    // Respect the OS-level motion preference, same as the original oneko toy: don't even mount.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    if (root) {
        if (mountNode && !mountNode.isConnected) body.appendChild(mountNode);
        return;
    }

    mountNode = document.createElement("div");
    body.appendChild(mountNode);

    root = createRoot(mountNode);
    root.render(
        <ErrorBoundary noop>
            <Neko />
        </ErrorBoundary>
    );
}

export function unmountNeko() {
    root?.unmount();
    root = null;

    mountNode?.remove();
    mountNode = null;
}

function Neko() {
    const { size } = settings.use(["size"]);

    const [behavior, setBehavior] = useState<Behavior>("idle");
    const [facingLeft, setFacingLeft] = useState(false);
    const [frameToggle, setFrameToggle] = useState(false);
    const [blinking, setBlinking] = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);
    const mouse = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const pos = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const behaviorRef = useRef<Behavior>("idle");
    const idleSinceMs = useRef(0);
    const behaviorStartedMs = useRef(0);

    behaviorRef.current = behavior;

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            mouse.current = { x: e.clientX, y: e.clientY };
        };
        window.addEventListener("mousemove", onMove, { passive: true });

        const onResize = () => {
            pos.current = {
                x: clamp(pos.current.x, 0, window.innerWidth),
                y: clamp(pos.current.y, 0, window.innerHeight)
            };
        };
        window.addEventListener("resize", onResize);

        let lastTime = performance.now();
        let raf = 0;

        const step = (time: number) => {
            const delta = Math.min(48, time - lastTime);
            lastTime = time;

            const dx = mouse.current.x - pos.current.x;
            const dy = mouse.current.y - pos.current.y;
            const distance = Math.hypot(dx, dy);

            if (distance < IDLE_DISTANCE) {
                if (idleSinceMs.current === 0) idleSinceMs.current = time;
                const idleFor = time - idleSinceMs.current;

                if (behaviorRef.current === "scratch" || behaviorRef.current === "sleep") {
                    const limit = behaviorRef.current === "scratch" ? SCRATCH_MS : SLEEP_MS;
                    if (time - behaviorStartedMs.current > limit) setBehavior("idle");
                } else if (behaviorRef.current !== "idle") {
                    setBehavior("idle");
                } else if (idleFor > IDLE_ANIMATION_AFTER_MS && Math.random() < IDLE_ANIMATION_CHANCE_PER_MS * delta) {
                    behaviorStartedMs.current = time;
                    setBehavior(Math.random() < 0.5 ? "scratch" : "sleep");
                }
            } else {
                // Just noticed the cursor wandered off after a while: a brief surprised pause before chasing it
                if (idleSinceMs.current !== 0 && time - idleSinceMs.current > 300 && behaviorRef.current !== "walk" && behaviorRef.current !== "alert") {
                    behaviorStartedMs.current = time;
                    setBehavior("alert");
                } else if (behaviorRef.current === "alert" && time - behaviorStartedMs.current > ALERT_MS) {
                    setBehavior("walk");
                } else if (behaviorRef.current !== "alert") {
                    if (behaviorRef.current !== "walk") setBehavior("walk");

                    const factor = 1 - Math.pow(1 - FOLLOW_FACTOR, delta / 16.67);
                    pos.current = {
                        x: pos.current.x + dx * factor,
                        y: pos.current.y + dy * factor
                    };
                    if (Math.abs(dx) > 2) setFacingLeft(dx < 0);
                }
                idleSinceMs.current = 0;
            }

            const width = size, height = Math.round(size * SPRITE_ASPECT);
            const x = clamp(pos.current.x, width / 2, window.innerWidth - width / 2);
            const y = clamp(pos.current.y, height / 2, window.innerHeight - height / 2);
            if (containerRef.current) {
                containerRef.current.style.transform = `translate3d(${Math.round(x - width / 2)}px, ${Math.round(y - height / 2)}px, 0)`;
            }

            raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);

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
            window.removeEventListener("resize", onResize);
            cancelAnimationFrame(raf);
            window.clearInterval(frameInterval);
            window.clearTimeout(blinkTimer);
        };
    }, []);

    let sprite = SIT_OPEN;
    if (behavior === "walk") sprite = frameToggle ? WALK_A : WALK_B;
    else if (behavior === "scratch") sprite = frameToggle ? SCRATCH : SIT_OPEN;
    else if (behavior === "sleep") sprite = SIT_BLINK;
    else if (behavior === "idle") sprite = blinking ? SIT_BLINK : SIT_OPEN;

    const width = size;
    const height = Math.round(size * SPRITE_ASPECT);

    return (
        <div ref={containerRef} className={cl("container")} style={{ width, height }}>
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
