import {
  SpeakerHighIcon,
  SpeakerSlashIcon,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { useSoundStore } from "@/stores/sound-store";
import { cn } from "@/lib/utils";

interface SoundToggleProps {
  className?: string;
}

export function SoundToggle({ className }: SoundToggleProps) {
  const enabled = useSoundStore((state) => state.enabled);
  const toggle = useSoundStore((state) => state.toggle);
  const label = enabled ? "静音" : "取消静音";

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
      aria-label={`${label}全站音效`}
      aria-pressed={!enabled}
      title={`${label}全站音效`}
      onClick={toggle}
    >
      {enabled ? <SpeakerHighIcon /> : <SpeakerSlashIcon />}
      <span className="hidden sm:inline">
        {enabled ? "音效" : "已静音"}
      </span>
    </Button>
  );
}
