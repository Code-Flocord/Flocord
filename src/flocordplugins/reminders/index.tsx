/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, sendBotMessage } from "@api/Commands";
import * as DataStore from "@api/DataStore";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { FlocordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Menu, NavigationRouter, showToast, Toasts } from "@webpack/common";

const SoundModule = findByPropsLazy("playSound", "createSound");

const KEY = "Flocord_Reminders";
/** A timer further away than this is only scheduled once the app gets closer to it */
const MAX_TIMEOUT = 2 ** 31 - 1;

interface Reminder {
    id: string;
    text: string;
    due: number;
    /** Where it was created, to offer a jump link */
    link?: string;
}

const settings = definePluginSettings({
    sound: {
        type: OptionType.BOOLEAN,
        description: "Play the notification sound when a reminder fires.",
        default: true
    },
    permanent: {
        type: OptionType.BOOLEAN,
        description: "Keep the reminder on screen until you dismiss it, instead of letting it fade away.",
        default: false
    }
});

let reminders: Reminder[] = [];
const timers = new Map<string, number>();

async function save() {
    await DataStore.set(KEY, reminders);
}

/**
 * Parses "20m", "1h30", "2h 15m", "45s", "tomorrow"… into milliseconds.
 * Returns null when nothing usable was found.
 */
export function parseDuration(input: string): number | null {
    const text = input.trim().toLowerCase();
    if (!text) return null;

    if (text === "demain" || text === "tomorrow") {
        const date = new Date();
        date.setDate(date.getDate() + 1);
        date.setHours(9, 0, 0, 0);
        return date.getTime() - Date.now();
    }

    // Absolute time of day: 18:30 or 18h30
    const clock = /^(\d{1,2})[h:](\d{2})$/.exec(text);
    if (clock) {
        const date = new Date();
        date.setHours(Number(clock[1]), Number(clock[2]), 0, 0);
        if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
        return date.getTime() - Date.now();
    }

    const units: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, j: 86_400_000, d: 86_400_000 };
    let total = 0;
    let matched = false;
    for (const [, amount, unit] of text.matchAll(/(\d+)\s*([smhjd])/g)) {
        total += Number(amount) * units[unit];
        matched = true;
    }
    // "1h30" without a trailing unit means 1 h 30 min
    const compact = /^(\d+)\s*h\s*(\d{1,2})$/.exec(text);
    if (compact) return (Number(compact[1]) * 60 + Number(compact[2])) * 60_000;

    if (!matched) {
        const bare = /^(\d+)$/.exec(text);
        if (bare) return Number(bare[1]) * 60_000; // a bare number means minutes
        return null;
    }
    return total;
}

