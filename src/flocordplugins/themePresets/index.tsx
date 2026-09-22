/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { plugins as registeredPlugins } from "@api/PluginManager";
import { definePluginSettings, Settings } from "@api/Settings";
import { Button } from "@components/Button";
import { Divider } from "@components/Divider";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { copyToClipboard } from "@utils/clipboard";
import { FlocordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { Margins } from "@utils/margins";
import definePlugin, { OptionType } from "@utils/types";
import { React, showToast, TextInput, Toasts } from "@webpack/common";

import { PRESETS, ThemePreset } from "./presets";

const cl = classNameFactory("vc-theme-presets-");

/** The FlocordTheme settings a preset carries */
const KEYS = ["style", "background", "accent", "surfaceOpacity", "backdropIntensity", "accentTint", "roundness", "mutedColor"] as const;
type Key = typeof KEYS[number];

const settings = definePluginSettings({
    presets: {
        type: OptionType.COMPONENT,
        description: "Theme presets",
        component: () => <PresetPicker />
    }
});

function themeSettings(): Record<string, any> | null {
    const store = Settings.plugins.FlocordTheme;
    return store?.enabled === false || store == null ? null : store;
}

function apply(preset: ThemePreset) {
    const store = themeSettings();
    if (!store) {
        showToast("Enable the FlocordTheme plugin first.", Toasts.Type.FAILURE);
        return;
    }

    for (const key of KEYS) {
        const value = preset[key];
        if (value !== undefined) store[key] = value;
    }

    // Writing the settings does not run FlocordTheme's onChange handlers, so the stylesheet
    // has to be rebuilt explicitly
    (registeredPlugins.FlocordTheme as any)?.applyTheme?.();

    showToast(`Theme preset "${preset.name}" applied.`, Toasts.Type.SUCCESS);
}

/** A preset code is the settings as base64 JSON, short enough to paste in a chat message */
function currentCode(): string {
    const store = themeSettings();
    if (!store) return "";

    const preset: Record<string, any> = {};
    for (const key of KEYS) preset[key] = store[key];
    return `flocord:${btoa(JSON.stringify(preset))}`;
}

function importCode(code: string): boolean {
    try {
        const json = JSON.parse(atob(code.trim().replace(/^flocord:/, "")));
        const preset: ThemePreset = { name: "Imported", ...json };
        // Only keep the keys we know, so a malformed code cannot write arbitrary settings
        for (const key of Object.keys(preset) as Key[]) {
            if (key !== "name" as any && !KEYS.includes(key)) delete preset[key];
        }
        apply(preset);
        return true;
    } catch {
        return false;
    }
}

function Swatch({ preset }: { preset: ThemePreset; }) {
    return (
        <button className={cl("card")} onClick={() => apply(preset)}>
            <span className={cl("preview")} style={{ background: `linear-gradient(135deg, ${preset.accent} 0%, ${preset.background} 70%)` }} />
            <span className={cl("name")}>{preset.name}</span>
            <span className={cl("description")}>{preset.description}</span>
        </button>
    );
}

function PresetPicker() {
    const [code, setCode] = React.useState("");

    return (
        <div>
            <Heading>Presets</Heading>
            <Paragraph className={Margins.bottom8}>
                Click a preset to apply it to FlocordTheme. Your current colors are replaced, nothing else changes.
            </Paragraph>
            <div className={cl("grid")}>
                {PRESETS.map(preset => <Swatch key={preset.name} preset={preset} />)}
            </div>

            <Divider className={Margins.top20} />

            <Heading className={Margins.top20}>Share</Heading>
            <Paragraph className={Margins.bottom8}>
                Copy your current theme as a code, or paste someone else's to apply it.
            </Paragraph>
            <div className={cl("share")}>
                <Button
                    variant="secondary"
                    size="small"
                    onClick={() => {
                        const code = currentCode();
                        if (!code) return showToast("Enable the FlocordTheme plugin first.", Toasts.Type.FAILURE);
                        copyToClipboard(code);
                        showToast("Theme code copied.", Toasts.Type.SUCCESS);
                    }}
                >
                    Copy my theme
                </Button>
                <TextInput
                    value={code}
                    onChange={setCode}
                    placeholder="flocord:…"
                />
                <Button
                    variant="primary"
                    size="small"
                    disabled={!code.trim()}
                    onClick={() => {
                        if (importCode(code)) setCode("");
                        else showToast("That code is not valid.", Toasts.Type.FAILURE);
                    }}
                >
                    Apply code
                </Button>
            </div>
        </div>
    );
}

export default definePlugin({
    name: "ThemePresets",
    description: "Ready-made color presets for FlocordTheme, and share your own as a short code.",
    authors: [FlocordDevs.Flocord],
    tags: ["Appearance"],
    settings
});
