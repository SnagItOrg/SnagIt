import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

// Flat-config equivalent of the retired .eslintrc.json
// ({ "extends": ["next/core-web-vitals", "next/typescript"] }).
// Next.js 16 removed `next lint`; `npm run lint` now calls the ESLint CLI.
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // PAN-167 is a pure framework upgrade, so the lint contract stays what it
    // was on Next 15. eslint-config-next 16 ships eslint-plugin-react-hooks 7,
    // whose recommended set adds React Compiler rules. Two of them fire on
    // existing code (24 + 4 sites, none in this diff); adopting them means
    // rewriting effects, which is its own ticket. Every other new rule passes
    // and stays on.
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
    },
    // ESLint 8 did not report stale disable directives; ESLint 9 warns on them
    // by default. Keep the Next 15 behaviour.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
])

export default eslintConfig
