import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import { ChannelStore, FluxDispatcher, Modal, React, openModal } from "@webpack/common";

const Native = VencordNative.pluginHelpers.AutoClip as PluginNative<typeof import("./native")>;

// ── Preferences stored in localStorage (device/screen IDs) ────
const PREF = "Flocord_AutoClip_";
function getPref(key: string, def = ""): string {
    try { return localStorage.getItem(PREF + key) ?? def; }
    catch { return def; }
}
function setPref(key: string, val: string): void {
    try { localStorage.setItem(PREF + key, val); } catch {}
}

// ── Settings ───────────────────────────────────────────────────
const settings = definePluginSettings({
    captureSystemAudio: {
        type: OptionType.BOOLEAN,
        description: "Enregistrer la sortie audio système (loopback)",
        default: true,
    },
    captureScreen: {
        type: OptionType.BOOLEAN,
        description: "Enregistrer l'écran (vidéo) en plus de l'audio",
        default: true,
    },
    micPicker: {
        type: OptionType.COMPONENT,
        description: "Microphone d'entrée",
        component: MicDevicePicker,
    },
    screenPicker: {
        type: OptionType.COMPONENT,
        description: "Écran à enregistrer",
        component: ScreenSourcePicker,
    },
});

// ── Picker styles ──────────────────────────────────────────────
const selectStyle: React.CSSProperties = {
    background: "var(--input-background)",
    color: "var(--text-normal)",
    border: "1px solid var(--background-modifier-accent)",
    borderRadius: 4,
    padding: "5px 8px",
    width: "100%",
    marginTop: 6,
    cursor: "pointer",
    fontSize: 14,
};

function PickerLabel({ text }: { text: string; }) {
    return (
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--header-secondary)" }}>
            {text}
        </span>
    );
}

