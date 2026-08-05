// Server-side military pay engine.
//
// Figures are anchored to 2024 DFAS pay tables (representative brackets) and
// carry provenance (data_year + source) so the client can display where the
// numbers came from. This is an estimator, not a payroll system.

export const PAY_DATA_YEAR = 2024;
export const PAY_SOURCE = "DFAS 2024 military pay tables (representative brackets)";

// Monthly BAS (Basic Allowance for Subsistence), 2024.
const BAS_ENLISTED_CENTS = 46025; // $460.25
const BAS_OFFICER_CENTS = 31698; // $316.98

// Monthly base pay by grade, as [minYearsOfService, monthlyDollars] brackets.
// Pick the highest bracket whose minYears <= yearsServed.
const BASE_PAY_2024: Record<string, [number, number][]> = {
  "E-1": [[0, 2017]],
  "E-2": [[0, 2262]],
  "E-3": [[0, 2378], [3, 2530], [4, 2610]],
  "E-4": [[0, 2634], [4, 2870], [6, 3010], [8, 3140]],
  "E-5": [[0, 2872], [4, 3210], [8, 3560], [12, 3820], [16, 3980]],
  "E-6": [[0, 3135], [4, 3560], [8, 3980], [12, 4260], [16, 4520], [20, 4720]],
  "E-7": [[0, 3627], [4, 4030], [8, 4360], [12, 4680], [16, 5010], [20, 5290], [24, 5560]],
  "E-8": [[8, 5215], [12, 5560], [16, 5900], [20, 6220], [24, 6560], [30, 7060]],
  "E-9": [[10, 6368], [16, 6820], [20, 7180], [24, 7560], [30, 8180]],
  "W-1": [[0, 3833], [4, 4360], [8, 4780], [12, 5140], [16, 5480], [20, 5760]],
  "W-2": [[0, 4366], [4, 4880], [8, 5300], [12, 5620], [16, 5960], [20, 6260]],
  "W-3": [[0, 4930], [4, 5420], [8, 5860], [12, 6220], [16, 6640], [20, 7020]],
  "W-4": [[0, 5399], [4, 5960], [8, 6440], [12, 6880], [16, 7360], [20, 7820]],
  "W-5": [[20, 8461], [24, 8960], [30, 9640]],
  "O-1": [[0, 3826], [2, 3980], [3, 4810], [4, 5040]],
  "O-2": [[0, 4409], [2, 5020], [3, 5780], [4, 5980], [6, 6100]],
  "O-3": [[0, 5102], [4, 6260], [8, 6980], [12, 7320], [16, 7620], [20, 7820]],
  "O-4": [[0, 5803], [4, 7060], [8, 7980], [12, 8620], [16, 9060], [20, 9260]],
  "O-5": [[0, 6721], [4, 7940], [8, 8640], [12, 9160], [16, 9880], [20, 10480], [24, 10980]],
  "O-6": [[0, 8067], [8, 9060], [16, 10480], [20, 11020], [24, 11480], [30, 12420]],
  "O-7": [[0, 10641], [20, 13200], [24, 14020], [30, 15060]],
  "O-8": [[0, 12817], [20, 15300], [24, 15980], [30, 16720]],
  "O-9": [[0, 18140], [30, 20500]],
  "O-10": [[0, 18789], [30, 21600]],
};

/** Grades we have pay tables for. Callers must validate before computing —
 * an unknown grade would otherwise yield $0 base plus a garbage BAH tier. */
export function isValidPayGrade(grade: string): boolean {
  return Object.prototype.hasOwnProperty.call(BASE_PAY_2024, grade);
}

function bracketValue(grade: string, years: number): number {
  const table = BASE_PAY_2024[grade];
  if (!table) return 0;
  let value = table[0]![1];
  for (const [minYears, dollars] of table) {
    if (years >= minYears) value = dollars;
  }
  return value;
}

function isOfficerGrade(grade: string): boolean {
  return grade.startsWith("O-") || grade.startsWith("W-");
}

// Rough regional BAH cost index keyed by the first ZIP digit (0=Northeast … 9=West).
const BAH_REGION_INDEX: Record<string, number> = {
  "0": 1.15, "1": 1.10, "2": 1.05, "3": 0.95, "4": 0.90,
  "5": 0.88, "6": 0.92, "7": 0.98, "8": 1.02, "9": 1.25,
};

// Base BAH by pay-grade "tier" (with-dependents monthly, national baseline).
function bahBaseDollars(grade: string, dependents: boolean): number {
  const tier = grade.split("-")[1] ?? "1";
  const n = Number(tier) || 1;
  const officer = isOfficerGrade(grade);
  // Baseline scales with grade; officers a bit higher.
  const base = (officer ? 1900 : 1500) + n * (officer ? 240 : 190);
  return Math.round(base * (dependents ? 1 : 0.86));
}

