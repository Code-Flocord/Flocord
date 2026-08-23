import "./styles.css";

import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { type PluginNative } from "@utils/types";
import { React } from "@webpack/common";

import type { MediaInfo } from "./native";

const Native = VencordNative.pluginHelpers.MediaPlayer as PluginNative<typeof import("./native")>;

const APP_NAMES: Record<string, string> = {
    "Spotify.exe": "SPOTIFY",
    "chrome": "CHROME",
    "firefox": "FIREFOX",
    "msedge": "EDGE",
    "vlc": "VLC",
    "foobar2000": "FOOBAR2000",
    "MusicBee": "MUSICBEE",
    "YouTubeMusic": "YT MUSIC",
};

function resolveAppName(appId: string): string {
    if (!appId) return "MUSIQUE";
    for (const [key, name] of Object.entries(APP_NAMES)) {
        if (appId.toLowerCase().includes(key.toLowerCase())) return name;
    }
    return (appId.split("!").pop()?.split(".").pop() ?? "MUSIQUE").toUpperCase();
}

function fmt(s: number): string {
    if (!isFinite(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${m}:${ss.toString().padStart(2, "0")}`;
}

function IconPrev() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
        </svg>
    );
}
function IconNext() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="m6 18 8.5-6L6 6v12zM16 6v12h2V6z" />
        </svg>
    );
}
function IconPlay() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
        </svg>
    );
}
function IconPause() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
        </svg>
    );
}

function IconVolume({ level, muted }: { level: number; muted: boolean; }) {
    if (muted || level === 0) return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z" />
        </svg>
    );
    if (level < 0.4) return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
        </svg>
    );
    if (level < 0.7) return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
        </svg>
    );
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
        </svg>
    );
}

function MediaPlayerPanel() {
    const [info, setInfo] = React.useState<MediaInfo | null>(null);
    const [thumbSrc, setThumbSrc] = React.useState<string | null>(null);
    const [localVolume, setLocalVolume] = React.useState<number>(1);
    const [localMuted, setLocalMuted] = React.useState<boolean>(false);
    const lastTrackRef = React.useRef<string>("");
    const volDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(() => {
        let alive = true;

        async function poll() {
            while (alive) {
                try {
                    const result = await Native.getMediaInfo();
                    if (!alive) break;
                    setInfo(result);
                    if (result) {
                        setLocalVolume(result.volume ?? 1);
                        setLocalMuted(result.muted ?? false);
                        const trackKey = `${result.title}|${result.artist}`;
                        if (trackKey !== lastTrackRef.current) {
                            lastTrackRef.current = trackKey;
                            setThumbSrc(result.thumb ? `data:image/jpeg;base64,${result.thumb}` : null);
                        }
                    }
                } catch { /* ignore */ }
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        poll();
        return () => { alive = false; };
    }, []);

    if (!info || info.status === "Closed" || info.status === "Stopped") return null;

    const isPlaying = info.status === "Playing";
    const progress = info.dur > 0 ? Math.min(100, (info.pos / info.dur) * 100) : 0;
    const appName = resolveAppName(info.app);

    async function control(action: "play" | "pause" | "next" | "previous") {
        await Native.sendControl(action);
        if (action === "play") setInfo(prev => prev ? { ...prev, status: "Playing" } : prev);
        if (action === "pause") setInfo(prev => prev ? { ...prev, status: "Paused" } : prev);
    }

    function handleVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
        const val = parseFloat(e.target.value) / 100;
        setLocalVolume(val);
        if (localMuted) setLocalMuted(false);
        if (volDebounceRef.current) clearTimeout(volDebounceRef.current);
        volDebounceRef.current = setTimeout(() => {
            Native.setVolume(val).catch(() => {});
        }, 150);
    }

    async function handleMuteToggle() {
        const next = !localMuted;
        setLocalMuted(next);
        await Native.toggleMute().catch(() => {});
    }

    const volPct = Math.round(localVolume * 100);

    return (
        <div className="vc-mp-panel">
            {/* Row 1: art + meta + controls */}
            <div className="vc-mp-row">
                <div className="vc-mp-art-wrap">
                    {thumbSrc
                        ? <img className="vc-mp-art" src={thumbSrc} alt="" />
                        : <div className="vc-mp-art vc-mp-art-placeholder">♪</div>
                    }
                </div>
                <div className="vc-mp-meta">
                    <div className="vc-mp-title" title={info.title}>{info.title || "Inconnu"}</div>
                    <div className="vc-mp-artist" title={info.artist}>{info.artist || appName}</div>
                </div>
                <div className="vc-mp-source">{appName}</div>
                <div className="vc-mp-controls">
                    <button className="vc-mp-btn" onClick={() => control("previous")} title="Précédent">
                        <IconPrev />
                    </button>
                    <button className="vc-mp-btn vc-mp-btn-main" onClick={() => control(isPlaying ? "pause" : "play")} title={isPlaying ? "Pause" : "Lecture"}>
                        {isPlaying ? <IconPause /> : <IconPlay />}
                    </button>
                    <button className="vc-mp-btn" onClick={() => control("next")} title="Suivant">
                        <IconNext />
                    </button>
                </div>
            </div>
            {/* Row 2: progress + time + volume */}
            <div className="vc-mp-bottom">
                <span className="vc-mp-time">{fmt(info.pos)}</span>
                <div className="vc-mp-bar">
                    <div className="vc-mp-bar-fill" style={{ width: `${progress}%` }} />
                </div>
                <span className="vc-mp-time">{fmt(info.dur)}</span>
                <button className="vc-mp-btn vc-mp-vol-btn" onClick={handleMuteToggle} title={localMuted ? "Activer le son" : "Muet"}>
                    <IconVolume level={localVolume} muted={localMuted} />
                </button>
                <input
                    type="range"
                    className="vc-mp-vol-slider"
                    min={0}
                    max={100}
                    value={localMuted ? 0 : volPct}
                    onChange={handleVolumeChange}
                    title={`Volume : ${volPct}%`}
                />
            </div>
        </div>
    );
}

export default definePlugin({
    name: "MediaPlayer",
    description: "Contrôle musical dans le panneau bas-gauche. Compatible Spotify, YouTube Music, VLC, et tout lecteur Windows sans connexion requise.",
    authors: [{ name: "Flocord", id: 0n }],
    tags: ["Media", "Utility"],

    patches: [
        {
            find: "#{intl::USER_PROFILE_ACCOUNT_POPOUT_BUTTON_A11Y_LABEL}",
            replacement: {
                match: /(?<=\i\.jsxs?\)\()(\i),{(?=[^}]*?userTag:\i,occluded:)/,
                replace: "$self.PanelWrapper,{VencordOriginal:$1,",
            },
        },
    ],

    PanelWrapper({ VencordOriginal, ...props }: { VencordOriginal: React.ComponentType<any>; [k: string]: any; }) {
        return (
            <>
                <ErrorBoundary noop>
                    <MediaPlayerPanel />
                </ErrorBoundary>
                <VencordOriginal {...props} />
            </>
        );
    },
});
