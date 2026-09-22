/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { moment, useEffect, useReducer } from "@webpack/common";

// ─── Settings ────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
    format: {
        type: OptionType.SELECT,
        description: "Seconds format displayed on every message timestamp",
        default: "HH:mm:ss",
        options: [
            { label: "15:34:21  (24h)", value: "HH:mm:ss", default: true },
            { label: "3:34:21 PM  (12h)", value: "h:mm:ss A" },
        ],
    },
    showInTooltip: {
        type: OptionType.BOOLEAN,
        description: "Show seconds in the hover tooltip",
        default: true,
    },
    showInCompact: {
        type: OptionType.BOOLEAN,
        description: "Show seconds in compact mode",
        default: true,
    },
});

// ─── Global tick ─ one shared setInterval for all timestamp components ───────
// This avoids creating one setInterval per rendered message (50+ messages = 50+
// intervals → 50+ React re-renders per second → Discord freeze).

const tickListeners = new Set<() => void>();
let globalTickInterval: ReturnType<typeof setInterval> | null = null;

function startGlobalTick() {
    if (globalTickInterval !== null) return;
    globalTickInterval = setInterval(() => {
        for (const fn of tickListeners) {
            try { fn(); } catch { }
        }
    }, 1000);
}

function stopGlobalTick() {
    if (tickListeners.size > 0) return;
    if (globalTickInterval !== null) {
        clearInterval(globalTickInterval);
        globalTickInterval = null;
    }
}

// ─── React Hook (only valid inside a React component) ────────────────────────
function useSecondTick() {
    const [, tick] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
        tickListeners.add(tick);
        startGlobalTick();
        return () => {
            tickListeners.delete(tick);
            stopGlobalTick();
        };
    }, []);
}

// ─── Timestamp render functions ──────────────────────────────────────────────
// REAL FIX (confirmed against the stock CustomTimestamps plugin, which patches
// these exact same Vencord match sites and works fine): the previous "BUGFIX"
// diagnosis was wrong. There is no Hook-rule violation — these patch sites sit
// directly inside the host component's render body, so calling a Hook here is
// perfectly valid (CustomTimestamps' renderTimestamp does the same thing).
//
// The actual crash was caused by returning a *React element* (Fragment) where
// Discord's own MessageTimestamp component expects a plain *string*. That same
// variable is reused later in the same component for things like AM/PM format
// detection via .match(...) and the edited-message a11y label — calling
// .match() on a React element throws "e.match is not a function" on every
// message render. Returning a plain string (like CustomTimestamps does) keeps
// those other internal usages intact while still updating live every second
// via useSecondTick().

function renderCozyText(date: Date) {
    useSecondTick();
    const fmt = settings.store.format ?? "HH:mm:ss";
    return moment(date).format(fmt);
}

function renderCompactText(date: Date) {
    useSecondTick();
    const fmt = settings.store.format ?? "HH:mm:ss";
    return settings.store.showInCompact
        ? moment(date).format(fmt)
        : moment(date).format("LT");
}

// No tick hook here: the tooltip lives in conditional JSX, and the component already re-renders every second
function renderTooltipText(date: Date) {
    const fmt = settings.store.format ?? "HH:mm:ss";
    return settings.store.showInTooltip
        ? moment(date).format(`dddd, MMMM D, YYYY [at] ${fmt}`)
        : moment(date).format("LLLL");
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "RealtimeTimestamps",
    enabledByDefault: false,
    description: "Replaces Discord timestamps (e.g. 15:31) with live seconds (e.g. 15:34:21), updated every second. Disable CustomTimestamps to use it.",
    tags: ["Appearance", "Chat", "Utility"],
    authors: [{ name: "Flocord",
     id: 253979869n }],
    settings,

    // Called directly by patches — must return a plain string, not a React
    // element, since these substitute for values Discord later treats as text
    // (and in some cases re-parses with .match()).
    renderCozy(date: Date) {
        return renderCozyText(date);
    },
    renderCompact(date: Date) {
        return renderCompactText(date);
    },
    renderTooltip(date: Date) {
        return renderTooltipText(date);
    },

    stop() {
        tickListeners.clear();
        if (globalTickInterval !== null) {
            clearInterval(globalTickInterval);
            globalTickInterval = null;
        }
    },

    patches: [
        // ─── Main Timestamp component (cozy + compact messages + hover tooltip) ─
        // CustomTimestamps rewrites the same three sites; when both are on it takes precedence
        {
            find: "#{intl::MESSAGE_EDITED_TIMESTAMP_A11Y_LABEL}",
            predicate: () => !isPluginEnabled("CustomTimestamps"),
            replacement: [
                {
                    // displayed time: useMemo(()=>customFormat?fmt(k,d,F):compact?fmt(k,"LT",F):calendar(k,!0),[...])
                    match: /\i\.useMemo\(\(\)=>null!=\i\?\(0,\i\.\i\)\(\i,\i,\i\):(\i)\?\(0,\i\.\i\)\(\i,"LT",\i\):\(0,\i\.\i\)\(\i,!0\),\[.{0,20}?\]\)/,
                    replace: "($1?$self.renderCompact(arguments[0].timestamp):$self.renderCozy(arguments[0].timestamp))",
                },
                {
                    // Tooltip shown when hovering a message timestamp
                    match: /(__unsupportedReactNodeAsText:)\(0,\i\.\i\)\(\i,"LLLL"\)/,
                    replace: "$1$self.renderTooltip(arguments[0].timestamp)",
                },
            ],
        },

        // ─── Timestamp markdown <t:unix:t> — hover tooltip ────────────────────
        {
            find: /.full,.{0,15}children:/,
            predicate: () => !isPluginEnabled("CustomTimestamps"),
            replacement: {
                match: /(__unsupportedReactNodeAsText:)\i\.full/,
                replace: "$1$self.renderTooltip(new Date(arguments[0].node.timestamp*1000))",
            },
        },
    ],
});
