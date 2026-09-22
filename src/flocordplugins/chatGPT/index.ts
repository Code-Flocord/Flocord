/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, sendBotMessage } from "@api/Commands";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { FlocordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

const DISCORD_MESSAGE_LIMIT = 1900;
const DEFAULT_OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_TITLE = "Flocord ChatGPT Plugin";
const FREE_FALLBACK_MODELS = [
    "google/gemini-2.0-flash-exp:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "qwen/qwen-2.5-vl-72b-instruct:free",
    "deepseek/deepseek-r1:free",
    "mistralai/mistral-small-3.1-24b-instruct:free"
] as const;

type ChatRole = "system" | "user" | "assistant";
type ChatMessage = {
    role: ChatRole;
    content: string;
};

const settings = definePluginSettings({
    apiKey: {
        type: OptionType.STRING,
        description: "Your OpenRouter API key (get one at https://openrouter.ai/keys).",
        default: "",
        placeholder: "sk-or-v1-...",
        componentProps: {
            type: "password"
        }
    },
    model: {
        type: OptionType.SELECT,
        description: "OpenRouter model to use.",
        default: "google/gemini-2.0-flash-exp:free",
        options: [
            { label: "Gemini 2.0 Flash - Free", value: "google/gemini-2.0-flash-exp:free" },
            { label: "Llama 3.3 70B Instruct - Free", value: "meta-llama/llama-3.3-70b-instruct:free" },
            { label: "Qwen 2.5 VL 72B - Free", value: "qwen/qwen-2.5-vl-72b-instruct:free" },
            { label: "DeepSeek R1 - Free", value: "deepseek/deepseek-r1:free" },
            { label: "Mistral Small 3.1 - Free", value: "mistralai/mistral-small-3.1-24b-instruct:free" },
            { label: "Claude 3.5 Haiku", value: "anthropic/claude-3.5-haiku" },
            { label: "GPT-4o Mini", value: "openai/gpt-4o-mini" },
            { label: "GPT-4o", value: "openai/gpt-4o" }
        ]
    },
    endpoint: {
        type: OptionType.STRING,
        description: "OpenAI-compatible endpoint to use.",
        default: DEFAULT_OPENROUTER_ENDPOINT,
        placeholder: "https://openrouter.ai/api/v1/chat/completions"
    },
    maxTokens: {
        type: OptionType.SLIDER,
        description: "Maximum number of tokens in the reply.",
        default: 500,
        markers: [100, 250, 500, 1000, 2000],
        minValue: 50,
        maxValue: 4000,
        stickToMarkers: false
    },
    temperature: {
        type: OptionType.SLIDER,
        description: "Reply creativity (0 = precise, 1 = creative).",
        default: 0.7,
        markers: [0, 0.3, 0.7, 1.0],
        minValue: 0,
        maxValue: 1,
        stickToMarkers: false
    },
    timeoutSeconds: {
        type: OptionType.SLIDER,
        description: "Maximum time to wait for the OpenRouter API, in seconds.",
        default: 45,
        markers: [10, 20, 30, 45, 60],
        minValue: 5,
        maxValue: 120,
        stickToMarkers: false
    },
    enableFallbackModels: {
        type: OptionType.BOOLEAN,
        description: "Automatically fall back to other free models when the main model fails.",
        default: true
    },
    enableMemory: {
        type: OptionType.BOOLEAN,
        description: "Keep a conversation memory per user.",
        default: true
    },
    memoryMessages: {
        type: OptionType.SLIDER,
        description: "Maximum number of messages kept per user.",
        default: 8,
        markers: [2, 4, 8, 12, 16],
        minValue: 0,
        maxValue: 20,
        stickToMarkers: false
    },
    systemPrompt: {
        type: OptionType.STRING,
        description: "System prompt used to customize how ChatGPT behaves.",
        default: "You are a helpful and friendly assistant. Answer concisely and clearly.",
        placeholder: "You are an assistant..."
    },
    includeModelTag: {
        type: OptionType.BOOLEAN,
        description: "Show which model was used in the reply.",
        default: true
    },
    enableNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show notifications for errors and successes.",
        default: true
    }
});

let isInitialized = false;
const activeRequests = new Set<string>();
let requestCount = 0;
let successCount = 0;
let failureCount = 0;
let lastError = "";
const conversationMemory = new Map<string, ChatMessage[]>();

function notify(title: string, body: string, isError = false) {
    if (!settings.store.enableNotifications) return;

    void showNotification({
        title: isError ? `Error: ${title}` : `OK: ${title}`,
        body,
        icon: undefined
    });
}

function validateApiKey(apiKey: string) {
    const trimmed = apiKey.trim();
    return Boolean(trimmed && (trimmed.startsWith("sk-or-v1-") || trimmed.startsWith("sk-")) && trimmed.length > 20);
}

function maskApiKey(apiKey: string) {
    if (!validateApiKey(apiKey)) return "Not configured";
    const trimmed = apiKey.trim();
    return `${trimmed.slice(0, 7)}...${trimmed.slice(-4)}`;
}

