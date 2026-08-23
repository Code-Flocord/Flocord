import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { UserStore } from "@webpack/common";
import { findByPropsLazy, findStoreLazy } from "@webpack";

const UserSettingsProto = findByPropsLazy("updateRemoteSettings");
const PresenceStore = findStoreLazy("PresenceStore");

let previousStatus: string | null = null;

const settings = definePluginSettings({
    autoDND: {
        type: OptionType.BOOLEAN,
        description: "Activer automatiquement le mode Ne pas déranger quand le plugin est actif",
        default: true,
    },
    allowMentions: {
        type: OptionType.BOOLEAN,
        description: "Recevoir les notifications pour les mentions directes (@toi, @everyone, @here)",
        default: false,
    },
    allowDMs: {
        type: OptionType.BOOLEAN,
        description: "Recevoir les notifications pour les messages privés (DM)",
        default: false,
    },
    keywords: {
        type: OptionType.STRING,
        description: "Mots-clés déclenchant une notification (séparés par des virgules)",
        default: "",
        placeholder: "urgence, réunion, bug",
    },
    whitelistedUsers: {
        type: OptionType.STRING,
        description: "IDs d'utilisateurs dont tu veux toujours recevoir les notifs (séparés par des virgules)",
        default: "",
        placeholder: "123456789012345678",
    },
});

function shouldShowNotification(message: any, channel: any): boolean {
    const { allowMentions, allowDMs } = settings.store;
    const me = UserStore.getCurrentUser();
    if (!me) return true;

    // DM (type 1) ou Group DM (type 3) → toujours laisser passer si option activée
    if (allowDMs && (channel?.type === 1 || channel?.type === 3)) return true;

    // Mentions directes
    if (allowMentions) {
        if (message?.mention_everyone) return true;
        if (message?.mentions?.some((u: any) => u.id === me.id)) return true;
    }

    // Mots-clés
    const content = (message?.content ?? "").toLowerCase();
    const keywords = settings.store.keywords
        .split(",")
        .map((k: string) => k.trim().toLowerCase())
        .filter(Boolean);
    if (keywords.some((k: string) => content.includes(k))) return true;

    // Utilisateurs whitelistés
    const whitelist = settings.store.whitelistedUsers
        .split(",")
        .map((id: string) => id.trim())
        .filter(Boolean);
    if (whitelist.includes(message?.author?.id)) return true;

    return false;
}

export default definePlugin({
    name: "SmartNotifications",
    description: "Notifications uniquement pour les mentions, mots-clés ou utilisateurs sélectionnés. Active le mode Ne pas déranger automatiquement.",
    authors: [{ name: "Flocord", id: 0n }],
    settings,

    patches: [
        {
            find: ".shouldNotify(",
            replacement: {
                match: /\.shouldNotify\((\i),(\i)\)/,
                replace: ".shouldNotify($1,$2)&&$self.shouldShowNotification($1,$2)"
            }
        }
    ],

    shouldShowNotification,

    start() {
        if (!settings.store.autoDND) return;
        const me = UserStore.getCurrentUser();
        if (!me) return;
        try {
            previousStatus = (PresenceStore as any).getStatus?.(me.id) ?? "online";
            UserSettingsProto.updateRemoteSettings?.({ status: "dnd" });
        } catch { /* ignore */ }
    },

    stop() {
        if (previousStatus !== null) {
            try {
                UserSettingsProto.updateRemoteSettings?.({ status: previousStatus });
            } catch { /* ignore */ }
            previousStatus = null;
        }
    },
});
