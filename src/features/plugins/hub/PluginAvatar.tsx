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
  className,
}: {
  id: string;
  name: string;
  size?: number;
  className?: string;
}) {
  const { from, to } = pluginAvatarGradient(id);
  return (
    <div
      aria-hidden
      className={cx(
        "flex shrink-0 select-none items-center justify-center rounded-xl font-medium text-white shadow-xs",
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
