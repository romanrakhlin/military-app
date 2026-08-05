import { PrismaClient, type Prisma } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

// Anchor metros so location-based queries return data out of the box.
const DC = { lat: 38.8977, lng: -77.0365 }; // Washington DC
const SD = { lat: 32.7157, lng: -117.1611 }; // San Diego
const SA = { lat: 29.4241, lng: -98.4936 }; // San Antonio (big military city)

function jitter(base: { lat: number; lng: number }, i: number) {
  // Spread points within ~5 miles of the anchor.
  return {
    lat: base.lat + ((i * 37) % 100) / 1500 - 0.033,
    lng: base.lng + ((i * 53) % 100) / 1500 - 0.033,
  };
}

const now = new Date();
function daysAgo(d: number) {
  return new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
}
function daysFromNow(d: number) {
  return new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
}
// Current month period key, e.g. "2026-08"
const periodKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

async function main() {
  // This seed WIPES every table before inserting demo fixtures. Refuse to run
  // against anything that looks like a hosted/production database unless the
  // operator explicitly forces it.
  const dbUrl = process.env.DATABASE_URL ?? "";
  const looksHosted = /rlwy\.net|railway\.internal|railway\.app|proxy\./i.test(dbUrl);
  if ((looksHosted || process.env.NODE_ENV === "production") && process.env.SEED_FORCE !== "1") {
    console.error(
      "Refusing to seed: DATABASE_URL points at a hosted database (or NODE_ENV=production).\n" +
        "This script deletes ALL rows in every table before seeding demo data.\n" +
        "If you really mean it, re-run with SEED_FORCE=1.",
    );
    process.exit(1);
  }

  console.log("Seeding Valor database…");

  // -------------------------------------------------------------------------
  // Idempotency: clear existing rows in FK-safe order (children first).
  // -------------------------------------------------------------------------
  await prisma.cardBenefitUsage.deleteMany({});
  await prisma.userCard.deleteMany({});
  await prisma.savedArticle.deleteMany({});
  await prisma.monthlyBill.deleteMany({});
  await prisma.payProfile.deleteMany({});
  await prisma.tspSnapshot.deleteMany({});
  await prisma.placeConfirmation.deleteMany({});
  await prisma.placeReport.deleteMany({});
  await prisma.favorite.deleteMany({});
  await prisma.upload.deleteMany({});
  await prisma.deviceToken.deleteMany({});
  await prisma.refreshToken.deleteMany({});
  await prisma.lounge.deleteMany({});
  await prisma.place.deleteMany({});
  await prisma.brand.deleteMany({});
  await prisma.airport.deleteMany({});
  await prisma.article.deleteMany({});
  await prisma.stateBenefit.deleteMany({});
  await prisma.healthResource.deleteMany({});
  await prisma.healthFacility.deleteMany({});
  await prisma.cardProduct.deleteMany({});
  await prisma.announcement.deleteMany({});
  await prisma.user.deleteMany({});

  // -------------------------------------------------------------------------
  // Brands (national chains)
  // -------------------------------------------------------------------------
  const brandDefs = [
    { name: "Home Depot", category: "Home Improvement", blurb: "10% military discount in-store & online.", discountBadge: "10% off" },
    { name: "Lowe's", category: "Home Improvement", blurb: "Everyday 10% military discount.", discountBadge: "10% off" },
    { name: "Under Armour", category: "Apparel", blurb: "Military & first responder discount.", discountBadge: "20% off" },
    { name: "Nike", category: "Apparel", blurb: "Military appreciation discount.", discountBadge: "10% off" },
    { name: "Great Clips", category: "Personal Care", blurb: "Discounted haircuts for service members.", discountBadge: "$3 off" },
    { name: "Cabela's", category: "Outdoors", blurb: "Military appreciation savings.", discountBadge: "5% off" },
  ];
  const brands = await Promise.all(brandDefs.map((b) => prisma.brand.create({ data: b })));
  const brandByName = new Map(brands.map((b) => [b.name, b]));

  // -------------------------------------------------------------------------
  // Places — discounts + free resources across three metros
  // -------------------------------------------------------------------------
  const placeData: Prisma.PlaceCreateManyInput[] = [];
  let idx = 0;

  const metros: { anchor: { lat: number; lng: number }; city: string; state: string }[] = [
    { anchor: DC, city: "Washington", state: "DC" },
    { anchor: SD, city: "San Diego", state: "CA" },
    { anchor: SA, city: "San Antonio", state: "TX" },
  ];

  // ---- Per-metro DISCOUNT places (mix of national-brand + purely local) ----
  type DiscountDef = {
    brand?: string;
    name?: string; // if local (no brand)
    category: string;
    subcategory?: string;
    summary: string;
    valueType: "percent" | "fixed" | "free";
    value: number | null;
    channel: "in_store" | "online" | "both";
  };

  const discountDefs: DiscountDef[] = [
    // National-brand locations (one per brand, per metro)
    { brand: "Home Depot", category: "Home Improvement", summary: "10% off with military ID", valueType: "percent", value: 10, channel: "both" },
    { brand: "Lowe's", category: "Home Improvement", summary: "10% everyday military discount", valueType: "percent", value: 10, channel: "both" },
    { brand: "Under Armour", category: "Apparel", subcategory: "Athletic", summary: "20% off for service members", valueType: "percent", value: 20, channel: "in_store" },
    { brand: "Nike", category: "Apparel", subcategory: "Footwear", summary: "10% military appreciation discount", valueType: "percent", value: 10, channel: "in_store" },
    { brand: "Great Clips", category: "Personal Care", subcategory: "Barber", summary: "$3 off haircuts", valueType: "fixed", value: 3, channel: "in_store" },
    { brand: "Cabela's", category: "Outdoors", subcategory: "Sporting Goods", summary: "5% off purchases", valueType: "percent", value: 5, channel: "in_store" },
    // Purely local businesses
    { name: "Semper Fi Diner", category: "Dining", subcategory: "American", summary: "15% off your meal with ID", valueType: "percent", value: 15, channel: "in_store" },
    { name: "Liberty Barbershop", category: "Personal Care", subcategory: "Barber", summary: "$5 off cuts for service members", valueType: "fixed", value: 5, channel: "in_store" },
    { name: "Frontline Fitness", category: "Fitness", subcategory: "Gym", summary: "50% off first month membership", valueType: "percent", value: 50, channel: "in_store" },
    { name: "Base Brews Coffee", category: "Dining", subcategory: "Cafe", summary: "Free coffee with any breakfast", valueType: "free", value: null, channel: "in_store" },
    { name: "Anchor Auto Repair", category: "Automotive", subcategory: "Repair", summary: "10% off labor for veterans", valueType: "percent", value: 10, channel: "in_store" },
    { name: "Valor Vision Optometry", category: "Health", subcategory: "Optometry", summary: "$25 off eye exams", valueType: "fixed", value: 25, channel: "in_store" },
  ];

  for (const { anchor, city, state } of metros) {
    for (let n = 0; n < discountDefs.length; n++) {
      const def = discountDefs[n]!;
      const loc = jitter(anchor, idx++);
      const brand = def.brand ? brandByName.get(def.brand) : undefined;
      const verified = n % 4 === 0;
      placeData.push({
        type: "discount",
        name: brand ? `${brand.name} — ${city}` : `${def.name} — ${city}`,
        brandId: brand?.id,
        category: def.category,
        subcategory: def.subcategory ?? null,
        city,
        address: `${100 + n * 7} Freedom Blvd, ${city}, ${state}`,
        lat: loc.lat,
        lng: loc.lng,
        discountSummary: def.summary,
        discountValueType: def.valueType,
        discountValue: def.value,
        eligibility: ["active_duty", "veteran", "reserves_guard"],
        proofRequired: true,
        channel: def.channel,
        verificationStatus: verified ? "verified" : "community",
        confirmations: (n * 3) % 14,
        lastVerifiedAt: verified ? daysAgo(n + 1) : null,
        status: "active",
      });
    }
  }

  // ---- Per-metro FREE resources (~7 per metro => ~21 total) ----
  type FreeDef = {
    name: string;
    category: string;
    subcategory?: string;
    summary: string;
  };
  const freeDefs: FreeDef[] = [
    { name: "USO Lounge", category: "USO", subcategory: "Lounge", summary: "Free lounge, snacks & Wi-Fi for service members & families" },
    { name: "Fisher House", category: "Fisher House", subcategory: "Lodging", summary: "Free lodging for families of hospitalized service members" },
    { name: "Blue Star Museum", category: "Blue Star Museum", subcategory: "Museum", summary: "Free admission for military families (Memorial Day–Labor Day)" },
    { name: "National Park", category: "National Park", subcategory: "Recreation", summary: "Free entry with military ID or America the Beautiful pass" },
    { name: "VA Medical Center", category: "VA Medical Center", subcategory: "Healthcare", summary: "Free & low-cost care for enrolled veterans" },
    { name: "State Park", category: "State Park", subcategory: "Recreation", summary: "Free or discounted day-use entry for veterans" },
    { name: "USO Center", category: "USO", subcategory: "Center", summary: "Free programs, events, and family support" },
  ];

  for (const { anchor, city, state } of metros) {
    for (let n = 0; n < freeDefs.length; n++) {
      const def = freeDefs[n]!;
      const loc = jitter(anchor, idx++);
      const verified = n % 3 === 0;
      placeData.push({
        type: "free",
        name: `${def.name} — ${city}`,
        category: def.category,
        subcategory: def.subcategory ?? null,
        city,
        address: `${200 + n * 5} Veterans Way, ${city}, ${state}`,
        lat: loc.lat,
        lng: loc.lng,
        discountSummary: def.summary,
        discountValueType: "free",
        discountValue: null,
        eligibility: ["active_duty", "veteran", "reserves_guard"],
        proofRequired: true,
        channel: "in_store",
        verificationStatus: verified ? "verified" : "community",
        confirmations: (n * 2) % 10,
        lastVerifiedAt: verified ? daysAgo(n + 2) : null,
        status: "active",
      });
    }
  }

  // ---- National / online-only offers (channel online | both) ----
  const onlineOffers: {
    brand?: string;
    name: string;
    category: string;
    summary: string;
    valueType: "percent" | "fixed" | "free";
    value: number | null;
    channel: "online" | "both";
  }[] = [
    { brand: "Nike", name: "Nike.com Military Discount", category: "Apparel", summary: "10% off online with SheerID verification", valueType: "percent", value: 10, channel: "online" },
    { brand: "Under Armour", name: "Under Armour Online", category: "Apparel", summary: "20% off online for service members", valueType: "percent", value: 20, channel: "both" },
    { name: "Verizon Military Plan", category: "Wireless", summary: "$25/mo off unlimited plans", valueType: "fixed", value: 25, channel: "online" },
    { name: "Ford Military Program", category: "Automotive", summary: "$500 bonus cash on select models", valueType: "fixed", value: 500, channel: "online" },
    { name: "Adobe Creative Cloud", category: "Software", summary: "Free access via base MWR programs", valueType: "free", value: null, channel: "online" },
    { name: "Purple Mattress", category: "Home Goods", summary: "10% off online orders", valueType: "percent", value: 10, channel: "both" },
  ];
  for (let n = 0; n < onlineOffers.length; n++) {
    const def = onlineOffers[n]!;
    const brand = def.brand ? brandByName.get(def.brand) : undefined;
    placeData.push({
      type: "discount",
      name: def.name,
      brandId: brand?.id,
      category: def.category,
      city: null,
      address: null,
      // Anchor near DC so they still show on a national map without skewing metros.
      lat: DC.lat + 0.5,
      lng: DC.lng + 0.5,
      discountSummary: def.summary,
      discountValueType: def.valueType,
      discountValue: def.value,
      eligibility: ["active_duty", "veteran", "reserves_guard"],
      proofRequired: true,
      channel: def.channel,
      verificationStatus: n % 4 === 0 ? "verified" : "community",
      confirmations: (n * 5) % 20,
      lastVerifiedAt: n % 4 === 0 ? daysAgo(n + 3) : null,
      status: "active",
    });
  }

  await prisma.place.createMany({ data: placeData });

  // -------------------------------------------------------------------------
  // Card products (4) — benefits shaped { id, name, description, amountCents, period }
  // -------------------------------------------------------------------------
  const amexPlatinum = await prisma.cardProduct.create({
    data: {
      name: "The Platinum Card® from American Express",
      issuer: "American Express",
      category: "Travel",
      annualFeeCents: 69500,
      blurb: "Premium travel card with extensive lounge access; annual fee waived for eligible military under SCRA/MLA.",
      waivesFeeForMilitary: true,
      loungePrograms: ["priority_pass", "amex_centurion", "amex_platinum", "delta_skyclub"],
      benefits: [
        { id: "airline_fee", name: "Airline fee credit", description: "Incidental fees with selected airline", amountCents: 20000, period: "annual" },
        { id: "uber_cash", name: "Uber Cash", description: "Rides & Eats in the U.S.", amountCents: 1500, period: "monthly" },
        { id: "digital_ent", name: "Digital entertainment credit", description: "Select streaming/news", amountCents: 2000, period: "monthly" },
        { id: "saks", name: "Saks Fifth Avenue credit", description: "", amountCents: 5000, period: "semiannual" },
        { id: "clear", name: "CLEAR Plus credit", description: "", amountCents: 18900, period: "annual" },
        { id: "hotel_credit", name: "Prepaid hotel credit", description: "Fine Hotels + Resorts / The Hotel Collection", amountCents: 20000, period: "annual" },
      ],
    },
  });

  await prisma.cardProduct.create({
    data: {
      name: "Chase Sapphire Reserve®",
      issuer: "Chase",
      category: "Travel",
      annualFeeCents: 55000,
      blurb: "Travel rewards card with Priority Pass access; annual fee waived for eligible military.",
      waivesFeeForMilitary: true,
      loungePrograms: ["priority_pass"],
      benefits: [
        { id: "travel_credit", name: "Annual travel credit", description: "Statement credit on travel", amountCents: 30000, period: "annual" },
        { id: "doordash", name: "DoorDash credit", description: "Monthly DashPass credit", amountCents: 500, period: "monthly" },
        { id: "lyft", name: "Lyft in-app credit", description: "", amountCents: 1000, period: "monthly" },
      ],
    },
  });

  await prisma.cardProduct.create({
    data: {
      name: "American Express® Gold Card",
      issuer: "American Express",
      category: "Dining",
      annualFeeCents: 32500,
      blurb: "Dining and grocery rewards; annual fee waived for eligible military.",
      waivesFeeForMilitary: true,
      loungePrograms: [],
      benefits: [
        { id: "dining", name: "Dining credit", description: "Select restaurants & delivery", amountCents: 1000, period: "monthly" },
        { id: "uber_gold", name: "Uber Cash", description: "", amountCents: 1000, period: "monthly" },
        { id: "resy", name: "Resy credit", description: "", amountCents: 5000, period: "semiannual" },
      ],
    },
  });

  await prisma.cardProduct.create({
    data: {
      name: "Military Star Card",
      issuer: "Exchange Credit Program",
      category: "Retail",
      annualFeeCents: 0,
      blurb: "No annual fee, exclusive to the military community.",
      waivesFeeForMilitary: false,
      loungePrograms: [],
      benefits: [
        { id: "fuel", name: "Fuel discount", description: "5¢/gal at Exchange fuel", amountCents: 0, period: "one_time" },
      ],
    },
  });

  // -------------------------------------------------------------------------
  // Airports + Lounges
  // -------------------------------------------------------------------------
  const airportDefs = [
    { code: "BWI", name: "Baltimore/Washington Intl", city: "Baltimore", state: "MD", lat: 39.1774, lng: -76.6684, details: { space_a: true } },
    { code: "SAN", name: "San Diego Intl", city: "San Diego", state: "CA", lat: 32.7336, lng: -117.1897, details: { space_a: false } },
    { code: "BLV", name: "Scott AFB / MidAmerica", city: "Belleville", state: "IL", lat: 38.5452, lng: -89.8352, details: { space_a: true } },
    { code: "NGU", name: "Norfolk NS (Chambers Field)", city: "Norfolk", state: "VA", lat: 36.9376, lng: -76.2893, details: { space_a: true } },
    { code: "SAT", name: "San Antonio Intl", city: "San Antonio", state: "TX", lat: 29.5337, lng: -98.4698, details: { space_a: false } },
    { code: "ATL", name: "Hartsfield-Jackson Atlanta Intl", city: "Atlanta", state: "GA", lat: 33.6407, lng: -84.4277, details: { space_a: false } },
  ];
  const airports = await Promise.all(airportDefs.map((a) => prisma.airport.create({ data: a })));
  const airportByCode = new Map(airports.map((a) => [a.code, a]));
  const aid = (code: string) => airportByCode.get(code)!.id;

  await prisma.lounge.createMany({
    data: [
      // USO lounges
      { airportId: aid("BWI"), name: "USO Lounge BWI", terminal: "Terminal A/B Connector", type: "uso", accessPrograms: ["uso", "military"], notes: "Free snacks, Wi-Fi, and quiet space for service members and families." },
      { airportId: aid("SAN"), name: "USO San Diego", terminal: "Terminal 2", type: "uso", accessPrograms: ["uso", "military"], notes: "Open to active duty, reserves, and dependents with ID." },
      { airportId: aid("SAT"), name: "USO San Antonio", terminal: "Terminal A", type: "uso", accessPrograms: ["uso", "military"], notes: "Refreshments and lounge seating near the food court." },
      // Amex Centurion lounges
      { airportId: aid("ATL"), name: "The Centurion Lounge", terminal: "Concourse T", type: "card", accessPrograms: ["amex_centurion", "amex_platinum"], notes: "Chef-curated menu; access for Platinum and Centurion cardmembers." },
      { airportId: aid("SAN"), name: "The Centurion Lounge", terminal: "Terminal 2 East", type: "card", accessPrograms: ["amex_centurion", "amex_platinum"], notes: "Craft cocktails and local bites; Platinum cardmembers welcome." },
      // Priority Pass lounges
      { airportId: aid("BWI"), name: "The Club at BWI", terminal: "Concourse D", type: "card", accessPrograms: ["priority_pass"], notes: "Complimentary snacks and drinks for Priority Pass members." },
      { airportId: aid("ATL"), name: "The Club ATL", terminal: "Concourse F", type: "card", accessPrograms: ["priority_pass"], notes: "International terminal lounge with Priority Pass access." },
      // Delta Sky Club
      { airportId: aid("ATL"), name: "Delta Sky Club", terminal: "Concourse B", type: "card", accessPrograms: ["delta_skyclub"], notes: "Delta Sky Club access for eligible cardmembers and Delta flyers." },
    ],
  });

  // -------------------------------------------------------------------------
  // Articles (~8) — captured for SavedArticle
  // -------------------------------------------------------------------------
  const articleDefs: Prisma.ArticleCreateInput[] = [
    {
      emoji: "🏦",
      title: "TSP allocations: G, F, C, S, I and L funds explained",
      excerpt: "How each Thrift Savings Plan fund works and who they suit.",
      tag: "Retirement",
      category: "Finance",
      readMinutes: 6,
      body: "The Thrift Savings Plan (TSP) offers five core individual funds plus lifecycle (L) funds. The G Fund invests in government securities and never loses principal, making it the most conservative option. The F Fund tracks a broad bond index. The C Fund mirrors the S&P 500 of large U.S. companies, while the S Fund captures small- and mid-cap stocks. The I Fund provides international exposure.\n\nLifecycle (L) funds automatically blend these five funds based on your target retirement date, shifting from stocks toward bonds and the G Fund as that date approaches. Younger service members with a long horizon often weight toward the C, S, and I funds for growth, accepting more volatility in exchange for higher expected returns.\n\nContributing at least enough to capture the full BRS matching (5%) is the single most valuable move most members can make. Consider the Roth TSP if you expect to be in a higher tax bracket in retirement.",
      sections: [
        { id: "funds", heading: "The five core funds", anchor: "funds" },
        { id: "lfunds", heading: "Lifecycle (L) funds", anchor: "lfunds" },
        { id: "matching", heading: "Getting the full match", anchor: "matching" },
      ],
      sources: [{ label: "TSP.gov", url: "https://www.tsp.gov" }],
      trustLabels: ["official_source"],
      source: "TSP.gov",
      lastReviewedAt: daysAgo(20),
    },
    {
      emoji: "🎖️",
      title: "VA disability ratings: how compensation is calculated",
      excerpt: "Combined ratings, dependents, and what changes your monthly amount.",
      tag: "Benefits",
      category: "VA",
      readMinutes: 5,
      body: "VA disability compensation is based on your combined disability rating, expressed from 0% to 100% in 10% increments. When you have multiple conditions, the VA does not simply add the percentages; it uses \"VA math,\" combining them so that each additional condition applies to the remaining healthy portion.\n\nOnce your combined rating reaches 30% or higher, you can add dependents — a spouse, children, and dependent parents — which increases your monthly payment. The exact amount is set annually and adjusted for cost of living.\n\nKeep your evidence current. Filing a fully developed claim with supporting medical records and, where relevant, a nexus letter linking the condition to service, can shorten the decision timeline.",
      sections: [
        { id: "combined", heading: "How combined ratings work", anchor: "combined" },
        { id: "dependents", heading: "Adding dependents", anchor: "dependents" },
        { id: "filing", heading: "Filing a strong claim", anchor: "filing" },
      ],
      sources: [{ label: "VA.gov", url: "https://www.va.gov" }],
      trustLabels: ["official_source"],
      source: "VA.gov",
      lastReviewedAt: daysAgo(15),
    },
    {
      emoji: "💳",
      title: "SCRA and MLA: interest-rate caps you should be using",
      excerpt: "Servicemembers Civil Relief Act protections on cards and loans.",
      tag: "Finance",
      category: "Finance",
      readMinutes: 4,
      body: "The Servicemembers Civil Relief Act (SCRA) caps interest at 6% on debts incurred before you entered active duty, including credit cards, auto loans, and mortgages. The cap is not automatic — you must notify the lender in writing and include a copy of your orders.\n\nThe Military Lending Act (MLA) is broader for debts taken on while serving, capping the Military Annual Percentage Rate at 36% and banning certain fees and mandatory arbitration clauses on covered products.\n\nMany major card issuers go beyond the law and waive annual fees entirely for active-duty members. It is worth calling each issuer to confirm which benefits you qualify for.",
      sections: [
        { id: "scra", heading: "SCRA 6% cap", anchor: "scra" },
        { id: "mla", heading: "MLA 36% cap", anchor: "mla" },
        { id: "fees", heading: "Fee waivers", anchor: "fees" },
      ],
      sources: [{ label: "CFPB", url: "https://www.consumerfinance.gov" }],
      trustLabels: ["reviewed"],
      source: "CFPB",
      lastReviewedAt: daysAgo(30),
    },
    {
      emoji: "🏥",
      title: "TRICARE healthcare plans: choosing the right coverage",
      excerpt: "Prime vs. Select and how to enroll your family.",
      tag: "Healthcare",
      category: "VA",
      readMinutes: 5,
      body: "TRICARE offers several plans, but most active-duty families choose between Prime and Select. TRICARE Prime is a managed-care option with assigned primary care managers and low out-of-pocket costs, but it requires referrals for specialists and works best near a military treatment facility.\n\nTRICARE Select is a fee-for-service plan that lets you see any TRICARE-authorized provider without referrals, trading higher flexibility for higher cost-shares. Your choice often comes down to how close you live to a base and how much provider flexibility you want.\n\nQualifying life events — a PCS move, marriage, or a new child — open enrollment windows. Missing the window can lock you out until the next open season, so update DEERS promptly.",
      sections: [
        { id: "prime", heading: "TRICARE Prime", anchor: "prime" },
        { id: "select", heading: "TRICARE Select", anchor: "select" },
        { id: "enroll", heading: "Enrollment windows", anchor: "enroll" },
      ],
      sources: [{ label: "TRICARE.mil", url: "https://www.tricare.mil" }],
      trustLabels: ["official_source"],
      source: "TRICARE.mil",
      lastReviewedAt: daysAgo(12),
    },
    {
      emoji: "🏠",
      title: "Understanding BAH: how your housing allowance is set",
      excerpt: "Rank, dependents, and ZIP code drive your Basic Allowance for Housing.",
      tag: "Housing",
      category: "Housing",
      readMinutes: 4,
      body: "Basic Allowance for Housing (BAH) is a tax-free payment that helps cover housing costs when you live off-base. Three factors set the amount: your pay grade, whether you have dependents, and the ZIP code of your duty station. Rates are recalculated annually based on local rental market data.\n\nBAH is designed to cover roughly 95% of median housing costs for your rank and location, so members typically pay a small share out of pocket. If you rent below your BAH, you keep the difference; if you rent above it, you cover the overage.\n\nRate protection means your BAH will not drop below what you received when you moved in, even if local rates fall — as long as your status does not change.",
      sections: [
        { id: "factors", heading: "What sets your rate", anchor: "factors" },
        { id: "coverage", heading: "How much it covers", anchor: "coverage" },
        { id: "protection", heading: "Rate protection", anchor: "protection" },
      ],
      sources: [{ label: "Defense Travel Management Office", url: "https://www.travel.dod.mil" }],
      trustLabels: ["official_source"],
      source: "DTMO",
      lastReviewedAt: daysAgo(18),
    },
    {
      emoji: "✈️",
      title: "Space-A travel: a beginner's guide to military hops",
      excerpt: "Sign up, categories, and how to catch a flight on a budget.",
      tag: "Travel",
      category: "Travel",
      readMinutes: 6,
      body: "Space-Available (Space-A) travel lets eligible members and their families fly on military aircraft when seats are open, often for free or a nominal fee. Eligibility falls into six categories, with emergency leave and active-duty environmental morale leave ranked highest.\n\nTo fly, you sign up (\"mark up\") with the passenger terminal at your originating base, either in person, by email, or through the official portal. Your sign-up date and time set your place within your category, so registering early helps.\n\nSpace-A is unpredictable — flights can cancel or fill without notice — so build in buffer days and always have a backup commercial plan. Check terminal Facebook pages for real-time seat releases.",
      sections: [
        { id: "eligibility", heading: "Who qualifies", anchor: "eligibility" },
        { id: "signup", heading: "How to sign up", anchor: "signup" },
        { id: "tips", heading: "Tips for success", anchor: "tips" },
      ],
      sources: [{ label: "AMC Travel", url: "https://www.amc.af.mil" }],
      trustLabels: ["official_source"],
      source: "Air Mobility Command",
      lastReviewedAt: daysAgo(25),
    },
    {
      emoji: "💼",
      title: "Airport lounges and your travel card benefits",
      excerpt: "Priority Pass, Centurion, and Sky Club access explained.",
      tag: "Cards",
      category: "Cards",
      readMinutes: 4,
      body: "Premium travel cards often bundle airport lounge access, which pairs well with military fee waivers that make those cards effectively free to hold. The Platinum Card grants access to Amex Centurion Lounges, Priority Pass, and Delta Sky Clubs when flying Delta, among others.\n\nPriority Pass is the most widely accepted network, with lounges in most large airports. Centurion Lounges are fewer but higher-end. Delta Sky Club access typically requires a same-day Delta boarding pass.\n\nMany airports also host USO lounges, which are free to service members and their families regardless of what card you carry — a valuable option when a paid lounge is crowded or unavailable.",
      sections: [
        { id: "networks", heading: "The main lounge networks", anchor: "networks" },
        { id: "uso", heading: "USO lounges", anchor: "uso" },
        { id: "waivers", heading: "Fee waivers make it free", anchor: "waivers" },
      ],
      sources: [{ label: "USO", url: "https://www.uso.org" }],
      trustLabels: ["reviewed"],
      source: "USO",
      lastReviewedAt: daysAgo(10),
    },
    {
      emoji: "👨‍👩‍👧",
      title: "Military spouse benefits: education, careers, and licensing",
      excerpt: "MyCAA, license reimbursement, and preference hiring.",
      tag: "Family",
      category: "Family",
      readMinutes: 5,
      body: "Military spouses have access to a growing set of benefits designed to offset the career disruption of frequent moves. The My Career Advancement Account (MyCAA) scholarship provides up to $4,000 toward licenses, certifications, or associate degrees for spouses of certain junior-ranking service members.\n\nAfter a PCS move, many states and the Department of Defense will reimburse the cost of transferring professional licenses, up to $1,000. Spouses also receive noncompetitive hiring preference for many federal jobs under Executive Order authorities.\n\nInstallation family readiness centers and the Military Spouse Employment Partnership connect spouses with employers who have committed to hiring and retaining military spouses.",
      sections: [
        { id: "mycaa", heading: "MyCAA scholarship", anchor: "mycaa" },
        { id: "licensing", heading: "License reimbursement", anchor: "licensing" },
        { id: "hiring", heading: "Federal hiring preference", anchor: "hiring" },
      ],
      sources: [{ label: "Military OneSource", url: "https://www.militaryonesource.mil" }],
      trustLabels: ["official_source"],
      source: "Military OneSource",
      lastReviewedAt: daysAgo(22),
    },
  ];

  const articles = await Promise.all(articleDefs.map((a) => prisma.article.create({ data: a })));

  // -------------------------------------------------------------------------
  // State benefits (~8) across TX, CA, VA, FL, WA, CO
  // -------------------------------------------------------------------------
  await prisma.stateBenefit.createMany({
    data: [
      { state: "TX", category: "Education", title: "Hazlewood Act tuition exemption", body: "Up to 150 credit hours at Texas public colleges and universities for eligible veterans and their dependents.", status: "veteran", source: "Texas Veterans Commission", lastReviewedAt: daysAgo(30) },
      { state: "TX", category: "Property Tax", title: "Disabled Veteran Property Tax Exemption", body: "Partial to full homestead property tax exemption scaled to VA disability rating; 100% rated veterans may owe no property tax.", status: "veteran", source: "Texas Comptroller", lastReviewedAt: daysAgo(28) },
      { state: "CA", category: "Property Tax", title: "Disabled Veterans' Exemption", body: "Property tax exemption for qualifying disabled veterans, with a higher exemption for low-income households.", status: "veteran", source: "CA State Board of Equalization", lastReviewedAt: daysAgo(26) },
      { state: "VA", category: "Education", title: "Virginia Military Survivors & Dependents Program", body: "Tuition waiver at Virginia public institutions for eligible spouses and children of qualifying veterans.", status: "family", source: "Virginia DVS", lastReviewedAt: daysAgo(24) },
      { state: "VA", category: "Recreation", title: "Free lifetime state park pass", body: "Honorably discharged veterans with a service-connected disability receive free admission and discounted camping at Virginia state parks.", status: "veteran", source: "Virginia DCR", lastReviewedAt: daysAgo(20) },
      { state: "FL", category: "Property Tax", title: "Homestead Exemption for Disabled Veterans", body: "Additional homestead exemptions and, for 100% permanent and total disabilities, a full exemption from property taxes.", status: "veteran", source: "Florida Department of Veterans' Affairs", lastReviewedAt: daysAgo(18) },
      { state: "WA", category: "Education", title: "Washington Tuition Waiver", body: "State universities may waive tuition and fees for eligible veterans and National Guard members.", status: "veteran", source: "Washington DVA", lastReviewedAt: daysAgo(16) },
      { state: "CO", category: "Recreation", title: "Colorado Disabled Veteran Lifetime Pass", body: "Free lifetime hunting and fishing combination license for resident veterans with a qualifying disability.", status: "veteran", source: "Colorado Parks & Wildlife", lastReviewedAt: daysAgo(14) },
    ],
  });

  // -------------------------------------------------------------------------
  // Health resources / facilities
  // -------------------------------------------------------------------------
  await prisma.healthResource.createMany({
    data: [
      { category: "Mental Health", title: "Veterans Crisis Line", body: "Dial 988 then press 1, or text 838255 for confidential support 24/7.", source: "VA.gov" },
      { category: "TRICARE", state: "CA", title: "TRICARE West enrollment", body: "How to enroll and find network providers in the TRICARE West region.", source: "TRICARE.mil" },
    ],
  });
  await prisma.healthFacility.createMany({
    data: [
      { name: "Walter Reed National Military Medical Center", category: "Hospital", address: "8901 Rockville Pike", city: "Bethesda", state: "MD", lat: 39.0009, lng: -77.0955, phone: "301-295-4000" },
      { name: "Naval Medical Center San Diego", category: "Hospital", address: "34800 Bob Wilson Dr", city: "San Diego", state: "CA", lat: 32.7076, lng: -117.1503, phone: "619-532-6400" },
      { name: "Brooke Army Medical Center", category: "Hospital", address: "3551 Roger Brooke Dr", city: "Fort Sam Houston", state: "TX", lat: 29.4599, lng: -98.4382, phone: "210-916-4141" },
      { name: "Audie L. Murphy VA Hospital", category: "VA Medical Center", address: "7400 Merton Minter Blvd", city: "San Antonio", state: "TX", lat: 29.5108, lng: -98.5772, phone: "210-617-5300" },
    ],
  });

  // -------------------------------------------------------------------------
  // Announcements (4)
  // -------------------------------------------------------------------------
  await prisma.announcement.createMany({
    data: [
      { title: "Airports & lounges is here", body: "Browse military-friendly airports, Space-A hubs, and lounges your travel cards unlock — all in one place.", kind: "feature", deeplink: "valor://airports", publishedAt: daysAgo(3), active: true },
      { title: "New discounts added near you", body: "We added dozens of verified local and national military discounts across DC, San Diego, and San Antonio.", kind: "benefit", deeplink: "valor://discover", publishedAt: daysAgo(6), active: true },
      { title: "2026 BAH rates published", body: "Housing allowance rates for the new year are live. Check how your allowance changed for your duty station.", kind: "news", deeplink: "valor://library/bah", publishedAt: daysAgo(9), active: true },
      { title: "Limited time: tax season checklist", body: "Free filing resources and a service-member tax checklist available through April.", kind: "alert", deeplink: "valor://library/taxes", publishedAt: daysAgo(1), expiresAt: daysFromNow(60), active: true },
    ],
  });

  // -------------------------------------------------------------------------
  // Demo user + related records
  // -------------------------------------------------------------------------
  const demoEmail = "demo@valorapp.com";
  const user = await prisma.user.create({
    data: {
      email: demoEmail,
      passwordHash: await argon2.hash("password123"),
      name: "Alex",
      onboardingComplete: true,
      status: "active",
      branch: "army",
      payCategory: "enlisted",
      payGrade: "E-5",
      yearsServed: 6,
      goal: "maximize_benefits",
      zip: "20001",
      lat: DC.lat,
      lng: DC.lng,
      knowsTsp: true,
    },
  });

  await prisma.tspSnapshot.create({
    data: {
      userId: user.id,
      balanceCents: 2_620_000,
      contributionPct: 10,
      allocation: { G: 10, F: 10, C: 50, S: 20, I: 10, L: 0 },
    },
  });

  await prisma.payProfile.create({
    data: {
      userId: user.id,
      dependents: 2,
      married: true,
      livesOnBase: false,
      specialPays: [{ id: "hazard", monthly_cents: 15000 }],
      additionalIncomeCents: 50000,
      stateOfResidence: "VA",
      vaRating: 30,
      vaMarried: true,
      vaChildren: 2,
      vaDependentParents: 0,
    },
  });

  await prisma.monthlyBill.createMany({
    data: [
      { userId: user.id, label: "Car payment", amountCents: 45000, category: "transport" },
      { userId: user.id, label: "Phone", amountCents: 9000, category: "utilities" },
      { userId: user.id, label: "Renters insurance", amountCents: 2500, category: "insurance" },
    ],
  });

  const userCard = await prisma.userCard.create({
    data: {
      userId: user.id,
      productId: amexPlatinum.id,
      openedOn: daysAgo(400),
    },
  });

  await prisma.cardBenefitUsage.create({
    data: {
      userCardId: userCard.id,
      benefitId: "uber_cash",
      periodKey,
      usedAmountCents: 1000, // partially used this month (of 1500)
    },
  });

  await prisma.savedArticle.createMany({
    data: [
      { userId: user.id, articleId: articles[0]!.id }, // TSP allocations
      { userId: user.id, articleId: articles[6]!.id }, // Airport lounges & cards
    ],
  });

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  const [placeCount, freeCount] = await Promise.all([
    prisma.place.count(),
    prisma.place.count({ where: { type: "free" } }),
  ]);
  console.log("Seed complete.");
  console.log(`  Brands:          ${brands.length}`);
  console.log(`  Places:          ${placeCount} (${freeCount} free resources)`);
  console.log(`  Card products:   4`);
  console.log(`  Airports:        ${airports.length}`);
  console.log(`  Lounges:         8`);
  console.log(`  Articles:        ${articles.length}`);
  console.log(`  State benefits:  8`);
  console.log(`  Health facilities: 4`);
  console.log(`  Announcements:   4`);
  console.log(`  Demo user:       ${demoEmail} / password123`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
