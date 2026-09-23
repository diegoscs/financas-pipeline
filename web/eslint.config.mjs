import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

/**
 * `npm run lint` rodava `next lint`, que nesta versão do Next só abre um
 * assistente interativo perguntando como configurar o ESLint — ou seja, o
 * projeto nunca teve linter de verdade, e o comando travava em CI. O
 * `next lint` também sai de cena no Next 16.
 *
 * Config flat com o preset do Next, que já traz as regras de React, hooks e
 * TypeScript que importam aqui.
 */
const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const config = [
  // `legado/` é arquivo de referência em Python e não entra; `.next` é build.
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
];

export default config;