// ── Microphone picker ──────────────────────────────────────────
function MicDevicePicker() {
    const [devices, setDevices] = React.useState<MediaDeviceInfo[]>([]);
    const [value, setValue] = React.useState(() => getPref("micDeviceId", "default"));

    React.useEffect(() => {
        navigator.mediaDevices.enumerateDevices()
            .then(all => setDevices(all.filter(d => d.kind === "audioinput")))
            .catch(() => {});
    }, []);

    function handleChange(v: string) {
        setValue(v);
        setPref("micDeviceId", v);
    }

    return (
        <div style={{ marginTop: 4 }}>
            <PickerLabel text="Microphone d'entrée" />
            <select style={selectStyle} value={value} onChange={e => handleChange(e.target.value)}>
                <option value="default">Microphone par défaut</option>
                {devices.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Micro ${d.deviceId.slice(0, 8)}…`}
                    </option>
                ))}
            </select>
        </div>
    );
}

// ── Screen source picker ───────────────────────────────────────
interface ScreenSource { id: string; name: string; thumbnail: string; }

function ScreenSourcePicker() {
    const [sources, setSources] = React.useState<ScreenSource[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [selected, setSelected] = React.useState(() => getPref("screenSourceId", ""));

    function loadSources() {
        setLoading(true);
        Native.getScreenSources()
            .then(s => { setSources(s); setLoading(false); })
            .catch(() => setLoading(false));
    }

    React.useEffect(() => { loadSources(); }, []);

    function handleSelect(id: string) {
        setSelected(id);
        setPref("screenSourceId", id);
    }

    const effectiveId = selected || sources[0]?.id || "";

    return (
        <div style={{ marginTop: 4 }}>
            <PickerLabel text="Écran à enregistrer" />
            {loading
                ? <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 6 }}>Chargement…</p>
                : (
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                        {sources.map(src => {
                            const active = src.id === effectiveId;
                            return (
                                <div
                                    key={src.id}
                                    onClick={() => handleSelect(src.id)}
                                    style={{
                                        border: `2px solid ${active ? "var(--brand-experiment)" : "var(--background-modifier-accent)"}`,
                                        borderRadius: 6,
                                        overflow: "hidden",
                                        cursor: "pointer",
                                        opacity: active ? 1 : 0.65,
                                        transition: "opacity 0.15s, border-color 0.15s",
                                        background: "var(--background-secondary)",
                                    }}
                                >
                                    {src.thumbnail
                                        ? <img src={src.thumbnail} alt={src.name}
                                            style={{ width: 160, height: 90, display: "block", objectFit: "cover" }} />
                                        : <div style={{
                                            width: 160, height: 90,
                                            background: "var(--background-tertiary)",
                                            display: "flex", alignItems: "center", justifyContent: "center",
                                            fontSize: 24,
                                        }}>🖥️</div>
                                    }
                                    <div style={{
                                        padding: "4px 8px", fontSize: 11,
                                        color: active ? "var(--brand-experiment)" : "var(--text-muted)",
                                        fontWeight: active ? 600 : 400,
                                        textAlign: "center", maxWidth: 160,
                                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                    }}>
                                        {src.name}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            <button
                onClick={loadSources}
                style={{
                    marginTop: 8, padding: "3px 10px", fontSize: 12,
                    background: "var(--background-modifier-accent)",
                    color: "var(--text-normal)", border: "none", borderRadius: 4, cursor: "pointer",
                }}
            >
                ↻ Actualiser
            </button>
        </div>
    );
}

// ── Recording state ────────────────────────────────────────────
interface Recording {
    recorder: MediaRecorder;
    ctx: AudioContext;
    streams: MediaStream[];
    startTime: number;
    channelName: string;
    hasVideo: boolean;
}

let recording: Recording | null = null;

function fmtDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m ${sec}s`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
}

async function startRecording(channelId: string): Promise<void> {
    if (recording) return;

    const channel = ChannelStore.getChannel(channelId);
    const channelName = channel?.name ?? `vocal-${channelId.slice(0, 6)}`;

    const wantVideo = settings.store.captureScreen;
    const wantLoopback = settings.store.captureSystemAudio;
    const micId = getPref("micDeviceId", "default");
    const storedScreenId = getPref("screenSourceId", "");

    // ── Screen + system audio via chromeMediaSource (Electron-native) ─
    // We always request both video + audio from the desktop source, then
    // discard video tracks if the user disabled screen recording.
    // This bypasses Discord's getDisplayMedia handler entirely.
    let displayStream: MediaStream | null = null;
    if (wantLoopback || wantVideo) {
        const screenId = await Native.resolveScreenId(storedScreenId).catch(() => "");
        if (screenId) {
            try {
                displayStream = await (navigator.mediaDevices.getUserMedia as Function)({
                    audio: wantLoopback
                        ? { mandatory: { chromeMediaSource: "desktop" } }
                        : false,
                    video: {
                        mandatory: {
                            chromeMediaSource: "desktop",
                            chromeMediaSourceId: screenId,
                        },
                    },
                });
                // Discard video if not wanted
                if (!wantVideo) {
                    displayStream.getVideoTracks().forEach(t => t.stop());
                }
            } catch {
                displayStream = null;
            }
        }
    }

    // ── Microphone ─────────────────────────────────────────────
    let micStream: MediaStream | null = null;
    try {
        const audioConstraint = (micId && micId !== "default")
            ? { deviceId: { exact: micId } }
            : true;
        micStream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraint as MediaTrackConstraints,
            video: false,
        });
    } catch { /* mic denied or unavailable */ }

    if (!displayStream && !micStream) return;

    // ── Mix all audio through WebAudio ─────────────────────────
    const ctx = new AudioContext();
    await ctx.resume();
    const audioDest = ctx.createMediaStreamDestination();

    if (micStream) {
        ctx.createMediaStreamSource(micStream).connect(audioDest);
    }
    const loopbackTracks = displayStream?.getAudioTracks() ?? [];
    if (loopbackTracks.length) {
        ctx.createMediaStreamSource(new MediaStream(loopbackTracks)).connect(audioDest);
    }

    // ── Build final stream ─────────────────────────────────────
    const videoTracks = wantVideo ? (displayStream?.getVideoTracks() ?? []) : [];
    const hasVideo = videoTracks.length > 0;
    const finalStream = new MediaStream([
        ...videoTracks,
        ...audioDest.stream.getAudioTracks(),
    ]);

    const mimeType = (() => {
        if (hasVideo) {
            for (const m of ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]) {
                if (MediaRecorder.isTypeSupported(m)) return m;
            }
        }
        for (const m of ["audio/webm;codecs=opus", "audio/webm"]) {
            if (MediaRecorder.isTypeSupported(m)) return m;
        }
        return "video/webm";
    })();

    const recorder = new MediaRecorder(finalStream, { mimeType });
    await Native.openTempFile();

    recorder.ondataavailable = async e => {
        if (e.data.size > 0) {
            const buf = await e.data.arrayBuffer();
            Native.appendChunk(new Uint8Array(buf)).catch(() => {});
        }
    };

    recorder.start(1000);

    const streams = [displayStream, micStream].filter(Boolean) as MediaStream[];
    recording = { recorder, ctx, streams, startTime: Date.now(), channelName, hasVideo };
}

async function stopRecording(): Promise<void> {
    if (!recording) return;
    const { recorder, ctx, streams, startTime, channelName, hasVideo } = recording;
    recording = null;

    await new Promise<void>(resolve => {
        recorder.onstop = () => resolve();
        recorder.stop();
    });

    streams.forEach(s => s.getTracks().forEach(t => t.stop()));
    ctx.close();

    openModal(props => (
        <ClipModal
            modalProps={props}
            duration={Date.now() - startTime}
            channelName={channelName}
            hasVideo={hasVideo}
        />
    ));
}

