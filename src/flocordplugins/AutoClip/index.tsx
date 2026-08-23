import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import { ChannelStore, FluxDispatcher, Modal, React, openModal } from "@webpack/common";

const Native = VencordNative.pluginHelpers.AutoClip as PluginNative<typeof import("./native")>;

const K = "Flocord_AutoClip_";
const getPref = (k: string, d = "") => { try { return localStorage.getItem(K + k) ?? d; } catch { return d; } };
const setPref = (k: string, v: string) => { try { localStorage.setItem(K + k, v); } catch {} };

// ── Settings ───────────────────────────────────────────────────
const settings = definePluginSettings({
    captureScreen: {
        type: OptionType.BOOLEAN,
        description: "Enregistrer l'écran (vidéo)",
        default: true,
    },
    captureSystemAudio: {
        type: OptionType.BOOLEAN,
        description: "Enregistrer la sortie audio système — nécessite ffmpeg",
        default: true,
    },
    ffmpegStatus: {
        type: OptionType.COMPONENT,
        description: "",
        component: FfmpegStatusBanner,
    },
    micPicker: {
        type: OptionType.COMPONENT,
        description: "Microphone d'entrée",
        component: MicPicker,
    },
    outputPicker: {
        type: OptionType.COMPONENT,
        description: "Sortie audio à capturer (loopback, ffmpeg uniquement)",
        component: OutputPicker,
    },
    screenPicker: {
        type: OptionType.COMPONENT,
        description: "Écran à enregistrer",
        component: ScreenPicker,
    },
});

// ── Shared UI helpers ──────────────────────────────────────────
const selSt: React.CSSProperties = {
    background: "var(--input-background)", color: "var(--text-normal)",
    border: "1px solid var(--background-modifier-accent)", borderRadius: 4,
    padding: "5px 8px", width: "100%", marginTop: 6, fontSize: 14, cursor: "pointer",
};

function Lbl({ t }: { t: string }) {
    return <span style={{ fontSize: 13, fontWeight: 600, color: "var(--header-secondary)" }}>{t}</span>;
}

// ── ffmpeg status banner ───────────────────────────────────────
function FfmpegStatusBanner() {
    const [state, setState] = React.useState<"loading" | "ok" | "missing">("loading");
    React.useEffect(() => {
        Native.checkFfmpeg().then(ok => setState(ok ? "ok" : "missing")).catch(() => setState("missing"));
    }, []);

    if (state === "loading") return null;
    const ok = state === "ok";
    return (
        <div style={{
            padding: "6px 10px", borderRadius: 4, fontSize: 12, marginBottom: 4,
            background: ok ? "rgba(59,165,93,0.15)" : "rgba(237,66,69,0.15)",
            color: ok ? "var(--green-360)" : "var(--red-400)",
        }}>
            {ok
                ? "✔ ffmpeg détecté — mode complet actif (écran + micro + sortie système → MP4)."
                : "✖ ffmpeg introuvable — mode dégradé actif (écran + micro → WebM, sans audio système). Installe ffmpeg et ajoute-le au PATH pour activer le mode complet."}
        </div>
    );
}

// ── Mic picker ─────────────────────────────────────────────────
function MicPicker() {
    const [wasapi, setWasapi] = React.useState<string[]>([]);
    const [browser, setBrowser] = React.useState<MediaDeviceInfo[]>([]);
    const [val, setVal] = React.useState(() => getPref("mic", ""));
    const [hasFfmpeg, setHasFfmpeg] = React.useState(false);

    React.useEffect(() => {
        Native.checkFfmpeg().then(ok => {
            setHasFfmpeg(ok);
            if (ok) Native.listWasapiDevices("input").then(setWasapi).catch(() => {});
            else navigator.mediaDevices.enumerateDevices()
                .then(d => setBrowser(d.filter(x => x.kind === "audioinput"))).catch(() => {});
        });
    }, []);

    const handle = (v: string) => { setVal(v); setPref("mic", v); };

    return (
        <div style={{ marginTop: 4 }}>
            <Lbl t="Microphone d'entrée" />
            <select style={selSt} value={val} onChange={e => handle(e.target.value)}>
                <option value="">Par défaut</option>
                {hasFfmpeg
                    ? wasapi.map(d => <option key={d} value={d}>{d}</option>)
                    : browser.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId.slice(0, 12)}</option>)
                }
            </select>
        </div>
    );
}

