import type { Place } from "@prisma/client";
import { haversineMiles, roundMiles } from "../lib/geo.js";

export function serializePlace(
  place: Place,
  opts: { origin?: { lat: number; lng: number }; favoriteIds?: Set<string> } = {},
) {
  const distance =
    opts.origin != null
      ? roundMiles(haversineMiles(opts.origin.lat, opts.origin.lng, place.lat, place.lng))
      : null;

  return {
    id: place.id,
    type: place.type,
    name: place.name,
    brand_id: place.brandId ?? undefined,
    category: place.category,
    subcategory: place.subcategory ?? undefined,
    city: place.city ?? undefined,
    address: place.address ?? undefined,
    lat: place.lat,
    lng: place.lng,
    distance_miles: distance,
    discount: {
      summary: place.discountSummary ?? undefined,
      value_type: place.discountValueType ?? undefined,
      value: place.discountValue ?? undefined,
      eligibility: (place.eligibility as string[] | null) ?? [],
      proof_required: place.proofRequired,
      channel: place.channel ?? undefined,
    },
    verification: {
      status: place.verificationStatus,
      confirmations: place.confirmations,
      last_verified_at: place.lastVerifiedAt ? place.lastVerifiedAt.toISOString() : null,
    },
    is_favorite: opts.favoriteIds?.has(place.id) ?? false,
    phone: place.phone ?? undefined,
    website: place.website ?? undefined,
    hours: place.hours ?? undefined,
  };
}
