import { useState } from "react";

import type { Player } from "@/data/players";
import { cn } from "@/lib/utils";

interface PlayerAvatarProps {
  player: Pick<Player, "nickname" | "imageUrl">;
  className?: string;
  eager?: boolean;
}

export function PlayerAvatar({
  player,
  className,
  eager = false,
}: PlayerAvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const [loadedUrl, setLoadedUrl] = useState<string>();
  const imageUrl =
    player.imageUrl && failedUrl !== player.imageUrl
      ? player.imageUrl
      : undefined;
  const initials = player.nickname.trim().slice(0, 2).toUpperCase() || "?";

  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden border border-foreground/20 bg-muted font-mono text-xs font-semibold text-muted-foreground",
        className,
      )}
      aria-hidden="true"
    >
      {initials}
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          className={cn(
            "absolute inset-0 size-full object-cover object-top transition-opacity duration-200",
            loadedUrl === imageUrl ? "opacity-100" : "opacity-0",
          )}
          onLoad={() => setLoadedUrl(imageUrl)}
          onError={() => setFailedUrl(imageUrl)}
        />
      ) : null}
    </span>
  );
}
