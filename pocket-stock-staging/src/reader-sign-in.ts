import { auth, type AuthUser } from '@appdeploy/client';

let pendingGoogleSignIn: Promise<unknown> | null = null;

export function withReaderDeadline<T>(
  operation: Promise<T>,
  milliseconds: number,
  code: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject({ code }), milliseconds);
    operation.then(
      value => {
        window.clearTimeout(timer);
        resolve(value);
      },
      error => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function signInWithReaderSession(reader: 'a' | 'b' = 'a'): Promise<AuthUser> {
  // A retry can reuse credentials already received by the SDK. The hint alone
  // never grants access: getUser and the protected reader profile still validate it.
  if (auth.isSignedIn()) {
    return withReaderDeadline(
      auth.getUser(),
      20000,
      'reader_profile_sync'
    ).then(user => {
      if (!user) throw { code: 'reader_session_expired' };
      return user;
    });
  }

  // Open synchronously from the click, and reuse an outstanding popup on retry.
  if (!pendingGoogleSignIn) {
    const operation = auth.signIn({
      scope: 'openid email profile offline_access',
      reader,
    });
    pendingGoogleSignIn = operation;
    const clearOperation = () => {
      if (pendingGoogleSignIn === operation) pendingGoogleSignIn = null;
    };
    operation.then(clearOperation, clearOperation);
  }
  const operation = pendingGoogleSignIn;
  return new Promise((resolve, reject) => {
    let settled = false;
    let pollTimer: number | undefined;
    const deadline = window.setTimeout(
      () => finish(undefined, { code: 'reader_sign_in_timeout' }),
      120000
    );

    function finish(user?: AuthUser, error?: unknown) {
      if (settled) return;
      settled = true;
      window.clearTimeout(deadline);
      window.clearTimeout(pollTimer);
      if (user) {
        // The SDK stores the session before awaiting optional notification resume.
        // Accept only its validated identity; never read tokens or popup messages.
        if (pendingGoogleSignIn === operation) pendingGoogleSignIn = null;
        resolve(user);
      } else {
        reject(error ?? { code: 'reader_session_expired' });
      }
    }

    async function checkSession() {
      if (settled) return;
      try {
        const user = await auth.getUser();
        if (user) {
          finish(user);
          return;
        }
      } catch {
        // The provider promise supplies its own definitive failure below.
      }
      if (!settled)
        pollTimer = window.setTimeout(() => void checkSession(), 750);
    }

    operation.then(
      () => {
        void auth.getUser().then(
          user => finish(user ?? undefined),
          error => finish(undefined, error)
        );
      },
      error => finish(undefined, error)
    );
    pollTimer = window.setTimeout(() => void checkSession(), 750);
  });
}
