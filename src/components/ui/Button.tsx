import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./tone";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  fullWidth?: boolean;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
}

export function Button({
  children,
  variant = "secondary",
  fullWidth,
  loading,
  disabled,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx("btn", `btn--${variant}`, fullWidth && "btn--full", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="btn__spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
