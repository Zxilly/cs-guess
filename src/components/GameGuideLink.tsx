import { getActiveLocale } from "@/i18n";

export function GameGuideLink() {
  const chinese = getActiveLocale() === "zh-CN";
  return (
    <a
      href={chinese ? "/guide/zh/" : "/guide/"}
      className="inline-flex min-h-11 items-center px-2 text-sm text-muted-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {chinese ? "玩法说明" : "How to play"}
    </a>
  );
}