export function computeBahCents(zip: string | null | undefined, grade: string, dependents: boolean): number {
  const region = zip ? BAH_REGION_INDEX[zip[0] ?? "5"] ?? 1.0 : 1.0;
  return Math.round(bahBaseDollars(grade, dependents) * region * 100);
}

export function computeBaseCents(grade: string, years: number): number {
  return Math.round(bracketValue(grade, years) * 100);
}

export function basCents(grade: string): number {
  return isOfficerGrade(grade) ? BAS_OFFICER_CENTS : BAS_ENLISTED_CENTS;
}

// Very rough progressive federal effective rate on taxable (base) monthly pay.
function federalEffectiveRate(annualTaxable: number): number {
  if (annualTaxable <= 11600) return 0.05;
  if (annualTaxable <= 47150) return 0.10;
  if (annualTaxable <= 100525) return 0.14;
  if (annualTaxable <= 191950) return 0.18;
  return 0.24;
}

export interface PayInput {
  branch?: string | null;
  payGrade?: string | null;
  yearsServed: number;
  zip?: string | null;
  dependents?: number;
  married?: boolean;
  livesOnBase?: boolean;
  specialPaysCents?: number;
  additionalIncomeCents?: number;
  deductionsCents?: number;
  tspContributionPct?: number;
  stateOfResidence?: string | null;
}

// Full breakdown used by POST /calc/pay. All money fields are integer cents.
export function computePay(input: PayInput) {
  const grade = input.payGrade ?? "E-1";
  const dependents = (input.dependents ?? 0) > 0 || !!input.married;

  const basePay = computeBaseCents(grade, input.yearsServed);
  const bah = input.livesOnBase ? 0 : computeBahCents(input.zip, grade, dependents);
  const bas = basCents(grade);
  const specialPay = input.specialPaysCents ?? 0;
  const additional = input.additionalIncomeCents ?? 0;

  const gross = basePay + bah + bas + specialPay + additional;

  // BAH/BAS are non-taxable; base + special + additional income are taxable.
  const taxable = basePay + specialPay + additional;
  const nonTaxable = bah + bas;

  const annualTaxable = (taxable * 12) / 100;
  const federal = Math.round(taxable * federalEffectiveRate(annualTaxable));
  const fica = Math.round(basePay * 0.0765);
  const stateRate = input.stateOfResidence ? stateTaxRate(input.stateOfResidence) : 0;
  const state = Math.round(taxable * stateRate);

  const deductions = input.deductionsCents ?? 0;
  const tspDeduction = Math.round(basePay * ((input.tspContributionPct ?? 0) / 100));

  const takeHomeMonthly = gross - federal - state - fica - deductions - tspDeduction;

  return {
    monthly: {
      base_pay: basePay,
      bah,
      bas,
      special_pay: specialPay,
      gross,
    },
    taxes: {
      taxable,
      non_taxable: nonTaxable,
      federal,
      state,
      fica,
    },
    take_home: {
      monthly: takeHomeMonthly,
      semi_monthly: Math.round(takeHomeMonthly / 2),
      annual: takeHomeMonthly * 12,
    },
    data_year: PAY_DATA_YEAR,
    source: PAY_SOURCE,
  };
}

// States with no income tax → 0; a light default elsewhere. Purely illustrative.
const NO_INCOME_TAX = new Set(["AK", "FL", "NV", "NH", "SD", "TN", "TX", "WA", "WY"]);
function stateTaxRate(state: string): number {
  return NO_INCOME_TAX.has(state.toUpperCase()) ? 0 : 0.04;
}

// Lightweight monthly take-home estimate used by the Home dashboard tile.
export function estimateMonthlyPayCents(args: {
  branch?: string | null;
  payGrade?: string | null;
  yearsServed: number;
  zip?: string | null;
}): number {
  if (!args.payGrade || !isValidPayGrade(args.payGrade)) return 0;
  const result = computePay({
    payGrade: args.payGrade,
    yearsServed: args.yearsServed,
    zip: args.zip,
    branch: args.branch,
  });
  return result.take_home.monthly;
}

export function payOptions() {
  return {
    grades: Object.keys(BASE_PAY_2024),
    special_pays: [
      { id: "hazard", name: "Hazardous Duty", monthly_cents: 15000 },
      { id: "flight", name: "Flight Pay", monthly_cents: 25000 },
      { id: "sea", name: "Sea Pay", monthly_cents: 18000 },
      { id: "jump", name: "Jump Pay", monthly_cents: 15000 },
      { id: "language", name: "Foreign Language Proficiency", monthly_cents: 20000 },
      { id: "hostile_fire", name: "Hostile Fire / Imminent Danger", monthly_cents: 22500 },
    ],
    data_year: PAY_DATA_YEAR,
    source: PAY_SOURCE,
  };
}
