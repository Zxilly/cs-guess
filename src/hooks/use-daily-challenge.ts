import { useCallback } from "react";
import useSWRImmutable from "swr/immutable";
import useSWRMutation from "swr/mutation";

import {
  acceptAuthoritativeProfile,
  ensureAnonymousProfileReady,
  useAnonymousProfile,
} from "@/hooks/use-anonymous-profile";
import {
  completeDailyChallenge,
  loadCurrentDailyChallenge,
  type ServerDailyChallenge,
} from "@/lib/daily-challenge-api";

function shanghaiDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function useDailyChallenge() {
  const { profile } = useAnonymousProfile();
  const anonymousId = profile.anonymousId;
  const syncToken = profile.syncToken;
  const {
    data: challenge,
    error,
    isLoading,
    mutate,
  } = useSWRImmutable<ServerDailyChallenge, Error>(
    [
      "daily-challenge-attempt",
      anonymousId,
      shanghaiDateKey(),
    ],
    async () => {
      await ensureAnonymousProfileReady();
      return loadCurrentDailyChallenge(undefined, {
        anonymousId,
        syncToken,
      });
    },
  );
  const {
    trigger: triggerCompletion,
    isMutating: completionPending,
  } = useSWRMutation(
    [
      "daily-challenge-completion",
      anonymousId,
      challenge?.date ?? shanghaiDateKey(),
    ],
    async (
      _key,
      {
        arg,
      }: {
        arg: {
          guessIds: readonly string[];
          timedOut: boolean;
        };
      },
    ) => {
      const remote = await completeDailyChallenge(
        profile,
        arg.guessIds,
        arg.timedOut,
      );
      acceptAuthoritativeProfile(remote);
      return remote;
    },
  );
  const submitCompletion = useCallback(
    (guessIds: readonly string[], timedOut: boolean) =>
      triggerCompletion({ guessIds, timedOut }),
    [triggerCompletion],
  );

  function retry() {
    void mutate();
  }

  return {
    challenge,
    error,
    retry,
    loading: isLoading,
    submitCompletion,
    completionPending,
  };
}
