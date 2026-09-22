/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface ThemePreset {
    name: string;
    description?: string;
    style?: string;
    background?: string;
    accent?: string;
    surfaceOpacity?: number;
    backdropIntensity?: number;
    accentTint?: boolean;
    roundness?: number;
    mutedColor?: string;
}

export const PRESETS: ThemePreset[] = [
    {
        name: "Flocord",
        description: "The default violet glass",
        style: "glass",
        background: "#14101c",
        accent: "#8b5cf6",
        surfaceOpacity: 0.55,
        backdropIntensity: 0.8,
        accentTint: true,
        roundness: 1.25,
        mutedColor: "#6d28d9"
    },
    {
        name: "Midnight",
        description: "Deep blue, calm and low contrast",
        style: "glass",
        background: "#0d1220",
        accent: "#3b82f6",
        surfaceOpacity: 0.6,
        backdropIntensity: 0.65,
        accentTint: true,
        roundness: 1.25,
        mutedColor: "#1d4ed8"
    },
    {
        name: "Rosewood",
        description: "Warm pink over near-black",
        style: "glass",
        background: "#1a0f16",
        accent: "#ec4899",
        surfaceOpacity: 0.55,
        backdropIntensity: 0.85,
        accentTint: true,
        roundness: 1.5,
        mutedColor: "#be185d"
    },
    {
        name: "Matcha",
        description: "Green accent, easy on the eyes",
        style: "glass",
        background: "#101a14",
        accent: "#34d399",
        surfaceOpacity: 0.6,
        backdropIntensity: 0.7,
        accentTint: true,
        roundness: 1.25,
        mutedColor: "#059669"
    },
    {
        name: "Ember",
        description: "Orange on charcoal, high energy",
        style: "glass",
        background: "#180f0a",
        accent: "#f97316",
        surfaceOpacity: 0.5,
        backdropIntensity: 0.9,
        accentTint: true,
        roundness: 1.0,
        mutedColor: "#c2410c"
    },
    {
        name: "Graphite",
        description: "Flat, no backdrop, neutral grey",
        style: "flat",
        background: "#16171a",
        accent: "#a1a1aa",
        surfaceOpacity: 0.7,
        backdropIntensity: 0,
        accentTint: false,
        roundness: 0.75,
        mutedColor: "#52525b"
    },
    {
        name: "Vaporwave",
        description: "Cyan and magenta, maximum glow",
        style: "glass",
        background: "#150d20",
        accent: "#22d3ee",
        surfaceOpacity: 0.45,
        backdropIntensity: 1,
        accentTint: true,
        roundness: 1.5,
        mutedColor: "#a21caf"
    },
    {
        name: "Paper",
        description: "Soft dark grey, minimal tint",
        style: "flat",
        background: "#1c1b1f",
        accent: "#c4b5fd",
        surfaceOpacity: 0.8,
        backdropIntensity: 0,
        accentTint: false,
        roundness: 1.0,
        mutedColor: "#7c3aed"
    }
];
