/**
 * ESLint flat config.
 * File path: /eslint.config.mjs
 *
 * `next lint` is deprecated in Next 15, so `npm run lint` calls ESLint
 * directly (same setup as the stretch_metal website). FlatCompat bridges
 * the classic `next/core-web-vitals` and `next/typescript` shareable
 * configs into the flat-config world.
 *
 * Engine rule: the geometry and pricing engines may not use `any` — the
 * override below turns the recommended warning into an error there.
 */
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      "out/**",
      "node_modules/**",
      "next-env.d.ts",
      "supabase/.temp/**",
      "test/fixtures/**",
      "coverage/**",
    ],
  },
  {
    files: ["lib/geometry/**/*.ts", "lib/pricing/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
];

export default eslintConfig;
