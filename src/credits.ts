// Adapted from @rareprotocol/connect examples/target-game (MIT, Copyright 2026 SuperRare).
import type {
  ConnectIntentCreation, SuperRareGameClient, SuperRareConnectClient,
  GameCreditPurchase, GameCreditBalance, ConnectIntent,
} from '@rareprotocol/connect';
import { describeSdkFailure } from './hosted-flow.js';
import { z } from 'zod';
const purchaseRecordSchema = z.object({
  purchase: z.object({
    id: z.string(),
    accountId: z.string(),
    paymentConfigId: z.string(),
    chainId: z.number(),
    address: z.string(),
    treasuryAddress: z.string(),
    usdcAddress: z.string(),
    packPriceAtomic: z.string(),
    packCredits: z.number(),
    minBlock: z.string(),
    createdAt: z.string(),
    expiresAt: z.string(),
    transactionHash: z.string().nullable(),
    creditedAt: z.string().nullable(),
  }).passthrough(),
  confirmPayment: z.boolean().optional(),
  outcomeUnknown: z.boolean().optional(),
  intentId: z.string().optional(),
  intentStatus: z.string().optional(),
  transactionHash: z.string().optional(),
  credited: z.boolean().optional(),
}).passthrough();
const archivedPurchasesSchema = z.array(z.object({
  record: purchaseRecordSchema,
  archivedAt: z.string(),
}));
const MAINNET_USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const STORAGE_VERSION = 'v1';
type PurchaseRecord = {
  purchase: GameCreditPurchase;
  confirmPayment?: boolean;
  outcomeUnknown?: boolean;
  intentId?: string;
  intentStatus?: string;
  transactionHash?: string;
  credited?: boolean;
};
type CreditConfiguration = {
  client: SuperRareConnectClient;
  game: SuperRareGameClient;
  root: HTMLElement;
  storageKey: string;
  changed?: () => void;
};
type ActionButton = (label: string, action: () => void | Promise<void>, className?: string) => HTMLButtonElement;

function text(element: HTMLElement, value: string): void {
  element.textContent = value;
}

