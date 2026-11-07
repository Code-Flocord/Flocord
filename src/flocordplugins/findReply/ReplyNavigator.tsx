/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import ErrorBoundary from "@components/ErrorBoundary";
import { Message } from "@vencord/discord-types";
import { findComponentByCodeLazy } from "@webpack";
import { React, useRef, useState } from "@webpack/common";

const CloseButton = findComponentByCodeLazy("CLOSE_BUTTON_LABEL");
import type { RefObject } from "react";

import { jumper } from "./index";

export default function ReplyNavigator({ replies }: { replies: Message[]; }) {
    const [page, setPage] = useState(1);
    const [visible, setVisible] = useState(true);
    const ref: RefObject<HTMLDivElement | null> = useRef(null);
    React.useEffect(() => {
        setPage(1);
        setVisible(true);
    }, [replies]);
    React.useEffect(() => {
        // https://stackoverflow.com/a/42234988
        function onMouseDown(event: MouseEvent) {
            if (ref.current && event.target instanceof Element && !ref.current.contains(event.target)) {
                setVisible(false);
            }
        }

        document.addEventListener("mousedown", onMouseDown);
        return () => {
            document.removeEventListener("mousedown", onMouseDown);
        };
    }, [ref]);
    return (
        <ErrorBoundary>
            <div ref={ref} className="vc-findreply-div" style={{
                display: visible ? "flex" : "none",
            }}>
                <div className="vc-findreply-paginator">
                    <button type="button" aria-label="Previous reply" disabled={page <= 1} onClick={() => processPageChange(page - 1)}>‹</button>
                    <span>{page} / {replies.length}</span>
                    <button type="button" aria-label="Next reply" disabled={page >= replies.length} onClick={() => processPageChange(page + 1)}>›</button>
                </div>
                <CloseButton className={"vc-findreply-close"} onClick={() => setVisible(false)} />
            </div>
        </ErrorBoundary>
    );

    function processPageChange(page: number) {
        const reply = replies[page - 1];
        if (!reply) return;
        setPage(page);
        jumper.jumpToMessage({
            channelId: reply.channel_id,
            messageId: reply.id,
            flash: true,
            jumpType: "INSTANT"
        });
    }
}
