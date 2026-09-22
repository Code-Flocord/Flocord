/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { managedStyleRootNode } from "@api/Styles";
import { FlocordDevs } from "@utils/constants";
import { classNameToSelector, createAndAppendStyle } from "@utils/css";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, StartAt } from "@utils/types";
import { findCssClassesLazy, onceReady } from "@webpack";

const logger = new Logger("FlocordTheme");

const HEX = /^#?([0-9a-f]{6})$/i;

const panelButtonClasses = findCssClassesLazy("redGlow", "button", "enabled");

const settings = definePluginSettings({
    background: {
        type: OptionType.STRING,
        description: "Base background color (hex). Every surface is derived from it while keeping Discord's contrast.",
        default: "#14101c",
        isValid: (v: string) => HEX.test(v) || "Enter a 6-digit hex color, for example #14101c.",
        onChange: () => apply()
    },
    accent: {
        type: OptionType.STRING,
        description: "Accent color (hex) used for buttons, links, mentions and selections.",
        default: "#8b5cf6",
        isValid: (v: string) => HEX.test(v) || "Enter a 6-digit hex color, for example #8b5cf6.",
        onChange: () => apply()
    },
    mutedColor: {
        type: OptionType.STRING,
        description: "Color (hex) of the mute and deafen buttons when they are active, instead of Discord's red.",
        default: "#6d28d9",
        isValid: (v: string) => HEX.test(v) || "Enter a 6-digit hex color, for example #6d28d9.",
        onChange: () => apply()
    }
});

interface Hsl { h: number; s: number; l: number; }

function hexToHsl(hex: string): Hsl {
    const [, digits] = HEX.exec(hex) ?? [, "000000"];
    const r = parseInt(digits.slice(0, 2), 16) / 255;
    const g = parseInt(digits.slice(2, 4), 16) / 255;
    const b = parseInt(digits.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l: l * 100 };

    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = max === r ? (g - b) / d + (g < b ? 6 : 0)
        : max === g ? (b - r) / d + 2
            : (r - g) / d + 4;
    h *= 60;
    return { h, s: s * 100, l: l * 100 };
}

// Discord's brand shades, from lightest to darkest, with their approximate lightness
const BRAND_SHADES: Array<[number, number]> = [
    [100, 99], [130, 98], [160, 97], [200, 95], [230, 93], [260, 91], [300, 88], [330, 85], [360, 81],
    [400, 77], [430, 74], [460, 70], [500, 66], [530, 62], [560, 58], [600, 53], [630, 48], [660, 43],
    [700, 38], [730, 34], [760, 29], [800, 24], [830, 20], [860, 16], [900, 12]
];

const NEUTRAL_LIGHTNESS = /(--neutral-\d{1,3}-hsl):[^;]*?([\d.]+)%;/g;

let neutralLightness: Record<string, number> | null = null;
let style: HTMLStyleElement | null = null;

async function readNeutralLightness() {
    const links = document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]');
    const sheets = await Promise.all(Array.from(links, l => l.href ? fetch(l.href).then(r => r.text()).catch(() => "") : ""));

    const result: Record<string, number> = {};
    for (const [, name, lightness] of sheets.join("\n").matchAll(NEUTRAL_LIGHTNESS)) {
        result[name] = parseFloat(lightness);
    }
    return result;
}

function neutralOverrides(base: Hsl) {
    if (!neutralLightness) return "";
    // --neutral-69 is the lightness Discord's dark theme is built around
    const darkBase = neutralLightness["--neutral-69-hsl"];
    if (darkBase == null) return "";

    return Object.entries(neutralLightness)
        .map(([name, lightness]) => `${name}: ${base.h.toFixed(1)} ${base.s.toFixed(1)}% ${Math.max(0, Math.min(100, base.l + lightness - darkBase)).toFixed(2)}%;`)
        .join("\n");
}

function brandOverrides(accent: Hsl) {
    return BRAND_SHADES
        .map(([shade, l]) => `--brand-${shade}-hsl: ${accent.h.toFixed(1)} ${accent.s.toFixed(1)}% ${l}%;\n--brand-${shade}: hsl(var(--brand-${shade}-hsl));`)
        .join("\n");
}

function mutedOverrides() {
    // Active mute/deafen buttons carry the panel button module's "redGlow" class, whose background is the danger red
    const selector = classNameToSelector(panelButtonClasses.redGlow);
    const color = `#${HEX.exec(settings.store.mutedColor)?.[1] ?? "6d28d9"}`;
    const { h, s, l } = hexToHsl(color);
    const hsl = `${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%`;

    return `${selector} {\n--status-danger: ${color};\n--status-danger-background: ${color};\n--button-danger-background: ${color};\n--red-400: ${color};\n--red-400-hsl: ${hsl};\n--red-430: ${color};\n--red-430-hsl: ${hsl};\n--red-460: ${color};\n--red-460-hsl: ${hsl};\n}`;
}

function apply() {
    if (!style) return;

    const background = hexToHsl(settings.store.background);
    const accent = hexToHsl(settings.store.accent);

    let muted = "";
    try {
        muted = mutedOverrides();
    } catch {
        // account panel classes not loaded yet, applied again once webpack is ready
    }

    style.textContent = [
        `.theme-dark {\n${neutralOverrides(background)}\n}`,
        `:root, .theme-dark, .theme-light {\n${brandOverrides(accent)}\n--brand-experiment: var(--brand-500);\n--brand-experiment-560: var(--brand-560);\n--brand-experiment-600: var(--brand-600);\n--text-link: hsl(var(--brand-400-hsl));\n}`,
        muted
    ].join("\n\n");
}

export default definePlugin({
    name: "FlocordTheme",
    description: "Flocord's own look: a deep violet dark theme with a violet accent. Colors are adjustable below.",
    authors: [FlocordDevs.Flocord],
    tags: ["Appearance"],
    enabledByDefault: true,
    settings,
    startAt: StartAt.DOMContentLoaded,

    async start() {
        style = createAndAppendStyle("flocord-theme", managedStyleRootNode);
        try {
            neutralLightness = await readNeutralLightness();
        } catch (err) {
            logger.warn("Could not read Discord's palette, applying accent only", err);
        }
        apply();
        onceReady.then(apply);
    },

    stop() {
        style?.remove();
        style = null;
    }
});