function formatPrice(atomic: string): string {
  if (!/^\d+$/.test(String(atomic))) return 'an amount shown by the wallet';
  const value = BigInt(atomic);
  const whole = value / 1_000_000n;
  const fraction = String(value % 1_000_000n).padStart(6, '0').replace(/0+$/, '');
  return `$${whole}${fraction ? `.${fraction}` : ''} USDC`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

export class Credits {
  client: SuperRareConnectClient;
  game: SuperRareGameClient;
  root: HTMLElement;
  storageKey: string;
  changed: () => void;
  balance?: GameCreditBalance;
  record?: PurchaseRecord;
  accountAddress?: string;
  claimPromises = new Map<string, Promise<void>>();
  rendered = false;
  busy = false;
  recoveryBlocked = false;
  balanceLabel!: HTMLParagraphElement;
  statusLabel!: HTMLParagraphElement;
  actions!: HTMLDivElement;
  technical!: HTMLDetailsElement;
  detailsText!: HTMLParagraphElement;
  recoveryActions!: HTMLDivElement;

  constructor({ client, game, root, storageKey, changed }: CreditConfiguration) {
    this.client = client;
    this.game = game;
    this.root = root;
    this.storageKey = storageKey;
    this.changed = changed ?? (() => {});
  }

  render(): this {
    if (this.rendered) return this;
    this.rendered = true;
    this.root.replaceChildren();

    this.balanceLabel = document.createElement('p');
    this.balanceLabel.setAttribute('aria-live', 'polite');
    text(this.balanceLabel, 'Credits: not loaded');
    this.root.append(this.balanceLabel);

    this.statusLabel = document.createElement('p');
    this.statusLabel.setAttribute('role', 'status');
    this.statusLabel.setAttribute('aria-live', 'polite');
    this.root.append(this.statusLabel);

    this.actions = document.createElement('div');
    this.actions.className = 'credit-actions';
    this.root.append(this.actions);

    this.technical = document.createElement('details');
    const summary = document.createElement('summary');
    text(summary, 'Advanced purchase recovery');
    this.technical.append(summary);
    this.detailsText = document.createElement('p');
    this.detailsText.className = 'technical-details';
    this.technical.append(this.detailsText);
    this.recoveryActions = document.createElement('div');
    this.recoveryActions.className = 'credit-actions';
    this.technical.append(this.recoveryActions);
    this.root.append(this.technical);
    this.technical.addEventListener('toggle', () => {
      if (this.technical.open) void this.refresh();
    });
    void this.refresh();
    return this;
  }

  _authorization(): { address: string } | undefined {
    const authorization = this.game.getAuthorization();
    if (!authorization?.address || authorization.address.toLowerCase() !== this.client.auth.getSession()?.address.toLowerCase()) return undefined;
    return { address: authorization.address.toLowerCase() };
  }

  _stateKey(address: string | undefined): string {
    return `${this.storageKey}:${STORAGE_VERSION}:${address}`;
  }

  _loadRecord(address: string): PurchaseRecord | undefined {
    try {
      const serialized = localStorage.getItem(this._stateKey(address));
      const record = serialized === null ? undefined : purchaseRecordSchema.parse(JSON.parse(serialized));
      this.recoveryBlocked = false;
      return record;
    } catch {
      this.recoveryBlocked = true;
      return undefined;
    }
  }

  _saveRecord(record: PurchaseRecord): void {
    // Preserve evidence under its original wallet, even if auth changes in flight.
    const owner = record.purchase.address.toLowerCase();
    localStorage.setItem(this._stateKey(owner), JSON.stringify(record));
    this._assertAccount(owner);
    this.record = record;
    this._showDetails();
  }

  _assertAccount(address: string): void {
    if (this._authorization()?.address !== address || this.accountAddress !== address) {
      throw new Error('Wallet changed. The original purchase remains saved under its owning wallet.');
    }
  }

  _showDetails(): void {
    this.recoveryActions.replaceChildren();
    this._showArchivedPurchases();
    if (!this.record) {
      text(this.detailsText, this.accountAddress
        ? 'No purchase is in progress for this game account.'
        : 'Saved purchases remain isolated per game account. Reauthorize the same account to resume or reconcile them.');
      return;
    }
    const purchase = this.record.purchase;
    text(this.detailsText, [
      `Purchase ID: ${purchase.id}`,
      `Quote expires: ${purchase.expiresAt}`,
      this.record.intentId ? `Connect intent: ${this.record.intentId}` : '',
      this.record.transactionHash ? `Transaction: ${this.record.transactionHash}` : '',
      this.record.outcomeUnknown && !this.record.intentId
        ? 'Payment outcome is unknown; starting over will not cancel any wallet transaction.'
        : '',
    ].filter(Boolean).join('\n'));
    if (!this.record.transactionHash && !this.record.credited && !this.record.purchase.creditedAt) {
      this._addButton(this.recoveryActions, 'Claim with existing transaction hash…', () => this._enterTransaction());
    }
  }

  _showArchivedPurchases(): void {
    if (!this.accountAddress) return;
    try {
      const serialized = localStorage.getItem(`${this._stateKey(this.accountAddress)}:history`);
      if (serialized === null) return;
      const history = archivedPurchasesSchema.parse(JSON.parse(serialized));
      history.forEach(({ record }, index) => {
        this._addButton(
          this.recoveryActions,
          `Resume saved purchase ${index + 1} · ${record.purchase.packCredits} credits`,
          () => this._restoreArchivedPurchase(index),
        );
      });
    } catch {
      this._say('Saved advanced recovery records could not be read; the current purchase is unchanged.');
    }
  }

  _restoreArchivedPurchase(index: number): void {
    if (this.recoveryBlocked || !this.accountAddress || this.busy) return;
    const historyKey = `${this._stateKey(this.accountAddress)}:history`;
    try {
      const serialized = localStorage.getItem(historyKey);
      if (serialized === null) return;
      const history = archivedPurchasesSchema.parse(JSON.parse(serialized));
      const selected = history[index];
      if (!selected) return;
      const current = this.record;
      const remaining = history.filter((_, historyIndex) => historyIndex !== index);
      localStorage.setItem(historyKey, JSON.stringify([
        ...remaining,
        ...(current ? [{ record: current, archivedAt: new Date().toISOString() }] : []),
      ]));
      this._saveRecord(selected.record);
      this._say('Saved purchase restored. Continue it to reconcile, or use advanced recovery to claim with a transaction hash.');
      this._renderActions();
    } catch (error) {
      this._say(`Could not restore the saved purchase: ${errorMessage(error)}`);
    }
  }

  _say(message: string): void {
    text(this.statusLabel, message);
  }

  _addButton(actions: HTMLElement, label: string, action: () => void | Promise<void>, className = ''): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    text(button, label);
    button.disabled = this.busy;
    button.addEventListener('click', () => void action());
    actions.append(button);
    return button;
  }

  _renderActions(): void {
    this._showDetails();
    this.actions.replaceChildren();
    const addButton: ActionButton = (label, action, className = '') => this._addButton(this.actions, label, action, className);

    if (this.recoveryBlocked) {
      this.recoveryActions.replaceChildren();
      this._say('Saved purchase recovery could not be read. Purchases are blocked to avoid a duplicate payment. Restore browser storage and retry; do not clear existing records.');
      addButton('Retry saved purchase recovery', () => this.refresh());
      return;
    }
    if (!this.accountAddress) return;
    const record = this.record;
    if (record?.credited || record?.purchase?.creditedAt) {
      addButton('Buy more credits', () => this._createQuote(), 'primary');
      return;
    }
    if (!record) {
      addButton('Buy credits', () => this._createQuote(), 'primary');
      return;
    }

    if (record.transactionHash) {
      addButton('Continue purchase', () => this._continuePurchase(), 'primary');
      return;
    }

    if (record.intentId || record.outcomeUnknown) {
      addButton('Continue purchase', () => this._continuePurchase(), 'primary');
      addButton('Start over with a fresh quote', () => this._startOver());
      return;
    }

    if (record.confirmPayment) {
      addButton(`Confirm ${record.purchase.packCredits} credits · ${formatPrice(record.purchase.packPriceAtomic)}`, () => this._pay(), 'primary');
      addButton('Cancel quote', () => this._discardQuote());
      return;
    }

    addButton('Continue purchase', () => this._continuePurchase(), 'primary');
  }
  async refresh() {
    if (!this.rendered) return;
    const authorization = this._authorization();
    if (!authorization) {
      this.accountAddress = undefined;
      this.balance = undefined;
      text(this.balanceLabel, 'Credits: connect your game account to load balance.');
      this.record = undefined;
      this._showDetails();
      this._renderActions();
      return;
    }

    this.accountAddress = authorization.address;
    this.record = this._loadRecord(this.accountAddress);
    this._showDetails();
    this._renderActions();
    try {
      const balance = await this.game.credits.getBalance();
      const currentAuthorization = this._authorization();
      if (currentAuthorization?.address !== authorization.address) {
        this.balance = undefined;
        text(this.balanceLabel, currentAuthorization
          ? 'Credits: loading current game account…'
          : 'Credits: connect your game account to load balance.');
        this.accountAddress = currentAuthorization?.address;
        this.record = currentAuthorization ? this._loadRecord(currentAuthorization.address) : undefined;
        this._say(currentAuthorization
          ? 'Game account changed while loading. Showing only the newly authorized account; saved purchases remain isolated per account.'
          : 'Game authorization expired while loading. Saved purchase records remain preserved per account; authorize the game again to resume.');
        this._showDetails();
        this._renderActions();
        this.changed();
        if (currentAuthorization) void this.refresh();
        return;
      }
      this.balance = balance;
      text(this.balanceLabel, `Credits: ${balance.available} available · ${balance.balance} total · ${balance.reserved} reserved`);
      if (this.record) {
        if (this.record.transactionHash && !this.record.credited && !this.record.intentId) {
          await this._claim(this.record.transactionHash);
        }
      }
      this._renderActions();
    } catch (error) {
      const currentAuthorization = this._authorization();
      this.balance = undefined;
      text(this.balanceLabel, currentAuthorization
        ? 'Credits: balance could not be loaded.'
        : 'Credits: connect your game account to load balance.');
      if (currentAuthorization?.address !== authorization.address) {
        this.accountAddress = currentAuthorization?.address;
        this.record = currentAuthorization ? this._loadRecord(currentAuthorization.address) : undefined;
        this._say(currentAuthorization
          ? 'Game account changed while loading. Showing only the newly authorized account; saved purchases remain isolated per account.'
          : `Could not load credit balance (${describeSdkFailure(error)}); game authorization is no longer available. Saved purchase records remain preserved per account.`);
        this._showDetails();
        this._renderActions();
        this.changed();
        if (currentAuthorization) void this.refresh();
        return;
      }
      this._say(`Could not load credit balance (${describeSdkFailure(error)}). The current authorization is preserved; retry the balance request.`);
    }
  }

  async _createQuote() {
    if (this.recoveryBlocked || this.busy || !this._authorization()) return;
    this.busy = true;
    this._renderActions();
    this._say('Loading a purchase quote…');
    try {
      const quote = await this.game.credits.createPurchase();
      const authorization = this._authorization();
      if (!authorization) throw new Error('Connect a game wallet before buying credits.');
      if (quote.chainId !== 1) throw new Error('This example only accepts Ethereum mainnet credit quotes.');
      if (quote.packPriceAtomic !== '10000' || quote.packCredits !== 10) {
        throw new Error('This example requires $0.01 USDC for 10 credits. Ask the organizer to correct the payment configuration.');
      }
      if (quote.usdcAddress.toLowerCase() !== MAINNET_USDC) {
        throw new Error('The credit quote does not use the configured Ethereum mainnet USDC contract. No payment was started.');
      }
      if (quote.address.toLowerCase() !== authorization.address) {
        throw new Error('This quote belongs to a different wallet. Refresh your game connection and try again.');
      }
      this.accountAddress = authorization.address;
      const record = { purchase: quote, confirmPayment: true, outcomeUnknown: false };
      this._saveRecord(record);
      this._say(`Review the quote, then explicitly confirm ${quote.packCredits} credits for ${formatPrice(quote.packPriceAtomic)}.`);
    } catch (error) {
      this._say(`Could not create a safe purchase quote: ${errorMessage(error)} You can try again.`);
    } finally {
      this.busy = false;
      this._renderActions();
    }
  }

  _startOver(): void {
    const record = this.record;
    if (this.recoveryBlocked || !record || record.transactionHash || !this.accountAddress) return;
    if (!window.confirm(
      'Start over and request a fresh quote? This will not cancel any wallet transaction already submitted. Keep the old transaction details if payment may have completed.',
    )) return;
    try {
      const historyKey = `${this._stateKey(this.accountAddress)}:history`;
      const serializedHistory = localStorage.getItem(historyKey);
      const history = serializedHistory === null ? [] : archivedPurchasesSchema.parse(JSON.parse(serializedHistory));
      localStorage.setItem(historyKey, JSON.stringify([...history, { record, archivedAt: new Date().toISOString() }]));
      localStorage.removeItem(this._stateKey(this.accountAddress));
      this.record = undefined;
      this._showDetails();
      this._say('Previous purchase saved in advanced recovery. Fresh quote requested; no new payment was submitted.');
      void this._createQuote();
    } catch (error) {
      this._say(`Could not preserve the previous purchase, so it was not replaced: ${errorMessage(error)}`);
    }
    this._renderActions();
  }

  _discardQuote(): void {
    if (this.recoveryBlocked || !this.record?.confirmPayment || !this.accountAddress) return;
    try {
      localStorage.removeItem(this._stateKey(this.accountAddress));
      this.record = undefined;
      this._showDetails();
      this._say('Quote cancelled. No payment was requested.');
    } catch (error) {
      this._say(`Could not cancel this quote: ${errorMessage(error)}`);
    }
    this._renderActions();
  }

  async _pay() {
    const authorization = this._authorization();
    const record = this.record;
    if (this.recoveryBlocked || this.busy || !authorization || !record?.confirmPayment || authorization.address !== this.accountAddress) return;
    const quote = record.purchase;
    if (Date.parse(quote.expiresAt) <= Date.now()) {
      this._say('This quote expired before payment. Cancel it and request a fresh quote; no transfer was started.');
      return;
    }
    if (quote.chainId !== 1 || quote.packPriceAtomic !== '10000' || quote.packCredits !== 10 || quote.usdcAddress.toLowerCase() !== MAINNET_USDC || quote.address.toLowerCase() !== authorization.address) {
      this._say('This quote no longer matches the connected mainnet wallet. No payment was started.');
      return;
    }
    this.busy = true;
    this._renderActions();
    try {
      // Keep the exact quote and an ambiguous-outcome marker durable before the SDK opens hosted checkout.
      const pending = { ...record, confirmPayment: false, outcomeUnknown: true };
      this._saveRecord(pending);
      this._say('Opening embedded hosted wallet checkout. No transfer is submitted until the hosted wallet asks for explicit approval.');
      const intent = await this.client.actions.transfer({
        chainId: 1,
        to: quote.treasuryAddress,
        currency: 'USDC',
        amount: quote.packPriceAtomic,
        beforeOpen: (intent: ConnectIntentCreation) => this._saveRecord({
          ...pending,
          intentId: intent.intentId,
          outcomeUnknown: false,
        }),
      });
      const withIntent = { ...pending, intentId: intent.intentId, outcomeUnknown: false };
      this._saveRecord(withIntent);
      this._say('Payment request opened. Continue purchase to check its status; a grant is claimed only after a transaction hash is known.');
    } catch (error) {
      this._say(`The payment result is not confirmed (${errorMessage(error)}). Do not start another transfer. Continue purchase to check again, or enter the transaction hash if your wallet completed it.`);
    } finally {
      this.busy = false;
      this._renderActions();
    }
  }

  async _continuePurchase() {
    if (this.recoveryBlocked || this.busy || !this.record) return;
    const authorization = this._authorization();
    if (!authorization) return;
    if (authorization.address !== this.accountAddress) {
      this._say('This purchase belongs to another wallet. Reconnect that wallet to continue; its record is kept separately.');
      return;
    }
    this.busy = true;
    this._renderActions();
    try {
      await this._reconcilePurchase();
      this._assertAccount(authorization.address);
      if (this.record?.intentId) {
        const intent = await this.client.actions.getStatus({ intentId: this.record.intentId });
        this._assertAccount(authorization.address);
        const hash = intent.result?.transactionHash ?? intent.result?.approvalTxHash;
        this._saveRecord({
          ...this.record,
          ...(hash ? { transactionHash: hash } : {}),
          intentStatus: intent.status,
          outcomeUnknown: false,
        });
        if (intent.status === 'completed' && hash) {
          await this._claim(hash);
        } else if (['failed', 'cancelled', 'expired'].includes(intent.status)) {
          this._say(`Payment ${intent.status}; no completed transfer was confirmed. You may start over with a fresh quote, or keep this purchase to reconcile later.`);
        } else if (intent.status === 'completed') {
          this._say('Connect completed the action but returned no transaction hash. You may start over with a fresh quote; the existing purchase stays available in advanced recovery.');
        } else {
          this._say(`Payment is ${intent.status}. You may start over with a fresh quote, or keep this purchase to continue later.`);
        }
      } else if (this.record?.transactionHash) {
        await this._claim(this.record.transactionHash);
      } else {
        this._say('The payment outcome is unknown and no intent ID was saved. Start over with a fresh quote if you do not want to wait. If payment completed, resume this saved purchase and claim it with the transaction hash under advanced recovery.');
      }
    } catch (error) {
      this._say(`Purchase status could not be confirmed: ${errorMessage(error)} The same purchase is saved; retry Continue purchase.`);
    } finally {
      this.busy = false;
      this._renderActions();
    }
  }

  async _reconcilePurchase() {
    if (!this.record) return;
    const saved = this.record;
    try {
      const purchase = await this.game.credits.getPurchase(saved.purchase.id);
      if (purchase.address.toLowerCase() !== this.accountAddress) {
        this._say('The saved purchase belongs to another wallet. Reconnect that wallet to continue.');
        return;
      }
      const latest = this._loadRecord(saved.purchase.address.toLowerCase()) ?? saved;
      const transactionHash = purchase.transactionHash || latest.transactionHash;
      this._saveRecord({ ...latest, purchase, transactionHash: transactionHash || undefined, credited: Boolean(purchase.creditedAt), outcomeUnknown: transactionHash ? false : latest.outcomeUnknown });
      if (purchase.creditedAt) {
        this._say('Credits received. Balance refreshed.');
        this.balance = await this.game.credits.getBalance();
        this._assertAccount(saved.purchase.address.toLowerCase());
        text(this.balanceLabel, `Credits: ${this.balance.available} available · ${this.balance.balance} total · ${this.balance.reserved} reserved`);
        this._saveRecord({ ...latest, purchase, credited: true });
        this.changed();
      }
    } catch (error) {
      // Keep local transfer evidence; absence of a server response is not proof of failure.
      if (saved.transactionHash) throw error;
    }
  }

  _claim(transactionHash: string): Promise<void> {
    if (!this.record) return Promise.resolve();
    const key = `${this.record.purchase.id}:${transactionHash.toLowerCase()}`;
    const existing = this.claimPromises.get(key);
    if (existing) return existing;
    const pending = this._claimOnce(transactionHash).finally(() => this.claimPromises.delete(key));
    this.claimPromises.set(key, pending);
    return pending;
  }

  async _claimOnce(transactionHash: string): Promise<void> {
    const record = this.record;
    if (!record) return;
    let intentStatus = record.intentStatus;
    let claimHash = record.transactionHash || transactionHash;
    try {
      if (record.intentId) {
        const intent = await this.client.actions.getStatus({ intentId: record.intentId });
        const completedHash = intent.result?.transactionHash ?? intent.result?.approvalTxHash;
        if (intent.status !== 'completed') {
          this._saveRecord({
            ...record,
            transactionHash: claimHash,
            intentStatus: intent.status,
          });
          this._say(`Transaction hash saved. The hosted transfer is ${intent.status}, not completed; continue this purchase to reconcile its status before claiming credits.`);
          return;
        }
        if (!completedHash || !/^0x[0-9a-fA-F]{64}$/.test(completedHash)) {
          throw new Error('Connect reported completion without a valid transaction hash.');
        }
        if (record.transactionHash
          && record.transactionHash.toLowerCase() !== completedHash.toLowerCase()) {
          throw new Error('Connect reported a different transaction hash; the saved purchase hash was not replaced.');
        }
        claimHash = completedHash;
        intentStatus = intent.status;
      }
      this._saveRecord({
        ...record,
        transactionHash: claimHash,
        ...(intentStatus ? { intentStatus } : {}),
        outcomeUnknown: false,
      });
      const result = await this.game.credits.claimPurchase({ purchaseId: record.purchase.id, transactionHash: claimHash });
      const latest = this._loadRecord(record.purchase.address.toLowerCase()) ?? record;
      this._saveRecord({ ...latest, purchase: result.purchase, credited: Boolean(result.purchase.creditedAt), transactionHash: claimHash });
      this.balance = result.balance;
      text(this.balanceLabel, `Credits: ${result.balance.available} available · ${result.balance.balance} total · ${result.balance.reserved} reserved`);
      this._say(result.purchase.creditedAt ? 'Credits received. You can continue playing.' : 'Transaction recorded; credit confirmation is pending. Continue purchase later to check again.');
      this.changed();
    } catch (error) {
      this._say(`Transaction is saved, but claiming could not be confirmed: ${errorMessage(error)} Continue purchase retries the same transaction safely.`);
    }
    this._renderActions();
  }

  onIntentSettled(intent: ConnectIntent): void {
    const record = this.record;
    if (!record?.intentId || intent?.intentId !== record.intentId
      || this._authorization()?.address !== this.accountAddress) return;
    const transactionHash = intent.result?.transactionHash ?? intent.result?.approvalTxHash;
    const validHash = transactionHash && /^0x[0-9a-fA-F]{64}$/.test(transactionHash)
      ? transactionHash
      : undefined;
    const definitivelyFailed = ['failed', 'cancelled', 'expired'].includes(intent.status);
    const saved = {
      ...record,
      ...(validHash ? { transactionHash: validHash } : {}),
      intentStatus: intent.status,
      outcomeUnknown: definitivelyFailed ? false : record.outcomeUnknown,
    };
    this._saveRecord(saved);
    if (intent.status === 'completed' && validHash) {
      void this._claim(validHash);
      return;
    }
    this._say(definitivelyFailed
      ? `Payment ${intent.status}; no completed transfer was confirmed. Check your wallet and keep this purchase before requesting anything new.`
      : intent.status === 'completed'
        ? 'Connect completed the action but returned no valid transaction hash. The purchase remains saved; do not start another transfer.'
        : `Payment status is ${intent.status}. Continue this same purchase later; do not request another transfer.`);
    this._renderActions();
  }

  async _enterTransaction() {
    const authorization = this._authorization();
    if (this.recoveryBlocked || !this.record || authorization?.address !== this.accountAddress) return;
    const hash = window.prompt('Enter the Ethereum transaction hash for this saved purchase. Do not enter a different transaction.');
    if (hash === null) return;
    const normalized = hash.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
      this._say('That does not look like a transaction hash. The saved purchase was not changed.');
      return;
    }
    if (this.record.transactionHash && this.record.transactionHash.toLowerCase() !== normalized.toLowerCase()) {
      this._say('A transaction hash is already saved for this purchase. It cannot be replaced here.');
      return;
    }
    this.busy = true;
    this._renderActions();
    try {
      this._saveRecord({ ...this.record, transactionHash: normalized, outcomeUnknown: false });
      await this._claim(normalized);
    } finally {
      this.busy = false;
      this._renderActions();
    }
  }
}
