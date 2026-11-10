// Lint rules: correctness checks plus a few style rules Prettier doesn't cover.
const browser = [
    'window',
    'document',
    'localStorage',
    'navigator',
    'performance',
    'location',
    'Image',
    'Blob',
    'URL',
    'Event',
    'TextEncoder',
    'getComputedStyle',
    'requestAnimationFrame',
    'setTimeout',
    'clearTimeout',
    'console',
    'confirm',
    'self',
];
const node = ['process', 'console'];
const globals = (names) => Object.fromEntries(names.map((n) => [n, 'readonly']));

export default [
    {
        files: ['**/*.js'],
        languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
        rules: {
            'no-unused-vars': ['warn', { args: 'none' }],
            'no-undef': 'error',
            'one-var': ['error', 'never'],
            'prefer-const': ['error', { destructuring: 'all' }],
            'no-var': 'error',
            eqeqeq: ['error', 'smart'],
        },
    },
    { files: ['src/**/*.js'], languageOptions: { globals: globals(browser) } },
    { files: ['cli.js', 'test/**/*.js', 'eslint.config.js'], languageOptions: { globals: globals(node) } },
];
