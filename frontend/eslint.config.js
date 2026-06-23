import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Advisory React-Compiler / Fast-Refresh rules inherited from the recommended
      // presets. They fire on correct, idiomatic code (e.g. setLoading(true) at the
      // top of a data-loading effect, or a context module exporting both its Provider
      // and its useX hook). Kept as warnings so they stay visible for incremental
      // cleanup without blocking the build/CI. Promote back to "error" once addressed.
      'react-hooks/set-state-in-effect': 'warn',
      'react-refresh/only-export-components': 'warn',
    },
  },
])
