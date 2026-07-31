import { t } from "@lingui/core/macro";
import {
  SpeakerHighIcon,
  SpeakerSlashIcon,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";
import { useSoundStore } from "@/stores/sound-store";
import { cn } from "@/lib/utils";

interface SoundToggleProps {
  className?: string;
}

export function SoundToggle({ className }: SoundToggleProps) {
  const enabled = useSoundStore((state) => state.enabled);
  const toggle = useSoundStore((state) => state.toggle);
  const label = enabled ? t`静音全站音效` : t`取消静音全站音效`;

  function handleToggle() {
    const nextEnabled = !enabled;
    toggle();
    trackEvent("sound-toggled", { enabled: nextEnabled });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "rounded-none text-muted-foreground hover:text-foreground",
        !enabled && "text-foreground",
        className,
      )}
      aria-label={label}
      aria-pressed={!enabled}
      title={label}
      onClick={handleToggle}
    >
      {enabled ? <SpeakerHighIcon /> : <SpeakerSlashIcon />}
      <span className="hidden sm:inline">
        {enabled ? t`音效` : t`已静音`}
      </span>
    </Button>
  );
}
