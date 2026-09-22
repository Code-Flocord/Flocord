/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

declare module "typed-emitter" {
    type EventMap = Record<string, (...args: any[]) => void>;

    export default interface TypedEmitter<Events extends EventMap> {
        on<E extends keyof Events>(event: E, listener: Events[E]): this;
        once<E extends keyof Events>(event: E, listener: Events[E]): this;
        off<E extends keyof Events>(event: E, listener: Events[E]): this;
        removeListener<E extends keyof Events>(event: E, listener: Events[E]): this;
        removeAllListeners<E extends keyof Events>(event?: E): this;
        emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): boolean;
    }
}
