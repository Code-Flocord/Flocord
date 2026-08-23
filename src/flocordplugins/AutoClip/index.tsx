import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import { ChannelStore, FluxDispatcher, Modal, React, openModal } from "@webpack/common";

const Native = VencordNative.pluginHelpers.AutoClip as PluginNative<typeof import("./native")>;

// ── localStorage prefs (dynamic device names) ──────────────────
const K = "Flocord_AutoClip_";
const getPref = (k: string, d = "") => { try { return localStorage.getItem(K + k) ?? d; } catch { return d; } };
const setPref = (k: string, v: string) => { try { localStorage.setItem(K + k, v); } catch {} };

// ── Settings panel ─────────────────────────────────────────────
const settings = definePluginSettings({
    captureSystemAudio: {
        type: OptionType.BOOLEAN,
        description: "Enregistrer la sortie audio système (loopback WASAPI)",
        default: true,
    },
    captureScreen: {
        type: OptionType.BOOLEAN,
        description: "Enregistrer l'écran (vidéo)",
        default: true,
    },
    ffmpegStatus: {
        type: OptionType.COMPONENT,
        description: "",
        component: FfmpegStatus,
    },
    micPicker: {
        type: OptionType.COMPONENT,
        description: "Microphone d'entrée",
        component: MicPicker,
    },
    outputPicker: {
        type: OptionType.COMPONENT,
        description: "Sortie audio (loopback)",
        component: OutputPicker,
    },
    screenPicker: {
        type: OptionType.COMPONENT,
        description: "Écran à enregistrer",
        component: ScreenPicker,
    },
});

// ── Shared picker styles ───────────────────────────────────────
const selectSt: React.CSSProperties = {
    background: "var(--input-background)",
    color: "var(--text-normal)",
    border: "1px solid var(--background-modifier-accent)",
    borderRadius: 4,
    padding: "5px 8px",
    width: "100%",
    marginTop: 6,
    fontSize: 14,
    cursor: "pointer",
};

function Label({ t }: { t: string }) {
    return <span style={{ fontSize: 13, fontWeight: 600, color: "var(--header-secondary)" }}>{t}</span>;
}

// ── ffmpeg status banner ───────────────────────────────────────
function FfmpegStatus() {
    const [ok, setOk] = React.useState<boolean | null>(null);
    React.useEffect(() => { Native.checkFfmpeg().then(setOk).catch(() => setOk(false)); }, []);

    if (ok === null) return null;
    return (
        <div style={{
            padding: "6px 10px", borderRadius: 4, fontSize: 12, marginBottom: 4,
            background: ok ? "rgba(59,165,93,0.15)" : "rgba(237,66,69,0.15)",
            color: ok ? "var(--green-360)" : "var(--red-400)",
        }}>
            {ok
                ? "✔ ffmpeg détecté — enregistrement MP4 actif."
                : "✖ ffmpeg introuvable — installe-le et ajoute-le au PATH Windows pour activer l'enregistrement."}
        </div>
    );
}

