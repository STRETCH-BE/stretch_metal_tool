/**
 * Button primitive — STRETCH identity: uppercase, 700 weight, hard edges,
 * 2px border, red → arrow glyph that flips colour on hover.
 * File path: /components/ui/button.tsx
 *
 * Renders as either a <button> or, if `href` is provided, a Next <Link>.
 * Variants map to the .btn-* classes in globals.css:
 *   primary     — red fill → hover black (arrow stays white)
 *   ghost       — black outline on light → hover black fill
 *   ghost-light — white outline on dark → hover white fill
 *
 * For analytics-tracked CTAs use <TrackedCTA> and pass these classes, or
 * wrap this component where composition fits better.
 */

import Link from "next/link";
import type {
  ReactNode,
  ButtonHTMLAttributes,
  AnchorHTMLAttributes,
} from "react";

type Variant = "primary" | "ghost" | "ghost-light";
type Size = "sm" | "md" | "lg";

const variantClasses: Record<Variant, string> = {
  primary: "btn-primary",
  ghost: "btn-ghost",
  "ghost-light": "btn-ghost-light",
};

const sizeClasses: Record<Size, string> = {
  sm: "btn-sm",
  md: "",
  lg: "btn-lg",
};

type CommonProps = {
  variant?: Variant;
  size?: Size;
  /** Renders the red → glyph after the label. */
  arrow?: boolean;
  children: ReactNode;
  className?: string;
};

type AsLink = CommonProps & { href: string } & Omit<
    AnchorHTMLAttributes<HTMLAnchorElement>,
    "href" | "children" | "className"
  >;
type AsButton = CommonProps & { href?: undefined } & Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "children" | "className"
  >;
type Props = AsLink | AsButton;

export function Button(props: Props) {
  const {
    variant = "primary",
    size = "md",
    arrow,
    children,
    className = "",
  } = props;

  const classes =
    `btn ${variantClasses[variant]} ${sizeClasses[size]} ${className}`.trim();

  const content = (
    <>
      {children}
      {arrow && (
        <span aria-hidden="true" className="btn-arrow">
          →
        </span>
      )}
    </>
  );

  if ("href" in props && props.href) {
    const { href, ...anchorProps } = props;
    const rest = stripCommon(anchorProps);
    return (
      <Link href={href} className={classes} {...rest}>
        {content}
      </Link>
    );
  }

  const rest = stripCommon(props as AsButton);
  return (
    <button className={classes} {...rest}>
      {content}
    </button>
  );
}

/** Removes the styling props so they never leak onto the DOM element. */
function stripCommon<T extends CommonProps & { href?: string }>(props: T) {
  const rest = { ...props } as Record<string, unknown>;
  delete rest.variant;
  delete rest.size;
  delete rest.arrow;
  delete rest.className;
  delete rest.href;
  delete rest.children;
  return rest;
}
