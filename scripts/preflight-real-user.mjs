import fs from "fs";
import pg from "pg";
import nextEnv from "@next/env";

const { Client } = pg;
const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const checks = [];

checkFile("docs/capture-first-roadmap.md");
checkFile("docs/mobile-capture-roadmap.md");
checkFile("docs/client-cloud-boundary.md");
checkFile("docs/real-user-trial-checklist.md");
checkFile("supabase/migrations/20260509_p15_gateway_control_plane.sql");
checkFile("supabase/migrations/20260509_p17_manual_refunds.sql");
checkFile("supabase/migrations/20260509_p18_product_events.sql");
checkFile("src/app/capture/page.tsx");
checkFile("src/app/admin/retention/page.tsx");
checkFile("src/app/admin/account-support/page.tsx");
checkFile("src/app/admin/refunds/page.tsx");

checkSchemaContains("product_events");
checkSchemaContains("sift_gateway_tokens");
checkSchemaContains("sift_gateway_usage_ledger");
checkSchemaContains("support_case_notes");
checkSchemaContains("manual_refunds");

checkEnvRequired("DATABASE_URL");
checkSecretLength("SIFT_SESSION_SECRET", 32);
checkEnvEquals("SIFT_REQUIRE_AUTH", "true", "真实用户试运行应启用登录保护");
checkEnvEquals("SIFT_TRUST_USER_HEADER", "false", "没有上游认证网关时不要信任用户请求头");
checkEnvRecommended("SIFT_ADMIN_EMAILS", "客服台、退款台和留存看板需要管理员白名单");
checkGatewayPair();
checkOptional("SIFT_CLOUD_CONTROL_API_KEY", "启用 Sift Model Gateway 服务端校验时需要配置");
checkOptional("STRIPE_SECRET_KEY", "公开收费前需要配置；人工试用或线下开通可暂缺");
checkOptional("STRIPE_WEBHOOK_SECRET", "公开收费前需要配置；人工试用或线下开通可暂缺");

if (process.argv.includes("--db")) {
  await checkDatabase();
}

const failed = checks.filter((check) => check.status === "fail");
const warnings = checks.filter((check) => check.status === "warn");

for (const check of checks) {
  const icon = check.status === "pass" ? "OK" : check.status === "warn" ? "WARN" : "FAIL";
  console.log(`${icon} ${check.label}${check.detail ? ` - ${check.detail}` : ""}`);
}

console.log("");
console.log(`Preflight complete: ${checks.length - failed.length - warnings.length} passed, ${warnings.length} warnings, ${failed.length} failed.`);

if (failed.length > 0) {
  process.exitCode = 1;
}

function add(status, label, detail = "") {
  checks.push({ detail, label, status });
}

function checkFile(filePath) {
  add(fs.existsSync(filePath) ? "pass" : "fail", `file ${filePath}`, fs.existsSync(filePath) ? "" : "missing");
}

function checkSchemaContains(name) {
  const schema = safeRead("supabase/schema.sql");
  add(schema.includes(name) ? "pass" : "fail", `schema contains ${name}`, schema.includes(name) ? "" : "missing from supabase/schema.sql");
}

function checkEnvRequired(name) {
  add(process.env[name] ? "pass" : "fail", `env ${name}`, process.env[name] ? "configured" : "missing");
}

function checkSecretLength(name, minLength) {
  const value = process.env[name] || "";
  add(value.length >= minLength ? "pass" : "fail", `env ${name}`, value ? `length ${value.length}` : "missing");
}

function checkEnvEquals(name, expected, warning) {
  const actual = process.env[name] || "";
  add(actual === expected ? "pass" : "warn", `env ${name}`, actual === expected ? expected : `${warning}; current=${actual || "unset"}`);
}

function checkEnvRecommended(name, detail) {
  add(process.env[name] ? "pass" : "warn", `env ${name}`, process.env[name] ? "configured" : detail);
}

function checkOptional(name, detail) {
  add(process.env[name] ? "pass" : "warn", `env ${name}`, process.env[name] ? "configured" : detail);
}

function checkGatewayPair() {
  const baseUrl = process.env.SIFT_MODEL_GATEWAY_BASE_URL || "";
  const apiKey = process.env.SIFT_MODEL_GATEWAY_API_KEY || "";
  if (Boolean(baseUrl) === Boolean(apiKey)) {
    add("pass", "Sift Gateway env pair", baseUrl ? "configured" : "not using gateway");
    return;
  }

  add("fail", "Sift Gateway env pair", "SIFT_MODEL_GATEWAY_BASE_URL and SIFT_MODEL_GATEWAY_API_KEY must be configured together");
}

async function checkDatabase() {
  if (!process.env.DATABASE_URL) {
    add("fail", "database connection", "DATABASE_URL missing");
    return;
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const tables = [
    "product_events",
    "sift_gateway_tokens",
    "sift_gateway_usage_ledger",
    "support_case_notes",
    "manual_refunds",
  ];

  try {
    await client.connect();
    for (const table of tables) {
      const result = await client.query("select to_regclass($1) as table_name", [table]);
      add(result.rows[0]?.table_name ? "pass" : "fail", `db table ${table}`, result.rows[0]?.table_name ? "exists" : "missing migration");
    }
  } catch (error) {
    add("fail", "database connection", formatDatabaseError(error));
  } finally {
    await client.end().catch(() => undefined);
  }
}

function formatDatabaseError(error) {
  if (!error || typeof error !== "object") {
    return String(error);
  }

  const code = "code" in error && error.code ? `code=${error.code}` : "";
  const address = "address" in error && error.address ? `address=${error.address}` : "";
  const port = "port" in error && error.port ? `port=${error.port}` : "";
  const message = error instanceof Error && error.message ? error.message : "";

  return [code, address, port, message].filter(Boolean).join(" ");
}

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}
