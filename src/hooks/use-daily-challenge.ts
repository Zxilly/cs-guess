import { useCallback, useState } from "react";
import useSWRImmutable from "swr/immutable";
import useSWRMutation from "swr/mutation";

import {
  acceptAuthoritativeProfileCompletion,
  ensureAnonymousProfileReady,
  useAnonymousProfile,
} from "@/hooks/use-anonymous-profile";
import {
  completeDailyChallenge,
  loadCurrentDailyChallengeMetadata,
  startCurrentDailyChallenge,
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
  // A mounted game keeps its issued attempt across Shanghai midnight.
  const [attemptDate] = useState(shanghaiDateKey);
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
      attemptDate,
    ],
    async () => {
      await ensureAnonymousProfileReady();
      return startCurrentDailyChallenge({
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
          date: string;
          guessIds: readonly string[];
          timedOut: boolean;
        };
      },
    ) => {
      const remote = await completeDailyChallenge(
        profile,
        arg.date,
        arg.guessIds,
        arg.timedOut,
      );
      acceptAuthoritativeProfileCompletion(remote);
      return remote;
    },
  );
  const submitCompletion = useCallback(
    (guessIds: readonly string[], timedOut: boolean) => {
      if (!challenge) return Promise.reject(new Error("daily challenge was not started"));
      return triggerCompletion({ date: challenge.date, guessIds, timedOut });
    },
    [challenge, triggerCompletion],
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

export function useDailyChallengeMetadata() {
  const date = shanghaiDateKey();
  const { data, error, isLoading, mutate } = useSWRImmutable(
    ["daily-challenge-metadata", date],
    () => loadCurrentDailyChallengeMetadata(),
  );

  return {
    challenge: data,
    error,
    loading: isLoading,
    retry: () => void mutate(),
  };
}
