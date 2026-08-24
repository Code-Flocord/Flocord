/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2024 Vendicated and contributors
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

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { ImageIcon } from "@components/Icons";
import { Alerts } from "@webpack/common";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { Button, Menu, React, showToast, Text, Toasts, UserStore, useState, useEffect, useRef } from "@webpack/common";

// ÐšÐ¾Ð¼Ð¿Ð¾Ð½ÐµÐ½Ñ‚ ÐºÐ½Ð¾Ð¿ÐºÐ¸ Ð² Ð¿Ð°Ð½ÐµÐ»Ð¸
const PanelButton = findComponentByCodeLazy(".GREEN,positionKeyStemOverride:");

const DATASTORE_KEY = "CustomStreamTopQ_ImageData";
const DATASTORE_KEY_SLIDESHOW = "CustomStreamTopQ_Slideshow";
const DATASTORE_KEY_INDEX = "CustomStreamTopQ_SlideIndex";
const DATASTORE_KEY_PROFILES = "CustomStreamTopQ_Profiles";
const DATASTORE_KEY_ACTIVE_PROFILE = "CustomStreamTopQ_ActiveProfile";
const MAX_IMAGES = 50;
const MAX_IMAGES_PER_PROFILE = 50;
const MAX_PROFILES = 5;  // Maximum number of profiles allowed
const DEFAULT_PROFILE_ID = "default";

// Ð¡Ñ‚Ñ€ÑƒÐºÑ‚ÑƒÑ€Ð° Ð¿Ñ€Ð¾Ñ„Ð¸Ð»Ñ
interface Profile {
    id: string;
    name: string;
    images: Blob[];
    dataUris: string[];
    currentIndex: number;
}

// ÐšÑÑˆ Ð´Ð»Ñ Ð¿Ñ€Ð¾Ñ„Ð¸Ð»ÐµÐ¹
let profiles: Map<string, Profile> = new Map();
let activeProfileId: string = DEFAULT_PROFILE_ID;

// ÐšÑÑˆ Ð´Ð»Ñ Ð¸Ð·Ð¾Ð±Ñ€Ð°Ð¶ÐµÐ½Ð¸Ð¹ Ð² Ð¿Ð°Ð¼ÑÑ‚Ð¸ (Ð´Ð»Ñ Ð¾Ð±Ñ€Ð°Ñ‚Ð½Ð¾Ð¹ ÑÐ¾Ð²Ð¼ÐµÑÑ‚Ð¸Ð¼Ð¾ÑÑ‚Ð¸)
let cachedImages: Blob[] = [];
let cachedDataUris: string[] = [];
let currentSlideIndex = 0;
let lastSlideChangeTime = 0; // Ð’Ñ€ÐµÐ¼Ñ Ð¿Ð¾ÑÐ»ÐµÐ´Ð½ÐµÐ¹ ÑÐ¼ÐµÐ½Ñ‹ ÑÐ»Ð°Ð¹Ð´Ð° (timestamp)
let isStreamActive = false; // ÐÐºÑ‚Ð¸Ð²ÐµÐ½ Ð»Ð¸ ÑÑ‚Ñ€Ð¸Ð¼ ÑÐµÐ¹Ñ‡Ð°Ñ
let manualSlideChange = false; // Ð¤Ð»Ð°Ð³ Ñ€ÑƒÑ‡Ð½Ð¾Ð¹ ÑÐ¼ÐµÐ½Ñ‹ ÐºÐ°Ñ€Ñ‚Ð¸Ð½ÐºÐ¸ Ñ‡ÐµÑ€ÐµÐ· Ð¼Ð¾Ð´Ð°Ð»ÐºÑƒ
let actualStreamImageUri: string | null = null; // Ð ÐµÐ°Ð»ÑŒÐ½Ð°Ñ ÐºÐ°Ñ€Ñ‚Ð¸Ð½ÐºÐ° ÐºÐ¾Ñ‚Ð¾Ñ€Ð°Ñ Ð¡Ð•Ð™Ð§ÐÐ¡ Ð½Ð° ÑÑ‚Ñ€Ð¸Ð¼Ðµ (Ð¾Ð±Ð½Ð¾Ð²Ð»ÑÐµÑ‚ÑÑ Ñ‚Ð¾Ð»ÑŒÐºÐ¾ Discord'Ð¾Ð¼)

// ÐŸÐ¾Ð»ÑƒÑ‡Ð¸Ñ‚ÑŒ Ð°ÐºÑ‚Ð¸Ð²Ð½Ñ‹Ð¹ Ð¿Ñ€Ð¾Ñ„Ð¸Ð»ÑŒ
function getActiveProfile(): Profile {
    let profile = profiles.get(activeProfileId);
    if (!profile) {
        profile = {
            id: DEFAULT_PROFILE_ID,
            name: "Default",
            images: [],
            dataUris: [],
            currentIndex: 0
        };
        profiles.set(DEFAULT_PROFILE_ID, profile);
    }
    return profile;
}

// Ð¡Ð¸Ð½Ñ…Ñ€Ð¾Ð½Ð¸Ð·Ð¸Ñ€Ð¾Ð²Ð°Ñ‚ÑŒ ÐºÑÑˆ Ñ Ð°ÐºÑ‚Ð¸Ð²Ð½Ñ‹Ð¼ Ð¿Ñ€Ð¾Ñ„Ð¸Ð»ÐµÐ¼
function syncCacheWithActiveProfile() {
    const profile = getActiveProfile();
    cachedImages = profile.images;
    cachedDataUris = profile.dataUris;
    currentSlideIndex = profile.currentIndex;
}

// Ð¡Ð»ÑƒÑˆÐ°Ñ‚ÐµÐ»Ð¸ Ð´Ð»Ñ Ð¾Ð±Ð½Ð¾Ð²Ð»ÐµÐ½Ð¸Ñ UI
const imageChangeListeners = new Set<() => void>();

function notifyImageChange() {
    imageChangeListeners.forEach(listener => listener());
}

const settings = definePluginSettings({
    replaceEnabled: {
        type: OptionType.BOOLEAN,
        description: "Use custom preview instead of screen capture",
        default: true
    },
    slideshowEnabled: {
        type: OptionType.BOOLEAN,
        description: "Slideshow mode (switch images automatically when Discord requests update ~5 min)",
        default: false
    },
    slideshowRandom: {
        type: OptionType.BOOLEAN,
        description: "Random slide order",
        default: false
    },
    showInfoBadges: {
        type: OptionType.BOOLEAN,
        description: "Show info badges in modal (count, selected, timer)",
        default: true
    }
});

// Ð¡Ñ‚Ñ€ÑƒÐºÑ‚ÑƒÑ€Ð° Ð´Ð°Ð½Ð½Ñ‹Ñ… Ð´Ð»Ñ Ñ…Ñ€Ð°Ð½ÐµÐ½Ð¸Ñ
interface StoredImageData {
    type: string;
    data: number[];
}

interface SlideshowData {
    images: StoredImageData[];
}

interface StoredProfile {
    id: string;
    name: string;
    images: StoredImageData[];
    currentIndex: number;
}

interface StoredProfilesData {
    profiles: StoredProfile[];
    activeProfileId: string;
}

// Ð¤ÑƒÐ½ÐºÑ†Ð¸Ð¸ Ð´Ð»Ñ Ñ€Ð°Ð±Ð¾Ñ‚Ñ‹ Ñ Ð¿Ñ€Ð¾Ñ„Ð¸Ð»ÑÐ¼Ð¸
async function saveProfilesToDataStore(): Promise<void> {
    const storedProfiles: StoredProfile[] = [];

    for (const [, profile] of profiles) {
        const images: StoredImageData[] = [];
        for (const blob of profile.images) {
            const arrayBuffer = await blob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            images.push({
                type: blob.type,
                data: Array.from(uint8Array)
            });
        }
        storedProfiles.push({
            id: profile.id,
            name: profile.name,
            images,
            currentIndex: profile.currentIndex
        });
    }

    await DataStore.set(DATASTORE_KEY_PROFILES, {
        profiles: storedProfiles,
        activeProfileId
    });

    syncCacheWithActiveProfile();
    notifyImageChange();
}

async function loadProfilesFromDataStore(): Promise<void> {
    try {
        const data: StoredProfilesData | undefined = await DataStore.get(DATASTORE_KEY_PROFILES);

        if (data?.profiles?.length) {
            profiles.clear();
            for (const stored of data.profiles) {
                const blobs: Blob[] = [];
                const dataUris: string[] = [];

                for (const img of stored.images) {
                    const uint8Array = new Uint8Array(img.data);
                    const blob = new Blob([uint8Array], { type: img.type });
                    blobs.push(blob);
                    dataUris.push(await blobToDataUrl(blob));
                }

                profiles.set(stored.id, {
                    id: stored.id,
                    name: stored.name,
                    images: blobs,
                    dataUris,
                    currentIndex: stored.currentIndex
                });
            }
            activeProfileId = data.activeProfileId || DEFAULT_PROFILE_ID;
        } else {
            // ÐœÐ¸Ð³Ñ€Ð°Ñ†Ð¸Ñ ÑÐ¾ ÑÑ‚Ð°Ñ€Ð¾Ð³Ð¾ Ñ„Ð¾Ñ€Ð¼Ð°Ñ‚Ð°
            const oldData: SlideshowData | undefined = await DataStore.get(DATASTORE_KEY_SLIDESHOW);
            if (oldData?.images?.length) {
                const blobs: Blob[] = [];
                const dataUris: string[] = [];

                for (const img of oldData.images) {
                    const uint8Array = new Uint8Array(img.data);
                    const blob = new Blob([uint8Array], { type: img.type });
                    blobs.push(blob);
                    dataUris.push(await blobToDataUrl(blob));
                }

                const oldIndex = await loadSlideIndex();
                profiles.set(DEFAULT_PROFILE_ID, {
                    id: DEFAULT_PROFILE_ID,
                    name: "Default",
                    images: blobs,
                    dataUris,
                    currentIndex: oldIndex
                });
                activeProfileId = DEFAULT_PROFILE_ID;

                // Ð¡Ð¾Ñ…Ñ€Ð°Ð½ÑÐµÐ¼ Ð² Ð½Ð¾Ð²Ð¾Ð¼ Ñ„Ð¾Ñ€Ð¼Ð°Ñ‚Ðµ Ð¸ ÑƒÐ´Ð°Ð»ÑÐµÐ¼ ÑÑ‚Ð°Ñ€Ñ‹Ðµ Ð´Ð°Ð½Ð½Ñ‹Ðµ
                await saveProfilesToDataStore();
                await DataStore.del(DATASTORE_KEY_SLIDESHOW);
                await DataStore.del(DATASTORE_KEY_INDEX);
                await DataStore.del(DATASTORE_KEY);
            } else {
                // Ð¡Ð¾Ð·Ð´Ð°Ñ‘Ð¼ Ð´ÐµÑ„Ð¾Ð»Ñ‚Ð½Ñ‹Ð¹ Ð¿Ñ€Ð¾Ñ„Ð¸Ð»ÑŒ
                profiles.set(DEFAULT_PROFILE_ID, {
                    id: DEFAULT_PROFILE_ID,
                    name: "Default",
                    images: [],
                    dataUris: [],
                    currentIndex: 0
                });
                activeProfileId = DEFAULT_PROFILE_ID;
            }
        }

        syncCacheWithActiveProfile();
    } catch (error) {
        console.error("[CustomStreamTopQ] Error loading profiles:", error);
        profiles.set(DEFAULT_PROFILE_ID, {
            id: DEFAULT_PROFILE_ID,
            name: "Default",
            images: [],
            dataUris: [],
            currentIndex: 0
        });
        activeProfileId = DEFAULT_PROFILE_ID;
    }
}

