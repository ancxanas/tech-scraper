export interface Product {
  id: string;
  name: string;
  price: number;
  originalPrice: number;
  discount: number;
  currency: string;
  productUrl: string;
  imageUrl: string;
  platform: string;
  scrapedAt: string;

  brand?: string;
  rating?: number;
  reviewsCount?: number;
  seller?: string;
  availability?: string;
  offers?: string[];
  listingPosition?: number;
  pageNumber?: number;
  extras?: Record<string, unknown>;

  enriched?: boolean;
  images?: string[];
  inStock?: boolean;
  description?: string;
  highlights?: string[];
  specifications?: Record<string, string>;
  variants?: ProductVariant[];
  warranty?: string;
  deliveryEta?: string;
  exchangePrice?: number;
  emiFrom?: number;
  category?: string;
  sku?: string;
}

export interface ProductVariant {
  name: string;
  price: number;
  url: string;
  inStock: boolean;
}

export interface SearchResult {
  query: string;
  platform: string;
  products: Product[];
  timestamp: string;
  status: "ok" | "error" | "empty";
  error?: string;
  requestedPages: number;
  rawCount: number;
  parsedCount: number;
  healAttempted: boolean;
  healSuccess: boolean;
  coverage: {
    fieldFillRate: number;
  };
}
