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

import { Flex } from "@components/Flex";
import { ContributorAuthorSummary } from "@flocordplugins/philsPluginLibrary/components/ContributorAuthorSummary";
import { Author, Contributor } from "@flocordplugins/philsPluginLibrary/types";
import type { ModalSize, RenderModalProps } from "@vencord/discord-types";
import { Modal } from "@webpack/common";
import type { JSX, ReactNode } from "react";

export interface SettingsModalProps extends RenderModalProps {
    title?: string;
    size?: ModalSize;
    onDone?: () => void;
    footerContent?: JSX.Element;
    closeButtonName?: string;
    author?: Author;
    contributors?: Contributor[];
    children?: ReactNode;
}

export const SettingsModal = ({ title, size, onDone, footerContent, closeButtonName, author, contributors, children, ...modalProps }: SettingsModalProps) => {
    const hasFooter = author || (contributors && contributors.length > 0) || footerContent;

    return (
        <Modal
            {...modalProps}
            size={size}
            title={title ?? ""}
            actions={[{ text: closeButtonName ?? "Done", variant: "primary", onClick: onDone ?? modalProps.onClose }]}
            actionBarInput={hasFooter
                ? (
                    <Flex style={{ flex: 1, alignItems: "center" }}>
                        {(author || (contributors && contributors.length > 0)) && (
                            <ContributorAuthorSummary author={author} contributors={contributors} />
                        )}
                        {footerContent}
                    </Flex>
                )
                : undefined}
        >
            <div style={{ display: "flex", flexDirection: "column", gap: "1em" }}>
                {children}
            </div>
        </Modal>
    );
};
