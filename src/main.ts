import { ConnectEmbedUnavailableError, createSuperRareClient } from '@rareprotocol/connect';
import { accountStorage } from './account-storage.js';
import { parseConfiguration } from './config.js';
import { Credits } from './credits.js';
import { describeSdkFailure } from './hosted-flow.js';
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
const connectDialog = requiredElement<HTMLDialogElement>('#connect-modal');
const connectFrameHost = requiredElement('#connect-embed');
const closeConnectButton = requiredElement<HTMLButtonElement>('#close-connect');

async function main(): Promise<void> {
  const response = await fetch('/config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load /config.json: HTTP ${response.status}`);
  const raw: unknown = await response.json();
  const configuration = parseConfiguration(raw, location.origin);
  const name = configuration.game === 'color-match' ? 'Color Match' : 'Target Rush';
  document.title = `${name} · Studio credits`;
  requiredElement('h1').textContent = name;
  requiredElement('.lede').textContent = configuration.game === 'color-match'
    ? 'Choose the color named by the server. Correct matches score; wrong choices do not. Each ten-second round costs one Studio credit.'
    : 'Hit as many moving targets as you can in ten seconds. Each new round costs one Studio credit.';
  requiredElement('#configuration').textContent = `App ${configuration.appId} · shared credit group ${configuration.groupId} · ${configuration.studioUrl} · published Connect 0.9.0-beta.0 · embedded`;
  if (configuration.siblingUrl) {
    const sibling = requiredElement<HTMLAnchorElement>('#sibling-game');
    sibling.href = configuration.siblingUrl;
    sibling.textContent = configuration.game === 'color-match' ? 'Play Target Rush →' : 'Play Color Match →';
    sibling.hidden = false;
  }

  let credits: Credits | undefined;
  let readAddress: () => string | undefined = () => undefined;
  function dismissConnect(frame: Element | null = connectFrameHost.firstElementChild): void {
    if (frame === null || frame.parentElement !== connectFrameHost) return;
    frame.remove();
    if (connectDialog.open) connectDialog.close();
  }
  const client = createSuperRareClient({
    studioUrl: configuration.studioUrl,
    apiUrl: configuration.apiUrl,
    connectUrl: configuration.connectUrl,
    embed: {
      open() {
        if (connectDialog.open) return null;
        requiredElement('#connect-modal-status').textContent = '';
        const frame = document.createElement('iframe');
        frame.title = 'SuperRare Connect';
        frame.allow = 'payment';
        connectFrameHost.replaceChildren(frame);
        try {
          connectDialog.showModal();
        } catch {
          frame.remove();
          return null;
        }
        const messageSource = frame.contentWindow;
        if (messageSource === null) {
          frame.remove();
          connectDialog.close();
          return null;
        }
        return {
          messageSource,
          get closed() { return !frame.isConnected; },
          close() { dismissConnect(frame); },
          location: { replace(nextUrl: string) { frame.src = nextUrl; } },
        };
      },
      onUnavailable: (error) => {
        const message = `Embedded Connect is unavailable (${error.code}). This browser must permit embedded storage. Close this window to return; saved purchase and play recovery records are preserved. No popup was opened.`;
        requiredElement('#connect-modal-status').textContent = message;
        signInStatus.textContent = message;
      },
    },
    sessionStorage: accountStorage(localStorage, () => readAddress()),
    onIntentSettled: (intent) => credits?.onIntentSettled(intent),
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
      ? `Game authorized for ${authorization?.address}. Purchases and plays still require your explicit approval.`
      : 'Authorize this game to load credits. Signing in never buys credits or starts a paid play.');
    window.clearTimeout(expiryTimer);
    const expiries = [session?.expiresAt, authorization?.expiresAt]
      .filter((value): value is string => value !== undefined)
      .map(Date.parse).filter((value) => Number.isFinite(value) && value > Date.now());
    if (expiries.length) expiryTimer = window.setTimeout(() => { void verifySession(); }, Math.min(Math.min(...expiries) - Date.now(), 2_147_483_647));
  }

  credits = new Credits({
    client, game, root: requiredElement('#credits'), storageKey: `${storageKey}:purchase`,
    changed: () => { renderAuth(); void round?.refresh(); },
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
  });
  const paidRound = round;
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
    let loginFrame: Element | null = null;
    signInStatus.textContent = 'Opening embedded SuperRare Connect sign-in…';
    try {
      const login = client.auth.login();
      loginFrame = connectFrameHost.firstElementChild;
      const result = await login;
      authenticated = result.status === 'authenticated';
      failedVerification = false;
      signInStatus.textContent = authenticated ? 'Signed in. Authorize this game when ready.'
        : `Sign-in ${result.status}. No purchase or play was started.`;
      await refreshPanels();
    } catch (error) {
      signInStatus.textContent = error instanceof ConnectEmbedUnavailableError
        ? 'Embedded sign-in is unavailable. Use a browser that permits embedded storage; no popup, purchase or play was started.'
        : `Sign-in failed (${describeSdkFailure(error)}). Retry when ready; recovery records are preserved.`;
    } finally {
      dismissConnect(loginFrame);
      busy = false;
      renderAuth();
    }
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
  closeConnectButton.addEventListener('click', () => dismissConnect());
  connectDialog.addEventListener('close', () => connectFrameHost.replaceChildren());
  connectDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dismissConnect();
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
