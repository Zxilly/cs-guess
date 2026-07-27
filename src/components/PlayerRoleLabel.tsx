import {
  playerRoleNameZh,
  type PlayerRole,
} from "@/data/players";
import { playerRoleIcon } from "@/lib/player-role-icons";
import { cn } from "@/lib/utils";

interface PlayerRoleIconProps {
  role: PlayerRole;
  className?: string;
}

export function PlayerRoleIcon({
  role,
  className,
}: PlayerRoleIconProps) {
  const RoleIcon = playerRoleIcon(role);
  return (
    <RoleIcon
      className={cn("size-3.5 shrink-0", className)}
      weight="regular"
      aria-hidden="true"
    />
  );
}

interface PlayerRoleLabelProps extends PlayerRoleIconProps {
  iconClassName?: string;
}

export function PlayerRoleLabel({
  role,
  className,
  iconClassName,
}: PlayerRoleLabelProps) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <PlayerRoleIcon role={role} className={iconClassName} />
      <span>{playerRoleNameZh(role)}</span>
    </span>
  );
}
