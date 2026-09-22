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
import { findCssClassesLazy, onceReady, waitFor } from "@webpack";

const logger = new Logger("FlocordTheme");

const HEX = /^#?([0-9a-f]{6})$/i;

const panelButtonClasses = findCssClassesLazy("redGlow", "button", "enabled");
// Floating surfaces that become frosted panes: [class to style, ...other classes identifying the module].
// Some of these modules (emoji picker, user popout) only load when first opened, so they are watched
// with waitFor and the style is re-applied as they appear.
const FROSTED_SURFACES: string[][] = [
    ["root", "focusLock", "fullscreenOnMobile"], // modals
    ["menu", "customMenuItem", "customNotches"], // context menus
    ["outer", "isPrivate", "inner", "overlay"], // user popout
    ["contentWrapper", "drawerSizingWrapper", "navButtonActive"], // emoji / gif / sticker picker
    ["autocomplete", "autocompleteInner", "autocompleteRow"] // chat autocomplete
];
const frostedClassNames = new Map<string, string>();

const classNameRegex = (name: string) => new RegExp(`^${name}_{1,2}[0-9a-f]{5,6}(?: |$)`);

/**
 * String values of a module's own data properties. Getters are deliberately skipped: waitFor filters run
 * while a module is still initialising, and invoking a getter there (Discord's markup parser has several)
 * throws and poisons the getter's cached result for the rest of the session.
 */
function dataStrings(module: any): string[] {
    const values: string[] = [];
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(module))) {
        if (typeof descriptor.value === "string") values.push(descriptor.value);
    }
    return values;
}

function watchFrostedSurfaces() {
    for (const names of FROSTED_SURFACES) {
        const regexes = names.map(classNameRegex);
        const filter = (module: any) => {
            if (typeof module !== "object" || module === null) return false;
            const values = dataStrings(module);
            return regexes.every(re => values.some(v => re.test(v)));
        };

        waitFor(filter, module => {
            const className = dataStrings(module).find(v => regexes[0].test(v));
            if (!className) return;
            frostedClassNames.set(names[0], className);
            apply();
        });
    }
}

