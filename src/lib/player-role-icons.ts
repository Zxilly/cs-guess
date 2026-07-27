import {
  CrownSimpleIcon,
  CrosshairIcon,
  LightningIcon,
  TargetIcon,
  type Icon,
} from "@phosphor-icons/react";

import type { PlayerRole } from "@/data/players";

const playerRoleIcons: Record<PlayerRole, Icon> = {
  AWPer: CrosshairIcon,
  Rifler: TargetIcon,
  IGL: CrownSimpleIcon,
  Entry: LightningIcon,
};

export function playerRoleIcon(role: PlayerRole) {
  return playerRoleIcons[role];
}
