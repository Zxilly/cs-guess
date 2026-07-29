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

  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden border border-foreground/20 bg-muted text-muted-foreground",
        className,
      )}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 48 48"
        className="size-[68%] opacity-55"
        data-slot="player-avatar-placeholder"
      >
        <circle cx="24" cy="17" r="9" fill="currentColor" />
        <path
          d="M8 42c0-9.4 7.2-15 16-15s16 5.6 16 15H8Z"
          fill="currentColor"
        />
      </svg>
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          className={cn(
            "absolute inset-0 size-full object-cover object-top transition-opacity duration-200 motion-reduce:transition-none",
            loadedUrl === imageUrl ? "opacity-100" : "opacity-0",
          )}
          onLoad={() => setLoadedUrl(imageUrl)}
          onError={() => setFailedUrl(imageUrl)}
        />
      ) : null}
    </span>
  );
}
