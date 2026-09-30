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
        description: "Deep space, starlight and a violet nebula — the default look",
        style: "glass",
        background: "#0a0a18",
        accent: "#8b5cf6",
        surfaceOpacity: 0.55,
        backdropIntensity: 0.8,
        accentTint: true,
        roundness: 1.25,
        mutedColor: "#6d28d9"
    },
    {
        name: "Nebula",
        description: "Magenta glow over near-black, maximum contrast",
        style: "glass",
        background: "#170a1a",
        accent: "#d946ef",
        surfaceOpacity: 0.5,
        backdropIntensity: 0.9,
        accentTint: true,
        roundness: 1.5,
        mutedColor: "#a21caf"
    },
    {
        name: "Aurora",
        description: "Green-teal glow, like polar light over a dark sky",
        style: "glass",
        background: "#0a1614",
        accent: "#34d399",
        surfaceOpacity: 0.6,
        backdropIntensity: 0.7,
        accentTint: true,
        roundness: 1.25,
        mutedColor: "#059669"
    },
    {
        name: "Eclipse",
        description: "Deep blue, calm and low contrast",
        style: "glass",
        background: "#0a0f1e",
        accent: "#3b82f6",
        surfaceOpacity: 0.6,
        backdropIntensity: 0.65,
        accentTint: true,
        roundness: 1.25,
        mutedColor: "#1d4ed8"
    },
    {
        name: "Supernova",
        description: "Orange-red explosion on charcoal, high energy",
        style: "glass",
        background: "#170d09",
        accent: "#f97316",
        surfaceOpacity: 0.5,
        backdropIntensity: 0.95,
        accentTint: true,
        roundness: 1.0,
        mutedColor: "#c2410c"
    },
    {
        name: "Pulsar",
        description: "Cyan glow, sharp and electric",
        style: "glass",
        background: "#0d1420",
        accent: "#22d3ee",
        surfaceOpacity: 0.45,
        backdropIntensity: 1,
        accentTint: true,
        roundness: 1.5,
        mutedColor: "#0e7490"
    },
    {
        name: "Void",
        description: "Flat, no backdrop, near-black and minimal",
        style: "flat",
        background: "#08080b",
        accent: "#71717a",
        surfaceOpacity: 0.75,
        backdropIntensity: 0,
        accentTint: false,
        roundness: 0.75,
        mutedColor: "#3f3f46"
    },
    {
        name: "Moonlight",
        description: "Soft pale violet-grey, flat and minimal tint",
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
