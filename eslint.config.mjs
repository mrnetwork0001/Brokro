import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * ESLint 9 flat config.
 *
 * `npm run lint` had been failing outright since the repo moved to ESLint 9,
 * which stopped reading `.eslintrc.*` and found no `eslint.config.*` to read
 * instead. Both Next presets already ship as flat arrays, so they spread in
 * directly with no FlatCompat shim.
 */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      // Build products and fetched media, not source.
      "video/out/**",
      "video/public/**",
      "video/data/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // `({ plannedFrames, ...rest }) => rest` is how the timing script drops
      // internal fields before writing timing.json. The discarded names are
      // the point of the expression, not an oversight.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { ignoreRestSiblings: true, argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default config;
