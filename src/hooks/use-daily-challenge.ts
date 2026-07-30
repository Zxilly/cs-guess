import { useEffect, useState } from "react";

import {
  ensureAnonymousProfileReady,
  useAnonymousProfile,
} from "@/hooks/use-anonymous-profile";
import {
  loadCurrentDailyChallenge,
  type ServerDailyChallenge,
} from "@/lib/daily-challenge-api";

export function useDailyChallenge() {
  const { profile } = useAnonymousProfile();
  const anonymousId = profile.anonymousId;
  const syncToken = profile.syncToken;
  const [challenge, setChallenge] = useState<ServerDailyChallenge>();
  const [error, setError] = useState<Error>();
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(undefined);
    ensureAnonymousProfileReady()
      .then(() =>
        loadCurrentDailyChallenge(controller.signal, {
          anonymousId,
          syncToken,
        }),
      )
      .then(setChallenge)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            reason instanceof Error
              ? reason
              : new Error("每日挑战载入失败"),
          );
        }
      });
    return () => controller.abort();
  }, [anonymousId, requestVersion, syncToken]);

  function retry() {
    setChallenge(undefined);
    setRequestVersion((version) => version + 1);
  }

  return {
    challenge,
    error,
    retry,
    loading: !challenge && !error,
  };
}
