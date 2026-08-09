/**
 * Nome e cor de cada banco.
 *
 * Cor de marca serve para identificação instantânea: com dois cartões na mesma
 * tela, ler "Itaú"/"Nubank" em texto cinza é lento. Laranja e roxo são
 * reconhecidos antes da leitura.
 */

export interface Banco {
  rotulo: string;
  /** cor de marca, usada em gráficos e no fundo do selo sem logo */
  cor: string;
  /** cor do texto sobre a cor de marca */
  contraste: string;
  /** arquivo em public/logos. Sem isso, cai no quadrado com a inicial. */
  logo?: string;
}

/**
 * O texto sobre laranja é ESCURO, não branco, de propósito.
 *
 * Branco sobre o laranja do Itaú (#EC7000) dá 3,05:1 de contraste — abaixo do
 * mínimo de 4,5:1 do WCAG AA para texto pequeno, e o selo mini tem 11px. Com
 * texto escuro sobe para 5,4:1, mantendo o laranja da marca. Mesmo caso no
 * Inter, que é ainda mais claro (2,61:1 com branco).
 */
const ESCURO = '#1f1200';

const BANCOS: Record<string, Banco> = {
  nubank:    { rotulo: 'Nubank',          cor: '#820AD1', contraste: '#ffffff', logo: '/logos/nubank.webp' },
  itau:      { rotulo: 'Itaú',            cor: '#EC7000', contraste: ESCURO,    logo: '/logos/itau.svg' },
  bradesco:  { rotulo: 'Bradesco',        cor: '#CC092F', contraste: '#ffffff' },
  santander: { rotulo: 'Santander',       cor: '#EC0000', contraste: '#ffffff' },
  bb:        { rotulo: 'Banco do Brasil', cor: '#0038A8', contraste: '#ffffff' },
  caixa:     { rotulo: 'Caixa',           cor: '#0070AF', contraste: '#ffffff' },
  inter:     { rotulo: 'Inter',           cor: '#FF7A00', contraste: ESCURO },
  c6:        { rotulo: 'C6 Bank',         cor: '#1f1f1f', contraste: '#ffffff' },
  manual:    { rotulo: 'Dinheiro / VR',   cor: '#4b5563', contraste: '#ffffff' },
};

const PADRAO: Banco = { rotulo: '', cor: '#6b7280', contraste: '#ffffff' };

export function banco(instituicao: string): Banco {
  const b = BANCOS[instituicao];
  if (b) return b;
  return {
    ...PADRAO,
    rotulo: instituicao ? instituicao[0].toUpperCase() + instituicao.slice(1) : '—',
  };
}

export const rotuloBanco = (instituicao: string) => banco(instituicao).rotulo;

/** Chaves conhecidas, para preencher um select. Ordem alfabética pelo rótulo. */
export function listarBancos(): string[] {
  return Object.keys(BANCOS).sort((a, b) =>
    BANCOS[a].rotulo.localeCompare(BANCOS[b].rotulo, 'pt-BR'));
}

/**
 * Marca visual do banco.
 *
 * São formas estilizadas nas cores da marca, não os logotipos oficiais —
 * reproduzir logo de banco é uso de marca registrada, e o objetivo aqui é só
 * reconhecimento rápido dentro do app. Nubank usa o quadrado arredondado roxo,
 * Itaú o quadrado laranja, cada um com a inicial.
 */
export function marcaSvg(instituicao: string): { letra: string; raio: number } {
  const iniciais: Record<string, string> = {
    nubank: 'N', itau: 'I', bradesco: 'B', santander: 'S',
    bb: 'BB', caixa: 'C', inter: 'i', c6: 'C6', manual: '$',
  };
  // Nubank e Inter usam cantos bem arredondados; Itaú é mais quadrado.
  const raios: Record<string, number> = { nubank: 8, inter: 8, itau: 4, c6: 4 };
  return {
    letra: iniciais[instituicao] ?? (instituicao[0]?.toUpperCase() ?? '?'),
    raio: raios[instituicao] ?? 6,
  };
}
