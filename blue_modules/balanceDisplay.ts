export type BalanceDisplayParts = {
  numeric: string;
  suffix: string;
  hiddenDecimals: number;
};

export const getBalanceDisplayParts = (
  formattedBalance: string,
  visibleDecimals: number = 4,
  maxTrackedDecimals: number = 8,
): BalanceDisplayParts => {
  if (!formattedBalance || visibleDecimals < 0 || maxTrackedDecimals < 0) {
    return {
      numeric: formattedBalance,
      suffix: '',
      hiddenDecimals: 0,
    };
  }

  const match = formattedBalance.match(/^(-?\d+)(?:\.(\d+))?(\s+.+)?$/);
  if (!match) {
    return {
      numeric: formattedBalance,
      suffix: '',
      hiddenDecimals: 0,
    };
  }

  const integerPart = match[1];
  const fractionalPart = match[2] ?? '';
  const suffix = match[3] ?? '';

  if (fractionalPart.length === 0) {
    return {
      numeric: integerPart,
      suffix,
      hiddenDecimals: 0,
    };
  }

  const trackedFraction = fractionalPart.slice(0, maxTrackedDecimals);
  const shownFraction = trackedFraction.slice(0, visibleDecimals);
  const hiddenDecimals = Math.max(0, trackedFraction.length - shownFraction.length);

  return {
    numeric: `${integerPart}${shownFraction ? `.${shownFraction}` : ''}`,
    suffix,
    hiddenDecimals,
  };
};
