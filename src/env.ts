import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(8080),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // 32+ chars: a short HMAC secret is offline-brute-forceable from any
  // captured token. Production uses 96-char random strings.
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),

  CORS_ORIGINS: z.string().default("*"),
  PUBLIC_BASE_URL: z.string().default("http://localhost:8080"),

  // Optional keys for official-data ingestion (see src/ingest). Absent → that
  // adapter is skipped with a note; the server itself never needs them.
  NPS_API_KEY: z.string().optional(),
  VA_API_KEY: z.string().optional(),
  // Override the VA Facilities base URL. Default is production; set to
  // https://sandbox-api.va.gov/services/va_facilities/v1 to use a sandbox key.
  VA_FACILITIES_BASE: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error(
    "Invalid environment configuration:\n" +
      parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n"),
  );
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
