import { useEffect, useState } from "react";

import {
  loadCurrentDailyChallenge,
  type ServerDailyChallenge,
} from "@/lib/daily-challenge-api";

export function useDailyChallenge() {
  const [challenge, setChallenge] = useState<ServerDailyChallenge>();
  const [error, setError] = useState<Error>();
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(undefined);
    loadCurrentDailyChallenge(controller.signal)
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
  }, [requestVersion]);

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
