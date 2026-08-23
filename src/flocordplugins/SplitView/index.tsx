import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { sendMessage } from "@utils/discord";
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

// --- Message types (minimal) ---

interface RawMessage {
    id: string;
    content: string;
    author: { id: string; username: string; global_name?: string; };
    timestamp: string;
    attachments: { url: string; filename: string; }[];
    referenced_message?: RawMessage | null;
}

// --- Panel component ---

function SplitPanel() {
    const channelId = useSplitChannelId();
    const [messages, setMessages] = React.useState<RawMessage[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [width, setWidth] = React.useState(380);
    const dragging = React.useRef(false);
    const startX = React.useRef(0);
    const startW = React.useRef(380);
    const messagesEndRef = React.useRef<HTMLDivElement>(null);

    const [draft, setDraft] = React.useState("");
    const [sending, setSending] = React.useState(false);
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);

    const channel: Channel | null = channelId ? ChannelStore.getChannel(channelId) : null;

    async function fetchMessages(cid: string) {
        setLoading(true);
        try {
            const res = await RestAPI.get({ url: `/channels/${cid}/messages?limit=50` });
            if (res.ok) setMessages((res.body as RawMessage[]).reverse());
        } catch {
            // ignore — no permission or offline
        } finally {
            setLoading(false);
        }
    }

    React.useEffect(() => {
        if (!channelId) { setMessages([]); setDraft(""); return; }
        fetchMessages(channelId);
    }, [channelId]);

    async function handleSend() {
        const content = draft.trim();
        if (!content || !channelId || sending) return;
        setSending(true);
        try {
            await sendMessage(channelId, { content });
            setDraft("");
            // reload to show the new message
            await fetchMessages(channelId);
        } catch {
            // ignore — no permission or offline
        } finally {
            setSending(false);
            textareaRef.current?.focus();
        }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }

    // Auto-scroll to bottom when new messages arrive
    React.useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Resize handle drag
    React.useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!dragging.current) return;
            const delta = startX.current - e.clientX;
            setWidth(Math.max(260, Math.min(900, startW.current + delta)));
        };
        const onUp = () => { dragging.current = false; };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
    }, []);

    if (!channelId) return null;

    const channelLabel = channel
        ? (channel.name ? `# ${channel.name}` : `@ ${channel.recipients?.map(id => UserStore.getUser(id)?.globalName ?? "...").join(", ") ?? "Conversation"}`)
        : channelId;

    return ReactDOM.createPortal(
        <div className="vc-sv-panel" style={{ width }}>
            <div
                className="vc-sv-handle"
                onMouseDown={e => {
                    dragging.current = true;
                    startX.current = e.clientX;
                    startW.current = width;
                    e.preventDefault();
                }}
            />
            <div className="vc-sv-header">
                <span className="vc-sv-title">{channelLabel}</span>
                <button
                    className="vc-sv-close"
                    onClick={() => setSplitChannel(null)}
                    title="Fermer"
                >
                    ✕
                </button>
            </div>

            <div className="vc-sv-messages">
                {loading && <div className="vc-sv-loading">Chargement…</div>}
                {!loading && messages.length === 0 && (
                    <div className="vc-sv-empty">Aucun message à afficher.</div>
                )}
                {messages.map(msg => (
                    <div key={msg.id} className="vc-sv-message">
                        <span className="vc-sv-author">
                            {msg.author.global_name ?? msg.author.username}
                        </span>
                        {msg.content && (
                            <span className="vc-sv-content">{msg.content}</span>
                        )}
                        {msg.attachments.length > 0 && (
                            <span className="vc-sv-attachments">
                                {msg.attachments.map(a => (
                                    <a key={a.url} href={a.url} target="_blank" rel="noreferrer">
                                        {a.filename}
                                    </a>
                                ))}
                            </span>
                        )}
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            <div className="vc-sv-composer">
                <textarea
                    ref={textareaRef}
                    className="vc-sv-input"
                    placeholder="Envoyer un message… (Entrée pour envoyer, Maj+Entrée pour sauter une ligne)"
                    value={draft}
                    onChange={e => setDraft(e.currentTarget.value)}
                    onKeyDown={handleKeyDown}
                    disabled={sending}
                    rows={1}
                />
                <div className="vc-sv-composer-actions">
                    <button
                        className="vc-sv-refresh"
                        onClick={() => channelId && fetchMessages(channelId)}
                        title="Actualiser"
                        disabled={loading}
                    >
                        ↺
                    </button>
                    <button
                        className="vc-sv-send"
                        onClick={handleSend}
                        disabled={!draft.trim() || sending}
                        title="Envoyer"
                    >
                        ➤
                    </button>
                </div>
            </div>
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

let panelRoot: ReturnType<typeof createRoot> | null = null;
let panelContainer: HTMLDivElement | null = null;

export default definePlugin({
    name: "SplitView",
    description: "Ouvre une deuxième conversation en panneau latéral, côte à côte avec le canal actif.",
    authors: [{ name: "Flocord", id: 0n }],
    tags: ["Chat", "Utility"],

    contextMenus: {
        "channel-context": channelContextPatch,
        "gdm-context": gdmContextPatch,
        "user-context": userContextPatch,
    },

    start() {
        panelContainer = document.createElement("div");
        panelContainer.id = "vc-split-view-root";
        document.body.appendChild(panelContainer);
        panelRoot = createRoot(panelContainer);
        panelRoot.render(
            <ErrorBoundary noop>
                <SplitPanel />
            </ErrorBoundary>
        );
    },

    stop() {
        setSplitChannel(null);
        panelRoot?.unmount();
        panelContainer?.remove();
        panelRoot = null;
        panelContainer = null;
    },
});
