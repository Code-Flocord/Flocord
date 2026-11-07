/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./Button.css";

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import type { ComponentPropsWithRef } from "react";

import { OpenExternalIcon } from "./Icons";
import { Link } from "./Link";

const btnCls = classNameFactory("vc-btn-");
const textBtnCls = classNameFactory("vc-text-btn-");

export type ButtonVariant =
    "primary" | "secondary" | "dangerPrimary" | "dangerSecondary" | "overlayPrimary" | "positive" | "link" | "none";
export type ButtonSize = "min" | "xs" | "small" | "medium" | "iconOnly";

export type ButtonProps = ComponentPropsWithRef<"button"> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
};

export type LinkButtonProps = ComponentPropsWithRef<"a"> & {
    size?: ButtonSize;
    variant?: ButtonVariant;
};

export function Button({ variant = "primary", size = "medium", children, className, ...restProps }: ButtonProps) {
    return (
        <button data-mana-component="button" className={classes(btnCls("base", variant, size), className)} {...restProps}>
            {children}
            {variant === "link" && <OpenExternalIcon className={btnCls("link-icon")} />}
        </button>
    );
}

export function LinkButton({ variant = "link", size = "medium", className, children, ...restProps }: LinkButtonProps) {
    return (
        <Link data-mana-component="button" className={classes(btnCls("base", variant, size), className)} {...restProps}>
            {children}
            <OpenExternalIcon className={btnCls("link-icon")} />
        </Link>
    );
}

export type TextButtonVariant = "primary" | "secondary" | "danger" | "link";

export type TextButtonProps = ComponentPropsWithRef<"button"> & {
    variant?: TextButtonVariant;
};

export function TextButton({ variant = "primary", className, ...restProps }: TextButtonProps) {
    return (
        <button className={classes(textBtnCls("base", variant), className)} {...restProps} />
    );
}

// Compatibility wrapper for plugins still importing Button from @webpack/common.
const LegacyButtonColors = {
    BLACK: "black",
    BRAND: "brand",
    CUSTOM: "custom",
    GREEN: "green",
    GREY: "grey",
    PRIMARY: "primary",
    RED: "red",
    YELLOW: "yellow"
} as const;

const LegacyButtonSizes = {
    DEFAULT: "default",
    MINI: "mini",
    MIN: "min",
    SMALL: "small"
} as const;

const legacyButtonVariants = {
    BLACK: "secondary",
    BRAND: "primary",
    CUSTOM: "secondary",
    GREEN: "positive",
    GREY: "secondary",
    PRIMARY: "primary",
    RED: "dangerPrimary",
    YELLOW: "secondary"
} as const;

export const ButtonCompat = Object.assign(
    ({ color, size, variant, ...props }: any) => (
        <Button
            {...props}
            variant={variant ?? (color && legacyButtonVariants[color as keyof typeof legacyButtonVariants]) ?? "primary"}
            size={size === "MIN" || size === "MINI" ? "min" : size === "SMALL" ? "small" : "medium"}
        />
    ),
    { Colors: LegacyButtonColors, Sizes: LegacyButtonSizes }
);