export function formatDelay(ms: number): string {
    if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`;

    const minutes = Math.round(ms / 60_000);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours < 24) return rest ? `${hours} h ${rest} min` : `${hours} h`;
    const days = Math.floor(hours / 24);
    return `${days} j ${hours % 24} h`;
}

function fire(reminder: Reminder) {
    timers.delete(reminder.id);
    reminders = reminders.filter(r => r.id !== reminder.id);
    void save();

    showNotification({
        title: "Reminder",
        body: reminder.text,
        permanent: settings.store.permanent,
        noPersist: false,
        dismissOnClick: true,
        onClick: reminder.link ? () => NavigationRouter.transitionTo(reminder.link!) : undefined
    });

    if (settings.store.sound) {
        try {
            SoundModule.playSound("message1");
        } catch {
            // the sound is a nicety, the notification is what matters
        }
    }
}

function schedule(reminder: Reminder) {
    const delay = reminder.due - Date.now();
    if (delay <= 0) return fire(reminder);

    // setTimeout tops out at ~24.8 days: re-schedule in chunks until close enough
    const timer = window.setTimeout(() => {
        if (reminder.due - Date.now() > 0) schedule(reminder);
        else fire(reminder);
    }, Math.min(delay, MAX_TIMEOUT));

    timers.set(reminder.id, timer);
}

function add(text: string, delay: number, link?: string): Reminder {
    const reminder: Reminder = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, due: Date.now() + delay, link };
    reminders.push(reminder);
    void save();
    schedule(reminder);
    return reminder;
}

function messageLink(guildId: string | null | undefined, channelId: string, messageId: string) {
    return `/channels/${guildId ?? "@me"}/${channelId}/${messageId}`;
}

export default definePlugin({
    name: "Reminders",
    description: "Set reminders with /remind, or from a message's context menu. A notification brings you back to where you were.",
    authors: [FlocordDevs.Flocord],
    tags: ["Utility"],
    settings,

    async start() {
        reminders = await DataStore.get<Reminder[]>(KEY) ?? [];
        reminders.forEach(schedule);
    },

    stop() {
        timers.forEach(clearTimeout);
        timers.clear();
    },

    commands: [
        {
            name: "remind",
            description: "Remind me about something later",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "when",
                    description: "20m, 1h30, 2j, 18:30, demain…",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                },
                {
                    name: "what",
                    description: "What to remind you about",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: (options, ctx) => {
                const when = options.find(o => o.name === "when")?.value as string;
                const what = options.find(o => o.name === "what")?.value as string;
                const delay = parseDuration(when);

                if (delay == null || delay <= 0) {
                    return sendBotMessage(ctx.channel.id, { content: `\`${when}\` is not a duration I understand. Try \`20m\`, \`1h30\`, \`2j\`, \`18:30\` or \`demain\`.` });
                }

                const reminder = add(what, delay, `/channels/${ctx.guild?.id ?? "@me"}/${ctx.channel.id}`);
                sendBotMessage(ctx.channel.id, { content: `Reminder set in **${formatDelay(delay)}** (${new Date(reminder.due).toLocaleTimeString()}) : ${what}` });
            }
        },
        {
            name: "reminders",
            description: "List your pending reminders",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [],
            execute: (_options, ctx) => {
                if (!reminders.length) return sendBotMessage(ctx.channel.id, { content: "No pending reminder." });

                const list = [...reminders]
                    .sort((a, b) => a.due - b.due)
                    .map(r => `• **${formatDelay(r.due - Date.now())}** — ${r.text}`)
                    .join("\n");
                sendBotMessage(ctx.channel.id, { content: `**Pending reminders**\n${list}` });
            }
        },
        {
            name: "reminders-clear",
            description: "Cancel every pending reminder",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [],
            execute: (_options, ctx) => {
                const count = reminders.length;
                timers.forEach(clearTimeout);
                timers.clear();
                reminders = [];
                void save();
                sendBotMessage(ctx.channel.id, { content: count ? `${count} reminder(s) cancelled.` : "No pending reminder." });
            }
        }
    ],

    contextMenus: {
        message(children, { message }: { message: any; }) {
            if (!message?.id) return;

            const link = messageLink(message.guild_id, message.channel_id, message.id);
            const preview = (message.content || "this message").slice(0, 60);

            children.push(
                <Menu.MenuItem id="flocord-remind" label="Remind me about this">
                    {[
                        ["In 10 minutes", 10 * 60_000],
                        ["In 30 minutes", 30 * 60_000],
                        ["In 1 hour", 3_600_000],
                        ["In 3 hours", 3 * 3_600_000],
                        ["Tomorrow morning", (() => {
                            const date = new Date();
                            date.setDate(date.getDate() + 1);
                            date.setHours(9, 0, 0, 0);
                            return date.getTime() - Date.now();
                        })()]
                    ].map(([label, delay]) => (
                        <Menu.MenuItem
                            key={label as string}
                            id={`flocord-remind-${delay}`}
                            label={label as string}
                            action={() => {
                                add(preview, delay as number, link);
                                showToast(`Reminder set in ${formatDelay(delay as number)}.`, Toasts.Type.SUCCESS);
                            }}
                        />
                    ))}
                </Menu.MenuItem>
            );
        }
    }
});
