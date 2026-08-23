import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";
import { sendMessage } from "@utils/discord";
import definePlugin from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { ChannelStore, Menu, React, ReactDOM, RestAPI, UserStore, createRoot } from "@webpack/common";

// --- State ---

let splitChannelId: string | null = null;
const listeners = new Set<() => void>();

function setSplitChannel(id: string | null) {
    splitChannelId = id;
    listeners.forEach(fn => fn());
}

function useSplitChannelId() {
    const [id, setId] = React.useState(splitChannelId);
    React.useEffect(() => {
        const handler = () => setId(splitChannelId);
        listeners.add(handler);
        return () => void listeners.delete(handler);
    }, []);
    return id;
}

// --- Types ---

interface RawMessage {
    id: string;
    content: string;
    author: { id: string; username: string; global_name?: string; };
    timestamp: string;
    attachments: { url: string; filename: string; }[];
}

// --- Popup window ---

function SplitPopup() {
    const channelId = useSplitChannelId();

    const [messages, setMessages] = React.useState<RawMessage[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [draft, setDraft] = React.useState("");
    const [sending, setSending] = React.useState(false);

    // Window position — starts bottom-right
    const [pos, setPos] = React.useState({ x: window.innerWidth - 440, y: window.innerHeight - 560 });
    const [size, setSize] = React.useState({ w: 400, h: 500 });

    const dragRef = React.useRef<{ active: boolean; startMouseX: number; startMouseY: number; startPosX: number; startPosY: number; }>({
        active: false, startMouseX: 0, startMouseY: 0, startPosX: 0, startPosY: 0
    });
    const resizeRef = React.useRef<{ active: boolean; startMouseX: number; startMouseY: number; startW: number; startH: number; }>({
        active: false, startMouseX: 0, startMouseY: 0, startW: 400, startH: 500
    });

    const messagesEndRef = React.useRef<HTMLDivElement>(null);
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);

    const channel: Channel | null = channelId ? ChannelStore.getChannel(channelId) : null;
    const channelLabel = channel
        ? (channel.name
            ? `# ${channel.name}`
            : `@ ${channel.recipients?.map(id => UserStore.getUser(id)?.globalName ?? "...").join(", ") ?? "Conversation"}`)
        : (channelId ?? "");

    async function fetchMessages(cid: string) {
        setLoading(true);
        try {
            const res = await RestAPI.get({ url: `/channels/${cid}/messages?limit=50` });
            if (res.ok) setMessages((res.body as RawMessage[]).reverse());
        } catch { /* no permission / offline */ }
        finally { setLoading(false); }
    }

    React.useEffect(() => {
        if (!channelId) { setMessages([]); setDraft(""); return; }
        fetchMessages(channelId);
    }, [channelId]);

    React.useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Global drag / resize listeners
    React.useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (dragRef.current.active) {
                setPos({
                    x: Math.max(0, dragRef.current.startPosX + e.clientX - dragRef.current.startMouseX),
                    y: Math.max(0, dragRef.current.startPosY + e.clientY - dragRef.current.startMouseY),
                });
            }
            if (resizeRef.current.active) {
                setSize({
                    w: Math.max(320, resizeRef.current.startW + e.clientX - resizeRef.current.startMouseX),
                    h: Math.max(300, resizeRef.current.startH + e.clientY - resizeRef.current.startMouseY),
                });
            }
        };
        const onUp = () => {
            dragRef.current.active = false;
            resizeRef.current.active = false;
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
    }, []);

    async function handleSend() {
        const content = draft.trim();
        if (!content || !channelId || sending) return;
        setSending(true);
        try {
            await sendMessage(channelId, { content });
            setDraft("");
            await fetchMessages(channelId);
        } catch { /* no permission */ }
        finally { setSending(false); textareaRef.current?.focus(); }
    }

    function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    }

    if (!channelId) return null;

    // Copy Discord's theme class so CSS variables resolve correctly
    const themeClass = document.documentElement.classList.contains("theme-light") ? "theme-light" : "theme-dark";

    return ReactDOM.createPortal(
        <div
            className={`vc-sv-popup ${themeClass}`}
            style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
        >
            {/* Title bar — drag handle */}
            <div
                className="vc-sv-titlebar"
                onMouseDown={e => {
                    if ((e.target as HTMLElement).closest(".vc-sv-titlebar-btns")) return;
                    dragRef.current = { active: true, startMouseX: e.clientX, startMouseY: e.clientY, startPosX: pos.x, startPosY: pos.y };
                    e.preventDefault();
                }}
            >
                <span className="vc-sv-icon">💬</span>
                <span className="vc-sv-channel-name">{channelLabel}</span>
                <div className="vc-sv-titlebar-btns">
                    <button
                        className="vc-sv-btn-refresh"
                        onClick={() => channelId && fetchMessages(channelId)}
                        title="Actualiser"
                        disabled={loading}
                    >↺</button>
                    <button
                        className="vc-sv-btn-close"
                        onClick={() => setSplitChannel(null)}
                        title="Fermer"
                    >✕</button>
                </div>
            </div>

            {/* Messages */}
            <div className="vc-sv-messages">
                {loading && <div className="vc-sv-state">Chargement…</div>}
                {!loading && messages.length === 0 && (
                    <div className="vc-sv-state">Aucun message.</div>
                )}
                {messages.map(msg => {
                    const name = msg.author.global_name ?? msg.author.username;
                    const initials = name.slice(0, 2).toUpperCase();
                    const ts = new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                    return (
                        <div key={msg.id} className="vc-sv-msg">
                            <div className="vc-sv-avatar">{initials}</div>
                            <div className="vc-sv-msg-body">
                                <div className="vc-sv-msg-header">
                                    <span className="vc-sv-msg-author">{name}</span>
                                    <span className="vc-sv-msg-time">{ts}</span>
                                </div>
                                {msg.content && <div className="vc-sv-msg-content">{msg.content}</div>}
                                {msg.attachments.map(a => (
                                    <a key={a.url} className="vc-sv-attachment" href={a.url} target="_blank" rel="noreferrer">
                                        📎 {a.filename}
                                    </a>
                                ))}
                            </div>
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </div>

            {/* Input bar */}
            <div className="vc-sv-bar">
                <textarea
                    ref={textareaRef}
                    className="vc-sv-input"
                    placeholder={`Écrire dans ${channelLabel}…`}
                    value={draft}
                    rows={1}
                    disabled={sending}
                    onChange={e => setDraft(e.currentTarget.value)}
                    onKeyDown={onKeyDown}
                />
                <button
                    className="vc-sv-send"
                    onClick={handleSend}
                    disabled={!draft.trim() || sending}
                    title="Envoyer"
                >➤</button>
            </div>

            {/* Resize handle — bottom-right corner */}
            <div
                className="vc-sv-resize"
                onMouseDown={e => {
                    resizeRef.current = { active: true, startMouseX: e.clientX, startMouseY: e.clientY, startW: size.w, startH: size.h };
                    e.preventDefault();
                }}
            />
        </div>,
        document.body
    );
}

// --- Context menu patches ---

function makeMenuPatch(getChannelId: (props: any) => string | undefined): NavContextMenuPatchCallback {
    return (children, props) => {
        const cid = getChannelId(props);
        if (!cid) return;
        children.push(
            <Menu.MenuItem
                id="vc-split-view"
                label={splitChannelId === cid ? "Fermer la vue partagée" : "Ouvrir en vue partagée"}
                action={() => setSplitChannel(splitChannelId === cid ? null : cid)}
            />
        );
    };
}

const channelContextPatch = makeMenuPatch(props => props.channel?.id);
const gdmContextPatch = makeMenuPatch(props => props.channel?.id);
const userContextPatch = makeMenuPatch(props => props.channel?.id);

// --- Plugin ---

let popupRoot: ReturnType<typeof createRoot> | null = null;
let popupContainer: HTMLDivElement | null = null;

export default definePlugin({
    name: "SplitView",
    description: "Ouvre une deuxième conversation dans une fenêtre flottante, draggable et redimensionnable.",
    authors: [{ name: "Flocord", id: 0n }],
    tags: ["Chat", "Utility"],

    contextMenus: {
        "channel-context": channelContextPatch,
        "gdm-context": gdmContextPatch,
        "user-context": userContextPatch,
    },

    start() {
        popupContainer = document.createElement("div");
        popupContainer.id = "vc-split-view-root";
        document.body.appendChild(popupContainer);
        popupRoot = createRoot(popupContainer);
        popupRoot.render(
            <ErrorBoundary noop>
                <SplitPopup />
            </ErrorBoundary>
        );
    },

    stop() {
        setSplitChannel(null);
        popupRoot?.unmount();
        popupContainer?.remove();
        popupRoot = null;
        popupContainer = null;
    },
});
