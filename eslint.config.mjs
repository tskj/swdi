import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Ban `.limit(1)` on Drizzle queries — it silently hides a uniqueness bug. Express the intended
// cardinality with the cardinality.ts helpers instead: `.single(ctx)` / `.maybeSingle(ctx)` when
// ≤1 row is an invariant (a 2nd row fails loudly), `.exists()` when you only care whether any
// row matches, or `.first(ctx)` / `.maybeFirst(ctx)` for a deliberate top-of-many pick (pair
// with `.orderBy`). See src/lib/cardinality.ts. `.limit(n)` for any other n is fine.
const noLimit1 = {
  selector: "CallExpression[callee.property.name='limit'][arguments.0.value=1]",
  message:
    "Don't use .limit(1) — it hides duplicate-row bugs. Use .single(ctx)/.maybeSingle(ctx) (≤1 invariant), .exists() (presence), or .first(ctx)/.maybeFirst(ctx) (top-of-many, with .orderBy). See src/lib/cardinality.ts.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next, plus workspace build output.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "extension/dist/**",
  ]),
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", noLimit1],
    },
  },
  // e2e specs serialize evaluate() callbacks into the browser/extension context, where the
  // node-side types genuinely don't reach; `any` at that boundary is honest.
  {
    files: ["e2e/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;
