import { ShieldIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

interface TeamLogoProps {
  name: string;
  src?: string;
  className?: string;
}

export function TeamLogo({ name, src, className }: TeamLogoProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <ShieldIcon
        className={cn("size-4 shrink-0 text-muted-foreground/60", className)}
        aria-label={`${name} 暂无战队标志`}
      />
    );
  }

  return (
    <img
      src={src}
      alt={`${name} 战队标志`}
      className={cn(
        "size-5 shrink-0 object-contain drop-shadow-[0_0_1px_rgba(15,23,42,0.75)]",
        className,
      )}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
