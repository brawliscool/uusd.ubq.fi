import type { Address } from "viem";
import { LUSD_COLLATERAL } from "../contracts/constants.ts";
import { MIN_VISIBLE_TOKEN_USD_VALUE } from "../constants/inventory-constants.ts";
import { INVENTORY_TOKENS, type TokenBalance } from "../types/inventory.types.ts";
import { areAddressesEqual } from "../utils/format-utils.ts";
import { isBalanceZero } from "../utils/token-utils.ts";
import tokenList from "../constants/token-list.json" with { type: "json" };
import { SimplifiedExchangeComponent } from "./simplified-exchange-component.ts";

type SelectedToken = { address: Address; symbol: string; decimals: number };
type InventoryBarLike = { getBalances?: () => TokenBalance[]; refreshBalances?: () => Promise<void> | void };
type ExchangeInternals = {
  _state: { direction: string; amount: string; routeResult: unknown; isCalculating: boolean };
  _services: { notificationManager: { showSuccess: (scope: string, message: string) => void }; inventoryBar: InventoryBarLike };
  _transactionStateService: { completeTransaction: (buttonId: string, text: string) => void };
  _renderOutput: () => void;
  _getSelectedToken: () => SelectedToken | null;
  _getVisibleTokenBalances: (balances: TokenBalance[]) => TokenBalance[];
};

const proto = SimplifiedExchangeComponent.prototype as unknown as Record<string, unknown>;
const originalCalculateRoute = proto._calculateRoute as (this: ExchangeInternals) => Promise<void>;
const originalRenderOptions = proto._renderOptions as (this: ExchangeInternals) => void;
const originalUpdateActionButton = proto._updateActionButton as (this: ExchangeInternals) => Promise<void>;
const originalPopulateMaxBalance = proto._populateMaxBalance as (this: ExchangeInternals, force: boolean) => boolean;

function appendTokenOption(group: HTMLOptGroupElement, balance: SelectedToken): void {
  const option = document.createElement("option");
  option.value = balance.address;
  option.setAttribute("data-decimals", balance.decimals.toString());
  option.setAttribute("data-symbol", balance.symbol);
  option.text = balance.symbol.substring(0, 10);
  group.appendChild(option);
}

function appendFallbackTokenOptions(group: HTMLOptGroupElement, excludedAddresses: Set<string>): void {
  tokenList.forEach((token) => {
    if (!excludedAddresses.has(token.address.toLowerCase())) {
      appendTokenOption(group, {
        address: token.address as Address,
        symbol: token.symbol,
        decimals: token.decimals,
      });
    }
  });
}

proto._renderTokenOptions = function renderTokenOptions(this: ExchangeInternals): void {
  const selectEl = document.querySelector("#tokenSelect") as HTMLSelectElement | null;
  const yourTokenGroup = document.getElementById("yourTokenGroup") as HTMLOptGroupElement | null;
  const otherTokenGroup = document.getElementById("otherTokenGroup") as HTMLOptGroupElement | null;
  if (!selectEl || !yourTokenGroup || !otherTokenGroup) {
    return;
  }

  const selectedValue = selectEl.value;
  yourTokenGroup.querySelectorAll("option").forEach((opt) => opt.remove());
  otherTokenGroup.querySelectorAll("option").forEach((opt) => opt.remove());

  const walletBalances = this._services.inventoryBar.getBalances?.() ?? [];
  const visibleWalletBalances = this._getVisibleTokenBalances(walletBalances);
  const excludedAddresses = new Set(visibleWalletBalances.map((balance) => balance.address.toLowerCase()));
  const shouldShowFallbackTokens = this._state.direction !== "deposit";

  if (visibleWalletBalances.length > 0) {
    yourTokenGroup.style.display = "";
    visibleWalletBalances.forEach((balance) => appendTokenOption(yourTokenGroup, balance));
  } else {
    yourTokenGroup.style.display = shouldShowFallbackTokens ? "none" : "";

    if (!shouldShowFallbackTokens) {
      const option = document.createElement("option");
      option.text = "No selectable tokens";
      option.value = "";
      option.disabled = true;
      option.selected = true;
      yourTokenGroup.appendChild(option);
    }
  }

  if (shouldShowFallbackTokens) {
    otherTokenGroup.style.display = "";
    appendFallbackTokenOptions(otherTokenGroup, excludedAddresses);
  } else {
    otherTokenGroup.style.display = "none";
  }

  if (selectedValue && [...selectEl.options].some((option) => option.value === selectedValue)) {
    selectEl.value = selectedValue;
  }
};

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

  void this._services.inventoryBar.refreshBalances?.();
};

proto._isLusdSelected = function isLusdSelected(this: ExchangeInternals): boolean {
  const selectedToken = this._getSelectedToken();
  return selectedToken ? areAddressesEqual(selectedToken.address, LUSD_COLLATERAL.address) : false;
};
