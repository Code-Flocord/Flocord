/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { createRoot, React, useEffect, useRef, useState } from "@webpack/common";

const cl = classNameFactory("vc-neko-");

/** How close the cat needs to get before it stops and sits */
const IDLE_DISTANCE = 56;
/** Pixels covered per tick while walking */
const STEP = 11;
/** Simulation rate, matching the classic "oneko" toy */
const TICK_MS = 100;

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

    const mouse = useRef({ x: pos.x, y: pos.y });
    const catPos = useRef(pos);

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            mouse.current = { x: e.clientX, y: e.clientY };
        };
        window.addEventListener("mousemove", onMove);

        const interval = window.setInterval(() => {
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

        return () => {
            window.removeEventListener("mousemove", onMove);
            window.clearInterval(interval);
        };
    }, []);

    return (
        <div
            className={cl("container")}
            style={{
                transform: `translate3d(${Math.round(pos.x - size / 2)}px, ${Math.round(pos.y - size / 2)}px, 0)`,
                width: size,
                height: size
            }}
        >
            <div className={classes(cl("flip"), facingLeft ? cl("flip-active") : "")}>
                <div className={classes(cl("cat"), walking ? cl("walking") : cl("idle"))}>
                    <div className={cl("tail")} />
                    <div className={cl("body")} />
                    <div className={cl("head")}>
                        <div className={classes(cl("ear"), cl("ear-left"))} />
                        <div className={classes(cl("ear"), cl("ear-right"))} />
                        <div className={classes(cl("eye"), cl("eye-left"))} />
                        <div className={classes(cl("eye"), cl("eye-right"))} />
                        <div className={cl("nose")} />
                    </div>
                </div>
            </div>
        </div>
    );
}
