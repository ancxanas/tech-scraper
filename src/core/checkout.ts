export interface CheckoutInfo {
  pagePrice: number | null;
  pageMrp: number | null;
  seller: string | null;
  inStock: boolean | null;
  deliveryBy: string | null;
  buyAt: number | null;
  bankOffer: number | null;
  exchangeUpTo: number | null;
  noCostEmi: boolean;
  pincodeBlocked: boolean;
  /** When the page this was read from was fetched. Prices move; a reading without a time is a rumor. */
  sampledAt?: string;
}

const EMPTY: CheckoutInfo = {
  pagePrice: null,
  pageMrp: null,
  seller: null,
  inStock: null,
  deliveryBy: null,
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

export function parseCheckout(text: string): CheckoutInfo {
  if (!text) return { ...EMPTY };

  const gap = "[\\s\\[\\](){}|]*";
  const priced = text.match(
    new RegExp(
      `(\\d{1,2})%${gap}([\\d,]{3,8})${gap}₹\\s?([\\d,]{3,8})${gap}\\+\\s?₹\\d+${gap}Protect Promise Fee`,
      "i",
    ),
  );
  const plain = text.match(
    new RegExp(
      `₹\\s?([\\d,]{3,8})${gap}\\+\\s?₹\\d+${gap}Protect Promise Fee`,
      "i",
    ),
  );
  // The page publishes its own structured data; prefer it to reading rupee
  // glyphs out of prose. pageToText appends it as LD_ tokens.
  // The visible buy box first: it is the offer you would actually be sold.
  // Structured data is the fallback for pages that do not render one.
  const ldPrice = rupees(text.match(/LD_PRICE=(\d{3,8})/)?.[1]);
  const buyBox = rupees(priced?.[3]) ?? rupees(plain?.[1]);
  const pagePrice = buyBox ?? ldPrice;
  const pageMrp = rupees(priced?.[2]) ??
    rupees(
      text.match(/₹([\d,]{3,8})\s*\|\s*MRP \(Incl\. of all taxes\)/i)?.[1],
    );

  const buyAt = rupees(text.match(/Buy at ₹([\d,]+)/i)?.[1]) ??
    rupees(text.match(/₹([\d,]+)\s*Lowest price for you/i)?.[1]);

  const bankOffer = rupees(text.match(/Bank offers?\s*₹([\d,]+)\s*off/i)?.[1]);

  const exchangeUpTo = rupees(
    text.match(/Exchange offer(?:[^₹]{0,80})Up to ₹([\d,]+)/i)?.[1],
  );

  const ldStock = text.match(/LD_STOCK=(\w+)/)?.[1];
  const explicitlyOut = /Selected Colou?r:[^|]{0,40}?Out of stock/i.test(text);
  // A rendered buy box with a price means the listing is sellable, whatever a
  // sold-out seller's structured data says about their own offer.
  const outOfStock = explicitlyOut ||
    (buyBox === null && !!ldStock &&
      /OutOfStock|SoldOut|Discontinued/i.test(ldStock));
  const deliveryBy = text.match(
    /Delivery by ([A-Za-z0-9 ,]{4,20}?)(?:\s+Arriving|\s+Fulfil|\s*\|)/i,
  )
    ?.[1]?.trim() ?? null;

  const seller =
    text.match(/LD_SELLER=([^|]{2,40}?)(?:\s{2,}|$)/)?.[1]?.trim() ??
      text.match(
        /(?:Fulfilled by|Sold by|Seller)\s+([A-Za-z0-9][A-Za-z0-9 .&'-]{2,38}?)(?:\s+\d\.\d|\s*\||\s+See other sellers|\s{2,}|\s*$)/i,
      )?.[1]?.trim() ??
      text.match(/LD_SELLER=([^|]{2,40}?)(?:\s{2,}|$)/)?.[1]?.trim() ?? null;

  return {
    pagePrice,
    pageMrp: pageMrp && pagePrice && pageMrp >= pagePrice ? pageMrp : null,
    seller,
    inStock: outOfStock ? false : ldStock ? true : deliveryBy ? true : null,
    deliveryBy,
    buyAt,
    bankOffer,
    exchangeUpTo,
    noCostEmi: /No Cost EMI/i.test(text),
    pincodeBlocked: /Not available at this Pincode/i.test(text),
  };
}

export function hasCheckoutInfo(c: CheckoutInfo): boolean {
  return c.pagePrice !== null || c.seller !== null || c.buyAt !== null ||
    c.bankOffer !== null ||
    c.exchangeUpTo !== null ||
    c.noCostEmi || c.pincodeBlocked || c.inStock !== null;
}
