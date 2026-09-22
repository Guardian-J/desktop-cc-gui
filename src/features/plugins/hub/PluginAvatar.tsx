import { cx } from "@/utils/cx";
import { pluginAvatarGradient, pluginInitial } from "./catalog";

/**
 * Market/index entries carry no artwork, so every plugin row gets the same
 * deterministic gradient tile with its initial (see catalog.ts). Purely
 * decorative: `aria-hidden`, the row text carries the identity.
 */
export function PluginAvatar({
  id,
  name,
  size = 40,
  shape = "tile",
  className,
}: {
  id: string;
  name: string;
  size?: number;
  /** `circle` is the small author chip in market rows; entries use the tile. */
  shape?: "tile" | "circle";
  className?: string;
}) {
  const { from, to } = pluginAvatarGradient(id);
  return (
    <div
      aria-hidden
      className={cx(
        "flex shrink-0 select-none items-center justify-center font-medium text-white shadow-xs",
        shape === "circle" ? "rounded-full" : "rounded-xl",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(12, Math.round(size * 0.42)),
        backgroundImage: `linear-gradient(135deg, ${from}, ${to})`,
      }}
    >
      {pluginInitial(name)}
    </div>
  );
}
