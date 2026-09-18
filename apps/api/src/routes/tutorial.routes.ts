import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../lib/auth.js';

/**
 * O tutorial é servido pelo próprio sistema: ao logar pela primeira vez o
 * usuário recebe, passo a passo, tudo o que precisa fazer. Cada passo aponta
 * para a rota e para o elemento da tela (anchor) que o tour destaca.
 */
export const STEPS = [
  {
    id: 1,
    key: 'boas-vindas',
    title: 'Bem-vindo ao EstoqueFlow',
    body:
      'Em menos de 5 minutos seu estoque estará rodando. Esta plataforma é a responsável pela ' +
      'gestão de estoque entre os dois depósitos da operação: tudo que entra, sai ou muda de ' +
      'lugar passa por aqui — e só por aqui.',
    route: '/app',
    anchor: null,
    action: 'Começar',
  },
  {
    id: 2,
    key: 'depositos',
    title: 'Passo 1 — Confira seus depósitos',
    body:
      'Sua operação trabalha com dois depósitos: DEP-1 (Depósito 1 · Superior) e DEP-2 ' +
      '(Depósito 2 · Inferior). Todo saldo no sistema é sempre "produto × depósito" — nunca ' +
      'um número solto: você sempre sabe se a peça está em cima ou embaixo.',
    route: '/app/depositos',
    anchor: 'warehouses-table',
    action: 'Ver depósitos',
  },
  {
    id: 3,
    key: 'produtos',
    title: 'Passo 2 — Cadastre seus produtos',
    body:
      'Este estoque NÃO tem etiqueta e NÃO é identificado por código: o que importa é a ' +
      'descrição. Escreva o nome como a equipe fala ("Tubo marrom de 20 mm"), informe a ' +
      'unidade (UN, MT, PC…), o tamanho/bitola e, quando o item for vendido por medida, a ' +
      'metragem. Código interno e código de barras existem, mas são opcionais — o sistema ' +
      'gera o código sozinho.',
    route: '/app/produtos',
    anchor: 'btn-novo-produto',
    action: 'Cadastrar produto',
  },
  {
    id: 4,
    key: 'entrada',
    title: 'Passo 3 — Dê entrada no estoque',
    body:
      'Preencha o formulário de Entrada: produto, depósito de destino, quantidade e custo ' +
      'unitário. O sistema recalcula sozinho o custo médio ponderado do depósito.',
    route: '/app/movimentacoes/entrada',
    anchor: 'form-entrada',
    action: 'Lançar entrada',
  },
  {
    id: 5,
    key: 'saida',
    title: 'Passo 4 — Registre saídas',
    body:
      'Consumo, perda, devolução ao fornecedor: tudo entra como Saída, sempre com motivo. ' +
      'O sistema bloqueia saldo negativo — se faltar, ele avisa antes de gravar.',
    route: '/app/movimentacoes/saida',
    anchor: 'form-saida',
    action: 'Lançar saída',
  },
  {
    id: 6,
    key: 'transferencia',
    title: 'Passo 5 — Transfira entre os depósitos',
    body:
      'Este é o coração da operação de logística: escolha origem, destino e quantidade. ' +
      'A baixa e a entrada acontecem na mesma transação — ou as duas ocorrem, ou nenhuma. ' +
      'O custo médio viaja junto com a mercadoria.',
    route: '/app/movimentacoes/transferencia',
    anchor: 'form-transferencia',
    action: 'Transferir',
  },
  {
    id: 7,
    key: 'pdv',
    title: 'Passo 6 — Venda no balcão',
    body:
      'Digite qualquer palavra do produto ("tubo 20 marrom") e escolha na lista — ela já mostra ' +
      'o saldo de cada depósito. Não precisa de etiqueta nem de código. Se você tiver leitor de ' +
      'código de barras, pode bipar no mesmo campo. Informe o pagamento e finalize: a baixa é ' +
      'automática e o cupom fica salvo.',
    route: '/app/pdv',
    anchor: 'pdv-scanner',
    action: 'Abrir PDV',
  },
  {
    id: 8,
    key: 'inventario',
    title: 'Passo 7 — Faça a contagem física',
    body:
      'Abra uma contagem por depósito, ache cada item pela descrição, lance o que foi contado, ' +
      'apure as divergências e aplique. Cada ajuste vira um movimento rastreável — nada some ' +
      'do histórico.',
    route: '/app/inventario',
    anchor: 'btn-nova-contagem',
    action: 'Abrir contagem',
  },
  {
    id: 9,
    key: 'relatorios',
    title: 'Passo 8 — Acompanhe pelos relatórios',
    body:
      'Valor em estoque por depósito, produtos abaixo do mínimo, curva ABC, giro e cobertura em ' +
      'dias. Tudo exportável em CSV.',
    route: '/app/relatorios',
    anchor: 'reports-tabs',
    action: 'Ver relatórios',
  },
  {
    id: 10,
    key: 'planilha',
    title: 'Passo 9 — A planilha espelho',
    body:
      'Toda movimentação é replicada para o Google Sheets como redundância. Importante: a ' +
      'planilha é SOMENTE LEITURA. Se alguém editar à mão, o guardião do sistema reverte o valor ' +
      'automaticamente e registra quem mexeu.',
    route: '/app/integracoes',
    anchor: 'sync-status',
    action: 'Ver integração',
  },
  {
    id: 11,
    key: 'fim',
    title: 'Pronto! Seu estoque está no ar',
    body:
      'Você pode rever este tutorial quando quiser pelo menu do seu usuário → "Refazer tutorial". ' +
      'Bom trabalho!',
    route: '/app',
    anchor: null,
    action: 'Concluir',
  },
];

export default async function tutorialRoutes(app: FastifyInstance) {
  app.get('/tutorial', { preHandler: authenticate }, async (req) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    const [produtos, movimentos, vendas, contagens] = await Promise.all([
      prisma.product.count({ where: { companyId: req.user!.companyId } }),
      prisma.movement.count({ where: { companyId: req.user!.companyId } }),
      prisma.sale.count({ where: { companyId: req.user!.companyId } }),
      prisma.inventoryCount.count({ where: { companyId: req.user!.companyId } }),
    ]);

    return {
      steps: STEPS,
      currentStep: user?.tutorialStep ?? 0,
      done: user?.tutorialDone ?? false,
      /** Checklist real — o sistema sabe o que já foi feito de verdade */
      checklist: {
        produtosCadastrados: produtos,
        movimentacoesFeitas: movimentos,
        vendasRealizadas: vendas,
        contagensAbertas: contagens,
      },
    };
  });
}
