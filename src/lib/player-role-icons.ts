import {
  CrownSimpleIcon,
  CrosshairIcon,
  LightningIcon,
  QuestionIcon,
  TargetIcon,
  type Icon,
} from "@phosphor-icons/react";

import type { PlayerRole } from "@/data/players";

const playerRoleIcons: Record<PlayerRole, Icon> = {
  AWPer: CrosshairIcon,
  Rifler: TargetIcon,
  IGL: CrownSimpleIcon,
  Entry: LightningIcon,
  Unknown: QuestionIcon,
};

export function playerRoleIcon(role: PlayerRole) {
  return playerRoleIcons[role];
}
