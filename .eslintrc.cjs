module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  settings: { react: { version: '18.2' } },
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    'react/prop-types': 'off',
    'react/react-in-jsx-scope': 'off',
  },
  overrides: [
    {
      // Context files export both Provider components and hooks - this is intentional
      files: ['src/context/**/*.jsx', 'src/components/robot/RobotFace.jsx'],
      rules: {
        'react-refresh/only-export-components': 'off',
      },
    },
    {
      // Test files — allow vitest globals and test utilities
      files: ['src/**/*.test.{js,jsx}', 'src/test/**/*.{js,jsx}'],
      env: { node: true },
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
        global: 'readonly',
      },
      rules: {
        'react-refresh/only-export-components': 'off',
      },
    },
  ],
}
