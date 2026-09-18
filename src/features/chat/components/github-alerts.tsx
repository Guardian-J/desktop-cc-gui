/** Alert-card metadata + title row for the GitHub-style blockquote alerts
 *  promoted by remark-github-alerts.ts. Kept separate from Markdown.tsx so
 *  the renderer file stays lean. */
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import Info from "lucide-react/dist/esm/icons/info";
import Lightbulb from "lucide-react/dist/esm/icons/lightbulb";
import MessageSquareWarning from "lucide-react/dist/esm/icons/message-square-warning";
import TriangleAlert from "lucide-react/dist/esm/icons/triangle-alert";
import OctagonAlert from "lucide-react/dist/esm/icons/octagon-alert";
import type { AlertType } from "./remark-github-alerts";

interface AlertIconProps {
  className?: string;
}

const ALERT_META: Record<
  AlertType,
  { labelKey: string; Icon: ComponentType<AlertIconProps> }
> = {
  note: { labelKey: "chat.alertNote", Icon: Info },
  tip: { labelKey: "chat.alertTip", Icon: Lightbulb },
  important: { labelKey: "chat.alertImportant", Icon: MessageSquareWarning },
  warning: { labelKey: "chat.alertWarning", Icon: TriangleAlert },
  caution: { labelKey: "chat.alertCaution", Icon: OctagonAlert },
};

/** Reads the className the remark plugin stamped onto the blockquote (hast
 *  `properties.className`, or the space-separated React `className` string)
 *  back into the alert type, for the component override in Markdown.tsx. */
export function isAlertClassName(className: unknown): AlertType | null {
  const names = Array.isArray(className)
    ? className.flatMap((item) => String(item).split(/\s+/))
    : typeof className === "string"
      ? className.split(/\s+/)
      : [];
  for (const name of names) {
    if (!name) continue;
    const match = /^md-alert-(note|tip|important|warning|caution)$/.exec(name);
    if (match) return match[1] as AlertType;
  }
  return null;
}

export function AlertTitle({ type }: { type: AlertType }) {
  const { t } = useTranslation();
  const { labelKey, Icon } = ALERT_META[type];
  return (
    <div className="md-alert-title">
      <Icon className="size-4" aria-hidden />
      {t(labelKey)}
    </div>
  );
}
