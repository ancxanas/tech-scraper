import { bdFetch } from "./brightdata.ts";

export interface SerpResult {
  title: string;
  url: string;
  price: string;
  shop: string;
  rating: number | null;
  reviews: number | null;
  image: string | null;
  oldPrice: string | null;
  tag: string | null;
}

interface RawSerpShoppingItem {
  title?: string;
  link?: string;
  price?: string;
  shop?: string;
  rating?: number;
  reviews_cnt?: number;
  image?: string;
  old_price?: string;
  tag?: string;
}

interface RawSerpResponse {
  search_results?: Array<{
    title?: string;
    url?: string;
    description?: string;
  }>;
  shopping?: RawSerpShoppingItem[];
  organic?: Array<{
    title?: string;
    url?: string;
    description?: string;
  }>;
}

function getSerpZone(): string {
  const zone = Deno.env.get("SERP_ZONE");
  if (!zone) {
    throw new Error(
      "SERP_ZONE not set. Create a SERP API zone at https://brightdata.com/cp/web_access/new",
    );
  }
  return zone;
}

export async function searchGoogleShopping(
  query: string,
  country = "in",
): Promise<SerpResult[]> {
  const zone = getSerpZone();
  const encoded = encodeURIComponent(query);
  const url =
    `https://www.google.com/search?q=${encoded}&udm=28&gl=${country}&hl=en&brd_json=1`;

  const data = await bdFetch<RawSerpResponse>("/request", {
    method: "POST",
    body: JSON.stringify({
      zone,
      url,
      format: "raw",
    }),
  });

  const items = data.shopping || [];
  return items.map((item) => ({
    title: item.title || "Unknown",
    url: item.link || "",
    price: item.price || "",
    shop: item.shop || "Unknown",
    rating: item.rating ?? null,
    reviews: item.reviews_cnt ?? null,
    image: item.image ?? null,
    oldPrice: item.old_price ?? null,
    tag: item.tag ?? null,
  }));
}
