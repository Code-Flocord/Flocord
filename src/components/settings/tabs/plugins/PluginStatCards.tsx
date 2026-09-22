/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { BaseText } from "@components/BaseText";

export function StockPluginsCard({ totalStockPlugins, enabledStockPlugins }) {
    return (
        <div className="vc-plugin-stats vc-stockplugins-stats-card">
            <div className="vc-plugin-stats-card-container">
                <div className="vc-plugin-stats-card-section">
                    <BaseText size="md" weight="semibold">Enabled Plugins</BaseText>
                    <BaseText size="xl" weight="bold">{enabledStockPlugins}</BaseText>
                </div>
                <div className="vc-plugin-stats-card-divider"></div>
                <div className="vc-plugin-stats-card-section">
                    <BaseText size="md" weight="semibold">Total Plugins</BaseText>
                    <BaseText size="xl" weight="bold">{totalStockPlugins}</BaseText>
                </div>
            </div>
        </div>
    );
}
