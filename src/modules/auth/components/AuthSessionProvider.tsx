"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  fetchAuthMeSession,
  type AuthMeSessionData,
} from "@/lib/client/api";

type AuthSessionContextValue = {
  session: AuthMeSessionData | null;
  /** True while `/api/auth/me` is in flight for the shared session load. */
  isLoading: boolean;
  refetch: () => Promise<void>;
  ensureSessionLoaded: () => Promise<void>;
};

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export function AuthSessionProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [session, setSession] = useState<AuthMeSessionData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const loadPromiseRef = useRef<Promise<void> | null>(null);

  const refetch = useCallback(async () => {
    const me = await fetchAuthMeSession();
    setSession(me);
  }, []);

  const ensureSessionLoaded = useCallback(() => {
    if (loadPromiseRef.current !== null) {
      return loadPromiseRef.current;
    }

    setIsLoading(true);

    const promise = (async () => {
      const me = await fetchAuthMeSession();
      setSession(me);
    })().finally(() => {
      setIsLoading(false);
    });

    loadPromiseRef.current = promise;
    return promise;
  }, []);

  const value = useMemo(
    () => ({ session, isLoading, refetch, ensureSessionLoaded }),
    [session, isLoading, refetch, ensureSessionLoaded],
  );

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession(): Omit<
  AuthSessionContextValue,
  "ensureSessionLoaded"
> {
  const ctx = useContext(AuthSessionContext);

  if (!ctx) {
    throw new Error("useAuthSession must be used within AuthSessionProvider");
  }

  const { ensureSessionLoaded } = ctx;

  useLayoutEffect(() => {
    void ensureSessionLoaded();
  }, [ensureSessionLoaded]);

  return {
    session: ctx.session,
    isLoading: ctx.isLoading,
    refetch: ctx.refetch,
  };
}
