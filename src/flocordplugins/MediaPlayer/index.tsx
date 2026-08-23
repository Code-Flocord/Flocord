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
    const [imgError, setImgError] = React.useState(false);
    const lastTrackRef = React.useRef<string>("");

    React.useEffect(() => {
        let alive = true;

        async function poll() {
            while (alive) {
                try {
                    const result = await Native.getMediaInfo();
                    if (!alive) break;
                    setInfo(result);
                    if (result) {
                        const trackKey = `${result.title}|${result.artist}`;
                        if (trackKey !== lastTrackRef.current) {
                            lastTrackRef.current = trackKey;
                            setImgError(false);
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

    function handleImgError() {
        if (!imgError && thumbSrc?.includes("jpeg")) {
            setImgError(true);
            setThumbSrc(prev => prev?.replace("image/jpeg", "image/png") ?? null);
        }
    }

    return (
        <div className="vc-mp-panel">
            <div className="vc-mp-main">
                <div className="vc-mp-art-wrap">
                    {thumbSrc && !imgError
                        ? <img className="vc-mp-art" src={thumbSrc} alt="" onError={handleImgError} />
                        : thumbSrc
                            ? <img className="vc-mp-art" src={thumbSrc} alt="" />
                            : <div className="vc-mp-art vc-mp-no-art">♪</div>
                    }
                </div>
                <div className="vc-mp-info">
                    <div className="vc-mp-title" title={info.title}>{info.title || "Inconnu"}</div>
                    <div className="vc-mp-sub">
                        <span className="vc-mp-artist">{info.artist || appName}</span>
                        {info.artist && <span className="vc-mp-dot"> · </span>}
                        {info.artist && <span className="vc-mp-source">{appName}</span>}
                    </div>
                    <div className="vc-mp-controls">
                        <button className="vc-mp-btn" onClick={() => control("previous")} title="Précédent">
                            <IconPrev />
                        </button>
                        <button className="vc-mp-btn vc-mp-btn-play" onClick={() => control(isPlaying ? "pause" : "play")} title={isPlaying ? "Pause" : "Lecture"}>
                            {isPlaying ? <IconPause /> : <IconPlay />}
                        </button>
                        <button className="vc-mp-btn" onClick={() => control("next")} title="Suivant">
                            <IconNext />
                        </button>
                    </div>
                </div>
            </div>
            <div className="vc-mp-footer">
                <span className="vc-mp-time">{fmt(info.pos)}</span>
                <div className="vc-mp-bar">
                    <div className="vc-mp-bar-fill" style={{ width: `${progress}%` }} />
                </div>
                <span className="vc-mp-time">{fmt(info.dur)}</span>
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
