/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Flex } from "@components/Flex";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { FlocordDevs } from "@utils/constants";
import { Margins } from "@utils/margins";
import definePlugin from "@utils/types";
import { RestAPI, showToast, Toasts, UserStore, useStateFromStores } from "@webpack/common";

const HOUSES = [
    { id: 1, name: "Bravery", flag: 1 << 6, icon: "https://cdn.discordapp.com/badge-icons/8a88d63823d8a71cd5e390baa45efa02.png" },
    { id: 2, name: "Brilliance", flag: 1 << 7, icon: "https://cdn.discordapp.com/badge-icons/011940fd013da3f7fb926e4a1cd2e618.png" },
    { id: 3, name: "Balance", flag: 1 << 8, icon: "https://cdn.discordapp.com/badge-icons/3aa41de486fa12454c3761e8e223442e.png" }
] as const;

function currentHouseId() {
    const flags = UserStore.getCurrentUser()?.flags ?? 0;
    return HOUSES.find(h => flags & h.flag)?.id ?? 0;
}

async function setHouse(houseId: number) {
    try {
        if (houseId === 0) await RestAPI.del({ url: "/hypesquad/online" });
        else await RestAPI.post({ url: "/hypesquad/online", body: { house_id: houseId } });

        const name = HOUSES.find(h => h.id === houseId)?.name ?? "none";
        showToast(`HypeSquad house updated: ${name}. It may take a moment to show on your profile.`, Toasts.Type.SUCCESS);
    } catch (err) {
        showToast(`Failed to change HypeSquad house: ${err instanceof Error ? err.message : String(err)}`, Toasts.Type.FAILURE);
    }
}

function HouseSelector() {
    const selected = useStateFromStores([UserStore], currentHouseId);

    return (
        <section className={Margins.bottom16}>
            <Heading>HypeSquad house</Heading>
            <Paragraph className={Margins.bottom8}>Pick a house or leave HypeSquad. Your profile updates once Discord confirms the change.</Paragraph>
            <Flex style={{ gap: "8px", flexWrap: "wrap" }}>
                {HOUSES.map(h => (
                    <Button
                        key={h.id}
                        variant={selected === h.id ? "primary" : "secondary"}
                        disabled={selected === h.id}
                        onClick={() => setHouse(h.id)}
                    >
                        <img src={h.icon} alt="" width={18} height={18} style={{ marginRight: 6, verticalAlign: "middle" }} />
                        {h.name}
                    </Button>
                ))}
                <Button variant="dangerSecondary" disabled={selected === 0} onClick={() => setHouse(0)}>
                    Leave HypeSquad
                </Button>
            </Flex>
        </section>
    );
}

export default definePlugin({
    name: "HypeSquadChanger",
    description: "Change your HypeSquad house or leave HypeSquad from this plugin's settings.",
    authors: [FlocordDevs.Flocord],
    tags: ["Customisation"],
    settingsAboutComponent: HouseSelector
});
