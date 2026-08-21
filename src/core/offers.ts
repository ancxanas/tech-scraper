/**
 * Checkout-price parsing.
 *
 * A note on why this does NOT feed the ranking.
 *
 * Flipkart's "Bank offers ₹X off" was measured across nine products from nine
 * different brands and was exactly 5.0% of the listed price every single time
 * — it is a flat card discount, not a per-product deal. Subtracting it changes
 * every price by the same proportion, which cancels out of the value ratio and
 * reorders nothing. Presenting an "effective price" ranking on top of it would
 * look like insight while carrying zero discriminating signal.
 *
 * What is genuinely useful is telling the buyer the real number at checkout,
 * and flagging the two things that DO vary: whether an exchange bonus exists,
 * and whether the item can actually be delivered to their pincode.
 */

export interface CheckoutInfo {
  /** Price after automatically-applied offers, as the site states it. */
  buyAt: number | null;
  /** Flat card discount. Uniform in practice — displayed, never scored. */
  bankOffer: number | null;
  /** Maximum trade-in credit. Conditional on the buyer's old phone. */
  exchangeUpTo: number | null;
  noCostEmi: boolean;
  /** The site said the offer/item is unavailable for the current pincode. */
  pincodeBlocked: boolean;
}

const EMPTY: CheckoutInfo = {
  buyAt: null,
  bankOffer: null,
  exchangeUpTo: null,
  noCostEmi: false,
  pincodeBlocked: false,
};

function rupees(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Parse the offer block out of a product page's text. */
export function parseCheckout(text: string): CheckoutInfo {
  if (!text) return { ...EMPTY };

  const buyAt = rupees(text.match(/Buy at ₹([\d,]+)/i)?.[1]) ??
    rupees(text.match(/₹([\d,]+)\s*Lowest price for you/i)?.[1]);

  const bankOffer = rupees(text.match(/Bank offers?\s*₹([\d,]+)\s*off/i)?.[1]);

  // "Exchange offer Not available at this Pincode Up to ₹9,450" — the amount
  // trails the availability note, so allow text between the two.
  const exchangeUpTo = rupees(
    text.match(/Exchange offer(?:[^₹]{0,80})Up to ₹([\d,]+)/i)?.[1],
  );

  return {
    buyAt,
    bankOffer,
    exchangeUpTo,
    noCostEmi: /No Cost EMI/i.test(text),
    pincodeBlocked: /Not available at this Pincode/i.test(text),
  };
}

/** True when there is anything worth showing the user. */
export function hasCheckoutInfo(c: CheckoutInfo): boolean {
  return c.buyAt !== null || c.bankOffer !== null || c.exchangeUpTo !== null ||
    c.noCostEmi || c.pincodeBlocked;
}