// ── Post-call modal ────────────────────────────────────────────
type Phase = "confirm" | "saving" | "converting" | "saved";

function ClipModal({ modalProps, duration, channelName, hasVideo }: {
    modalProps: { transitionState: number; onClose(): void };
    duration: number;
    channelName: string;
    hasVideo: boolean;
}) {
    const [phase, setPhase] = React.useState<Phase>("confirm");
    const [savedPath, setSavedPath] = React.useState("");

    async function handleKeep() {
        setPhase("saving");
        const webm = await Native.finishClip(true, channelName).catch(() => null);
        if (!webm) { modalProps.onClose(); return; }

        // Try ffmpeg conversion to MP4
        setPhase("converting");
        const mp4 = await Native.convertToMp4(webm).catch(() => null);
        setSavedPath(mp4 ?? webm);
        setPhase("saved");
    }

    async function handleDiscard() {
        await Native.finishClip(false, channelName).catch(() => {});
        modalProps.onClose();
    }

    if (phase === "saved") {
        const isMp4 = savedPath.endsWith(".mp4");
        return (
            <Modal
                {...modalProps}
                title={`✅ Clip sauvegardé${isMp4 ? " (MP4)" : " (WebM)"}`}
                actions={[
                    {
                        text: "Ouvrir le dossier",
                        variant: "secondary",
                        onClick: () => { Native.openClipsFolder().catch(() => {}); modalProps.onClose(); },
                    },
                    { text: "OK", variant: "primary", onClick: modalProps.onClose },
                ]}
            >
                <p style={{ margin: "8px 0", color: "var(--text-normal)" }}>
                    <strong>#{channelName}</strong> — {fmtDuration(duration)} sauvegardé.
                </p>
                {!isMp4 && (
                    <p style={{ margin: "4px 0 8px", color: "var(--text-muted)", fontSize: 12 }}>
                        ⚠️ ffmpeg non détecté — fichier en .webm (lisible avec VLC).
                    </p>
                )}
                {savedPath && (
                    <code style={{
                        background: "var(--background-secondary)", padding: "4px 8px",
                        borderRadius: 4, fontSize: 11, display: "block",
                        wordBreak: "break-all", color: "var(--text-normal)", marginTop: 8,
                    }}>
                        {savedPath}
                    </code>
                )}
            </Modal>
        );
    }

    const isWorking = phase === "saving" || phase === "converting";
    const workLabel = phase === "converting" ? "Conversion MP4…" : "Sauvegarde…";
    const sourceLabel = hasVideo ? "écran + micro + sortie système" : "micro uniquement";

    return (
        <Modal
            {...modalProps}
            title="🎙️ Clip vocal"
            actions={[
                {
                    text: isWorking ? workLabel : "Garder le clip",
                    variant: "primary",
                    onClick: handleKeep,
                    loading: isWorking,
                    disabled: isWorking,
                },
                {
                    text: "Supprimer",
                    variant: "secondary",
                    onClick: handleDiscard,
                    disabled: isWorking,
                },
            ]}
        >
            <p style={{ margin: "8px 0", color: "var(--text-normal)", fontSize: 14 }}>
                Salon <strong>#{channelName}</strong>
            </p>
            <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "var(--header-primary)" }}>
                {fmtDuration(duration)}
            </p>
            <p style={{ margin: "4px 0 8px", color: "var(--text-muted)", fontSize: 13 }}>
                enregistré — {sourceLabel}
            </p>
        </Modal>
    );
}

// ── Flux handler + plugin ──────────────────────────────────────
const onVoiceChannelSelect = ({ channelId }: { channelId: string | null }) => {
    if (channelId) {
        if (recording) {
            stopRecording().then(() => startRecording(channelId)).catch(() => {});
        } else {
            startRecording(channelId).catch(() => {});
        }
    } else {
        if (recording) stopRecording().catch(() => {});
    }
};

export default definePlugin({
    name: "AutoClip",
    description: "Enregistre automatiquement le call vocal (écran + micro + sortie système). À la fin du call, choisis de garder ou supprimer le clip.",
    authors: [{ name: "Flocord", id: 0n }],
    tags: ["Voice", "Utility"],
    settings,

    start() {
        FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", onVoiceChannelSelect);
    },

    stop() {
        FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", onVoiceChannelSelect);
        if (recording) {
            const { recorder, ctx, streams } = recording;
            recording = null;
            recorder.stop();
            streams.forEach(s => s.getTracks().forEach(t => t.stop()));
            ctx.close();
            Native.finishClip(false, "").catch(() => {});
        }
    },
});
