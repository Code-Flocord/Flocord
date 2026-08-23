import "./styles.css";

import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { type PluginNative } from "@utils/types";
import { React, createRoot } from "@webpack/common";

import type { MediaInfo } from "./native";

const Native = VencordNative.pluginHelpers.MediaPlayer as PluginNative<typeof import("./native")>;

// --- App name helpers ---

const APP_NAMES: Record<string, string> = {
    "Spotify.exe": "Spotify",
    "chrome": "Chrome",
    "firefox": "Firefox",
    "msedge": "Edge",
    "vlc": "VLC",
    "foobar2000": "foobar2000",
    "MusicBee": "MusicBee",
};

function resolveAppName(appId: string): string {
    if (!appId) return "Musique";
    for (const [key, name] of Object.entries(APP_NAMES)) {
        if (appId.toLowerCase().includes(key.toLowerCase())) return name;
    }
    return appId.split("!").pop()?.split(".").pop() ?? "Musique";
}

function fmt(s: number): string {
    if (!isFinite(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${m}:${ss.toString().padStart(2, "0")}`;
}

function IconPrev() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
        </svg>
    );
}

function IconNext() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="m6 18 8.5-6L6 6v12zM16 6v12h2V6z" />
        </svg>
    );
}

function IconPlay() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
        </svg>
    );
}

function IconPause() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
        </svg>
    );
}

function MediaPlayerPanel() {
    const [info, setInfo] = React.useState<MediaInfo | null>(null);
    const [thumbSrc, setThumbSrc] = React.useState<string | null>(null);
    const [nativeError, setNativeError] = React.useState(false);
    const lastTrackRef = React.useRef<string>("");

    React.useEffect(() => {
        let alive = true;

        async function poll() {
            while (alive) {
                try {
                    // This will throw if VencordNative.pluginHelpers.MediaPlayer is undefined
                    const result = await Native.getMediaInfo();
                    if (!alive) break;

                    setNativeError(false);
                    setInfo(result);

                    const trackKey = `${result?.title}|${result?.artist}`;
                    if (result && trackKey !== lastTrackRef.current) {
                        lastTrackRef.current = trackKey;
                        setThumbSrc(result.thumb ? `data:image/jpeg;base64,${result.thumb}` : null);
                    }
                } catch {
                    setNativeError(true);
                }

                await new Promise(r => setTimeout(r, 2000));
            }
        }

        poll();
        return () => { alive = false; };
    }, []);

    if (nativeError) {
        return (
            <div className="vc-mp-panel vc-mp-error">
                <span>MediaPlayer: native non disponible</span>
            </div>
        );
    }

    if (!info || info.status === "Closed" || info.status === "Stopped") return null;

    const isPlaying = info.status === "Playing";
    const progress = info.dur > 0 ? Math.min(100, (info.pos / info.dur) * 100) : 0;
    const appName = resolveAppName(info.app);

    async function control(action: "play" | "pause" | "next" | "previous") {
        await Native.sendControl(action);
        if (action === "play") setInfo(prev => prev ? { ...prev, status: "Playing" } : prev);
        if (action === "pause") setInfo(prev => prev ? { ...prev, status: "Paused" } : prev);
    }

    return (
        <div className="vc-mp-panel">
            <div className="vc-mp-track">
                {thumbSrc
                    ? <img className="vc-mp-art" src={thumbSrc} alt="" />
                    : <div className="vc-mp-art vc-mp-art-placeholder">🎵</div>
                }
                <div className="vc-mp-meta">
                    <div className="vc-mp-title" title={info.title}>{info.title || "Inconnu"}</div>
                    <div className="vc-mp-artist" title={info.artist}>{info.artist || appName}</div>
                </div>
                <div className="vc-mp-source">{appName}</div>
            </div>

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

            <div className="vc-mp-progress-area">
                <span className="vc-mp-time">{fmt(info.pos)}</span>
                <div className="vc-mp-bar">
                    <div className="vc-mp-bar-fill" style={{ width: `${progress}%` }} />
                </div>
                <span className="vc-mp-time">{fmt(info.dur)}</span>
            </div>
        </div>
    );
}

let _root: ReturnType<typeof createRoot> | null = null;
let _container: HTMLDivElement | null = null;

export default definePlugin({
    name: "MediaPlayer",
    description: "Contrôle musical dans le panneau bas-gauche. Compatible Spotify, YouTube Music, VLC, et tout lecteur Windows sans connexion requise.",
    authors: [{ name: "Flocord", id: 0n }],
    tags: ["Media", "Utility"],

    start() {
        if (!IS_DISCORD_DESKTOP) return;

        _container = document.createElement("div");
        _container.id = "vc-mp-root";
        document.body.appendChild(_container);

        _root = createRoot(_container);
        _root.render(
            <ErrorBoundary>
                <MediaPlayerPanel />
            </ErrorBoundary>
        );
    },

    stop() {
        _root?.unmount();
        _root = null;
        _container?.remove();
        _container = null;
    },
});