function createProfile(name: string): Profile | null {
    // Check profile limit
    if (profiles.size >= MAX_PROFILES) {
        return null;
    }
    const id = `profile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const profile: Profile = {
        id,
        name,
        images: [],
        dataUris: [],
        currentIndex: 0
    };
    profiles.set(id, profile);
    return profile;
}

function deleteProfile(profileId: string): boolean {
    const profile = profiles.get(profileId);
    if (!profile) return false;
    if (profile.images.length > 0) return false; // ÐÐµÐ»ÑŒÐ·Ñ ÑƒÐ´Ð°Ð»Ð¸Ñ‚ÑŒ Ð¿Ñ€Ð¾Ñ„Ð¸Ð»ÑŒ Ñ Ñ„Ð¾Ñ‚Ð¾
    if (profileId === DEFAULT_PROFILE_ID) return false; // ÐÐµÐ»ÑŒÐ·Ñ ÑƒÐ´Ð°Ð»Ð¸Ñ‚ÑŒ Ð´ÐµÑ„Ð¾Ð»Ñ‚Ð½Ñ‹Ð¹

    profiles.delete(profileId);
    if (activeProfileId === profileId) {
        activeProfileId = DEFAULT_PROFILE_ID;
        syncCacheWithActiveProfile();
    }
    return true;
}

function renameProfile(profileId: string, newName: string): boolean {
    const profile = profiles.get(profileId);
    if (!profile) return false;
    profile.name = newName;
    return true;
}

function setActiveProfile(profileId: string): boolean {
    if (!profiles.has(profileId)) return false;
    activeProfileId = profileId;
    syncCacheWithActiveProfile();
    notifyImageChange();
    return true;
}

function getProfileList(): Profile[] {
    return Array.from(profiles.values());
}

// Ð¤ÑƒÐ½ÐºÑ†Ð¸Ð¸ Ð´Ð»Ñ Ñ€Ð°Ð±Ð¾Ñ‚Ñ‹ Ñ DataStore (Ð¾Ð±Ð½Ð¾Ð²Ð»Ñ‘Ð½Ð½Ñ‹Ðµ Ð´Ð»Ñ Ñ€Ð°Ð±Ð¾Ñ‚Ñ‹ Ñ Ð¿Ñ€Ð¾Ñ„Ð¸Ð»ÑÐ¼Ð¸)
async function saveSlideIndex(index: number): Promise<void> {
    const profile = getActiveProfile();
    profile.currentIndex = index;
    currentSlideIndex = index;
    await saveProfilesToDataStore();
}

async function loadSlideIndex(): Promise<number> {
    const index = await DataStore.get(DATASTORE_KEY_INDEX);
    return typeof index === "number" ? index : 0;
}

async function saveImagesToDataStore(blobs: Blob[]): Promise<void> {
    const profile = getActiveProfile();
    profile.images = blobs;

    // ÐžÐ±Ð½Ð¾Ð²Ð»ÑÐµÐ¼ dataUris
    profile.dataUris = [];
    for (const blob of blobs) {
        profile.dataUris.push(await blobToDataUrl(blob));
    }

    syncCacheWithActiveProfile();
    await saveProfilesToDataStore();
}

// loadImagesFromDataStore ÑƒÐ´Ð°Ð»ÐµÐ½Ð° - Ñ‚ÐµÐ¿ÐµÑ€ÑŒ Ð¸ÑÐ¿Ð¾Ð»ÑŒÐ·ÑƒÐµÑ‚ÑÑ getActiveProfile().images Ð½Ð°Ð¿Ñ€ÑÐ¼ÑƒÑŽ

async function deleteAllImages(): Promise<void> {
    const profile = getActiveProfile();
    profile.images = [];
    profile.dataUris = [];
    profile.currentIndex = 0;
    syncCacheWithActiveProfile();
    await saveProfilesToDataStore();
}

async function deleteImageAtIndex(index: number): Promise<void> {
    const profile = getActiveProfile();
    if (index < 0 || index >= profile.images.length) return;

    profile.images.splice(index, 1);
    profile.dataUris.splice(index, 1);

    if (profile.currentIndex >= profile.images.length) {
        profile.currentIndex = 0;
    }

    syncCacheWithActiveProfile();
    await saveProfilesToDataStore();
}

async function moveImage(fromIndex: number, toIndex: number): Promise<void> {
    const profile = getActiveProfile();
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= profile.images.length) return;
    if (toIndex < 0 || toIndex >= profile.images.length) return;

    // ÐŸÑ€Ð¾ÑÑ‚Ð¾Ð¹ swap 
    [profile.images[fromIndex], profile.images[toIndex]] = [profile.images[toIndex], profile.images[fromIndex]];
    [profile.dataUris[fromIndex], profile.dataUris[toIndex]] = [profile.dataUris[toIndex], profile.dataUris[fromIndex]];

    // ÐšÐ¾Ñ€Ñ€ÐµÐºÑ‚Ð¸Ñ€ÑƒÐµÐ¼ currentIndex ÐµÑÐ»Ð¸ Ð¾Ð½ Ð±Ñ‹Ð» Ð½Ð° Ð¾Ð´Ð½Ð¾Ð¹ Ð¸Ð· Ð¿ÐµÑ€ÐµÐ¼ÐµÑ‰Ð°ÐµÐ¼Ñ‹Ñ… Ð¿Ð¾Ð·Ð¸Ñ†Ð¸Ð¹
    if (profile.currentIndex === fromIndex) {
        profile.currentIndex = toIndex;
    } else if (profile.currentIndex === toIndex) {
        profile.currentIndex = fromIndex;
    }

    syncCacheWithActiveProfile();
    await saveProfilesToDataStore();
}

async function addImage(blob: Blob): Promise<void> {
    const profile = getActiveProfile();
    profile.images.push(blob);
    profile.dataUris.push(await blobToDataUrl(blob));
    syncCacheWithActiveProfile();
    await saveProfilesToDataStore();
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// Ð£Ð´Ð°Ð»ÐµÐ½Ð° Ð½ÐµÐ¸ÑÐ¿Ð¾Ð»ÑŒÐ·ÑƒÐµÐ¼Ð°Ñ Ñ„ÑƒÐ½ÐºÑ†Ð¸Ñ prepareCachedDataUris

function getImageCount(): number {
    return cachedImages.length;
}

// ÐšÐ¾Ð½Ð²ÐµÑ€Ñ‚Ð°Ñ†Ð¸Ñ Ð¸Ð·Ð¾Ð±Ñ€Ð°Ð¶ÐµÐ½Ð¸Ñ Ð² JPEG Ð¸ Ð¼Ð°ÑÑˆÑ‚Ð°Ð±Ð¸Ñ€Ð¾Ð²Ð°Ð½Ð¸Ðµ Ð´Ð¾ 1280x720
async function processImage(blob: Blob): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);

        img.onload = () => {
            URL.revokeObjectURL(url);

            const targetWidth = 1280;
            const targetHeight = 720;

            // Ð¡Ð¾Ð·Ð´Ð°Ñ‘Ð¼ canvas Ð´Ð»Ñ ÐºÐ¾Ð½Ð²ÐµÑ€Ñ‚Ð°Ñ†Ð¸Ð¸ Ð¸ Ð¼Ð°ÑÑˆÑ‚Ð°Ð±Ð¸Ñ€Ð¾Ð²Ð°Ð½Ð¸Ñ
            const canvas = document.createElement("canvas");
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext("2d")!;

            // Ð—Ð°Ð»Ð¸Ð²Ð°ÐµÐ¼ Ñ‡Ñ‘Ñ€Ð½Ñ‹Ð¼ Ñ„Ð¾Ð½Ð¾Ð¼ (Ð½Ð° ÑÐ»ÑƒÑ‡Ð°Ð¹ Ð¿Ñ€Ð¾Ð·Ñ€Ð°Ñ‡Ð½Ð¾ÑÑ‚Ð¸)
            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, targetWidth, targetHeight);

            // Ð’Ñ‹Ñ‡Ð¸ÑÐ»ÑÐµÐ¼ Ñ€Ð°Ð·Ð¼ÐµÑ€Ñ‹ Ð´Ð»Ñ ÑÐ¾Ñ…Ñ€Ð°Ð½ÐµÐ½Ð¸Ñ Ð¿Ñ€Ð¾Ð¿Ð¾Ñ€Ñ†Ð¸Ð¹ (cover)
            const scale = Math.max(targetWidth / img.width, targetHeight / img.height);
            const scaledWidth = img.width * scale;
            const scaledHeight = img.height * scale;
            const x = (targetWidth - scaledWidth) / 2;
            const y = (targetHeight - scaledHeight) / 2;

            ctx.drawImage(img, x, y, scaledWidth, scaledHeight);

            // Discord Ð¸ÑÐ¿Ð¾Ð»ÑŒÐ·ÑƒÐµÑ‚ JPEG Ð´Ð»Ñ Ð¿Ñ€ÐµÐ²ÑŒÑŽ ÑÑ‚Ñ€Ð¸Ð¼Ð¾Ð²
            // ÐšÐ°Ñ‡ÐµÑÑ‚Ð²Ð¾ 0.7 Ð´Ð»Ñ ÑƒÐ¼ÐµÐ½ÑŒÑˆÐµÐ½Ð¸Ñ Ñ€Ð°Ð·Ð¼ÐµÑ€Ð° (Discord Ð¾Ð³Ñ€Ð°Ð½Ð¸Ñ‡Ð¸Ð²Ð°ÐµÑ‚ ~100KB)
            canvas.toBlob((newBlob) => {
                if (newBlob) {
                    resolve(newBlob);
                } else {
                    reject(new Error("Failed to convert image"));
                }
            }, "image/jpeg", 0.7);
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Failed to load image"));
        };

        img.src = url;
    });
}

function ImagePickerModal({ rootProps }: { rootProps: any; }) {
    // Ð¡Ð¾Ñ…Ñ€Ð°Ð½ÑÐµÐ¼ Ð¸ÑÑ…Ð¾Ð´Ð½Ñ‹Ðµ Ð·Ð½Ð°Ñ‡ÐµÐ½Ð¸Ñ Ð´Ð»Ñ Ð¾Ñ‚ÐºÐ°Ñ‚Ð°
    const initialSettingsRef = useRef({
        enabled: settings.store.replaceEnabled,
        slideshowEnabled: settings.store.slideshowEnabled,
        slideshowRandom: settings.store.slideshowRandom,
        slideIndex: currentSlideIndex,
        activeProfileId: activeProfileId
    });
    const savedRef = useRef(false);

    const [images, setImages] = useState<string[]>([]);
    const [imageSizes, setImageSizes] = useState<number[]>([]); // Ð Ð°Ð·Ð¼ÐµÑ€Ñ‹ Ð² Ð±Ð°Ð¹Ñ‚Ð°Ñ…
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");
    const [pendingIndex, setPendingIndex] = useState(currentSlideIndex);
    const [pluginEnabled, setPluginEnabled] = useState(settings.store.replaceEnabled);
    const [slideshowOn, setSlideshowOn] = useState(settings.store.slideshowEnabled);
    const [randomOn, setRandomOn] = useState(settings.store.slideshowRandom);
    const [isDragging, setIsDragging] = useState(false);
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const [timerSeconds, setTimerSeconds] = useState(0);
    const [streamActive, setStreamActive] = useState(isStreamActive);
    const [previewImage, setPreviewImage] = useState<string | null>(null); // Ð”Ð»Ñ Ð¿Ð¾Ð»Ð½Ð¾ÑÐºÑ€Ð°Ð½Ð½Ð¾Ð³Ð¾ Ð¿Ñ€Ð¾ÑÐ¼Ð¾Ñ‚Ñ€Ð°

    // Ð¡Ð¾ÑÑ‚Ð¾ÑÐ½Ð¸Ñ Ð´Ð»Ñ Ð¿Ñ€Ð¾Ñ„Ð¸Ð»ÐµÐ¹
    const [profileList, setProfileList] = useState<Profile[]>(getProfileList());
    const [currentProfileId, setCurrentProfileId] = useState(activeProfileId);
    const [isCreatingProfile, setIsCreatingProfile] = useState(false);
    const [newProfileName, setNewProfileName] = useState("");
    const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
    const [editingProfileName, setEditingProfileName] = useState("");

    // ÐžÑ‚ÐºÐ°Ñ‚ Ð¿Ñ€Ð¸ Ð·Ð°ÐºÑ€Ñ‹Ñ‚Ð¸Ð¸ Ð±ÐµÐ· ÑÐ¾Ñ…Ñ€Ð°Ð½ÐµÐ½Ð¸Ñ (ESC, ÐºÐ»Ð¸Ðº Ð²Ð½Ðµ Ð¾ÐºÐ½Ð°, ÐºÑ€ÐµÑÑ‚Ð¸Ðº)
    useEffect(() => {
        return () => {
            if (!savedRef.current) {
                // ÐžÑ‚ÐºÐ°Ñ‚Ñ‹Ð²Ð°ÐµÐ¼ Ð½Ð°ÑÑ‚Ñ€Ð¾Ð¹ÐºÐ¸ Ð¿Ñ€Ð¸ Ð·Ð°ÐºÑ€Ñ‹Ñ‚Ð¸Ð¸ Ð±ÐµÐ· ÑÐ¾Ñ…Ñ€Ð°Ð½ÐµÐ½Ð¸Ñ
                const init = initialSettingsRef.current;
                settings.store.replaceEnabled = init.enabled;
                settings.store.slideshowEnabled = init.slideshowEnabled;
                settings.store.slideshowRandom = init.slideshowRandom;
                currentSlideIndex = init.slideIndex;
                // ÐžÑ‚ÐºÐ°Ñ‚Ñ‹Ð²Ð°ÐµÐ¼ Ð°ÐºÑ‚Ð¸Ð²Ð½Ñ‹Ð¹ Ð¿Ñ€Ð¾Ñ„Ð¸Ð»ÑŒ
                setActiveProfile(init.activeProfileId);
            }
        };
    }, []);

    const loadImages = async () => {
        setIsLoading(true);
        const profile = profiles.get(currentProfileId) || getActiveProfile();
        const uris: string[] = [];
        const sizes: number[] = [];
        for (const blob of profile.images) {
            try {
                const uri = await blobToDataUrl(blob);
                uris.push(uri);
                sizes.push(blob.size); // Ð¡Ð¾Ñ…Ñ€Ð°Ð½ÑÐµÐ¼ Ñ€Ð°Ð·Ð¼ÐµÑ€ Ð² Ð±Ð°Ð¹Ñ‚Ð°Ñ…
            } catch (e) {
                console.error("[CustomStreamTopQ] Error:", e);
            }
        }
        setImages(uris);
        setPendingIndex(profile.currentIndex);
        setImageSizes(sizes);
        setIsLoading(false);
    };

    useEffect(() => {
        loadImages();
    }, [currentProfileId]);

    // Ð¢Ð°Ð¹Ð¼ÐµÑ€ Ð´Ð»Ñ Ð¾Ð±Ð½Ð¾Ð²Ð»ÐµÐ½Ð¸Ñ Ð²Ñ€ÐµÐ¼ÐµÐ½Ð¸ Ð² Ð¼Ð¾Ð´Ð°Ð»ÐºÐµ
    useEffect(() => {
        const timerInterval = setInterval(() => {
            // ÐÐ²Ñ‚Ð¾ÑÐ±Ñ€Ð¾Ñ: ÐµÑÐ»Ð¸ Ð¿Ñ€Ð¾ÑˆÐ»Ð¾ Ð±Ð¾Ð»ÐµÐµ 7 Ð¼Ð¸Ð½ÑƒÑ‚ Ð±ÐµÐ· Ð²Ñ‹Ð·Ð¾Ð²Ð° getCustomThumbnail - ÑÑ‚Ñ€Ð¸Ð¼ Ð¾ÑÑ‚Ð°Ð½Ð¾Ð²Ð»ÐµÐ½
            if (isStreamActive && lastSlideChangeTime > 0 && (Date.now() - lastSlideChangeTime) > 420000) {
                isStreamActive = false;
            }
            setStreamActive(isStreamActive);
            if (lastSlideChangeTime > 0 && isStreamActive) {
                setTimerSeconds(Math.floor((Date.now() - lastSlideChangeTime) / 1000));
            }
        }, 1000);
        return () => clearInterval(timerInterval);
    }, []);

    // ÐŸÐµÑ€ÐµÐºÐ»ÑŽÑ‡ÐµÐ½Ð¸Ðµ Ð¿Ñ€Ð¾Ñ„Ð¸Ð»Ñ
    const handleProfileSwitch = async (profileId: string) => {
        setActiveProfile(profileId);
        setCurrentProfileId(profileId);
        const profile = profiles.get(profileId);
        if (profile) {
            setPendingIndex(profile.currentIndex);
        }
    };

    // Ð¡Ð¾Ð·Ð´Ð°Ð½Ð¸Ðµ Ð½Ð¾Ð²Ð¾Ð³Ð¾ Ð¿Ñ€Ð¾Ñ„Ð¸Ð»Ñ
    const handleCreateProfile = async () => {
        if (!newProfileName.trim()) {
            setError("Enter profile name");
            return;
        }
        if (newProfileName.trim().length > 40) {
            setError("Profile name too long (max 40 characters)");
            return;
        }
        if (profiles.size >= MAX_PROFILES) {
            setError(`Maximum ${MAX_PROFILES} profiles allowed`);
            return;
        }
        const profile = createProfile(newProfileName.trim());
        if (!profile) {
            setError(`Maximum ${MAX_PROFILES} profiles allowed`);
            return;
        }
        await saveProfilesToDataStore();
        setProfileList(getProfileList());
        setNewProfileName("");
        setIsCreatingProfile(false);
        handleProfileSwitch(profile.id);
        showToast(`Profile "${profile.name}" created`, Toasts.Type.SUCCESS);
    };

    // Ð£Ð´Ð°Ð»ÐµÐ½Ð¸Ðµ Ð¿Ñ€Ð¾Ñ„Ð¸Ð»Ñ
    const handleDeleteProfile = async (profileId: string) => {
        const profile = profiles.get(profileId);
        if (!profile) return;

        if (profile.images.length > 0) {
            setError("Delete all images first!");
            return;
        }

        if (profileId === DEFAULT_PROFILE_ID) {
            setError("Cannot delete default profile");
            return;
        }

        Alerts.show({
            title: `Delete profile "${profile.name}"?`,
            body: "This action cannot be undone.",
            confirmText: "Delete",
            cancelText: "Cancel",
            confirmColor: "red",
            onConfirm: async () => {
                deleteProfile(profileId);
                await saveProfilesToDataStore();
                setProfileList(getProfileList());
                if (currentProfileId === profileId) {
                    handleProfileSwitch(DEFAULT_PROFILE_ID);
                }
                showToast("Profile deleted", Toasts.Type.SUCCESS);
            }
        });
    };

    // ÐŸÐµÑ€ÐµÐ¸Ð¼ÐµÐ½Ð¾Ð²Ð°Ð½Ð¸Ðµ Ð¿Ñ€Ð¾Ñ„Ð¸Ð»Ñ
    const handleRenameProfile = async (profileId: string) => {
        if (!editingProfileName.trim()) {
            setEditingProfileId(null);
            return;
        }
        if (editingProfileName.trim().length > 40) {
            setError("Profile name too long (max 40 characters)");
            return;
        }
        renameProfile(profileId, editingProfileName.trim());
        await saveProfilesToDataStore();
        setProfileList(getProfileList());
        setEditingProfileId(null);
        showToast("Profile renamed", Toasts.Type.SUCCESS);
    };

    // ÐžÐ±Ñ€Ð°Ð±Ð¾Ñ‚ÐºÐ° Ð¿ÐµÑ€ÐµÑ‚Ð°ÑÐºÐ¸Ð²Ð°ÐµÐ¼Ñ‹Ñ… Ñ„Ð°Ð¹Ð»Ð¾Ð²
    const handleDroppedFiles = async (files: FileList | File[]) => {
        const profile = profiles.get(currentProfileId) || getActiveProfile();
        const remaining = MAX_IMAGES_PER_PROFILE - profile.images.length;
        if (remaining <= 0) {
            setError(`Limit of ${MAX_IMAGES_PER_PROFILE} images reached!`);
            return;
        }

        setIsLoading(true);
        setError("");

        try {
            let added = 0;
            for (const file of files) {
                if (added >= remaining) {
                    setError(`Added ${added}. Limit of ${MAX_IMAGES} reached!`);
                    break;
                }
                if (!file.type.startsWith("image/") || file.type === "image/gif") {
                    continue;
                }
                if (file.size > 8 * 1024 * 1024) {
                    continue;
                }

                const processedBlob = await processImage(file);
                await addImage(processedBlob);
                added++;
            }

            await loadImages();
            if (added > 0) {
                showToast(`Added: ${added}`, Toasts.Type.SUCCESS);
            }
        } catch {
            setError("File processing error");
        }

        setIsLoading(false);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // ÐŸÐ¾ÐºÐ°Ð·Ñ‹Ð²Ð°ÐµÐ¼ Ð¿Ð¾Ð»Ð¾ÑÐºÑƒ Ñ‚Ð¾Ð»ÑŒÐºÐ¾ ÐµÑÐ»Ð¸ ÑÑ‚Ð¾ Ñ„Ð°Ð¹Ð»Ñ‹ Ð¸Ð·Ð²Ð½Ðµ, Ð° Ð½Ðµ Ð¿ÐµÑ€ÐµÑ‚Ð°ÑÐºÐ¸Ð²Ð°Ð½Ð¸Ðµ Ñ„Ð¾Ñ‚Ð¾ Ð²Ð½ÑƒÑ‚Ñ€Ð¸
        if (draggedIndex === null && e.dataTransfer.types.includes("Files")) {
            setIsDragging(true);
        }
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // ÐŸÑ€Ð¾Ð²ÐµÑ€ÑÐµÐ¼ Ñ‡Ñ‚Ð¾ Ð´ÐµÐ¹ÑÑ‚Ð²Ð¸Ñ‚ÐµÐ»ÑŒÐ½Ð¾ Ð¿Ð¾ÐºÐ¸Ð½ÑƒÐ»Ð¸ Ð¾Ð±Ð»Ð°ÑÑ‚ÑŒ
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
            setIsDragging(false);
        }
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            await handleDroppedFiles(files);
        }
    };

    const handleFileSelect = (multiple: boolean) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/png,image/jpeg,image/webp";
        input.multiple = multiple;
        input.onchange = async (e: any) => {
            const files = e.target.files;
            if (!files?.length) return;

            // ÐŸÑ€Ð¾Ð²ÐµÑ€ÑÐµÐ¼ Ð»Ð¸Ð¼Ð¸Ñ‚ Ð´Ð»Ñ Ñ‚ÐµÐºÑƒÑ‰ÐµÐ³Ð¾ Ð¿Ñ€Ð¾Ñ„Ð¸Ð»Ñ
            const profile = profiles.get(currentProfileId) || getActiveProfile();
            const remaining = MAX_IMAGES_PER_PROFILE - profile.images.length;
            if (remaining <= 0) {
                setError(`Limit of ${MAX_IMAGES_PER_PROFILE} images reached!`);
                return;
            }

            setIsLoading(true);
            setError("");

            try {
                let added = 0;
                for (const file of files) {
                    if (added >= remaining) {
                        setError(`Added ${added}. Limit of ${MAX_IMAGES_PER_PROFILE} reached!`);
                        break;
                    }
                    if (file.type === "image/gif" || file.type.startsWith("video/")) {
                        continue;
                    }
                    if (file.size > 8 * 1024 * 1024) {
                        continue;
                    }

                    const processedBlob = await processImage(file);
                    await addImage(processedBlob);
                    added++;
                }

                await loadImages();
                if (added > 0) {
                    showToast(`Added: ${added}`, Toasts.Type.SUCCESS);
                }
            } catch {
                setError("File processing error");
            }

            setIsLoading(false);
        };
        input.click();
    };

    const handleDelete = async (index: number) => {
        await deleteImageAtIndex(index);
        const profile = profiles.get(currentProfileId) || getActiveProfile();
        if (pendingIndex >= profile.images.length && profile.images.length > 0) {
            setPendingIndex(profile.images.length - 1);
        } else if (profile.images.length === 0) {
            setPendingIndex(0);
        }
        await loadImages();
        setProfileList(getProfileList()); // ÐžÐ±Ð½Ð¾Ð²Ð»ÑÐµÐ¼ ÑÐ¿Ð¸ÑÐ¾Ðº Ð¿Ñ€Ð¾Ñ„Ð¸Ð»ÐµÐ¹ Ð´Ð»Ñ Ð¾Ñ‚Ð¾Ð±Ñ€Ð°Ð¶ÐµÐ½Ð¸Ñ ÐºÐ¾Ð»Ð¸Ñ‡ÐµÑÑ‚Ð²Ð°
        showToast("Deleted", Toasts.Type.MESSAGE);
    };

    const handleClearAll = async () => {
        const profile = profiles.get(currentProfileId);
        if (!profile || profile.images.length === 0) return;

        Alerts.show({
            title: `Delete all images from "${profile.name}"?`,
            body: `Are you sure you want to delete all ${images.length} images? This action cannot be undone.`,
            confirmText: "Delete All",
            cancelText: "Cancel",
            confirmColor: "red",
            onConfirm: async () => {
                await deleteAllImages();
                setImages([]);
                setPendingIndex(0);
                setProfileList(getProfileList()); // ÐžÐ±Ð½Ð¾Ð²Ð»ÑÐµÐ¼ ÑÐ¿Ð¸ÑÐ¾Ðº Ð¿Ñ€Ð¾Ñ„Ð¸Ð»ÐµÐ¹
                showToast("All deleted", Toasts.Type.MESSAGE);
            }
        });
    };

    const handleSelectCurrent = (index: number) => {
        setPendingIndex(index);
    };

    const togglePlugin = () => {
        setPluginEnabled(!pluginEnabled);
    };

    const toggleSlideshow = () => {
        setSlideshowOn(!slideshowOn);
    };

    const toggleRandom = () => {
        setRandomOn(!randomOn);
    };

    const handleSave = async () => {
        // ÐŸÑ€Ð¸Ð¼ÐµÐ½ÑÐµÐ¼ Ð²ÑÐµ Ð¸Ð·Ð¼ÐµÐ½ÐµÐ½Ð¸Ñ
        settings.store.replaceEnabled = pluginEnabled;
        settings.store.slideshowEnabled = slideshowOn;
        settings.store.slideshowRandom = randomOn;

        // ÐŸÑ€Ð¾Ð²ÐµÑ€ÑÐµÐ¼ Ð±Ñ‹Ð»Ð° Ð»Ð¸ Ñ€ÑƒÑ‡Ð½Ð°Ñ ÑÐ¼ÐµÐ½Ð° ÐºÐ°Ñ€Ñ‚Ð¸Ð½ÐºÐ¸
        if (pendingIndex !== currentSlideIndex) {
            manualSlideChange = true; // ÐŸÐ¾Ð¼ÐµÑ‡Ð°ÐµÐ¼ Ñ‡Ñ‚Ð¾ Ð±Ñ‹Ð»Ð° Ñ€ÑƒÑ‡Ð½Ð°Ñ ÑÐ¼ÐµÐ½Ð°
            // ÐÐ• ÑÐ±Ñ€Ð°ÑÑ‹Ð²Ð°ÐµÐ¼ Ñ‚Ð°Ð¹Ð¼ÐµÑ€ Ð¿Ñ€Ð¸ Ñ€ÑƒÑ‡Ð½Ð¾Ð¹ ÑÐ¼ÐµÐ½Ðµ!
        }

        currentSlideIndex = pendingIndex;
        await saveSlideIndex(pendingIndex); // Ð¡Ð¾Ñ…Ñ€Ð°Ð½ÑÐµÐ¼ Ð¸Ð½Ð´ÐµÐºÑ Ð² DataStore
        savedRef.current = true; // ÐŸÐ¾Ð¼ÐµÑ‡Ð°ÐµÐ¼ Ñ‡Ñ‚Ð¾ ÑÐ¾Ñ…Ñ€Ð°Ð½Ð¸Ð»Ð¸
        notifyImageChange(); // ÐžÐ±Ð½Ð¾Ð²Ð»ÑÐµÐ¼ Ð¸ÐºÐ¾Ð½ÐºÑƒ Ð² Ð¿Ð°Ð½ÐµÐ»Ð¸
        showToast("Settings saved!", Toasts.Type.SUCCESS);
        rootProps.onClose();
    };

    const handleCancel = () => {
        // saved Ð¾ÑÑ‚Ð°Ñ‘Ñ‚ÑÑ false, Ð¾Ñ‚ÐºÐ°Ñ‚ Ð¿Ñ€Ð¾Ð¸Ð·Ð¾Ð¹Ð´Ñ‘Ñ‚ Ð² useEffect Ð¿Ñ€Ð¸ Ñ€Ð°Ð·Ð¼Ð¾Ð½Ñ‚Ð¸Ñ€Ð¾Ð²Ð°Ð½Ð¸Ð¸
        rootProps.onClose();
    };

    // Drag & drop Ð´Ð»Ñ Ð¸Ð·Ð¼ÐµÐ½ÐµÐ½Ð¸Ñ Ð¿Ð¾Ñ€ÑÐ´ÐºÐ°
    const handleImageDragStart = (e: React.DragEvent, index: number) => {
        e.stopPropagation();
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", index.toString());
    };

    const handleImageDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.stopPropagation();
        if (draggedIndex !== null && draggedIndex !== index) {
            setDragOverIndex(index);
        }
    };

    const handleImageDragLeave = (e: React.DragEvent) => {
        e.stopPropagation();
        setDragOverIndex(null);
    };

    const handleImageDrop = async (e: React.DragEvent, toIndex: number) => {
        e.preventDefault();
        e.stopPropagation();

        if (draggedIndex !== null && draggedIndex !== toIndex) {
            // ÐšÐ¾Ñ€Ñ€ÐµÐºÑ‚Ð¸Ñ€ÑƒÐµÐ¼ pendingIndex Ð¿Ñ€Ð¸ Ð¿ÐµÑ€ÐµÐ¼ÐµÑ‰ÐµÐ½Ð¸Ð¸
            let newPendingIndex = pendingIndex;
            if (pendingIndex === draggedIndex) {
                newPendingIndex = toIndex;
            } else if (draggedIndex < pendingIndex && toIndex >= pendingIndex) {
                newPendingIndex--;
            } else if (draggedIndex > pendingIndex && toIndex <= pendingIndex) {
                newPendingIndex++;
            }

            await moveImage(draggedIndex, toIndex);
            setPendingIndex(newPendingIndex);
            await loadImages();
            showToast(`Moved: #${draggedIndex + 1} â†’ #${toIndex + 1}`, Toasts.Type.SUCCESS);
        }

        setDraggedIndex(null);
        setDragOverIndex(null);
    };

    const handleImageDragEnd = () => {
        setDraggedIndex(null);
        setDragOverIndex(null);
    };

    // Ð’Ñ‹Ñ‡Ð¸ÑÐ»ÑÐµÐ¼ ÑÐ»ÐµÐ´ÑƒÑŽÑ‰Ð¸Ð¹ Ð¸Ð½Ð´ÐµÐºÑ
    const getNextIndex = () => {
        if (images.length <= 1 || !slideshowOn) return -1;
        if (randomOn) return -1;
        return (pendingIndex + 1) % images.length;
    };

    const nextIndex = getNextIndex();

    return (
        <ModalRoot {...rootProps} size={ModalSize.LARGE}>
            {/* ÐŸÐ¾Ð»Ð½Ð¾ÑÐºÑ€Ð°Ð½Ð½Ñ‹Ð¹ Ð¿Ñ€Ð¾ÑÐ¼Ð¾Ñ‚Ñ€ Ð¸Ð·Ð¾Ð±Ñ€Ð°Ð¶ÐµÐ½Ð¸Ñ */}
            {previewImage && (
                <div
                    onClick={() => setPreviewImage(null)}
                    style={{
                        position: "fixed",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: "rgba(0, 0, 0, 0.95)",
                        zIndex: 10000,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "zoom-out",
                        padding: "40px"
                    }}
                >
                    <img
                        src={previewImage}
                        alt="Preview"
                        style={{
                            maxWidth: "100%",
                            maxHeight: "100%",
                            objectFit: "contain",
                            borderRadius: "8px",
                            boxShadow: "0 8px 32px rgba(0,0,0,0.5)"
                        }}
                    />
                    <div style={{
                        position: "absolute",
                        top: "20px",
                        right: "20px",
                        color: "white",
                        fontSize: "14px",
                        opacity: 0.7
                    }}>
                        Click to close
                    </div>
                    <div style={{
                        position: "absolute",
                        bottom: "20px",
                        left: "50%",
                        transform: "translateX(-50%)",
                        color: "white",
                        fontSize: "13px",
                        backgroundColor: "rgba(0,0,0,0.6)",
                        padding: "8px 16px",
                        borderRadius: "8px"
                    }}>
                        ðŸ“ 1280Ã—720 (16:9) â€” Stream preview size
                    </div>
                </div>
            )}

            <ModalHeader>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>
                    Stream Preview
                </Text>
                <ModalCloseButton onClick={handleCancel} />
            </ModalHeader>
            <ModalContent>
                <div
                    style={{ padding: "20px", position: "relative" }}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >

                    {/* ÐžÐ²ÐµÑ€Ð»ÐµÐ¹ Ð´Ð»Ñ drag & drop Ñ„Ð°Ð¹Ð»Ð¾Ð² - Ñ‚Ð¾Ð»ÑŒÐºÐ¾ Ð²ÐµÑ€Ñ… Ð´Ð¾ Ð³Ð°Ð»ÐµÑ€ÐµÐ¸ */}
                    {isDragging && draggedIndex === null && (
                        <div
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            style={{
                                position: "absolute",
                                top: "8px",
                                left: "8px",
                                right: "8px",
                                bottom: "400px",
                                backgroundColor: "rgba(88, 101, 242, 0.95)",
                                borderRadius: "12px",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                zIndex: 1000,
                                border: "3px dashed rgba(255,255,255,0.5)",
                                pointerEvents: "auto",
                                backdropFilter: "blur(8px)"
                            }}>
                            <div style={{ fontSize: "48px", marginBottom: "12px" }}>ðŸ“¥</div>
                            <Text variant="heading-lg/bold" style={{ color: "white", marginBottom: "4px" }}>
                                Drop to upload
                            </Text>
                            <Text variant="text-sm/normal" style={{ color: "rgba(255,255,255,0.7)" }}>
                                Supports PNG, JPEG, WebP
                            </Text>
                        </div>
                    )}

                    {/* Ð“Ð»Ð°Ð²Ð½Ñ‹Ð¹ Ð¿ÐµÑ€ÐµÐºÐ»ÑŽÑ‡Ð°Ñ‚ÐµÐ»ÑŒ */}
                    <div
                        onClick={togglePlugin}
                        style={{
                            padding: "14px 20px",
                            borderRadius: "10px",
                            marginBottom: "16px",
                            cursor: "pointer",
                            backgroundColor: pluginEnabled ? "rgba(59, 165, 92, 0.9)" : "rgba(237, 66, 69, 0.9)",
                            color: "white",
                            fontWeight: "600",
                            fontSize: "14px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "10px",
                            transition: "all 0.2s ease",
                            boxShadow: pluginEnabled
                                ? "0 4px 12px rgba(59, 165, 92, 0.3)"
                                : "0 4px 12px rgba(237, 66, 69, 0.3)"
                        }}
                    >
                        <span style={{ fontSize: "18px" }}>{pluginEnabled ? "âœ…" : "âŒ"}</span>
                        {pluginEnabled ? "REPLACEMENT ENABLED" : "REPLACEMENT DISABLED (default Discord)"}
                    </div>

                    {/* === ÐŸÐ ÐžÐ¤Ð˜Ð›Ð˜ / Ð’ÐšÐ›ÐÐ”ÐšÐ˜ === */}
                    <div style={{
                        marginBottom: "16px",
                        backgroundColor: "var(--background-secondary)",
                        borderRadius: "12px",
                        padding: "16px",
                        border: "1px solid var(--background-modifier-accent)"
                    }}>
                        {/* Ð—Ð°Ð³Ð¾Ð»Ð¾Ð²Ð¾Ðº Ñ ÐºÐ½Ð¾Ð¿ÐºÐ¾Ð¹ ÑÐ¾Ð·Ð´Ð°Ð½Ð¸Ñ */}
                        <div style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            marginBottom: "14px",
                            paddingBottom: "12px",
                            borderBottom: "1px solid var(--background-modifier-accent)"
                        }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                <span style={{ fontSize: "20px" }}>ðŸ“</span>
                                <Text variant="text-md/semibold" style={{ color: "#ffffff" }}>
                                    Profiles
                                </Text>
                                <span style={{
                                    fontSize: "12px",
                                    fontWeight: "600",
                                    color: "#ffffff",
                                    backgroundColor: "var(--brand-experiment)",
                                    padding: "3px 10px",
                                    borderRadius: "12px"
                                }}>
                                    {profileList.length}/{MAX_PROFILES}
                                </span>
                            </div>
                            {!isCreatingProfile && profileList.length < MAX_PROFILES && (
                                <button
                                    onClick={() => setIsCreatingProfile(true)}
                                    style={{
                                        background: "linear-gradient(135deg, #5865F2 0%, #7289da 100%)",
                                        color: "white",
                                        border: "none",
                                        borderRadius: "8px",
                                        padding: "8px 14px",
                                        fontSize: "13px",
                                        fontWeight: "600",
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "6px",
                                        transition: "all 0.2s ease",
                                        boxShadow: "0 2px 8px rgba(88, 101, 242, 0.3)"
                                    }}
                                    onMouseEnter={e => {
                                        (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
                                        (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(88, 101, 242, 0.4)";
                                    }}
                                    onMouseLeave={e => {
                                        (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
                                        (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(88, 101, 242, 0.3)";
                                    }}
                                >
                                    <span style={{ fontSize: "14px" }}>+</span> New Profile
                                </button>
                            )}
                        </div>

                        {/* Ð¤Ð¾Ñ€Ð¼Ð° ÑÐ¾Ð·Ð´Ð°Ð½Ð¸Ñ Ð¿Ñ€Ð¾Ñ„Ð¸Ð»Ñ */}
                        {isCreatingProfile && (
                            <div style={{
                                display: "flex",
                                gap: "10px",
                                marginBottom: "14px",
                                padding: "14px",
                                backgroundColor: "var(--background-tertiary)",
                                borderRadius: "10px",
                                border: "1px solid rgba(88, 101, 242, 0.3)"
                            }}>
                                <input
                                    type="text"
                                    placeholder="Profile name..."
                                    value={newProfileName}
                                    onChange={e => setNewProfileName(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === "Enter") handleCreateProfile();
                                        if (e.key === "Escape") {
                                            setIsCreatingProfile(false);
                                            setNewProfileName("");
                                        }
                                    }}
                                    autoFocus
                                    style={{
                                        flex: 1,
                                        padding: "8px 12px",
                                        borderRadius: "6px",
                                        border: "1px solid var(--background-modifier-accent)",
                                        backgroundColor: "var(--background-secondary)",
                                        color: "#ffffff",
                                        fontSize: "14px",
                                        outline: "none"
                                    }}
                                />
                                <button
                                    onClick={handleCreateProfile}
                                    style={{
                                        backgroundColor: "rgba(59, 165, 92, 0.9)",
                                        color: "white",
                                        border: "none",
                                        borderRadius: "6px",
                                        padding: "8px 14px",
                                        fontSize: "13px",
                                        fontWeight: "600",
                                        cursor: "pointer"
                                    }}
                                >
                                    âœ“
                                </button>
                                <button
                                    onClick={() => {
                                        setIsCreatingProfile(false);
                                        setNewProfileName("");
                                    }}
                                    style={{
                                        backgroundColor: "rgba(237, 66, 69, 0.9)",
                                        color: "white",
                                        border: "none",
                                        borderRadius: "6px",
                                        padding: "8px 14px",
                                        fontSize: "13px",
                                        fontWeight: "600",
                                        cursor: "pointer"
                                    }}
                                >
                                    âœ•
                                </button>
                            </div>
                        )}

                        {/* Ð¡Ð¿Ð¸ÑÐ¾Ðº Ð²ÐºÐ»Ð°Ð´Ð¾Ðº Ð¿Ñ€Ð¾Ñ„Ð¸Ð»ÐµÐ¹ */}
                        <div style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "8px"
                        }}>
                            {profileList.map((profile: Profile) => {
                                const isActive = profile.id === currentProfileId;
                                const isEditing = editingProfileId === profile.id;
                                const canDelete = profile.id !== DEFAULT_PROFILE_ID && profile.images.length === 0;

                                return (
                                    <div
                                        key={profile.id}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "6px",
                                            padding: "8px 12px",
                                            borderRadius: "8px",
                                            backgroundColor: isActive 
                                                ? "#5865F2"
                                                : "var(--background-secondary-alt)",
                                            background: isActive 
                                                ? "linear-gradient(135deg, #5865F2 0%, #4752c4 100%)" 
                                                : "var(--background-secondary-alt)",
                                            color: "#ffffff",
                                            cursor: "pointer",
                                            transition: "all 0.2s ease",
                                            border: isActive 
                                                ? "2px solid #5865F2" 
                                                : "1px solid var(--background-modifier-accent)",
                                            boxShadow: isActive 
                                                ? "0 3px 10px rgba(88, 101, 242, 0.4)" 
                                                : "0 1px 4px rgba(0,0,0,0.1)",
                                            minWidth: "100px"
                                        }}
                                        onClick={() => !isEditing && handleProfileSwitch(profile.id)}
                                        onMouseEnter={e => {
                                            if (!isActive) {
                                                (e.currentTarget as HTMLElement).style.borderColor = "#5865F2";
                                                (e.currentTarget as HTMLElement).style.boxShadow = "0 3px 10px rgba(88, 101, 242, 0.25)";
                                                (e.currentTarget as HTMLElement).style.backgroundColor = "var(--background-tertiary)";
                                            }
                                        }}
                                        onMouseLeave={e => {
                                            if (!isActive) {
                                                (e.currentTarget as HTMLElement).style.borderColor = "var(--background-modifier-accent)";
                                                (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 4px rgba(0,0,0,0.1)";
                                                (e.currentTarget as HTMLElement).style.backgroundColor = "var(--background-secondary-alt)";
                                            }
                                        }}
                                    >
                                        {isEditing ? (
                                            <input
                                                type="text"
                                                value={editingProfileName}
                                                onChange={e => setEditingProfileName(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === "Enter") handleRenameProfile(profile.id);
                                                    if (e.key === "Escape") setEditingProfileId(null);
                                                }}
                                                onBlur={() => handleRenameProfile(profile.id)}
                                                autoFocus
                                                onClick={e => e.stopPropagation()}
                                                style={{
                                                    width: "80px",
                                                    padding: "4px 8px",
                                                    borderRadius: "4px",
                                                    border: "2px solid #5865F2",
                                                    backgroundColor: "var(--background-secondary)",
                                                    color: "#ffffff",
                                                    fontSize: "12px",
                                                    fontWeight: "600",
                                                    outline: "none"
                                                }}
                                            />
                                        ) : (
                                            <>
                                                {/* Ð˜ÐºÐ¾Ð½ÐºÐ° Ð³Ð°Ð»Ð¾Ñ‡ÐºÐ¸ Ð´Ð»Ñ Ð°ÐºÑ‚Ð¸Ð²Ð½Ð¾Ð³Ð¾ */}
                                                {isActive && (
                                                    <span style={{ 
                                                        fontSize: "12px",
                                                        fontWeight: "bold"
                                                    }}>âœ“</span>
                                                )}
                                                {/* Ð˜ÐºÐ¾Ð½ÐºÐ° Ð¿Ð°Ð¿ÐºÐ¸ Ð´Ð»Ñ Ð½ÐµÐ°ÐºÑ‚Ð¸Ð²Ð½Ñ‹Ñ… */}
                                                {!isActive && (
                                                    <span style={{ fontSize: "12px" }}>ðŸ“</span>
                                                )}
                                                <span style={{ 
                                                    fontWeight: "600", 
                                                    fontSize: "12px",
                                                    letterSpacing: "0.2px",
                                                    color: "#ffffff"
                                                }}>
                                                    {profile.name}
                                                </span>
                                                <span style={{
                                                    fontSize: "10px",
                                                    fontWeight: "700",
                                                    backgroundColor: isActive 
                                                        ? "rgba(255,255,255,0.25)" 
                                                        : "var(--brand-experiment)",
                                                    color: "#ffffff",
                                                    padding: "2px 6px",
                                                    borderRadius: "6px",
                                                    minWidth: "20px",
                                                    textAlign: "center"
                                                }}>
                                                    {profile.images.length}
                                                </span>
                                            </>
                                        )}

                                        {/* ÐšÐ½Ð¾Ð¿ÐºÐ¸ Ð´ÐµÐ¹ÑÑ‚Ð²Ð¸Ð¹ Ð´Ð»Ñ Ð²ÐºÐ»Ð°Ð´ÐºÐ¸ */}
                                        {isActive && !isEditing && (
                                            <div style={{ 
                                                display: "flex", 
                                                gap: "6px", 
                                                marginLeft: "6px",
                                                paddingLeft: "8px",
                                                borderLeft: "1px solid rgba(255,255,255,0.3)"
                                            }}>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setEditingProfileId(profile.id);
                                                        setEditingProfileName(profile.name);
                                                    }}
                                                    style={{
                                                        backgroundColor: "rgba(255,255,255,0.2)",
                                                        color: "white",
                                                        border: "none",
                                                        borderRadius: "6px",
                                                        width: "28px",
                                                        height: "28px",
                                                        cursor: "pointer",
                                                        fontSize: "13px",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                        transition: "all 0.15s ease"
                                                    }}
                                                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.3)"}
                                                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.15)"}
                                                    title="Rename"
                                                >
                                                    âœï¸
                                                </button>
                                                {canDelete && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleDeleteProfile(profile.id);
                                                        }}
                                                        style={{
                                                            backgroundColor: "rgba(237, 66, 69, 0.9)",
                                                            color: "white",
                                                            border: "none",
                                                            borderRadius: "6px",
                                                            width: "28px",
                                                            height: "28px",
                                                            cursor: "pointer",
                                                            fontSize: "13px",
                                                            display: "flex",
                                                            alignItems: "center",
                                                            justifyContent: "center",
                                                            transition: "all 0.15s ease"
                                                        }}
                                                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(237, 66, 69, 1)"}
                                                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(237, 66, 69, 0.9)"}
                                                        title="Delete profile (only if empty)"
                                                    >
                                                        ðŸ—‘ï¸
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* ÐŸÐ¾Ð´ÑÐºÐ°Ð·ÐºÐ° */}
                        <div style={{
                            marginTop: "14px",
                            paddingTop: "12px",
                            borderTop: "1px solid var(--background-modifier-accent)",
                            fontSize: "12px",
                            color: "var(--text-muted)",
                            display: "flex",
                            alignItems: "center",
                            gap: "8px"
                        }}>
                            <span style={{ fontSize: "14px" }}>ðŸ’¡</span>
                            <span>Click profile to select â€¢ Empty profiles can be deleted</span>
                        </div>
                    </div>

                    {/* Ð ÐµÐ¶Ð¸Ð¼Ñ‹ ÑÐ»Ð°Ð¹Ð´-ÑˆÐ¾Ñƒ */}
                    <div style={{
                        display: "flex",
                        gap: "10px",
                        marginBottom: "16px"
                    }}>
                        <div
                            onClick={toggleSlideshow}
                            style={{
                                flex: 1,
                                padding: "12px 16px",
                                borderRadius: "8px",
                                cursor: "pointer",
                                backgroundColor: slideshowOn ? "rgba(88, 101, 242, 0.9)" : "rgba(79, 84, 92, 0.9)",
                                color: "white",
                                fontWeight: "600",
                                fontSize: "13px",
                                textAlign: "center",
                                transition: "all 0.2s ease",
                                boxShadow: slideshowOn ? "0 4px 12px rgba(88, 101, 242, 0.3)" : "none"
                            }}
                        >
                            ðŸŽžï¸ Slideshow: {slideshowOn ? "ON" : "OFF"}
                        </div>
                        <div
                            onClick={slideshowOn ? toggleRandom : undefined}
                            style={{
                                flex: 1,
                                padding: "12px 16px",
                                borderRadius: "8px",
                                cursor: slideshowOn ? "pointer" : "not-allowed",
                                backgroundColor: slideshowOn && randomOn ? "rgba(88, 101, 242, 0.9)" : "rgba(79, 84, 92, 0.9)",
                                color: "white",
                                fontWeight: "600",
                                fontSize: "13px",
                                textAlign: "center",
                                opacity: slideshowOn ? 1 : 0.5,
                                transition: "all 0.2s ease",
                                boxShadow: slideshowOn && randomOn ? "0 4px 12px rgba(88, 101, 242, 0.3)" : "none"
                            }}
                        >
                            ðŸŽ² Random: {randomOn ? "YES" : "NO"}
                        </div>
                    </div>

                    {/* Ð˜Ð½Ñ„Ð¾ */}
                    {settings.store.showInfoBadges && (
                        <div style={{
                            padding: "14px 18px",
                            backgroundColor: "var(--background-secondary)",
                            borderRadius: "10px",
                            marginBottom: "16px",
                            display: "flex",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: "12px",
                            border: "1px solid var(--background-modifier-accent)"
                        }}>
                            {/* Profile name */}
                            <div style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                padding: "8px 14px",
                                backgroundColor: "rgba(88, 101, 242, 0.15)",
                                borderRadius: "8px",
                                border: "1px solid rgba(88, 101, 242, 0.3)",
                                boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                            }}>
                                <span style={{ fontSize: "18px" }}>ðŸ“</span>
                                <div style={{ display: "flex", flexDirection: "column", lineHeight: "1.2" }}>
                                    <span style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Profile</span>
                                    <span style={{ fontSize: "14px", fontWeight: "700", color: "#5865F2" }}>
                                        {profiles.get(currentProfileId)?.name || "Default"}
                                    </span>
                                </div>
                            </div>

                            {/* Images count */}
                            <div style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                padding: "8px 14px",
                                backgroundColor: "var(--background-tertiary)",
                                borderRadius: "8px",
                                boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                            }}>
                                <span style={{ fontSize: "18px" }}>ðŸ“Š</span>
                                <div style={{ display: "flex", flexDirection: "column", lineHeight: "1.2" }}>
                                    <span style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Images</span>
                                    <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                                        <span style={{ fontSize: "20px", fontWeight: "800", color: "#5865F2" }}>{images.length}</span>
                                        <span style={{ fontSize: "14px", fontWeight: "500", color: "var(--text-muted)" }}>/{MAX_IMAGES_PER_PROFILE}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Selected */}
                            {images.length > 0 && (
                                <div style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    padding: "8px 14px",
                                    backgroundColor: "rgba(88, 101, 242, 0.15)",
                                    borderRadius: "8px",
                                    border: "1px solid rgba(88, 101, 242, 0.3)",
                                    boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                                }}>
                                    <span style={{ fontSize: "18px" }}>ðŸ“</span>
                                    <div style={{ display: "flex", flexDirection: "column", lineHeight: "1.2" }}>
                                        <span style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Selected</span>
                                        <span style={{ fontSize: "16px", fontWeight: "700", color: "#5865F2" }}>#{pendingIndex + 1}</span>
                                    </div>
                                </div>
                            )}

                            {/* Stream status */}
                            {images.length > 1 && slideshowOn && pluginEnabled && (
                                <div style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    padding: "8px 14px",
                                    backgroundColor: streamActive ? "rgba(59, 165, 92, 0.15)" : "var(--background-tertiary)",
                                    borderRadius: "8px",
                                    border: streamActive ? "1px solid rgba(59, 165, 92, 0.3)" : "none",
                                    boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                                }}>
                                    <span style={{ fontSize: "18px" }}>{streamActive ? "ðŸŸ¢" : "âš«"}</span>
                                    <div style={{ display: "flex", flexDirection: "column", lineHeight: "1.2" }}>
                                        <span style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Slideshow</span>
                                        <span style={{ fontSize: "14px", fontWeight: "600", color: streamActive ? "#3ba55c" : "var(--text-muted)" }}>
                                            ~5 min
                                        </span>
                                    </div>
                                </div>
                            )}

                            {/* Timer */}
                            {images.length > 0 && pluginEnabled && streamActive && lastSlideChangeTime > 0 && (
                                <div style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    padding: "8px 14px",
                                    backgroundColor: "rgba(88, 101, 242, 0.15)",
                                    borderRadius: "8px",
                                    border: "1px solid rgba(88, 101, 242, 0.3)",
                                    boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                                }}>
                                    <span style={{ fontSize: "18px" }}>â±ï¸</span>
                                    <div style={{ display: "flex", flexDirection: "column", lineHeight: "1.2" }}>
                                        <span style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Timer</span>
                                        <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                                            <span style={{ fontSize: "14px", fontWeight: "700", color: "#5865F2" }}>
                                                {formatTime(timerSeconds)}
                                            </span>
                                            <span style={{ fontSize: "12px", fontWeight: "500", color: "var(--text-muted)" }}>
                                                / ~5 min
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ÐšÐ½Ð¾Ð¿ÐºÐ¸ */}
                    <div style={{ display: "flex", gap: "10px", marginBottom: "16px", flexWrap: "wrap" }}>
                        <Button
                            onClick={() => handleFileSelect(false)}
                            disabled={isLoading || images.length >= MAX_IMAGES_PER_PROFILE}
                            style={{ padding: "10px 16px" }}
                        >
                            {isLoading ? "â³..." : "ðŸ“ Add Image"}
                        </Button>
                        <Button
                            onClick={() => handleFileSelect(true)}
                            disabled={isLoading || images.length >= MAX_IMAGES_PER_PROFILE}
                            style={{ padding: "10px 16px" }}
                        >
                            ðŸ“+ Multiple
                        </Button>
                        <Button
                            color={Button.Colors.RED}
                            onClick={handleClearAll}
                            disabled={images.length === 0}
                            style={{ padding: "10px 16px" }}
                        >
                            ðŸ—‘ï¸ Delete All
                        </Button>
                    </div>

                    {error && (
                        <div style={{
                            padding: "8px 12px",
                            backgroundColor: "var(--status-danger-background)",
                            borderRadius: "4px",
                            marginBottom: "16px",
                            color: "var(--status-danger)"
                        }}>
                            âŒ {error}
                        </div>
                    )}

                    {images.length > 0 ? (
                        <div style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                            gap: "16px",
                            maxHeight: "400px",
                            overflowY: "auto",
                            padding: "8px",
                            backgroundColor: "var(--background-tertiary)",
                            borderRadius: "8px"
                        }}>
                            {images.map((src: string, index: number) => {
                                const isCurrent = index === pendingIndex;
                                const isNext = index === nextIndex;
                                const isBeingDragged = index === draggedIndex;
                                const isDragTarget = index === dragOverIndex;

                                return (
                                    <div
                                        key={index}
                                        draggable
                                        onClick={() => handleSelectCurrent(index)}
                                        onDragStart={(e) => handleImageDragStart(e, index)}
                                        onDragOver={(e) => handleImageDragOver(e, index)}
                                        onDragLeave={handleImageDragLeave}
                                        onDrop={(e) => handleImageDrop(e, index)}
                                        onDragEnd={handleImageDragEnd}
                                        style={{
                                            position: "relative",
                                            borderRadius: "8px",
                                            overflow: "hidden",
                                            border: isDragTarget
                                                ? "3px solid #faa61a"
                                                : isCurrent
                                                    ? "3px solid #3ba55c"
                                                    : isNext
                                                        ? "3px solid #5865F2"
                                                        : "3px solid transparent",
                                            backgroundColor: "var(--background-secondary)",
                                            boxShadow: isDragTarget
                                                ? "0 4px 20px rgba(250, 166, 26, 0.4)"
                                                : isCurrent
                                                    ? "0 4px 20px rgba(59, 165, 92, 0.4)"
                                                    : isNext
                                                        ? "0 4px 16px rgba(88, 101, 242, 0.3)"
                                                        : "0 2px 8px rgba(0,0,0,0.2)",
                                            cursor: "grab",
                                            opacity: isBeingDragged ? 0.5 : 1,
                                            transition: "all 0.15s ease"
                                        }}
                                        onMouseEnter={e => {
                                            if (!isCurrent && !isBeingDragged) {
                                                (e.currentTarget as HTMLElement).style.transform = "translateY(-4px)";
                                                (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 24px rgba(0,0,0,0.3)";
                                            }
                                        }}
                                        onMouseLeave={e => {
                                            (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
                                            if (!isCurrent && !isNext && !isDragTarget) {
                                                (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.2)";
                                            }
                                        }}
                                    >
                                        {/* ÐšÐ¾Ð½Ñ‚ÐµÐ¹Ð½ÐµÑ€ Ñ ÑÐ¾Ð¾Ñ‚Ð½Ð¾ÑˆÐµÐ½Ð¸ÐµÐ¼ 16:9 */}
                                        <div style={{
                                            position: "relative",
                                            width: "100%",
                                            paddingTop: "56.25%", // 16:9 aspect ratio
                                            backgroundColor: "#000"
                                        }}>
                                            <img
                                                src={src}
                                                alt={`Slide ${index + 1}`}
                                                style={{
                                                    position: "absolute",
                                                    top: 0,
                                                    left: 0,
                                                    width: "100%",
                                                    height: "100%",
                                                    objectFit: "contain",
                                                    display: "block"
                                                }}
                                            />
                                        </div>

                                        {/* Ð¡Ñ‚Ð°Ñ‚ÑƒÑ Ð±ÐµÐ¹Ð´Ð¶ */}
                                        <div style={{
                                            position: "absolute",
                                            top: "8px",
                                            left: "8px",
                                            backgroundColor: isCurrent
                                                ? "#3ba55c"
                                                : isNext
                                                    ? "#5865F2"
                                                    : "rgba(0,0,0,0.75)",
                                            color: "white",
                                            padding: "4px 8px",
                                            borderRadius: "6px",
                                            fontSize: "12px",
                                            fontWeight: "600",
                                            backdropFilter: "blur(4px)",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "4px"
                                        }}>
                                            {isCurrent && "â–¶"}
                                            {isNext && "â†’"}
                                            #{index + 1}
                                        </div>

                                        {/* ÐšÐ½Ð¾Ð¿ÐºÐ¸ Ð´ÐµÐ¹ÑÑ‚Ð²Ð¸Ð¹ */}
                                        <div style={{
                                            position: "absolute",
                                            top: "8px",
                                            right: "8px",
                                            display: "flex",
                                            gap: "6px"
                                        }}>
                                            {/* ÐŸÐ¾Ð»Ð½Ð¾ÑÐºÑ€Ð°Ð½Ð½Ñ‹Ð¹ Ð¿Ñ€Ð¾ÑÐ¼Ð¾Ñ‚Ñ€ */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setPreviewImage(src);
                                                }}
                                                style={{
                                                    backgroundColor: "rgba(0,0,0,0.75)",
                                                    color: "white",
                                                    border: "none",
                                                    borderRadius: "6px",
                                                    width: "28px",
                                                    height: "28px",
                                                    cursor: "pointer",
                                                    fontSize: "14px",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    backdropFilter: "blur(4px)",
                                                    transition: "background-color 0.15s"
                                                }}
                                                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(88, 101, 242, 0.9)"}
                                                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(0,0,0,0.75)"}
                                                title="ÐŸÑ€Ð¾ÑÐ¼Ð¾Ñ‚Ñ€"
                                            >
                                                ðŸ”
                                            </button>
                                            {/* Ð¡ÐºÐ°Ñ‡Ð°Ñ‚ÑŒ */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const a = document.createElement("a");
                                                    a.href = src;
                                                    a.download = `stream-preview-${index + 1}.jpg`;
                                                    a.click();
                                                }}
                                                style={{
                                                    backgroundColor: "rgba(0,0,0,0.75)",
                                                    color: "white",
                                                    border: "none",
                                                    borderRadius: "6px",
                                                    width: "28px",
                                                    height: "28px",
                                                    cursor: "pointer",
                                                    fontSize: "14px",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    backdropFilter: "blur(4px)",
                                                    transition: "background-color 0.15s"
                                                }}
                                                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(88, 101, 242, 0.9)"}
                                                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(0,0,0,0.75)"}
                                                title="Download"
                                            >
                                                â¬‡
                                            </button>
                                            {/* Ð£Ð´Ð°Ð»Ð¸Ñ‚ÑŒ */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDelete(index);
                                                }}
                                                style={{
                                                    backgroundColor: "rgba(0,0,0,0.75)",
                                                    color: "white",
                                                    border: "none",
                                                    borderRadius: "6px",
                                                    width: "28px",
                                                    height: "28px",
                                                    cursor: "pointer",
                                                    fontSize: "14px",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    backdropFilter: "blur(4px)",
                                                    transition: "background-color 0.15s"
                                                }}
                                                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(237, 66, 69, 0.9)"}
                                                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(0,0,0,0.75)"}
                                                title="Delete"
                                            >
                                                âœ•
                                            </button>
                                        </div>

                                        {/* Ð˜Ð½Ð´Ð¸ÐºÐ°Ñ‚Ð¾Ñ€ Ð²Ñ‹Ð±Ð¾Ñ€Ð° Ð²Ð½Ð¸Ð·Ñƒ */}
                                        {isCurrent && (
                                            <div style={{
                                                position: "absolute",
                                                bottom: 0,
                                                left: 0,
                                                right: 0,
                                                height: "4px",
                                                backgroundColor: "#3ba55c",
                                                borderRadius: "0 0 5px 5px"
                                            }} />
                                        )}

                                        {/* Ð Ð°Ð·Ð¼ÐµÑ€ Ñ„Ð°Ð¹Ð»Ð° Ð² Ð¿Ñ€Ð°Ð²Ð¾Ð¼ Ð½Ð¸Ð¶Ð½ÐµÐ¼ ÑƒÐ³Ð»Ñƒ */}
                                        {imageSizes[index] && (
                                            <div style={{
                                                position: "absolute",
                                                bottom: "6px",
                                                right: "8px",
                                                backgroundColor: "rgba(0,0,0,0.8)",
                                                color: "white",
                                                padding: "4px 8px",
                                                borderRadius: "4px",
                                                fontSize: "11px",
                                                fontWeight: "500",
                                                backdropFilter: "blur(4px)",
                                                whiteSpace: "nowrap"
                                            }}>
                                                ðŸ“¦ {formatFileSize(imageSizes[index])}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div style={{
                            padding: "40px",
                            textAlign: "center",
                            backgroundColor: "var(--background-secondary)",
                            borderRadius: "12px",
                            border: "2px dashed var(--background-modifier-accent)"
                        }}>
                            <div style={{ fontSize: "48px", marginBottom: "12px" }}>ðŸ“·</div>
                            <Text variant="text-lg/semibold" style={{ color: "var(--text-normal)", marginBottom: "8px" }}>
                                No images
                            </Text>
                            <Text variant="text-sm/normal" style={{ color: "var(--text-muted)" }}>
                                Drag images here or click "Add Image"
                            </Text>
                        </div>
                    )}

                    {/* ÐŸÐ¾Ð´ÑÐºÐ°Ð·ÐºÐ° Ð¿Ñ€Ð¾ Ñ…Ñ€Ð°Ð½ÐµÐ½Ð¸Ðµ */}
                    <div style={{
                        marginTop: "16px",
                        padding: "10px 14px",
                        backgroundColor: "var(--background-secondary)",
                        borderRadius: "6px",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px"
                    }}>
                        <span style={{ fontSize: "16px" }}>ðŸ’¾</span>
                        <Text variant="text-xs/normal" style={{ color: "var(--text-muted)" }}>
                            Images stored locally â€¢ Limit: {MAX_IMAGES_PER_PROFILE} images per profile
                        </Text>
                    </div>
                </div>
            </ModalContent>
            <ModalFooter>
                <div style={{ display: "flex", gap: "12px", width: "100%", justifyContent: "space-between", alignItems: "center" }}>
                    <Text variant="text-xs/normal" style={{ color: "var(--text-muted)" }}>
                        ðŸ“ {profiles.get(currentProfileId)?.name || "Default"}: {images.length} / {MAX_IMAGES_PER_PROFILE} images
                    </Text>
                    <div style={{ display: "flex", gap: "10px" }}>
                        <Button
                            onClick={handleCancel}
                            style={{
                                padding: "10px 20px"
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            color={Button.Colors.GREEN}
                            onClick={handleSave}
                            style={{
                                padding: "10px 24px"
                            }}
                        >
                            âœ“ Save
                        </Button>
                    </div>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

function openImagePicker() {
    openModal((props: any) => <ImagePickerModal rootProps={props} />);
}

// Ð˜ÐºÐ¾Ð½ÐºÐ° Ð´Ð»Ñ ÐºÐ½Ð¾Ð¿ÐºÐ¸ Ð¿Ð°Ð½ÐµÐ»Ð¸ Ñ Ð±ÐµÐ¹Ð´Ð¶ÐµÐ¼ ÐºÐ¾Ð»Ð¸Ñ‡ÐµÑÑ‚Ð²Ð°
function StreamPreviewIcon({ imageCount, isEnabled, isSlideshowEnabled, isRandom, currentImageUri, streamActive }: {
    imageCount: number;
    isEnabled: boolean;
    isSlideshowEnabled: boolean;
    isRandom: boolean;
    currentImageUri: string | null;
    streamActive: boolean;
}) {
    return (
        <div style={{ position: "relative" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                {/* Ð Ð°Ð¼ÐºÐ° Ð¼Ð¾Ð½Ð¸Ñ‚Ð¾Ñ€Ð° - Ð²ÑÐµÐ³Ð´Ð° currentColor */}
                <path
                    fill="currentColor"
                    d="M21 3H3C1.9 3 1 3.9 1 5V17C1 18.1 1.9 19 3 19H8V21H16V19H21C22.1 19 23 18.1 23 17V5C23 3.9 22.1 3 21 3ZM21 17H3V5H21V17Z"
                />
                {/* Ð’Ð½ÑƒÑ‚Ñ€ÐµÐ½Ð½ÑÑ Ñ‡Ð°ÑÑ‚ÑŒ - Ð·ÐµÐ»Ñ‘Ð½Ñ‹Ðµ Ð³Ð¾Ñ€Ñ‹ ÐµÑÐ»Ð¸ Ð¿Ð»Ð°Ð³Ð¸Ð½ Ð°ÐºÑ‚Ð¸Ð²ÐµÐ½, ÑÐµÑ€Ñ‹Ðµ ÐµÑÐ»Ð¸ Ð²Ñ‹ÐºÐ»ÑŽÑ‡ÐµÐ½ */}
                <path
                    fill={isEnabled ? "var(--status-positive)" : "currentColor"}
                    d="M12 7C10.34 7 9 8.34 9 10C9 11.66 10.34 13 12 13C13.66 13 15 11.66 15 10C15 8.34 13.66 7 12 7Z"
                />
                <path
                    fill={isEnabled ? "var(--status-positive)" : "currentColor"}
                    d="M18 14L15 11L12 14L9 11L6 14V15H18V14Z"
                />
            </svg>

            {/* Ð‘ÐµÐ¹Ð´Ð¶ Ñ ÐºÐ¾Ð»Ð¸Ñ‡ÐµÑÑ‚Ð²Ð¾Ð¼ - Ð¿Ð¾ÐºÐ°Ð·Ñ‹Ð²Ð°ÐµÐ¼ ÐµÑÐ»Ð¸ Ð±Ð¾Ð»ÑŒÑˆÐµ 1 Ð¸ Ð²ÐºÐ»ÑŽÑ‡Ñ‘Ð½ ÑÐ»Ð°Ð¹Ð´ÑˆÐ¾Ñƒ */}
            {imageCount > 1 && isSlideshowEnabled && isEnabled && (
                <div style={{
                    position: "absolute",
                    top: "-4px",
                    right: "-6px",
                    backgroundColor: "var(--status-positive)",
                    color: "white",
                    fontSize: "9px",
                    fontWeight: "bold",
                    borderRadius: "6px",
                    minWidth: "12px",
                    height: "12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 3px"
                }}>
                    {imageCount}
                </div>
            )}

            {/* Ð—Ð½Ð°Ðº ÑÐ»ÑƒÑ‡Ð°Ð¹Ð½Ð¾ÑÑ‚Ð¸ ðŸŽ² - Ð¿Ð¾ÐºÐ°Ð·Ñ‹Ð²Ð°ÐµÐ¼ ÐµÑÐ»Ð¸ ÑÐ»ÑƒÑ‡Ð°Ð¹Ð½Ñ‹Ð¹ Ñ€ÐµÐ¶Ð¸Ð¼ */}
            {imageCount > 1 && isSlideshowEnabled && isRandom && isEnabled && (
                <div style={{
                    position: "absolute",
                    bottom: "-4px",
                    right: "-6px",
                    fontSize: "10px",
                    lineHeight: "1"
                }}>
                    ðŸŽ²
                </div>
            )}
        </div>
    );
}

// Ð¤Ð¾Ñ€Ð¼Ð°Ñ‚Ð¸Ñ€Ð¾Ð²Ð°Ð½Ð¸Ðµ Ð²Ñ€ÐµÐ¼ÐµÐ½Ð¸ Ð² ÑƒÐ´Ð¾Ð±Ð½Ñ‹Ð¹ Ð²Ð¸Ð´
function formatTime(seconds: number): string {
    if (seconds < 60) return `${seconds} sec`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (secs === 0) return `${mins} min`;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// Ð¤Ð¾Ñ€Ð¼Ð°Ñ‚Ð¸Ñ€Ð¾Ð²Ð°Ð½Ð¸Ðµ Ñ€Ð°Ð·Ð¼ÐµÑ€Ð° Ñ„Ð°Ð¹Ð»Ð°
function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ÐšÐ½Ð¾Ð¿ÐºÐ° Ð² Ð¿Ð°Ð½ÐµÐ»Ð¸ Ð°ÐºÐºÐ°ÑƒÐ½Ñ‚Ð° 
function StreamPreviewPanelButton(props: { nameplate?: any; }) {
    const [imageCount, setImageCount] = useState(0);
    const [isEnabled, setIsEnabled] = useState(settings.store.replaceEnabled);
    const [isSlideshowEnabled, setIsSlideshowEnabled] = useState(settings.store.slideshowEnabled);
    const [isRandom, setIsRandom] = useState(settings.store.slideshowRandom);
    const [currentIndex, setCurrentIndex] = useState(currentSlideIndex);
    const [secondsAgo, setSecondsAgo] = useState(0);
    const [streamActive, setStreamActive] = useState(isStreamActive);
    const [currentImageUri, setCurrentImageUri] = useState<string | null>(null);

    useEffect(() => {
        const updateState = () => {
            setImageCount(getImageCount());
            setIsEnabled(settings.store.replaceEnabled);
            setIsSlideshowEnabled(settings.store.slideshowEnabled);
            setIsRandom(settings.store.slideshowRandom);
            setCurrentIndex(currentSlideIndex);
            setStreamActive(isStreamActive);
            // ÐžÐ±Ð½Ð¾Ð²Ð»ÑÐµÐ¼ Ð¿Ñ€ÐµÐ²ÑŒÑŽ Ð Ð•ÐÐ›Ð¬ÐÐžÐ™ ÐºÐ°Ñ€Ñ‚Ð¸Ð½ÐºÐ¸ Ð½Ð° ÑÑ‚Ñ€Ð¸Ð¼Ðµ 
            setCurrentImageUri(actualStreamImageUri);
        };

        updateState();
        imageChangeListeners.add(updateState);

        // Ð¢Ð°Ð¹Ð¼ÐµÑ€ Ð´Ð»Ñ Ð¾Ð±Ð½Ð¾Ð²Ð»ÐµÐ½Ð¸Ñ Ð²Ñ€ÐµÐ¼ÐµÐ½Ð¸ ÐºÐ°Ð¶Ð´ÑƒÑŽ ÑÐµÐºÑƒÐ½Ð´Ñƒ
        const timerInterval = setInterval(() => {
            // ÐÐ²Ñ‚Ð¾ÑÐ±Ñ€Ð¾Ñ: ÐµÑÐ»Ð¸ Ð¿Ñ€Ð¾ÑˆÐ»Ð¾ Ð±Ð¾Ð»ÐµÐµ 7 Ð¼Ð¸Ð½ÑƒÑ‚ Ð±ÐµÐ· Ð²Ñ‹Ð·Ð¾Ð²Ð° getCustomThumbnail - ÑÑ‚Ñ€Ð¸Ð¼ Ð¾ÑÑ‚Ð°Ð½Ð¾Ð²Ð»ÐµÐ½
            if (isStreamActive && lastSlideChangeTime > 0 && (Date.now() - lastSlideChangeTime) > 420000) {
                isStreamActive = false;
            }
            setStreamActive(isStreamActive);
            if (lastSlideChangeTime > 0 && isStreamActive) {
                setSecondsAgo(Math.floor((Date.now() - lastSlideChangeTime) / 1000));
            }
        }, 1000);

        return () => {
            imageChangeListeners.delete(updateState);
            clearInterval(timerInterval);
        };
    }, []);

    const getTooltip = () => {
        if (imageCount === 0) return "Select stream preview";
        if (!isEnabled) return `Stream preview (disabled, ${imageCount} images)`;

        // Ð˜Ð½Ñ‚ÐµÑ€Ð²Ð°Ð» ~5 Ð¼Ð¸Ð½ÑƒÑ‚ (Discord ÐºÐ¾Ð½Ñ‚Ñ€Ð¾Ð»Ð¸Ñ€ÑƒÐµÑ‚)
        const intervalSeconds = 5 * 60;

        // Ð¢Ð°Ð¹Ð¼ÐµÑ€ Ð´Ð»Ñ Ð»ÑŽÐ±Ð¾Ð³Ð¾ ÐºÐ¾Ð»Ð¸Ñ‡ÐµÑÑ‚Ð²Ð° Ñ„Ð¾Ñ‚Ð¾ (Ð²ÐºÐ»ÑŽÑ‡Ð°Ñ 1)
        const timeInfo = lastSlideChangeTime > 0 && streamActive
            ? `\nâ±ï¸ ${formatTime(secondsAgo)} ago (~${formatTime(Math.max(0, intervalSeconds - secondsAgo))} until update)`
            : streamActive ? "" : "\nâš« Stream not active";

        if (imageCount === 1) return `Stream preview (1 image)${timeInfo}`;

        if (isSlideshowEnabled) {
            const slideInfo = `\nðŸ“ Current: #${currentIndex + 1}`;
            if (isRandom) {
                return `Stream preview (${imageCount} images, random)${slideInfo}${timeInfo}`;
            }
            return `Stream preview (${imageCount} images, slideshow)${slideInfo}${timeInfo}`;
        }
        return `Stream preview (${imageCount} images)${timeInfo}`;
    };

    // ÐšÐ°ÑÑ‚Ð¾Ð¼Ð½Ñ‹Ð¹ Ñ‚ÑƒÐ»Ñ‚Ð¸Ð¿ Ñ Ð¿Ñ€ÐµÐ²ÑŒÑŽ ÐºÐ°Ñ€Ñ‚Ð¸Ð½ÐºÐ¸
    const renderTooltip = () => {
        const tooltipText = getTooltip();

        // ÐŸÐ¾ÐºÐ°Ð·Ñ‹Ð²Ð°ÐµÐ¼ Ð¿Ñ€ÐµÐ²ÑŒÑŽ Ñ‚Ð¾Ð»ÑŒÐºÐ¾ ÐµÑÐ»Ð¸: ÐµÑÑ‚ÑŒ ÐºÐ°Ñ€Ñ‚Ð¸Ð½ÐºÐ°, Ð¿Ð»Ð°Ð³Ð¸Ð½ Ð²ÐºÐ»ÑŽÑ‡ÐµÐ½, ÐµÑÑ‚ÑŒ Ñ„Ð¾Ñ‚Ð¾ Ð˜ ÑÑ‚Ñ€Ð¸Ð¼ Ð°ÐºÑ‚Ð¸Ð²ÐµÐ½
        if (currentImageUri && isEnabled && imageCount > 0 && streamActive) {
            return (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "center" }}>
                    <div style={{
                        width: "160px",
                        height: "90px",
                        borderRadius: "4px",
                        overflow: "hidden",
                        border: "2px solid var(--status-positive)",
                        boxShadow: "0 0 8px rgba(59, 165, 92, 0.5)"
                    }}>
                        <img
                            src={currentImageUri}
                            alt="Preview"
                            style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                                display: "block"
                            }}
                        />
                    </div>
                    <div style={{
                        whiteSpace: "pre-line",
                        textAlign: "center",
                        fontSize: "12px",
                        lineHeight: "1.4"
                    }}>
                        {tooltipText}
                    </div>
                </div>
            );
        }

        return tooltipText;
    };

    return (
        <PanelButton
            tooltipText={renderTooltip()}
            icon={() => <StreamPreviewIcon
                imageCount={imageCount}
                isEnabled={isEnabled}
                isSlideshowEnabled={isSlideshowEnabled}
                isRandom={isRandom}
                currentImageUri={currentImageUri}
                streamActive={streamActive}
            />}
            onClick={openImagePicker}
            plated={props?.nameplate != null}
        />
    );
}

// ÐŸÐ°Ñ‚Ñ‡ ÐºÐ¾Ð½Ñ‚ÐµÐºÑÑ‚Ð½Ð¾Ð³Ð¾ Ð¼ÐµÐ½ÑŽ ÑÑ‚Ñ€Ð¸Ð¼Ð°
interface StreamContextProps {
    stream: {
        ownerId: string;
        guildId: string | null;
        channelId: string;
    };
}

const streamContextMenuPatch: NavContextMenuPatchCallback = (children: any[], { stream }: StreamContextProps) => {
    // ÐŸÑ€Ð¾Ð²ÐµÑ€ÑÐµÐ¼, Ñ‡Ñ‚Ð¾ ÑÑ‚Ð¾ Ð½Ð°Ñˆ ÑÑ‚Ñ€Ð¸Ð¼
    const currentUser = UserStore.getCurrentUser();
    if (!currentUser || stream.ownerId !== currentUser.id) return;

    // ÐÐ°Ñ…Ð¾Ð´Ð¸Ð¼ Ð³Ñ€ÑƒÐ¿Ð¿Ñƒ Ñ "ÐŸÐ¾Ð»Ð½Ñ‹Ð¹ ÑÐºÑ€Ð°Ð½" Ð¸ "ÐžÑ‚ÐºÑ€Ñ‹Ñ‚ÑŒ Ð² Ð¾Ñ‚Ð´ÐµÐ»ÑŒÐ½Ð¾Ð¼ Ð¾ÐºÐ½Ðµ"
    const group = findGroupChildrenByChildId(["fullscreen", "popout"], children);

    if (group) {
        // Ð”Ð¾Ð±Ð°Ð²Ð»ÑÐµÐ¼ Ð½Ð°Ñˆ Ð¿ÑƒÐ½ÐºÑ‚ Ð¿Ð¾ÑÐ»Ðµ ÑÑƒÑ‰ÐµÑÑ‚Ð²ÑƒÑŽÑ‰Ð¸Ñ…
        group.push(
            <Menu.MenuItem
                id="custom-stream-preview"
                label="ðŸ–¼ï¸ Custom Preview"
                icon={ImageIcon}
                action={openImagePicker}
            />
        );
    } else {
        // Ð•ÑÐ»Ð¸ Ð³Ñ€ÑƒÐ¿Ð¿Ð° Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð°, Ð´Ð¾Ð±Ð°Ð²Ð»ÑÐµÐ¼ Ð² ÐºÐ¾Ð½ÐµÑ†
        children.push(
            <Menu.MenuSeparator />,
            <Menu.MenuItem
                id="custom-stream-preview"
                label="ðŸ–¼ï¸ Custom Preview"
                icon={ImageIcon}
                action={openImagePicker}
            />
        );
    }
};

// Ð¤ÑƒÐ½ÐºÑ†Ð¸Ñ Ð´Ð»Ñ Ð¿Ð¾Ð»ÑƒÑ‡ÐµÐ½Ð¸Ñ ÐºÐ°ÑÑ‚Ð¾Ð¼Ð½Ð¾Ð³Ð¾ Ð¿Ñ€ÐµÐ²ÑŒÑŽ (Ð²Ñ‹Ð·Ñ‹Ð²Ð°ÐµÑ‚ÑÑ Ð¸Ð· webpack patch)
// ÐŸÑ€Ð¸ ÑÐ»Ð°Ð¹Ð´-ÑˆÐ¾Ñƒ ÐºÐ°Ð¶Ð´Ñ‹Ð¹ Ð²Ñ‹Ð·Ð¾Ð² (~5 Ð¼Ð¸Ð½) Ð²Ð¾Ð·Ð²Ñ€Ð°Ñ‰Ð°ÐµÑ‚ ÑÐ»ÐµÐ´ÑƒÑŽÑ‰ÑƒÑŽ ÐºÐ°Ñ€Ñ‚Ð¸Ð½ÐºÑƒ
function getCustomThumbnail(originalThumbnail: string): string {
    // ÐŸÐ¾Ð¼ÐµÑ‡Ð°ÐµÐ¼ Ñ‡Ñ‚Ð¾ ÑÑ‚Ñ€Ð¸Ð¼ Ð°ÐºÑ‚Ð¸Ð²ÐµÐ½
    isStreamActive = true;

    if (!settings.store.replaceEnabled || cachedDataUris.length === 0) {
        actualStreamImageUri = null; // ÐÐµÑ‚ ÐºÐ°ÑÑ‚Ð¾Ð¼Ð½Ð¾Ð¹ ÐºÐ°Ñ€Ñ‚Ð¸Ð½ÐºÐ¸
        notifyImageChange();
        return originalThumbnail;
    }

    // Ð•ÑÐ»Ð¸ Ð¾Ð´Ð½Ð° ÐºÐ°Ñ€Ñ‚Ð¸Ð½ÐºÐ° Ð¸Ð»Ð¸ ÑÐ»Ð°Ð¹Ð´-ÑˆÐ¾Ñƒ Ð²Ñ‹ÐºÐ»ÑŽÑ‡ÐµÐ½Ð¾ â€” Ð¿Ð¾ÐºÐ°Ð·Ñ‹Ð²Ð°ÐµÐ¼ Ð²Ñ‹Ð±Ñ€Ð°Ð½Ð½ÑƒÑŽ
    if (cachedDataUris.length === 1 || !settings.store.slideshowEnabled) {
        // ÐŸÑ€Ð¾Ð²ÐµÑ€ÑÐµÐ¼ Ñ‡Ñ‚Ð¾ Ð¸Ð½Ð´ÐµÐºÑ Ð²Ð°Ð»Ð¸Ð´ÐµÐ½
        const idx = currentSlideIndex < cachedDataUris.length ? currentSlideIndex : 0;
        lastSlideChangeTime = Date.now(); // ÐžÐ±Ð½Ð¾Ð²Ð»ÑÐµÐ¼ Ð²Ñ€ÐµÐ¼Ñ Ð´Ð»Ñ Ñ‚Ð°Ð¹Ð¼ÐµÑ€Ð°
        actualStreamImageUri = cachedDataUris[idx]; // ÐžÐ±Ð½Ð¾Ð²Ð»ÑÐµÐ¼ Ñ€ÐµÐ°Ð»ÑŒÐ½ÑƒÑŽ ÐºÐ°Ñ€Ñ‚Ð¸Ð½ÐºÑƒ Ð½Ð° ÑÑ‚Ñ€Ð¸Ð¼Ðµ
        notifyImageChange();
        return cachedDataUris[idx];
    }

    // Ð•ÑÐ»Ð¸ Ð±Ñ‹Ð»Ð° Ñ€ÑƒÑ‡Ð½Ð°Ñ ÑÐ¼ÐµÐ½Ð° â€” Ð¿Ð¾ÐºÐ°Ð·Ñ‹Ð²Ð°ÐµÐ¼ Ð²Ñ‹Ð±Ñ€Ð°Ð½Ð½ÑƒÑŽ ÐºÐ°Ñ€Ñ‚Ð¸Ð½ÐºÑƒ Ð¾Ð´Ð¸Ð½ Ñ€Ð°Ð·
    if (manualSlideChange) {
        manualSlideChange = false; // Ð¡Ð±Ñ€Ð°ÑÑ‹Ð²Ð°ÐµÐ¼ Ñ„Ð»Ð°Ð³
        lastSlideChangeTime = Date.now(); // ÐžÐ±Ð½Ð¾Ð²Ð»ÑÐµÐ¼ Ð²Ñ€ÐµÐ¼Ñ Ð´Ð»Ñ Ñ‚Ð°Ð¹Ð¼ÐµÑ€Ð°
        actualStreamImageUri = cachedDataUris[currentSlideIndex]; // ÐžÐ±Ð½Ð¾Ð²Ð»ÑÐµÐ¼ Ñ€ÐµÐ°Ð»ÑŒÐ½ÑƒÑŽ ÐºÐ°Ñ€Ñ‚Ð¸Ð½ÐºÑƒ Ð½Ð° ÑÑ‚Ñ€Ð¸Ð¼Ðµ
        notifyImageChange();
        return cachedDataUris[currentSlideIndex];
    }

    // Ð¡Ð»Ð°Ð¹Ð´-ÑˆÐ¾Ñƒ: Ð²Ñ‹Ð±Ð¸Ñ€Ð°ÐµÐ¼ ÑÐ»ÐµÐ´ÑƒÑŽÑ‰ÑƒÑŽ ÐºÐ°Ñ€Ñ‚Ð¸Ð½ÐºÑƒ
    let nextIndex: number;

    if (settings.store.slideshowRandom) {
        // Ð¡Ð»ÑƒÑ‡Ð°Ð¹Ð½Ñ‹Ð¹ Ð²Ñ‹Ð±Ð¾Ñ€ (Ð½Ð¾ Ð½Ðµ Ñ‚Ð° Ð¶Ðµ ÑÐ°Ð¼Ð°Ñ)
        do {
            nextIndex = Math.floor(Math.random() * cachedDataUris.length);
        } while (nextIndex === currentSlideIndex && cachedDataUris.length > 1);
    } else {
        // ÐŸÐ¾ÑÐ»ÐµÐ´Ð¾Ð²Ð°Ñ‚ÐµÐ»ÑŒÐ½Ñ‹Ð¹ Ð²Ñ‹Ð±Ð¾Ñ€
        nextIndex = (currentSlideIndex + 1) % cachedDataUris.length;
    }

    currentSlideIndex = nextIndex;
    lastSlideChangeTime = Date.now(); // Ð—Ð°Ð¿Ð¾Ð¼Ð¸Ð½Ð°ÐµÐ¼ Ð²Ñ€ÐµÐ¼Ñ ÑÐ¼ÐµÐ½Ñ‹
    actualStreamImageUri = cachedDataUris[currentSlideIndex]; // ÐžÐ±Ð½Ð¾Ð²Ð»ÑÐµÐ¼ Ñ€ÐµÐ°Ð»ÑŒÐ½ÑƒÑŽ ÐºÐ°Ñ€Ñ‚Ð¸Ð½ÐºÑƒ Ð½Ð° ÑÑ‚Ñ€Ð¸Ð¼Ðµ
    saveSlideIndex(nextIndex); // Ð¡Ð¾Ñ…Ñ€Ð°Ð½ÑÐµÐ¼ Ð½Ð¾Ð²Ñ‹Ð¹ Ð¸Ð½Ð´ÐµÐºÑ
    notifyImageChange(); // ÐžÐ±Ð½Ð¾Ð²Ð»ÑÐµÐ¼ UI
    return cachedDataUris[currentSlideIndex];
}

export default definePlugin({
    name: "CustomStreamTopQ",
    description: "Custom stream preview images with profiles & slideshow. GitHub: https://github.com/MrTopQ/customStream-Vencord",
    authors: [{ name: "Flocord", id: 0n }],

    settings,

    // ÐŸÐ°Ñ‚Ñ‡Ð¸ Ð´Ð»Ñ Ð¿ÐµÑ€ÐµÑ…Ð²Ð°Ñ‚Ð° Ñ„ÑƒÐ½ÐºÑ†Ð¸Ð¸ Ð¾Ð±Ð½Ð¾Ð²Ð»ÐµÐ½Ð¸Ñ Ð¿Ñ€ÐµÐ²ÑŒÑŽ
    patches: [
        {
            // ÐŸÐ°Ñ‚Ñ‡ Ð´Ð»Ñ Ð´Ð¾Ð±Ð°Ð²Ð»ÐµÐ½Ð¸Ñ ÐºÐ½Ð¾Ð¿ÐºÐ¸ Ð² Ð¿Ð°Ð½ÐµÐ»ÑŒ (Ñ€ÑÐ´Ð¾Ð¼ Ñ Ð¼Ð¸ÐºÑ€Ð¾Ñ„Ð¾Ð½Ð¾Ð¼/Ð½Ð°ÑƒÑˆÐ½Ð¸ÐºÐ°Ð¼Ð¸)
            find: ".DISPLAY_NAME_STYLES_COACHMARK),",
            replacement: {
                // ÐœÐ°Ñ‚Ñ‡Ð¸Ð¼ Ð½Ð°Ñ‡Ð°Ð»Ð¾ Ð¼Ð°ÑÑÐ¸Ð²Ð° children Ð¿Ð¾ÑÐ»Ðµ Ñ‡ÐµÐ³Ð¾ ÑƒÐ³Ð¾Ð´Ð½Ð¾, Ð³Ð»Ð°Ð²Ð½Ð¾Ðµ Ñ‡Ñ‚Ð¾Ð±Ñ‹ Ð±Ñ‹Ð» accountContainerRef Ð´Ð°Ð»ÑŒÑˆÐµ
                match: /(children:\[)(.{0,150}?)(accountContainerRef)/,
                replace: "$1$self.StreamPreviewPanelButton(arguments[0]),$2$3"
            }
        },
        {
            // ÐŸÐµÑ€ÐµÑ…Ð²Ð°Ñ‚Ñ‹Ð²Ð°ÐµÐ¼ Ð¾Ñ‚Ð¿Ñ€Ð°Ð²ÐºÑƒ Ð¿Ñ€ÐµÐ²ÑŒÑŽ Ð² ApplicationStreamPreviewUploadManager
            find: "\"ApplicationStreamPreviewUploadManager\"",
            all: true,
            replacement: [
                {
                    // ÐŸÐ°Ñ‚Ñ‚ÐµÑ€Ð½ 1: body:{thumbnail:x}
                    match: /body:\{thumbnail:(\i)\}/,
                    replace: "body:{thumbnail:$self.getCustomThumbnail($1)}"
                },
                {
                    // ÐŸÐ°Ñ‚Ñ‚ÐµÑ€Ð½ 2: {thumbnail:x} Ð±ÐµÐ· body
                    match: /\{thumbnail:(\i)\}/,
                    replace: "{thumbnail:$self.getCustomThumbnail($1)}"
                }
            ]
        }
    ],

    toolboxActions: {
        "Select stream preview": openImagePicker
    },

    // ÐšÐ½Ð¾Ð¿ÐºÐ° Ð² Ð¿Ð°Ð½ÐµÐ»Ð¸ Ð°ÐºÐºÐ°ÑƒÐ½Ñ‚Ð°
    StreamPreviewPanelButton: ErrorBoundary.wrap(StreamPreviewPanelButton, { noop: true }),

    // Ð¤ÑƒÐ½ÐºÑ†Ð¸Ñ Ð´Ð»Ñ Ð·Ð°Ð¼ÐµÐ½Ñ‹ thumbnail (Ð²Ñ‹Ð·Ñ‹Ð²Ð°ÐµÑ‚ÑÑ Ð¸Ð· webpack patch)
    getCustomThumbnail,

    contextMenus: {
        "stream-context": streamContextMenuPatch
    },

    async start() {
        // Ð—Ð°Ð³Ñ€ÑƒÐ¶Ð°ÐµÐ¼ Ð¿Ñ€Ð¾Ñ„Ð¸Ð»Ð¸ Ð¿Ñ€Ð¸ ÑÑ‚Ð°Ñ€Ñ‚Ðµ (Ð²ÐºÐ»ÑŽÑ‡Ð°Ñ Ð¼Ð¸Ð³Ñ€Ð°Ñ†Ð¸ÑŽ ÑÐ¾ ÑÑ‚Ð°Ñ€Ð¾Ð³Ð¾ Ñ„Ð¾Ñ€Ð¼Ð°Ñ‚Ð°)
        await loadProfilesFromDataStore();

        // Ð¡Ð¸Ð½Ñ…Ñ€Ð¾Ð½Ð¸Ð·Ð¸Ñ€ÑƒÐµÐ¼ ÐºÑÑˆ Ñ Ð°ÐºÑ‚Ð¸Ð²Ð½Ñ‹Ð¼ Ð¿Ñ€Ð¾Ñ„Ð¸Ð»ÐµÐ¼
        syncCacheWithActiveProfile();

        // Ð£Ð²ÐµÐ´Ð¾Ð¼Ð»ÑÐµÐ¼ UI Ð¾Ð± Ð¾Ð±Ð½Ð¾Ð²Ð»ÐµÐ½Ð¸Ð¸ (Ð´Ð»Ñ Ð¸ÐºÐ¾Ð½ÐºÐ¸ Ð² Ð¿Ð°Ð½ÐµÐ»Ð¸)
        notifyImageChange();

        const profile = getActiveProfile();
        console.log(`[CustomStreamTopQ] Loaded ${profiles.size} profiles, active: "${profile.name}" with ${profile.images.length} images`);
    },

    stop() {
        // ÐžÑ‡Ð¸Ñ‰Ð°ÐµÐ¼ ÐºÑÑˆ Ð¿Ñ€Ð¸ Ð²Ñ‹ÐºÐ»ÑŽÑ‡ÐµÐ½Ð¸Ð¸
        cachedImages = [];
        cachedDataUris = [];
        currentSlideIndex = 0;
        isStreamActive = false;
        lastSlideChangeTime = 0;
        manualSlideChange = false;
        profiles.clear();
        activeProfileId = DEFAULT_PROFILE_ID;
    }
});
