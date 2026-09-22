/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { FlocordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

import managedStyle from "./style.css?managed";

const settings = definePluginSettings({
    hideServers: {
        type: OptionType.BOOLEAN,
        description: "Hide the server list.",
        default: true,
        onChange: () => refresh()
    },
    hideChannels: {
        type: OptionType.BOOLEAN,
        description: "Hide the channel list.",
        default: true,
        onChange: () => refresh()
    },
    hideMembers: {
        type: OptionType.BOOLEAN,
        description: "Hide the member list.",
        default: true,
        onChange: () => refresh()
    },
    hideHeader: {
        type: OptionType.BOOLEAN,
        description: "Empty the channel header bar. The focus mode button stays visible so you can always leave.",
        default: false,
        onChange: () => refresh()
    },
    keepUserArea: {
        type: OptionType.BOOLEAN,
        description: "Keep the account panel (mute, deafen, settings) visible when the channel list is hidden.",
        default: true,
        onChange: () => refresh()
    },
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Focus mode is on.",
        default: false,
        hidden: true
    }
});

const CLASS = "flocord-focus-mode";

function refresh() {
    document.documentElement.classList.toggle(CLASS, settings.store.enabled);
    for (const [name, on] of [
        ["servers", settings.store.hideServers],
        ["channels", settings.store.hideChannels],
        ["members", settings.store.hideMembers],
        ["header", settings.store.hideHeader],
        ["user-area", settings.store.hideChannels && !settings.store.keepUserArea]
    ] as Array<[string, boolean]>) {
        document.documentElement.classList.toggle(`${CLASS}-${name}`, settings.store.enabled && on);
    }
}

function toggle() {
    settings.store.enabled = !settings.store.enabled;
    refresh();
}

function Icon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" width={20} height={20} {...props}>
            <path
                fill="currentColor"
                d="M12 5c-5 0-9 4.5-9 7s4 7 9 7 9-4.5 9-7-4-7-9-7Zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Zm0-2a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
            />
        </svg>
    );
}

function FocusButton() {
    const { enabled } = settings.use(["enabled"]);

    return (
        <HeaderBarButton
            className={`${CLASS}-toggle`}
            icon={Icon}
            tooltip={enabled ? "Leave focus mode" : "Focus mode"}
            selected={enabled}
            onClick={toggle}
        />
    );
}

export default definePlugin({
    name: "FocusMode",
    description: "Hides the server, channel and member lists to keep only the conversation. Toggle from the channel header or with a keybind.",
    authors: [FlocordDevs.Flocord],
    tags: ["Appearance"],
    dependencies: ["HeaderBarAPI"],
    settings,
    managedStyle,

    headerBarButton: {
        icon: Icon,
        render: FocusButton,
        priority: 1000
    },

    patches: [
        {
            find: "DISCONNECT_FROM_VOICE_CHANNEL]",
            replacement: {
                match: /\[\i\.\i\.DISCONNECT_FROM_VOICE_CHANNEL/,
                replace: '["FLOCORD_FOCUS_MODE"]:{onTrigger(){$self.toggle()},keyEvents:{keyUp:!0,keyDown:!1,blurred:!1,focused:!0}},$&'
            }
        },
        {
            find: '"push-to-talk-priority"',
            replacement: {
                match: /(\{id:.{0,25}?value:\i\.\i\.UNASSIGNED)/,
                replace: '{id:"flocord-focus-mode",value:"FLOCORD_FOCUS_MODE",label:"Focus Mode (Flocord)"},$1'
            }
        }
    ],

    toggle,

    start() {
        refresh();
    },

    stop() {
        settings.store.enabled = false;
        refresh();
    }
});
