import definePlugin, { type PluginNative } from "@utils/types";
import { ChannelStore, FluxDispatcher, Modal, React, openModal } from "@webpack/common";

const Native = VencordNative.pluginHelpers.AutoClip as PluginNative<typeof import("./native")>;

interface Recording {
    recorder: MediaRecorder;
    ctx: AudioContext;
    streams: MediaStream[];
    startTime: number;
    channelName: string;
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

    const audioTracks: MediaStreamTrack[] = [];
    const streams: MediaStream[] = [];

    // Microphone
    try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        streams.push(mic);
        audioTracks.push(...mic.getAudioTracks());
    } catch { /* mic unavailable or denied */ }

    // System audio via loopback (intercepted by our main-process handler)
    const captureOk = await Native.setupCapture().catch(() => false);
    if (captureOk) {
        try {
            const display = await navigator.mediaDevices.getDisplayMedia({
                audio: true,
                video: { width: 1, height: 1 } as any,
            });
            display.getVideoTracks().forEach(t => t.stop());
            streams.push(display);
            audioTracks.push(...display.getAudioTracks());
        } catch { /* loopback unavailable */ }
    }

    if (audioTracks.length === 0) return;

    // Mix all tracks into one stream via WebAudio
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    for (const track of audioTracks) {
        ctx.createMediaStreamSource(new MediaStream([track])).connect(dest);
    }

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

    const recorder = new MediaRecorder(dest.stream, { mimeType });
    await Native.openTempFile();

    recorder.ondataavailable = async e => {
        if (e.data.size > 0) {
            const buf = await e.data.arrayBuffer();
            Native.appendChunk(new Uint8Array(buf)).catch(() => {});
        }
    };

    recorder.start(1000);
    recording = { recorder, ctx, streams, startTime: Date.now(), channelName };
}

async function stopRecording(): Promise<void> {
    if (!recording) return;
    const { recorder, ctx, streams, startTime, channelName } = recording;
    recording = null;

    await new Promise<void>(resolve => {
        recorder.onstop = () => resolve();
        recorder.stop();
    });

    streams.forEach(s => s.getTracks().forEach(t => t.stop()));
    ctx.close();
    await Native.teardownCapture().catch(() => {});

    const duration = Date.now() - startTime;
    openModal(props => <ClipModal modalProps={props} duration={duration} channelName={channelName} />);
}

function ClipModal({ modalProps, duration, channelName }: {
    modalProps: { transitionState: number; onClose(): void };
    duration: number;
    channelName: string;
}) {
    const [phase, setPhase] = React.useState<"confirm" | "saving" | "saved">("confirm");
    const [savedPath, setSavedPath] = React.useState("");

    async function handleKeep() {
        setPhase("saving");
        const p = await Native.finishClip(true, channelName).catch(() => null);
        setSavedPath(p ?? "");
        setPhase("saved");
    }

    async function handleDiscard() {
        await Native.finishClip(false, channelName).catch(() => {});
        modalProps.onClose();
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
                <p style={{ margin: "8px 0", color: "var(--text-normal)" }}>
                    <strong>#{channelName}</strong> — {fmtDuration(duration)} sauvegardé.
                </p>
                {savedPath && (
                    <code style={{
                        background: "var(--background-secondary)",
                        padding: "4px 8px",
                        borderRadius: 4,
                        fontSize: 11,
                        display: "block",
                        wordBreak: "break-all",
                        color: "var(--text-normal)",
                        marginTop: 8,
                    }}>
                        {savedPath}
                    </code>
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
            <p style={{ margin: "8px 0", color: "var(--text-normal)", fontSize: 14 }}>
                Salon <strong>#{channelName}</strong>
            </p>
            <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "var(--header-primary)" }}>
                {fmtDuration(duration)}
            </p>
            <p style={{ margin: "4px 0 8px", color: "var(--text-muted)", fontSize: 13 }}>
                enregistré — micro + sortie système
            </p>
        </Modal>
    );
}

const onVoiceChannelSelect = ({ channelId }: { channelId: string | null }) => {
    if (channelId) {
        if (recording) {
            // Switched channels: stop current, start new
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
    description: "Enregistre automatiquement le call vocal (micro + sortie système). À la fin du call, choisis de garder ou supprimer le clip.",
    authors: [{ name: "Flocord", id: 0n }],
    tags: ["Voice", "Utility"],

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
            Native.teardownCapture().catch(() => {});
        }
    },
});
