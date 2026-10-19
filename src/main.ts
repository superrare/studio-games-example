import { ConnectEmbedUnavailableError, createSuperRareClient, type ConnectEmbedOptions } from '@rareprotocol/connect';
import { accountStorage } from './account-storage.js';
import { parseConfiguration } from './config.js';
import { Credits } from './credits.js';
import { describeSdkFailure } from './hosted-flow.js';
import { Practice } from './practice.js';
import { PaidRound } from './round.js';

function requiredElement<ElementType extends HTMLElement>(selector: string): ElementType {
  const element = document.querySelector<ElementType>(selector);
  if (!element) throw new Error(`Missing interface element: ${selector}`);
  return element;
}

const signInButton = requiredElement<HTMLButtonElement>('#sign-in');
const signOutButton = requiredElement<HTMLButtonElement>('#sign-out');
const authorizeButton = requiredElement<HTMLButtonElement>('#connect');
const signInStatus = requiredElement('#connect-status');
const authorizationStatus = requiredElement('#connection-status');
const playButton = requiredElement<HTMLButtonElement>('#play');
const playStatus = requiredElement('#play-status');
const runResult = requiredElement<HTMLElement>('#run-result');
const walletDialog = requiredElement<HTMLDialogElement>('#wallet-panel');

async function main(): Promise<void> {
  const response = await fetch('/config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load /config.json: HTTP ${response.status}`);
  const raw: unknown = await response.json();
  const configuration = parseConfiguration(raw, location.origin);
  const name = configuration.game === 'color-match' ? 'Color Match' : 'Target Rush';
  document.title = `${name} · Studio games`;
  requiredElement('h1').textContent = name;
  requiredElement('#game-title').textContent = name;
  requiredElement('.lede').textContent = configuration.game === 'color-match'
    ? 'Choose the color named by the game. Correct matches score; wrong choices do not. Paid rounds are recorded by the server.'
    : 'Hit as many moving targets as you can. Paid rounds are recorded by the server.';
  requiredElement('#configuration').textContent = `App ${configuration.appId} · shared credit group ${configuration.groupId} · ${configuration.studioUrl} · Connect display: ${configuration.display}`;
  requiredElement('#wallet-menu').addEventListener('click', () => walletDialog.showModal());
  requiredElement('#balance-menu').addEventListener('click', () => walletDialog.showModal());
  const walletClose = walletDialog.querySelector<HTMLButtonElement>('.modal-close button');
  walletClose?.addEventListener('click', () => walletDialog.close());
  let practice: Practice;
  requiredElement<HTMLButtonElement>('#practice').addEventListener('click', () => practice.start());
  let embedUnavailable = false;
  let connectFrame: HTMLIFrameElement | undefined;
  const connectModal = requiredElement<HTMLDialogElement>('#connect-modal');
  const connectFrameHost = requiredElement('#connect-embed');
  const connectStatus = requiredElement('#connect-modal-status');
  const connectEmbed: ConnectEmbedOptions = {
    open(url) {
      if (connectModal.open) return null;
      const frame = document.createElement('iframe');
      frame.title = 'SuperRare Connect sign-in or checkout';
      frame.allow = 'payment';
      connectFrameHost.replaceChildren(frame);
      const messageSource = frame.contentWindow;
      if (!messageSource) {
        frame.remove();
        return null;
      }
      connectFrame = frame;
      connectModal.showModal();
      frame.src = url;
      return {
        messageSource,
        get closed() { return !frame.isConnected || !connectModal.open; },
        close() { connectModal.close(); },
        location: { replace(next: string) { frame.src = next; } },
      };
    },
    onUnavailable(error) {
      try { localStorage.setItem('studio-games:connect-display', 'popup'); } catch { /* manual fallback still works by reloading */ }
      embedUnavailable = true;
      connectStatus.textContent = `Embedded Connect is unavailable (${error.code}). Close this dialog and press Play again to continue in a popup.`;
    },
  };
  connectModal.addEventListener('close', () => {
    connectFrame?.remove();
    connectFrame = undefined;
    connectFrameHost.replaceChildren();
    if (embedUnavailable) location.reload();
  });
  requiredElement<HTMLButtonElement>('#connect-close').addEventListener('click', () => connectModal.close());
  if (configuration.siblingUrl) {
    const sibling = requiredElement<HTMLAnchorElement>('#sibling-game');
    sibling.href = configuration.siblingUrl;
    sibling.textContent = configuration.game === 'color-match' ? 'Play Target Rush →' : 'Play Color Match →';
    sibling.hidden = false;
  }

  let credits: Credits | undefined;
  let readAddress: () => string | undefined = () => undefined;
  let fallbackToPopup = false;
  try { fallbackToPopup = localStorage.getItem('studio-games:connect-display') === 'popup'; } catch { /* popup fallback is optional */ }
  const display = configuration.display === 'embed' && !fallbackToPopup ? 'embed' : 'popup';
  const client = createSuperRareClient({
    studioUrl: configuration.studioUrl,
    apiUrl: configuration.apiUrl,
    connectUrl: configuration.connectUrl,
    sessionStorage: accountStorage(localStorage, () => readAddress()),
    ...(display === 'embed' ? { embed: connectEmbed } : {}),
    onIntentSettled: (intent) => {
      credits?.onIntentSettled(intent);
      if (['completed', 'failed', 'cancelled', 'expired'].includes(intent.status) && connectModal.open) connectModal.close();
    },
  });
  readAddress = () => client.auth.getSession()?.address;
  const game = client.games.forGame({ appId: configuration.appId, groupId: configuration.groupId });
  // Scoring reads, server runs and one-time sockets use the hosted game origin,
  // not Studio's cross-origin credit API.
  const scoringGame = createSuperRareClient({
    studioUrl: location.origin,
    apiUrl: configuration.apiUrl,
    connectUrl: configuration.connectUrl,
    sessionStorage: false,
  }).games.forGame({ appId: configuration.appId });
  const storageKey = `studio-games:${encodeURIComponent(configuration.studioUrl)}:${configuration.appId}:${configuration.groupId}`;
  let busy = false;
  let authenticated = false;
  let failedVerification = false;
  let identity = client.auth.getSession()?.address.toLowerCase();
  let expiryTimer: number | undefined;
  let authorizationMessage: string | undefined;
  let verificationGeneration = 0;
  let round: PaidRound | undefined;

  function renderAuth(): void {
    const session = client.auth.getSession();
    signInButton.textContent = authenticated ? 'Signed in to SuperRare'
      : failedVerification ? 'Retry Connect session check' : 'Sign in to SuperRare';
    signInButton.disabled = busy || authenticated;
    signOutButton.hidden = !session;
    signOutButton.disabled = busy;
    const authorization = game.getAuthorization();
    const valid = authorization?.address.toLowerCase() === session?.address.toLowerCase() && Boolean(authorization);
    authorizeButton.hidden = !authenticated || valid;
    authorizeButton.disabled = busy || !authenticated || valid;
    authorizeButton.textContent = 'Authorize this game';
    authorizationStatus.textContent = authorizationMessage ?? (valid
      ? `Game authorized for ${authorization?.address}.`
      : 'Press Play to sign in and authorize this game. No payment or play starts automatically.');
    requiredElement('#wallet-address').textContent = session?.address ?? 'Not signed in';
    requiredElement('#balance-badge').textContent = session ? `${credits?.balance?.available ?? '—'} credits` : 'Sign in';
    playButton.disabled = busy;
    playButton.textContent = credits?.balance?.available === 0 ? 'Play · buy credits' : 'Play';
    window.clearTimeout(expiryTimer);
    window.clearTimeout(expiryTimer);
    const expiries = [session?.expiresAt, authorization?.expiresAt]
      .filter((value): value is string => value !== undefined)
      .map(Date.parse).filter((value) => Number.isFinite(value) && value > Date.now());
    if (expiries.length) expiryTimer = window.setTimeout(() => { void verifySession(); }, Math.min(Math.min(...expiries) - Date.now(), 2_147_483_647));
  }

  let resumeAfterPurchase = false;
  let purchaseIdBeforePlay: string | undefined;
  credits = new Credits({
    client, game, root: requiredElement('#credits'), storageKey: `${storageKey}:purchase`,
    changed: () => {
      renderAuth();
      void round?.refresh();
      if (resumeAfterPurchase && credits?.record?.purchase.id !== purchaseIdBeforePlay
        && (credits?.record?.credited || credits?.record?.purchase.creditedAt)
        && (credits.balance?.available ?? 0) >= 1) {
        resumeAfterPurchase = false;
        playStatus.textContent = 'Credits received. Review and approve one credit to start your server-verified play.';
        void round?.prepareRound(1);
      }
    },
  });
  const creditPanel = credits;
  round = new PaidRound({
    game, scoringGame, variant: configuration.game,
    root: requiredElement('#game'), storageKey: `${storageKey}:round`,
    getBalance: async () => {
      await creditPanel.refresh();
      return creditPanel.balance;
    },
    getAddress: () => client.auth.getSession()?.address,
    onPlayRequested: (terms: { credits: number }) => { playButton.textContent = `Play · ${terms.credits} credit`; },
    onComplete: (score: number) => {
      runResult.hidden = false;
      runResult.textContent = `Server-verified score: ${score}. Recorded by SuperRare.`;
      playStatus.textContent = 'Paid round complete.';
    },
  });
  const paidRound = round;
  practice = new Practice(requiredElement('#practice-game'), configuration.game, (result) => {
    runResult.hidden = false;
    runResult.textContent = `Practice score: ${result}. Local only; not recorded or ranked.`;
    playStatus.textContent = 'Practice complete.';
  });
  playButton.addEventListener('click', async () => {
    if (busy) return;
    practice.stop();
    runResult.hidden = true;
    busy = true;
    playStatus.textContent = 'Preparing a server-verified play…';
    renderAuth();
    let needsConsent = false;
    try {
      if (!authenticated) {
        needsConsent = true;
        const result = await client.auth.login();
        authenticated = result.status === 'authenticated';
        if (!authenticated) {
          playStatus.textContent = `Sign-in ${result.status}. Nothing was purchased or started.`;
          return;
        }
      }
      let authorization = game.getAuthorization();
      if (authorization?.address.toLowerCase() !== client.auth.getSession()?.address.toLowerCase()) {
        authorization = await game.connect();
      }
      if (!authorization?.address || authorization.address.toLowerCase() !== client.auth.getSession()?.address.toLowerCase()) {
        throw new Error('The game authorization belongs to another wallet.');
      }
      await creditPanel.refresh();
      if (!creditPanel.balance) throw new Error('Could not load your authorized credit balance.');
      if (creditPanel.balance.available < 1) {
        purchaseIdBeforePlay = creditPanel.record?.purchase.id;
        resumeAfterPurchase = true;
        playStatus.textContent = 'Buy credits in the Wallet menu. Once confirmed, Play will ask you to approve the one-credit game start.';
        walletDialog.showModal();
        return;
      }
      await paidRound.refresh();
      if (paidRound.state && !['completed', 'terminal'].includes(paidRound.state.phase)) {
        await paidRound.recover();
      } else {
        if (needsConsent) playStatus.textContent = 'Review and approve the one-credit play in SuperRare Connect.';
        await paidRound.prepareRound(1);
      }
    } catch (error) {
      if (error instanceof ConnectEmbedUnavailableError) {
        try { localStorage.setItem('studio-games:connect-display', 'popup'); } catch { /* explicit fallback remains available through config */ }
        embedUnavailable = true;
        connectStatus.textContent = 'Embedded Connect is unavailable. Close this dialog and press Play again to use a popup.';
        if (connectModal.open) connectModal.close();
      } else {
        playStatus.textContent = `Could not prepare play (${describeSdkFailure(error)}). Nothing new was started.`;
      }
    } finally {
      busy = false;
      renderAuth();
    }
  });
  requiredElement<HTMLButtonElement>('#practice').addEventListener('click', () => {
    if (busy) return;
    if (paidRound.state && !['completed', 'terminal'].includes(paidRound.state.phase)) {
      playStatus.textContent = 'Continue or finish your saved paid play before starting practice. Its recovery record is preserved.';
      return;
    }
    playStatus.textContent = 'Practice is local only; no credit is used and no score is submitted.';
    practice.start();
  });
  requiredElement('#practice-game').addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('button')?.textContent === 'End practice') practice.stop();
  });
  creditPanel.render();
  paidRound.render();

  async function refreshPanels(): Promise<void> {
    await creditPanel.refresh();
    await paidRound.refresh();
    renderAuth();
  }

  async function verifySession(): Promise<void> {
    const generation = ++verificationGeneration;
    const currentIdentity = client.auth.getSession()?.address.toLowerCase();
    if (identity !== undefined && currentIdentity !== identity) {
      location.reload();
      return;
    }
    if (!client.auth.getSession()) {
      authenticated = false;
      failedVerification = false;
      signInStatus.textContent = 'Sign in to SuperRare. No payment or play starts automatically.';
      renderAuth();
      await refreshPanels();
      return;
    }
    busy = true;
    renderAuth();
    signInStatus.textContent = 'Verifying the saved Connect session…';
    try {
      const remote = await client.auth.getRemoteSession();
      if (generation !== verificationGeneration) return;
      authenticated = remote.authenticated;
      failedVerification = !remote.authenticated;
      signInStatus.textContent = remote.authenticated
        ? `Signed in as ${client.auth.getSession()?.address}.`
        : 'The saved session is no longer authenticated. Sign out, then sign in again; saved purchases and rounds are preserved.';
      await refreshPanels();
    } catch (error) {
      if (generation !== verificationGeneration) return;
      authenticated = false;
      failedVerification = true;
      signInStatus.textContent = `Session verification failed (${describeSdkFailure(error)}). Credentials and saved recovery records were preserved.`;
    } finally {
      if (generation === verificationGeneration) {
        busy = false;
        renderAuth();
      }
    }
  }

  const unsubscribe = client.auth.onChange((session) => {
    const nextIdentity = session?.address.toLowerCase();
    if (identity !== undefined && identity !== nextIdentity) {
      // Discard in-memory game state on wallet replacement, not saved
      // credentials or any wallet's purchase/run recovery records.
      location.reload();
      return;
    }
    identity = nextIdentity;
    authenticated = Boolean(session && Date.parse(session.expiresAt) > Date.now());
    renderAuth();
    void refreshPanels();
  });

  signInButton.addEventListener('click', async () => {
    if (busy) return;
    if (failedVerification && client.auth.getSession()) { await verifySession(); return; }
    busy = true;
    renderAuth();
    signInStatus.textContent = display === 'embed' ? 'SuperRare Connect sign-in is opening in this page.' : 'Opening SuperRare Connect sign-in in a popup…';
    try {
      const result = await client.auth.login();
      authenticated = result.status === 'authenticated';
      failedVerification = false;
      signInStatus.textContent = authenticated ? 'Signed in. No purchase or paid play was started.'
        : `Sign-in ${result.status}. No purchase or play was started.`;
      await refreshPanels();
    } catch (error) {
      if (error instanceof ConnectEmbedUnavailableError) {
        try { localStorage.setItem('studio-games:connect-display', 'popup'); } catch { /* reload fallback remains visible */ }
        embedUnavailable = true;
        connectStatus.textContent = 'Embedded Connect is unavailable. Reload this page, then press Sign in or Play to use a popup.';
        if (connectModal.open) connectModal.close();
        else window.setTimeout(() => location.reload(), 1200);
      }
      signInStatus.textContent = `Sign-in failed (${describeSdkFailure(error)}). Retry when ready; recovery records are preserved.`;
    } finally { busy = false; renderAuth(); }
  });
  authorizeButton.addEventListener('click', async () => {
    if (busy || !authenticated) return;
    authorizationMessage = undefined;
    busy = true;
    renderAuth();
    try {
      const authorization = await game.connect();
      if (authorization.address.toLowerCase() !== client.auth.getSession()?.address.toLowerCase()) {
        throw new Error('Game authorization does not belong to the signed-in wallet. Sign out and reconnect.');
      }
      await refreshPanels();
    } catch (error) {
      authorizationMessage = `Game authorization failed (${describeSdkFailure(error)}). No purchase or play was started.`;
    } finally { busy = false; renderAuth(); }
  });
  signOutButton.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    renderAuth();
    try { await client.auth.logout(); }
    catch (error) { signInStatus.textContent = `Sign-out failed (${describeSdkFailure(error)}). Saved records remain intact.`; }
    finally { busy = false; renderAuth(); }
  });
  window.addEventListener('storage', () => { void verifySession(); });
  window.addEventListener('pagehide', () => {
    unsubscribe();
    window.clearTimeout(expiryTimer);
    paidRound.disconnectRun();
  }, { once: true });
  await verifySession();
}

void main().catch((error: unknown) => {
  signInButton.disabled = true;
  authorizeButton.disabled = true;
  signInStatus.textContent = 'Valid organizer configuration is required before signing in.';
  authorizationStatus.textContent = describeSdkFailure(error);
});
