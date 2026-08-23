import definePlugin, { type PluginNative } from "@utils/types";
import { ChannelStore, FluxDispatcher, Modal, React, openModal } from "@webpack/common";

const Native = VencordNative.pluginHelpers.AutoClip as PluginNative<typeof import("./native")>;

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

    // ── Screen + system audio via loopback handler ────────────
    const captureOk = await Native.setupCapture().catch(() => false);
    let displayStream: MediaStream | null = null;
    if (captureOk) {
        try {
            displayStream = await navigator.mediaDevices.getDisplayMedia({
                video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
                audio: true,
            });
        } catch { /* handler may have been overridden or loopback unavailable */ }
    }

    // ── Microphone ─────────────────────────────────────────────
    let micStream: MediaStream | null = null;
    try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch { /* mic denied or unavailable */ }

    if (!displayStream && !micStream) {
        await Native.teardownCapture().catch(() => {});
        return;
    }

    // ── Mix all audio through WebAudio ─────────────────────────
    // We route both mic and loopback into a single mixed track so MediaRecorder
    // gets one clean audio stream instead of two competing tracks.
    const ctx = new AudioContext();
    const audioDest = ctx.createMediaStreamDestination();

    if (micStream) {
        ctx.createMediaStreamSource(micStream).connect(audioDest);
    }
    if (displayStream?.getAudioTracks().length) {
        // Route loopback audio through WebAudio for mixing (do NOT add raw tracks to finalStream)
        ctx.createMediaStreamSource(new MediaStream(displayStream.getAudioTracks())).connect(audioDest);
    }

    // ── Build final stream: screen video + mixed audio ─────────
    const videoTracks = displayStream?.getVideoTracks() ?? [];
    const hasVideo = videoTracks.length > 0;
    const finalStream = new MediaStream([
        ...videoTracks,
        ...audioDest.stream.getAudioTracks(),
    ]);

    // Pick best supported mime type
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
    await Native.teardownCapture().catch(() => {});

    openModal(props => (
        <ClipModal
            modalProps={props}
            duration={Date.now() - startTime}
            channelName={channelName}
            hasVideo={hasVideo}
        />
    ));
}

function ClipModal({ modalProps, duration, channelName, hasVideo }: {
    modalProps: { transitionState: number; onClose(): void };
    duration: number;
    channelName: string;
    hasVideo: boolean;
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

    const sourceLabel = hasVideo
        ? "écran + micro + sortie système"
        : "micro uniquement";

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
                enregistré — {sourceLabel}
            </p>
        </Modal>
    );
}

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
    description: "Enregistre automatiquement le call vocal (écran + micro + sortie système). À la fin du call, choisis de garder ou supprimer le clip (.webm).",
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