function normalizeResponse(content: string) {
    return content.replace(/\r\n/g, "\n").trim();
}

function getRequestKey(ctx: any) {
    return String(ctx?.user?.id ?? ctx?.author?.id ?? ctx?.message?.author?.id ?? ctx?.channel?.id ?? "global");
}

function getConversationHistory(requestKey: string) {
    if (!settings.store.enableMemory || settings.store.memoryMessages <= 0) return [];
    return conversationMemory.get(requestKey) ?? [];
}

function pushConversationHistory(requestKey: string, userPrompt: string, assistantReply: string) {
    if (!settings.store.enableMemory || settings.store.memoryMessages <= 0) return;

    const current = conversationMemory.get(requestKey) ?? [];
    current.push(
        { role: "user", content: userPrompt },
        { role: "assistant", content: assistantReply }
    );

    const maxMessages = Math.max(0, Math.round(settings.store.memoryMessages));
    conversationMemory.set(requestKey, current.slice(-maxMessages));
}

function clearConversationHistory(requestKey?: string) {
    if (requestKey) {
        conversationMemory.delete(requestKey);
        return;
    }

    conversationMemory.clear();
}

function shouldTryFallback(errorMessage: string) {
    const normalized = errorMessage.toLowerCase();
    return normalized.includes("429")
        || normalized.includes("rate")
        || normalized.includes("tempor")
        || normalized.includes("unavailable")
        || normalized.includes("overloaded")
        || normalized.includes("503")
        || normalized.includes("502");
}

function getModelCandidates(selectedModel: string) {
    return [selectedModel, ...FREE_FALLBACK_MODELS.filter(model => model !== selectedModel)];
}

function splitMessage(content: string, limit = DISCORD_MESSAGE_LIMIT) {
    if (content.length <= limit) return [content];

    const parts: string[] = [];
    let remaining = content;

    while (remaining.length > limit) {
        let cut = remaining.lastIndexOf("\n", limit);
        if (cut < limit / 2) cut = remaining.lastIndexOf(" ", limit);
        if (cut < limit / 2) cut = limit;

        parts.push(remaining.slice(0, cut).trim());
        remaining = remaining.slice(cut).trim();
    }

    if (remaining) parts.push(remaining);
    return parts.filter(Boolean);
}

async function sendResponse(channelId: string, response: string, model: string) {
    const prefix = settings.store.includeModelTag ? `**ChatGPT** (${model})\n\n` : "**ChatGPT**\n\n";
    const chunks = splitMessage(response, DISCORD_MESSAGE_LIMIT);

    chunks.forEach((chunk, index) => {
        sendBotMessage(channelId, {
            content: index === 0 ? `${prefix}${chunk}` : chunk
        });
    });
}

