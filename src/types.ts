export interface Product {
  name: string;
  price: number;
  originalPrice: number;
  discount: number;
  brand: string;
  availability: string;
  imageUrl: string;
  productUrl: string;
  platform: string;
  rating?: number;
}

export interface SearchResult {
  query: string;
  platform: string;
  products: Product[];
  timestamp: string;
  status: "ok" | "error" | "empty";
  error?: string;
}
