import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { db } from './lib/instant';

export type ClubUser = {
  id: string;
  email: string;
};

export type ClubSession =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: ClubUser; isCreator: boolean };

const signedOut: ClubSession = { status: 'signed-out' };

const ClubContext = createContext<ClubSession>(signedOut);

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function ClubProvider({ children, session }: { children: ReactNode; session?: ClubSession }) {
  if (session) return <ClubContext.Provider value={session}>{children}</ClubContext.Provider>;
  if (!db) return <ClubContext.Provider value={signedOut}>{children}</ClubContext.Provider>;
  return <LiveClubProvider>{children}</LiveClubProvider>;
}

export function useClubSession() {
  return useContext(ClubContext);
}

export async function sendMagicCode(email: string) {
  if (!db) throw new Error('not-configured');
  await db.auth.sendMagicCode({ email: normalizeEmail(email) });
}

export async function signInWithMagicCode(email: string, code: string) {
  if (!db) throw new Error('not-configured');
  await db.auth.signInWithMagicCode({ email: normalizeEmail(email), code: code.trim() });
}

export async function signOutClub() {
  if (!db) return;
  await db.auth.signOut();
}

function LiveClubProvider({ children }: { children: ReactNode }) {
  const auth = db!.useAuth();
  const email = auth.user?.email ? normalizeEmail(auth.user.email) : null;
  const query = db!.useQuery(email ? { creators: { $: { where: { email } }, user: {} } } : null);
  const [claimed, setClaimed] = useState(false);

  const creator = query.data?.creators[0];
  const linked = Boolean(creator?.user);

  useEffect(() => {
    if (!auth.user || !creator || linked || claimed || !db) return;
    setClaimed(true);
    void db.transact(db.tx.creators[creator.id].link({ user: auth.user.id })).catch(() => {
      setClaimed(false);
    });
  }, [auth.user, claimed, creator, linked]);

  const session = useMemo<ClubSession>(() => {
    if (auth.isLoading || (email && query.isLoading)) return { status: 'loading' };
    if (!auth.user?.email) return signedOut;
    return {
      status: 'signed-in',
      user: { id: auth.user.id, email: normalizeEmail(auth.user.email) },
      isCreator: linked || (claimed && Boolean(creator)),
    };
  }, [auth.isLoading, auth.user, claimed, creator, email, linked, query.isLoading]);

  return <ClubContext.Provider value={session}>{children}</ClubContext.Provider>;
}