async function callChatGPT(prompt: string, requestKey: string) {
    const {
        apiKey,
        enableFallbackModels,
        endpoint,
        maxTokens,
        model,
        systemPrompt,
        temperature,
        timeoutSeconds
    } = settings.store;

    const trimmedApiKey = apiKey.trim();
    const selectedModel = model || FREE_FALLBACK_MODELS[0];
    if (!validateApiKey(trimmedApiKey)) {
        throw new Error("Invalid API key. Set a valid key in the plugin settings.");
    }

    const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        ...getConversationHistory(requestKey),
        { role: "user", content: prompt }
    ];

    const candidates = enableFallbackModels ? getModelCandidates(selectedModel) : [selectedModel];
    let lastAttemptError = "";

    for (const candidateModel of candidates) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Math.round(timeoutSeconds * 1000));

        try {
            const response = await fetch(endpoint || DEFAULT_OPENROUTER_ENDPOINT, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${trimmedApiKey}`,
                    "HTTP-Referer": "https://github.com/Code-Flocord/Flocord",
                    "X-Title": OPENROUTER_TITLE
                },
                body: JSON.stringify({
                    model: candidateModel,
                    messages,
                    max_tokens: Math.round(maxTokens),
                    temperature: Math.round(temperature * 100) / 100
                }),
                signal: controller.signal
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({} as any));
                let errorMessage = `API error (${response.status})`;

                if (errorData?.error?.message) {
                    errorMessage += `: ${errorData.error.message}`;
                } else if (response.status === 401) {
                    errorMessage += ": invalid or expired OpenRouter API key";
                } else if (response.status === 429) {
                    errorMessage += ": rate limit reached, try again later";
                }

                throw new Error(errorMessage);
            }

            const data = await response.json();
            const content = data?.choices?.[0]?.message?.content;

            if (typeof content !== "string" || !content.trim()) {
                throw new Error("Unexpected response from the OpenRouter API");
            }

            return {
                content: normalizeResponse(content),
                model: candidateModel,
                usedFallback: candidateModel !== selectedModel
            };
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
                lastAttemptError = "Request timed out: the OpenRouter API took too long to reply";
            } else {
                lastAttemptError = error instanceof Error ? error.message : "Unknown error";
            }

            if (!enableFallbackModels || candidateModel === candidates[candidates.length - 1] || !shouldTryFallback(lastAttemptError)) {
                throw new Error(lastAttemptError);
            }
        } finally {
            clearTimeout(timeout);
        }
    }

    throw new Error(lastAttemptError || "No OpenRouter model managed to reply");
}

export default definePlugin({
    name: "ChatGPT",
    description: "Use ChatGPT directly from Discord, with configurable settings.",
    authors: [FlocordDevs.Flocord],
    dependencies: ["CommandsAPI"],
    settings,
    commands: [
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "chatgpt",
            description: "Ask ChatGPT a question",
            options: [
                {
                    name: "question",
                    description: "Your question for ChatGPT",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: async (opts, ctx) => {
                const requestKey = getRequestKey(ctx);
                const question = opts.find(opt => opt.name === "question")?.value;

                if (!question || typeof question !== "string") {
                    sendBotMessage(ctx.channel.id, {
                        content: "No question provided."
                    });
                    return;
                }

                if (activeRequests.has(requestKey)) {
                    sendBotMessage(ctx.channel.id, {
                        content: "A ChatGPT request is already running. Please wait."
                    });
                    return;
                }

                if (!validateApiKey(settings.store.apiKey)) {
                    sendBotMessage(ctx.channel.id, {
                        content: "OpenRouter API key is missing or invalid. Set it in the ChatGPT plugin settings."
                    });
                    return;
                }

                activeRequests.add(requestKey);
                requestCount++;

                try {
                    const result = await callChatGPT(question, requestKey);
                    successCount++;
                    lastError = "";

                    pushConversationHistory(requestKey, question, result.content);

                    notify(
                        "ChatGPT",
                        result.usedFallback
                            ? `Reply generated with fallback model: ${result.model}`
                            : "Reply generated"
                    );
                    await sendResponse(ctx.channel.id, result.content, result.model);
                } catch (error) {
                    failureCount++;
                    lastError = error instanceof Error ? error.message : "Unknown error";
                    console.error("[ChatGPT] Command failed:", error);

                    notify("ChatGPT", lastError, true);
                    sendBotMessage(ctx.channel.id, {
                        content: `**ChatGPT error**: ${lastError}`
                    });
                } finally {
                    activeRequests.delete(requestKey);
                }
            }
        },
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "chatgpt-info",
            description: "Show the ChatGPT configuration",
            options: [],
            execute: async (_opts, ctx) => {
                const requestKey = getRequestKey(ctx);
                const hasValidKey = validateApiKey(settings.store.apiKey);
                const keyStatus = hasValidKey ? "Configured" : "Missing or invalid";
                const memoryLength = getConversationHistory(requestKey).length;

                sendBotMessage(ctx.channel.id, {
                    content:
                        "**ChatGPT / OpenRouter configuration**\n\n" +
                        `**API key**: ${keyStatus}\n` +
                        `**Masked key**: ${maskApiKey(settings.store.apiKey)}\n` +
                        `**Endpoint**: ${settings.store.endpoint}\n` +
                        `**Model**: ${settings.store.model}\n` +
                        `**Free fallback**: ${settings.store.enableFallbackModels ? "Enabled" : "Disabled"}\n` +
                        `**Memory**: ${settings.store.enableMemory ? `Enabled (${memoryLength} messages)` : "Disabled"}\n` +
                        `**Max tokens**: ${settings.store.maxTokens}\n` +
                        `**Temperature**: ${settings.store.temperature}\n` +
                        `**Timeout**: ${settings.store.timeoutSeconds}s\n` +
                        `**Status**: ${activeRequests.size > 0 ? `${activeRequests.size} request(s) running` : "Ready"}\n` +
                        `**Requests**: ${requestCount} total / ${successCount} succeeded / ${failureCount} failed\n` +
                        `${lastError ? `**Last error**: ${lastError}\n` : ""}` +
                        `\n${!hasValidKey ? "Set your OpenRouter API key in the plugin settings." : ""}`
                });
            }
        },
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "chatgpt-reset",
            description: "Clear your ChatGPT conversation memory",
            options: [],
            execute: async (_opts, ctx) => {
                clearConversationHistory(getRequestKey(ctx));
                sendBotMessage(ctx.channel.id, {
                    content: "ChatGPT memory cleared for your user."
                });
            }
        }
    ],
    start() {
        if (isInitialized) return;

        isInitialized = true;
        activeRequests.clear();

        if (!validateApiKey(settings.store.apiKey)) {
            notify(
                "ChatGPT Plugin",
                "OpenRouter API key is not configured. Set your key in the plugin settings.",
                true
            );
            return;
        }

        notify("ChatGPT Plugin", "Plugin enabled.");
    },
    stop() {
        isInitialized = false;
        activeRequests.clear();
        clearConversationHistory();
        notify("ChatGPT Plugin", "Plugin disabled.");
    }
});
