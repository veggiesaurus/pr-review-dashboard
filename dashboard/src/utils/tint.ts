import type { CSSProperties } from "react";

// For the .tint and .tint-bg classes, which hold a colour from Linear or GitHub to the theme's lightness range.
export const tint = (color: string | null) => (color ? ({ "--tint": color } as CSSProperties) : undefined);