const settings = definePluginSettings({
    style: {
        type: OptionType.SELECT,
        description: "Overall look of the client.",
        options: [
            { label: "Glass — translucent surfaces over a soft violet backdrop", value: "glass", default: true },
            { label: "Flat — solid surfaces, no backdrop", value: "flat" }
        ],
        onChange: () => apply()
    },
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
    surfaceOpacity: {
        type: OptionType.SLIDER,
        description: "Glass only: opacity of sidebars, chat and inputs over the backdrop. Lower is more see-through.",
        markers: [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
        default: 0.55,
        stickToMarkers: false,
        onChange: () => apply()
    },
    backdropIntensity: {
        type: OptionType.SLIDER,
        description: "Glass only: strength of the colored glow in the backdrop.",
        markers: [0, 0.25, 0.5, 0.75, 1],
        default: 0.8,
        stickToMarkers: false,
        onChange: () => apply()
    },
    accentTint: {
        type: OptionType.BOOLEAN,
        description: "Tint hovers, selections, scrollbars and focused inputs with the accent color instead of grey.",
        default: true,
        onChange: () => apply()
    },
    roundness: {
        type: OptionType.SLIDER,
        description: "Corner radius of cards, popouts and buttons (1 = Discord default).",
        markers: [0.5, 0.75, 1, 1.25, 1.5],
        default: 1.25,
        stickToMarkers: false,
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

const clamp = (v: number, min = 0, max = 100) => Math.max(min, Math.min(max, v));
const hsl = (c: Hsl, l = c.l) => `${c.h.toFixed(1)} ${c.s.toFixed(1)}% ${clamp(l).toFixed(2)}%`;
const hsla = (c: Hsl, alpha: number, l = c.l) => `hsl(${hsl(c, l)} / ${alpha})`;

// Discord's legacy brand shades, from lightest to darkest, with their approximate lightness
const BRAND_SHADES: Array<[number, number]> = [
    [100, 99], [130, 98], [160, 97], [200, 95], [230, 93], [260, 91], [300, 88], [330, 85], [360, 81],
    [400, 77], [430, 74], [460, 70], [500, 66], [530, 62], [560, 58], [600, 53], [630, 48], [660, 43],
    [700, 38], [730, 34], [760, 29], [800, 24], [830, 20], [860, 16], [900, 12]
];

// Lightness of each `--neutral-N-hsl` / `--blurple-N-hsl` shade, read from Discord's own stylesheets
const PALETTE_LIGHTNESS = /(--(?:neutral|blurple)-\d{1,3}-hsl):[^;]*?([\d.]+)%;/g;

let palette: Record<string, number> | null = null;
let style: HTMLStyleElement | null = null;

async function readPalette() {
    const links = document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]');
    const sheets = await Promise.all(Array.from(links, l => l.href ? fetch(l.href).then(r => r.text()).catch(() => "") : ""));

    const result: Record<string, number> = {};
    for (const [, name, lightness] of sheets.join("\n").matchAll(PALETTE_LIGHTNESS)) {
        result[name] = parseFloat(lightness);
    }
    return result;
}

function shadeOverrides(prefix: "neutral" | "blurple", color: Hsl, referenceShade: string) {
    if (!palette) return "";
    const reference = palette[referenceShade];
    if (reference == null) return "";

    return Object.entries(palette)
        .filter(([name]) => name.startsWith(`--${prefix}-`))
        .map(([name, lightness]) => `${name}: ${hsl(color, color.l + lightness - reference)};`)
        .join("\n");
}

function brandOverrides(accent: Hsl) {
    const legacy = BRAND_SHADES
        .map(([shade, l]) => `--brand-${shade}-hsl: ${hsl(accent, l)};\n--brand-${shade}: hsl(var(--brand-${shade}-hsl));`)
        .join("\n");
    // The modern palette: --blurple-N shades, plus the translucent opacity-blurple shades that all share blurple-50
    const modern = shadeOverrides("blurple", accent, "--blurple-50-hsl");
    const opacity = Array.from({ length: 24 }, (_, i) => `--opacity-blurple-${(i + 1) * 4}-hsl: ${hsl(accent)};`).join("\n");

    return [legacy, modern, opacity, `--opacity-blurple-1-hsl: ${hsl(accent)};`].join("\n");
}

function glassOverrides(base: Hsl, accent: Hsl) {
    const intensity = settings.store.backdropIntensity;
    const opacity = settings.store.surfaceOpacity;
    const secondary: Hsl = { h: (accent.h + 40) % 360, s: accent.s, l: accent.l };

    const backdrop = [
        `radial-gradient(75% 60% at 5% 0%, ${hsla(accent, 0.6 * intensity)}, transparent 70%)`,
        `radial-gradient(60% 65% at 100% 100%, ${hsla(secondary, 0.45 * intensity)}, transparent 70%)`,
        `radial-gradient(45% 45% at 65% 35%, ${hsla(accent, 0.22 * intensity, accent.l - 25)}, transparent 70%)`,
        `linear-gradient(160deg, ${hsla(base, 1, base.l + 3)} 0%, ${hsla(base, 1, base.l - 2)} 55%, ${hsla(base, 1, base.l - 5)} 100%)`
    ].map(layer => `${layer} fixed 0 0/cover`).join(", ");

    // Same surface -> neutral mapping Discord uses, each one becoming a tinted pane over the shared backdrop
    const surfaces: Array<[string, number, number]> = [
        ["lowest", 73, opacity + 0.15],
        ["lower", 69, opacity + 0.1],
        ["low", 66, opacity + 0.05],
        ["high", 64, opacity],
        ["higher", 62, opacity - 0.05],
        ["chat", 64, opacity],
        ["highest", 60, opacity - 0.1],
        ["app-frame", 73, opacity - 0.1]
    ];

    const gradients = surfaces.map(([name, neutral, alpha]) => {
        const tint = `hsl(var(--neutral-${neutral}-hsl) / ${clamp(alpha, 0.2, 1).toFixed(2)})`;
        return `--background-gradient-${name}: linear-gradient(${tint}, ${tint}) fixed 0 0/cover, ${backdrop};`;
    });

    // Layout-level surfaces that Discord paints with a plain color (server list scroller, sidebar bottom):
    // made translucent so the backdrop shows through them too
    const plain = [
        `--background-base-lowest: hsl(var(--neutral-73-hsl) / ${clamp(opacity + 0.15, 0.2, 1).toFixed(2)});`,
        `--background-base-lower: hsl(var(--neutral-69-hsl) / ${clamp(opacity + 0.1, 0.2, 1).toFixed(2)});`
    ];

    return [...gradients, ...plain].join("\n");
}

function accentTintOverrides(accent: Hsl) {
    return [
        `--interactive-background-hover: ${hsla(accent, 0.12)};`,
        `--interactive-background-selected: ${hsla(accent, 0.22)};`,
        `--interactive-background-active: ${hsla(accent, 0.18)};`,
        `--message-background-hover: ${hsla(accent, 0.05)};`,
        `--message-mentioned-background-default: ${hsla(accent, 0.1)};`,
        `--message-mentioned-background-hover: ${hsla(accent, 0.16)};`,
        `--scrollbar-auto-thumb: ${hsla(accent, 0.35)};`,
        "--scrollbar-auto-track: transparent;",
        `--scrollbar-thin-thumb: ${hsla(accent, 0.35)};`,
        `--input-border-active: ${hsla(accent, 1)};`,
        `--border-focus: ${hsla(accent, 1)};`,
        `--border-strong: ${hsla(accent, 0.28)};`,
        `--border-subtle: ${hsla(accent, 0.14)};`,
        `--shadow-high: 0 12px 36px 0 ${hsla(accent, 0.18, 20)};`
    ].join("\n");
}

function frostedOverrides(accent: Hsl) {
    const opacity = clamp(settings.store.surfaceOpacity + 0.25, 0.5, 0.95).toFixed(2);

    const selectors = Array.from(frostedClassNames.values(), cls => `.theme-dark ${classNameToSelector(cls)}`);
    if (!selectors.length) return "";

    // Inside a pane, the surfaces Discord stacks on top (headers, category bars, inspector) become
    // translucent as well, otherwise they show up as solid dark blocks over the frosted glass
    return `${selectors.join(",\n")} {
background-color: hsl(var(--neutral-64-hsl) / ${opacity});
backdrop-filter: blur(18px) saturate(1.3);
border: 1px solid ${hsla(accent, 0.22)};
box-shadow: 0 16px 48px -16px ${hsla(accent, 0.45, 15)}, inset 0 1px 0 hsl(0 0% 100% / 0.06);
--background-base-lowest: hsl(var(--neutral-73-hsl) / 0.45);
--background-base-lower: hsl(var(--neutral-69-hsl) / 0.4);
--background-base-low: hsl(var(--neutral-66-hsl) / 0.35);
--background-surface-high: hsl(var(--neutral-64-hsl) / 0.3);
--background-surface-higher: hsl(var(--neutral-62-hsl) / 0.4);
--background-surface-highest: hsl(var(--neutral-60-hsl) / 0.5);
--modal-background: hsl(var(--neutral-64-hsl) / 0.3);
--modal-footer-background: hsl(var(--neutral-66-hsl) / 0.3);
}`;
}

function roundnessOverrides() {
    const r = settings.store.roundness;
    const radius = (px: number) => `${Math.round(px * r)}px`;
    return `--radius-xs: ${radius(4)};\n--radius-sm: ${radius(8)};\n--radius-md: ${radius(12)};\n--radius-lg: ${radius(16)};\n--radius-xl: ${radius(24)};\n--radius-xxl: ${radius(32)};`;
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

    let muted = "", frosted = "";
    try {
        muted = mutedOverrides();
    } catch {
        // account panel classes not loaded yet, applied again once webpack is ready
    }
    const glass = settings.store.style === "glass";
    if (glass) frosted = frostedOverrides(accent);
    // Discord's own class for Nitro gradient themes: unlocks its rules that unset decorative panels
    // and route the remaining surfaces through the --background-gradient-* variables we define
    document.documentElement.classList.toggle("custom-theme-background", glass);

    const dark = [
        shadeOverrides("neutral", background, "--neutral-69-hsl"),
        settings.store.style === "glass" ? glassOverrides(background, accent) : "",
        settings.store.accentTint ? accentTintOverrides(accent) : "",
        roundnessOverrides()
    ].filter(Boolean).join("\n");

    style.textContent = [
        `.theme-dark {\n${dark}\n}`,
        `:root, .theme-dark, .theme-light {\n${brandOverrides(accent)}\n--brand-experiment: var(--brand-500);\n--brand-experiment-560: var(--brand-560);\n--brand-experiment-600: var(--brand-600);\n--text-link: ${hsla(accent, 1, Math.max(accent.l, 68))};\n}`,
        muted,
        frosted
    ].join("\n\n");
}

export default definePlugin({
    name: "FlocordTheme",
    description: "Flocord's own look: a deep violet glass theme with a violet accent. Style and colors are adjustable below.",
    authors: [FlocordDevs.Flocord],
    tags: ["Appearance"],
    enabledByDefault: true,
    settings,
    startAt: StartAt.DOMContentLoaded,

    // Re-renders the theme after another plugin (ThemePresets) wrote the settings directly:
    // setting onChange handlers only run when the value is changed from the settings UI
    applyTheme: apply,

    async start() {
        style = createAndAppendStyle("flocord-theme", managedStyleRootNode);
        try {
            palette = await readPalette();
        } catch (err) {
            logger.warn("Could not read Discord's palette, applying accent only", err);
        }
        apply();
        onceReady.then(apply);
        watchFrostedSurfaces();
    },

    stop() {
        style?.remove();
        style = null;
        document.documentElement.classList.remove("custom-theme-background");
    }
});
