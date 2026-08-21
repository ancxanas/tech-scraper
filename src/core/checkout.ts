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

  const priced = text.match(
    /(\d{1,2})%\s*([\d,]{3,8})\s*₹([\d,]{3,8})\s*\+₹\d+\s*Protect Promise Fee/i,
  );
  const plain = text.match(/₹([\d,]{3,8})\s*\+₹\d+\s*Protect Promise Fee/i);
  const pagePrice = rupees(priced?.[3]) ?? rupees(plain?.[1]);
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

  const outOfStock = /Selected Colou?r:[^|]{0,40}?Out of stock/i.test(text);
  const deliveryBy = text.match(
    /Delivery by ([A-Za-z0-9 ,]{4,20}?)(?:\s+Arriving|\s+Fulfil|\s*\|)/i,
  )
    ?.[1]?.trim() ?? null;

  const seller = text.match(
    /(?:Fulfilled by|Sold by|Seller)\s+([A-Za-z0-9][A-Za-z0-9 .&'-]{2,38}?)(?:\s+\d\.\d|\s*\||\s+See other sellers|\s{2,})/i,
  )?.[1]?.trim() ?? null;

  return {
    pagePrice,
    pageMrp: pageMrp && pagePrice && pageMrp >= pagePrice ? pageMrp : null,
    seller,
    inStock: outOfStock ? false : deliveryBy ? true : null,
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
