/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Text, type TextProps, type TextSize, type TextWeight } from "./Text";

export type HeadingTag = `h${1 | 2 | 3 | 4 | 5 | 6}`;

export type HeadingProps<Tag extends HeadingTag = "h5"> = TextProps<Tag>;

const HeadingDefaults: Record<HeadingTag, { size: TextSize; weight: TextWeight; }> = {
    h1: { size: "xl", weight: "bold" },
    h2: { size: "lg", weight: "bold" },
    h3: { size: "lg", weight: "semibold" },
    h4: { size: "md", weight: "semibold" },
    h5: { size: "md", weight: "medium" },
    h6: { size: "sm", weight: "medium" },
};

/**
 * A simple heading component that automatically sizes according to the tag used.
 *
 * If you need more control, use the BaseText component instead.
 */
export function Heading<T extends HeadingTag = "h5">(props: HeadingProps<T>) {
    const { tag = "h5", children, ...restProps } = props;
    return (
        <Text tag={tag} {...HeadingDefaults[tag]} {...restProps}>
            {children}
        </Text>
    );
}

export function HeadingPrimary(props: HeadingProps<"h2">) {
    return (
        <Heading tag="h2" {...props} />
    );
}

export function HeadingSecondary(props: HeadingProps<"h3">) {
    return (
        <Heading tag="h3" {...props} />
    );
}

export function HeadingTertiary(props: HeadingProps<"h4">) {
    return (
        <Heading tag="h4" {...props} />
    );
}
