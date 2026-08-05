// VA disability compensation — 2024 rates (representative of the published
// VA rate tables). Carries provenance so the client can show data_year/source.

export const VA_DATA_YEAR = 2024;
export const VA_SOURCE = "VA 2024 disability compensation rate tables (representative)";

// Veteran alone, monthly USD, by combined rating.
const BASE_MONTHLY: Record<number, number> = {
  10: 171.23,
  20: 338.49,
  30: 524.31,
  40: 755.28,
  50: 1075.16,
  60: 1361.88,
  70: 1716.28,
  80: 1995.01,
  90: 2241.91,
  100: 3737.85,
};

// Additional monthly amounts (only apply at 30%+), by rating.
const ADD_ONS: Record<number, { spouse: number; child: number; parent: number }> = {
  30: { spouse: 65, child: 31, parent: 58 },
  40: { spouse: 87, child: 41, parent: 77 },
  50: { spouse: 109, child: 51, parent: 96 },
  60: { spouse: 130, child: 62, parent: 116 },
  70: { spouse: 152, child: 72, parent: 135 },
  80: { spouse: 174, child: 82, parent: 154 },
  90: { spouse: 196, child: 92, parent: 174 },
  100: { spouse: 217.87, child: 101.05, parent: 193.35 },
};

export const VALID_RATINGS = Object.keys(BASE_MONTHLY).map(Number);

export interface VaInput {
  rating: number;
  married: boolean;
  children: number;
  dependentParents: number;
  year?: number;
}

export function computeVaDisability(input: VaInput) {
  const rating = input.rating;
  const base = BASE_MONTHLY[rating] ?? 0;

  let monthly = base;
  if (rating >= 30) {
    const add = ADD_ONS[rating];
    if (add) {
      if (input.married) monthly += add.spouse;
      monthly += add.child * Math.max(0, input.children);
      monthly += add.parent * Math.max(0, Math.min(2, input.dependentParents));
    }
  }

  const monthlyCents = Math.round(monthly * 100);
  return {
    monthly_cents: monthlyCents,
    annual_cents: monthlyCents * 12,
    year: VA_DATA_YEAR,
    source: VA_SOURCE,
  };
}

export function vaTables(_year?: number) {
  return {
    year: VA_DATA_YEAR,
    source: VA_SOURCE,
    ratings: VALID_RATINGS.map((rating) => ({
      rating,
      base_monthly_cents: Math.round((BASE_MONTHLY[rating] ?? 0) * 100),
      add_ons_cents:
        rating >= 30 && ADD_ONS[rating]
          ? {
              spouse: Math.round(ADD_ONS[rating]!.spouse * 100),
              child: Math.round(ADD_ONS[rating]!.child * 100),
              parent: Math.round(ADD_ONS[rating]!.parent * 100),
            }
          : null,
    })),
  };
}