// ── Mic picker (WASAPI inputs) ─────────────────────────────────
function MicPicker() {
    const [devices, setDevices] = React.useState<string[]>([]);
    const [value, setValue] = React.useState(() => getPref("mic", ""));

    React.useEffect(() => {
        Native.listWasapiDevices("input").then(setDevices).catch(() => {});
    }, []);

    const handle = (v: string) => { setValue(v); setPref("mic", v); };

    return (
        <div style={{ marginTop: 4 }}>
            <Label t="Microphone d'entrée" />
            <select style={selectSt} value={value} onChange={e => handle(e.target.value)}>
                <option value="">Microphone par défaut</option>
                {devices.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
        </div>
    );
}

// ── Output picker (WASAPI outputs → loopback) ──────────────────
function OutputPicker() {
    const [devices, setDevices] = React.useState<string[]>([]);
    const [value, setValue] = React.useState(() => getPref("output", ""));

    React.useEffect(() => {
        Native.listWasapiDevices("output").then(setDevices).catch(() => {});
    }, []);

    const handle = (v: string) => { setValue(v); setPref("output", v); };

    return (
        <div style={{ marginTop: 4 }}>
            <Label t="Sortie audio (loopback)" />
            <select style={selectSt} value={value} onChange={e => handle(e.target.value)}>
                <option value="">Sortie par défaut</option>
                {devices.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
        </div>
    );
}

// ── Screen picker (visual thumbnails) ─────────────────────────
interface SrcInfo { id: string; name: string; thumbnail: string; displayIndex: number; }

function ScreenPicker() {
    const [sources, setSources] = React.useState<SrcInfo[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [sel, setSel] = React.useState(() => getPref("screenId", ""));

    const load = () => {
        setLoading(true);
        Native.getScreenSources().then(s => { setSources(s); setLoading(false); }).catch(() => setLoading(false));
    };

    React.useEffect(load, []);

    const handle = (id: string, idx: number) => {
        setSel(id);
        setPref("screenId", id);
        setPref("screenIdx", String(idx));
    };

    const eff = sel || sources[0]?.id || "";

    return (
        <div style={{ marginTop: 4 }}>
            <Label t="Écran à enregistrer" />
            {loading
                ? <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "6px 0 0" }}>Chargement…</p>
                : (
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                        {sources.map(src => {
                            const active = src.id === eff;
                            return (
                                <div
                                    key={src.id}
                                    onClick={() => handle(src.id, src.displayIndex)}
                                    style={{
                                        border: `2px solid ${active ? "var(--brand-experiment)" : "var(--background-modifier-accent)"}`,
                                        borderRadius: 6, overflow: "hidden", cursor: "pointer",
                                        opacity: active ? 1 : 0.6,
                                        transition: "opacity 0.15s, border-color 0.15s",
                                        background: "var(--background-secondary)",
                                    }}
                                >
                                    {src.thumbnail
                                        ? <img src={src.thumbnail} style={{ width: 160, height: 90, display: "block", objectFit: "cover" }} />
                                        : <div style={{ width: 160, height: 90, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>🖥️</div>
                                    }
                                    <div style={{
                                        padding: "4px 8px", fontSize: 11, textAlign: "center",
                                        color: active ? "var(--brand-experiment)" : "var(--text-muted)",
                                        fontWeight: active ? 600 : 400,
                                        maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                    }}>{src.name}</div>
                                </div>
                            );
                        })}
                    </div>
                )
            }
            <button
                onClick={load}
                style={{
                    marginTop: 8, padding: "3px 10px", fontSize: 12,
                    background: "var(--background-modifier-accent)",
                    color: "var(--text-normal)", border: "none", borderRadius: 4, cursor: "pointer",
                }}
            >↻ Actualiser</button>
        </div>
    );
}

// ── Recording state ────────────────────────────────────────────
interface ActiveRec {
    startTime: number;
    channelName: string;
}

let active: ActiveRec | null = null;

function fmtDur(ms: number): string {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? `${h}h ${m}m ${sec}s` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

async function startRecording(channelId: string): Promise<void> {
    if (active) return;

    const channel = ChannelStore.getChannel(channelId);
    const channelName = channel?.name ?? `vocal-${channelId.slice(0, 6)}`;

    const displayIndex = settings.store.captureScreen
        ? parseInt(getPref("screenIdx", "0"), 10) || 0
        : -1;

    const result = await Native.startRecord({
        displayIndex,
        systemAudio: settings.store.captureSystemAudio,
        micDevice: getPref("mic", ""),
        outputDevice: getPref("output", ""),
    }).catch(() => ({ ok: false, error: "startRecord threw" }));

    if (!result.ok) {
        // ffmpeg failed to start — silently skip recording
        return;
    }

    active = { startTime: Date.now(), channelName };
}

async function stopRecording(): Promise<void> {
    if (!active) return;
    const { startTime, channelName } = active;
    active = null;

    const tmpPath = await Native.stopRecord().catch(() => null);

    openModal(props => (
        <ClipModal
            modalProps={props}
            duration={Date.now() - startTime}
            channelName={channelName}
            tmpPath={tmpPath}
        />
    ));
}

// ── Post-call modal ────────────────────────────────────────────
function ClipModal({ modalProps, duration, channelName, tmpPath }: {
    modalProps: { transitionState: number; onClose(): void };
    duration: number;
    channelName: string;
    tmpPath: string | null;
}) {
    const [phase, setPhase] = React.useState<"confirm" | "saving" | "saved">("confirm");
    const [savedPath, setSavedPath] = React.useState("");

    async function handleKeep() {
        if (!tmpPath) { modalProps.onClose(); return; }
        setPhase("saving");
        const p = await Native.finishClip(true, tmpPath, channelName).catch(() => null);
        setSavedPath(p ?? "");
        setPhase("saved");
    }

    async function handleDiscard() {
        if (tmpPath) await Native.finishClip(false, tmpPath, channelName).catch(() => {});
        modalProps.onClose();
    }

    if (!tmpPath) {
        return (
            <Modal
                {...modalProps}
                title="⚠️ Enregistrement indisponible"
                actions={[{ text: "OK", variant: "primary", onClick: modalProps.onClose }]}
            >
                <p style={{ color: "var(--text-normal)", margin: "8px 0" }}>
                    ffmpeg n'est pas installé ou introuvable dans le PATH.<br />
                    Installe ffmpeg et redémarre Discord.
                </p>
            </Modal>
        );
    }

    if (phase === "saved") {
        return (
            <Modal
                {...modalProps}
                title="✅ Clip sauvegardé"
                actions={[
                    {
                        text: "Ouvrir le dossier",
                        variant: "secondary",
                        onClick: () => { Native.openClipsFolder().catch(() => {}); modalProps.onClose(); },
                    },
                    { text: "OK", variant: "primary", onClick: modalProps.onClose },
                ]}
            >
                <p style={{ color: "var(--text-normal)", margin: "8px 0" }}>
                    <strong>#{channelName}</strong> — {fmtDur(duration)}
                </p>
                {savedPath && (
                    <code style={{
                        background: "var(--background-secondary)", padding: "4px 8px",
                        borderRadius: 4, fontSize: 11, display: "block",
                        wordBreak: "break-all", color: "var(--text-normal)", marginTop: 8,
                    }}>{savedPath}</code>
                )}
            </Modal>
        );
    }

    return (
        <Modal
            {...modalProps}
            title="🎙️ Clip vocal"
            actions={[
                {
                    text: phase === "saving" ? "Sauvegarde…" : "Garder le clip",
                    variant: "primary",
                    onClick: handleKeep,
                    loading: phase === "saving",
                    disabled: phase === "saving",
                },
                {
                    text: "Supprimer",
                    variant: "secondary",
                    onClick: handleDiscard,
                    disabled: phase === "saving",
                },
            ]}
        >
            <p style={{ color: "var(--text-normal)", fontSize: 14, margin: "8px 0" }}>
                Salon <strong>#{channelName}</strong>
            </p>
            <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "var(--header-primary)" }}>
                {fmtDur(duration)}
            </p>
            <p style={{ margin: "4px 0 8px", color: "var(--text-muted)", fontSize: 13 }}>
                MP4 — écran + micro + sortie système
            </p>
        </Modal>
    );
}

// ── Flux ──────────────────────────────────────────────────────
const onSelect = ({ channelId }: { channelId: string | null }) => {
    if (channelId) {
        if (active) stopRecording().then(() => startRecording(channelId)).catch(() => {});
        else startRecording(channelId).catch(() => {});
    } else {
        if (active) stopRecording().catch(() => {});
    }
};

export default definePlugin({
    name: "AutoClip",
    description: "Enregistre automatiquement le call vocal via ffmpeg (écran + micro + sortie système → MP4). Nécessite ffmpeg dans le PATH.",
    authors: [{ name: "Flocord", id: 0n }],
    tags: ["Voice", "Utility"],
    settings,

    start() { FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", onSelect); },

    stop() {
        FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", onSelect);
        if (active) {
            active = null;
            Native.stopRecord()
                .then(p => { if (p) Native.finishClip(false, p, "").catch(() => {}); })
                .catch(() => {});
        }
    },
});
