/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

export const enum IpcEvents {
    INIT_FILE_WATCHERS = "FlocordInitFileWatchers",
    QUICK_CSS_UPDATE = "FlocordQuickCssUpdate",
    OPEN_QUICKCSS = "FlocordOpenQuickCss",
    GET_QUICK_CSS = "FlocordGetQuickCss",
    SET_QUICK_CSS = "FlocordSetQuickCss",
    UPLOAD_THEME = "FlocordUploadTheme",
    DELETE_THEME = "FlocordDeleteTheme",
    GET_THEMES_DIR = "FlocordGetThemesDir",
    GET_THEMES_LIST = "FlocordGetThemesList",
    GET_THEME_DATA = "FlocordGetThemeData",
    GET_THEME_SYSTEM_VALUES = "FlocordGetThemeSystemValues",
    GET_SETTINGS_DIR = "FlocordGetSettingsDir",
    GET_SETTINGS = "FlocordGetSettings",
    SET_SETTINGS = "FlocordSetSettings",
    THEME_UPDATE = "FlocordThemeUpdate",
    OPEN_EXTERNAL = "FlocordOpenExternal",
    GET_UPDATES = "FlocordGetUpdates",
    GET_REPO = "FlocordGetRepo",
    UPDATE = "FlocordUpdate",
    BUILD = "FlocordBuild",
    OPEN_MONACO_EDITOR = "FlocordOpenMonacoEditor",
    GET_MONACO_THEME = "FlocordGetMonacoTheme",

    GET_PLUGIN_IPC_METHOD_MAP = "FlocordGetPluginIpcMethodMap",

    CSP_IS_DOMAIN_ALLOWED = "FlocordCspIsDomainAllowed",
    CSP_REMOVE_OVERRIDE = "FlocordCspRemoveOverride",
    CSP_REQUEST_ADD_OVERRIDE = "FlocordCspRequestAddOverride",

    OPEN_THEMES_FOLDER = "FlocordOpenThemesFolder",
    OPEN_SETTINGS_FOLDER = "FlocordOpenSettingsFolder",
    GET_RENDERER_CSS = "FlocordGetRendererCss",
    RENDERER_CSS_UPDATE = "FlocordRendererCssUpdate",
    PRELOAD_GET_RENDERER_JS = "FlocordPreloadGetRendererJs",

    SET_TRAY_UPDATE_STATE = "FlocordSetTrayUpdateState",
    TRAY_REPAIR = "FlocordTrayRepair",
    TRAY_CHECK_UPDATES = "FlocordTrayCheckUpdates",
    TRAY_ABOUT = "FlocordTrayAbout",
    SUPPORTS_WINDOWS_MATERIAL = "FlocordSupportsWindowsMaterial",
}