// ── Output picker (ffmpeg only) ────────────────────────────────
function OutputPicker() {
    const [devices, setDevices] = React.useState<string[]>([]);
    const [val, setVal] = React.useState(() => getPref("output", ""));
    const [hasFfmpeg, setHasFfmpeg] = React.useState(false);

    React.useEffect(() => {
        Native.checkFfmpeg().then(ok => {
            setHasFfmpeg(ok);
            if (ok) Native.listWasapiDevices("output").then(setDevices).catch(() => {});
        });
    }, []);

    const handle = (v: string) => { setVal(v); setPref("output", v); };

    if (!hasFfmpeg) return (
        <div style={{ marginTop: 4 }}>
            <Lbl t="Sortie audio (loopback)" />
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 0" }}>
                Nécessite ffmpeg.
            </p>
        </div>
    );

    return (
        <div style={{ marginTop: 4 }}>
            <Lbl t="Sortie audio à capturer (loopback)" />
            <select style={selSt} value={val} onChange={e => handle(e.target.value)}>
                <option value="">Sortie par défaut</option>
                {devices.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
        </div>
    );
}

// ── Screen picker ──────────────────────────────────────────────
interface SrcInfo { id: string; name: string; thumbnail: string; displayIndex: number; }

function ScreenPicker() {
    const [sources, setSources] = React.useState<SrcInfo[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [sel, setSel] = React.useState(() => getPref("screenId", ""));

    const load = () => {
        setLoading(true);
        Native.getScreenSources()
            .then(s => { setSources(s); setLoading(false); })
            .catch(() => setLoading(false));
    };
    React.useEffect(load, []);

    const handle = (id: string, idx: number) => {
        setSel(id); setPref("screenId", id); setPref("screenIdx", String(idx));
    };
    const eff = sel || sources[0]?.id || "";

    return (
        <div style={{ marginTop: 4 }}>
            <Lbl t="Écran à enregistrer" />
            {loading
                ? <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "6px 0 0" }}>Chargement…</p>
                : (
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                        {sources.map(src => {
                            const active = src.id === eff;
                            return (
                                <div key={src.id} onClick={() => handle(src.id, src.displayIndex)} style={{
                                    border: `2px solid ${active ? "var(--brand-experiment)" : "var(--background-modifier-accent)"}`,
                                    borderRadius: 6, overflow: "hidden", cursor: "pointer",
                                    opacity: active ? 1 : 0.6, transition: "opacity 0.15s, border-color 0.15s",
                                    background: "var(--background-secondary)",
                                }}>
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
                )}
            <button onClick={load} style={{
                marginTop: 8, padding: "3px 10px", fontSize: 12,
                background: "var(--background-modifier-accent)",
                color: "var(--text-normal)", border: "none", borderRadius: 4, cursor: "pointer",
            }}>↻ Actualiser</button>
        </div>
    );
}

// ── Recording state ────────────────────────────────────────────
interface ActiveRec {
    startTime: number;
    channelName: string;
    mode: "ffmpeg" | "fallback";
    // fallback only
    recorder?: MediaRecorder;
    ctx?: AudioContext;
    streams?: MediaStream[];
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

    const hasFfmpeg = await Native.checkFfmpeg().catch(() => false);

    if (hasFfmpeg) {
        await startFfmpegRecording(channelName);
    } else {
        await startFallbackRecording(channelName);
    }
}

// ── Mode A: ffmpeg (full: screen + mic + system audio → MP4) ──
async function startFfmpegRecording(channelName: string): Promise<void> {
    const displayIndex = settings.store.captureScreen
        ? (parseInt(getPref("screenIdx", "0"), 10) || 0)
        : -1;

    const result = await Native.startFfmpegRecord({
        displayIndex,
        systemAudio: settings.store.captureSystemAudio,
        micDevice: getPref("mic", ""),
        outputDevice: getPref("output", ""),
    }).catch(() => ({ ok: false as const, error: "startFfmpegRecord threw" }));

    if (!result.ok) return;
    active = { startTime: Date.now(), channelName, mode: "ffmpeg" };
}

// ── Mode B: fallback renderer (screen + mic, no system audio → WebM) ──
async function startFallbackRecording(channelName: string): Promise<void> {
    const screenId = getPref("screenId", "");

    let displayStream: MediaStream | null = null;
    if (settings.store.captureScreen) {
        const ok = await Native.setupCapture(screenId).catch(() => false);
        if (ok) {
            try {
                displayStream = await navigator.mediaDevices.getDisplayMedia({
                    video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
                    audio: false,   // no loopback in fallback mode
                });
            } catch { /* denied or overridden */ }
        }
    }

    let micStream: MediaStream | null = null;
    try {
        const micId = getPref("mic", "");
        const constraint = micId ? { deviceId: { exact: micId } } : true;
        micStream = await navigator.mediaDevices.getUserMedia({
            audio: constraint as MediaTrackConstraints,
            video: false,
        });
    } catch { /* denied */ }

    if (!displayStream && !micStream) {
        await Native.teardownCapture().catch(() => {});
        return;
    }

    const ctx = new AudioContext();
    await ctx.resume();
    const dest = ctx.createMediaStreamDestination();
    if (micStream) ctx.createMediaStreamSource(micStream).connect(dest);

    const videoTracks = displayStream?.getVideoTracks() ?? [];
    const finalStream = new MediaStream([...videoTracks, ...dest.stream.getAudioTracks()]);

    const mimeType = (() => {
        if (videoTracks.length) {
            for (const m of ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"])
                if (MediaRecorder.isTypeSupported(m)) return m;
        }
        for (const m of ["audio/webm;codecs=opus", "audio/webm"])
            if (MediaRecorder.isTypeSupported(m)) return m;
        return "video/webm";
    })();

    const recorder = new MediaRecorder(finalStream, { mimeType });
    await Native.openTempFile();

    recorder.ondataavailable = async e => {
        if (e.data.size > 0) Native.appendChunk(new Uint8Array(await e.data.arrayBuffer())).catch(() => {});
    };
    recorder.start(1000);

    const streams = [displayStream, micStream].filter(Boolean) as MediaStream[];
    active = { startTime: Date.now(), channelName, mode: "fallback", recorder, ctx, streams };
}

async function stopRecording(): Promise<void> {
    if (!active) return;
    const snap = active;
    active = null;

    let tmpPath: string | null = null;

    if (snap.mode === "ffmpeg") {
        tmpPath = await Native.stopFfmpegRecord().catch(() => null);
    } else {
        // Stop renderer-based recording
        if (snap.recorder) {
            await new Promise<void>(res => { snap.recorder!.onstop = () => res(); snap.recorder!.stop(); });
        }
        snap.streams?.forEach(s => s.getTracks().forEach(t => t.stop()));
        snap.ctx?.close();
        await Native.teardownCapture().catch(() => {});
        tmpPath = await Native.closeTempFile().catch(() => null);
    }

    openModal(props => (
        <ClipModal
            modalProps={props}
            duration={Date.now() - snap.startTime}
            channelName={snap.channelName}
            tmpPath={tmpPath}
            mode={snap.mode}
        />
    ));
}

// ── Modal ──────────────────────────────────────────────────────
function ClipModal({ modalProps, duration, channelName, tmpPath, mode }: {
    modalProps: { transitionState: number; onClose(): void };
    duration: number;
    channelName: string;
    tmpPath: string | null;
    mode: "ffmpeg" | "fallback";
}) {
    const [phase, setPhase] = React.useState<"confirm" | "saving" | "saved">("confirm");
    const [savedPath, setSavedPath] = React.useState("");

    async function handleKeep() {
        if (!tmpPath) { modalProps.onClose(); return; }
        setPhase("saving");
        const p = await Native.finishClip(true, tmpPath, channelName).catch(() => null);
        setSavedPath(p ?? ""); setPhase("saved");
    }

    async function handleDiscard() {
        if (tmpPath) await Native.finishClip(false, tmpPath, channelName).catch(() => {});
        modalProps.onClose();
    }

    if (!tmpPath) {
        return (
            <Modal {...modalProps} title="⚠️ Clip vide"
                actions={[{ text: "OK", variant: "primary", onClick: modalProps.onClose }]}>
                <p style={{ color: "var(--text-normal)", margin: "8px 0" }}>
                    Aucune piste audio ou vidéo capturée.
                </p>
            </Modal>
        );
    }

    if (phase === "saved") {
        const isMp4 = savedPath.endsWith(".mp4");
        return (
            <Modal {...modalProps} title={`✅ Clip sauvegardé${isMp4 ? " (MP4)" : " (WebM)"}`}
                actions={[
                    { text: "Ouvrir le dossier", variant: "secondary", onClick: () => { Native.openClipsFolder().catch(() => {}); modalProps.onClose(); } },
                    { text: "OK", variant: "primary", onClick: modalProps.onClose },
                ]}>
                <p style={{ color: "var(--text-normal)", margin: "8px 0" }}>
                    <strong>#{channelName}</strong> — {fmtDur(duration)}
                </p>
                {!isMp4 && (
                    <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0" }}>
                        Mode dégradé — micro uniquement, lisible dans VLC ou Chrome.
                    </p>
                )}
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

    const modeLabel = mode === "ffmpeg"
        ? "MP4 — écran + micro + sortie système"
        : "WebM — écran + micro (sans audio système)";

    return (
        <Modal {...modalProps} title="🎙️ Clip vocal"
            actions={[
                {
                    text: phase === "saving" ? "Sauvegarde…" : "Garder le clip",
                    variant: "primary", onClick: handleKeep,
                    loading: phase === "saving", disabled: phase === "saving",
                },
                { text: "Supprimer", variant: "secondary", onClick: handleDiscard, disabled: phase === "saving" },
            ]}>
            <p style={{ color: "var(--text-normal)", fontSize: 14, margin: "8px 0" }}>
                Salon <strong>#{channelName}</strong>
            </p>
            <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "var(--header-primary)" }}>
                {fmtDur(duration)}
            </p>
            <p style={{ margin: "4px 0 8px", color: "var(--text-muted)", fontSize: 13 }}>
                {modeLabel}
            </p>
        </Modal>
    );
}

// ── Flux + plugin ──────────────────────────────────────────────
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
    description: "Enregistre automatiquement le call vocal. Avec ffmpeg : MP4 complet (écran + micro + sortie système). Sans ffmpeg : WebM (écran + micro).",
    authors: [{ name: "Flocord", id: 0n }],
    tags: ["Voice", "Utility"],
    settings,

    start() { FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", onSelect); },

    stop() {
        FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", onSelect);
        if (active) {
            const snap = active; active = null;
            if (snap.mode === "ffmpeg") {
                Native.stopFfmpegRecord().then(p => { if (p) Native.finishClip(false, p, "").catch(() => {}); }).catch(() => {});
            } else {
                snap.recorder?.stop();
                snap.streams?.forEach(s => s.getTracks().forEach(t => t.stop()));
                snap.ctx?.close();
                Native.closeTempFile().then(p => { if (p) Native.finishClip(false, p, "").catch(() => {}); }).catch(() => {});
                Native.teardownCapture().catch(() => {});
            }
        }
    },
});
