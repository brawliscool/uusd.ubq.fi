import type { Address } from "viem";
import { LUSD_COLLATERAL } from "../contracts/constants.ts";
import { MIN_VISIBLE_TOKEN_USD_VALUE } from "../constants/inventory-constants.ts";
import { INVENTORY_TOKENS, type TokenBalance } from "../types/inventory.types.ts";
import { areAddressesEqual } from "../utils/format-utils.ts";
import { isBalanceZero } from "../utils/token-utils.ts";
import { SimplifiedExchangeComponent } from "./simplified-exchange-component.ts";

type SelectedToken = { address: Address; symbol: string; decimals: number };
type ExchangeInternals = {
  _state: { direction: string; amount: string; routeResult: unknown; isCalculating: boolean };
  _services: { notificationManager: { showSuccess: (scope: string, message: string) => void }; inventoryBar: unknown };
  _transactionStateService: { completeTransaction: (buttonId: string, text: string) => void };
  _renderOutput: () => void;
  _getSelectedToken: () => SelectedToken | null;
};

const proto = SimplifiedExchangeComponent.prototype as unknown as Record<string, unknown>;
const originalCalculateRoute = proto._calculateRoute as (this: ExchangeInternals) => Promise<void>;
const originalRenderOptions = proto._renderOptions as (this: ExchangeInternals) => void;
const originalUpdateActionButton = proto._updateActionButton as (this: ExchangeInternals) => Promise<void>;
const originalPopulateMaxBalance = proto._populateMaxBalance as (this: ExchangeInternals, force: boolean) => boolean;

proto._getSelectedToken = function getSelectedToken(): SelectedToken | null {
  const selectEl = document.getElementById("tokenSelect") as HTMLSelectElement | null;
  const selectedOption = selectEl?.selectedOptions[0];

  if (!selectedOption?.value) {
    return null;
  }

  return {
    address: selectedOption.value as Address,
    symbol: selectedOption.getAttribute("data-symbol") || "UNKNOWN",
    decimals: Number.parseInt(selectedOption.getAttribute("data-decimals") || "18", 10),
  };
};

proto._getVisibleTokenBalances = function getVisibleTokenBalances(balances: TokenBalance[]): TokenBalance[] {
  return balances.filter((balance) => {
    if (isBalanceZero(balance.balance, balance.decimals)) {
      return false;
    }

    if (balance.usdValue === undefined || balance.usdValue === null || balance.usdValue === 0) {
      return true;
    }

    return balance.usdValue >= MIN_VISIBLE_TOKEN_USD_VALUE;
  });
};

proto._calculateRoute = async function calculateRoute(this: ExchangeInternals): Promise<void> {
  if (this._state.amount && this._state.amount !== "0" && !this._getSelectedToken()) {
    this._state.routeResult = null;
    this._state.isCalculating = false;
    this._renderOutput();
    return;
  }

  await originalCalculateRoute.call(this);
};

proto._renderOptions = function renderOptions(this: ExchangeInternals): void {
  if (this._state.direction === "deposit") {
    const selectedToken = this._getSelectedToken();
    if (!selectedToken) {
      const ubqOptionDiv = document.getElementById("ubqDiscountOption");
      const swapOnlyDiv = document.getElementById("swapOnlyOption");
      const fractionalRedemptionDiv = document.getElementById("fractionalRedemptionOption");
      if (ubqOptionDiv) ubqOptionDiv.style.display = "none";
      if (swapOnlyDiv) swapOnlyDiv.style.display = "none";
      if (fractionalRedemptionDiv) fractionalRedemptionDiv.style.display = "none";
      return;
    }
  }

  originalRenderOptions.call(this);
};

proto._updateActionButton = async function updateActionButton(this: ExchangeInternals): Promise<void> {
  if (this._state.direction === "deposit" && !this._getSelectedToken()) {
    const button = document.getElementById("exchangeButton") as HTMLButtonElement | null;
    if (button) {
      button.textContent = "Select a token";
      button.disabled = true;
    }
    return;
  }

  await originalUpdateActionButton.call(this);
};

proto._populateMaxBalance = function populateMaxBalance(this: ExchangeInternals, force: boolean): boolean {
  if (this._state.direction === "deposit" && !this._getSelectedToken()) {
    return false;
  }

  return originalPopulateMaxBalance.call(this, force);
};

proto._handleTransactionSuccess = function handleTransactionSuccess(this: ExchangeInternals): void {
  const direction = this._state.direction === "deposit" ? "Bought" : "Sold";
  const selectedToken = this._getSelectedToken();
  const tokenSymbol = this._state.direction === "deposit" ? selectedToken?.symbol ?? "token" : INVENTORY_TOKENS.UUSD.symbol;

  this._transactionStateService.completeTransaction("exchangeButton", `✅ ${direction}!`);
  this._services.notificationManager.showSuccess("exchange", `Successfully ${direction.toLowerCase()} ${this._state.amount} ${tokenSymbol}!`);

  this._state.amount = "";
  this._state.routeResult = null;
  const amountInput = document.getElementById("exchangeAmount") as HTMLInputElement | null;
  if (amountInput) amountInput.value = "";
  this._renderOutput();

  const inventoryBar = this._services.inventoryBar as { refreshBalances?: () => Promise<void> | void };
  void inventoryBar.refreshBalances?.();
};

proto._isLusdSelected = function isLusdSelected(this: ExchangeInternals): boolean {
  const selectedToken = this._getSelectedToken();
  return selectedToken ? areAddressesEqual(selectedToken.address, LUSD_COLLATERAL.address) : false;
};
