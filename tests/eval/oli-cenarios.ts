/**
 * Cenários da simulação do Oli (nível 2), derivados de pedidos reais em que ele negou o que as ferramentas fazem.
 * Nomes genéricos; nenhum dado real da família.
 */
import { NENHUMA, type Cenario } from "./oli-harness";

/** Recusas falsas que o histórico real mostrou. */
export const RECUSAS: RegExp[] = [
  /não (consigo|posso|tenho como) (te )?(montar|criar|mostrar|exibir|gerar|fazer) (um |o |esse |este )?(painel|relatório|gráfico|tela|lista)/i,
  /não (consigo|posso) (montar|criar|mostrar|exibir|gerar)/i,
  /não (tenho|possuo) acesso/i,
  /reenvi/i,
];
const NAO_ACHEI = /não (encontrei|achei|localizei)/i;
const NAO_LEMBRO = /não (me )?lembro/i;

const R = RECUSAS;
const RN = [...RECUSAS, NAO_ACHEI];

export const OLI_CENARIOS: Cenario[] = [
  // Painel = consulta com filtro
  { id: "painel-alimentacao-fora", texto: "Monte um painel detalhado com os gastos com alimentação fora de casa deste mês", aceitas: ["consultar_financas"], proibidas: R },
  {
    id: "painel-recusa-antiga-no-historico",
    texto: "Me mostra um painel com os gastos de restaurante do mês passado",
    aceitas: ["consultar_financas"],
    proibidas: R,
    historico: [
      { role: "user", content: "Monta um painel com os gastos de mercado" },
      { role: "model", content: "Desculpa, não consigo criar um painel personalizado, mas posso te falar o total." },
    ],
  },
  { id: "relatorio-mercado", texto: "Faz um relatório detalhado dos gastos com mercado no mês passado", aceitas: ["consultar_financas", "analisar"], proibidas: R },
  { id: "tela-metas", texto: "Mostra a tela das metas financeiras", aceitas: ["consultar_financas"], proibidas: R },
  { id: "transporte-com-analise", texto: "Quanto gastei com transporte este mês e o que você acha disso?", aceitas: ["consultar_financas", "analisar"], proibidas: R },

  // Igreja
  { id: "carisma-resumo-aula", texto: "Leia o resumo da aula de louvor do Carisma", aceitas: ["consultar_igreja", "buscar_no_app"], proibidas: RN },
  { id: "carisma-anotacoes", texto: "O que eu anotei na última aula do Carisma?", aceitas: ["consultar_igreja", "buscar_no_app"], proibidas: RN },
  { id: "lista-oracoes", texto: "Me mostra a lista de pedidos de oração", aceitas: ["consultar_igreja"], proibidas: R },
  {
    id: "proposito-ainda-nao-confirmado",
    texto: "Cadê o propósito que você acabou de criar?",
    aceitas: [NENHUMA, "consultar_igreja"],
    proibidas: RN,
    exigidas: [/confirm/i],
    historico: [
      { role: "user", content: "Cria um propósito de ler a Bíblia toda manhã" },
      { role: "model", content: "Opa, preparei o propósito Ler a Bíblia toda manhã. Confere na tela e toca em Confirmar." },
    ],
  },

  // Saúde e documentos
  { id: "remedios-para-tomar", texto: "Me mostra os remédios que preciso tomar", aceitas: ["consultar_saude", "buscar_no_app"], proibidas: RN },
  { id: "remedios-do-preparo", texto: "Quais remédios o preparo da colonoscopia que está em Saúde manda tomar?", aceitas: ["consultar_saude", "buscar_no_app", "ler_arquivo"], proibidas: RN },
  { id: "doses-do-preparo", texto: "Quais são as doses e os horários do preparo do exame guardado em Saúde?", aceitas: ["consultar_saude", "buscar_no_app", "ler_arquivo"], proibidas: RN },
  { id: "lista-consultas", texto: "Me mostra uma lista das consultas médicas que já fiz este ano", aceitas: ["consultar_saude"], proibidas: R },
  { id: "historico-colesterol", texto: "Mostra o histórico do meu colesterol", aceitas: ["consultar_exames_lab", "consultar_saude"], proibidas: R },
  { id: "marcar-dentista", texto: "Marca dentista para o Lucas dia 3 de dezembro às 14h", aceitas: ["criar_consulta", NENHUMA], ferramentasProibidas: ["criar_evento"], proibidas: R },
  { id: "marcar-psicologa", texto: "Agenda uma consulta com a psicóloga na terça que vem às 10h para mim", aceitas: ["criar_consulta", NENHUMA], ferramentasProibidas: ["criar_evento"], proibidas: R },

  // Arquivo do "+"
  { id: "arquivo-pelo-mais", texto: "O que diz o arquivo que te mandei pelo +?", aceitas: ["ler_ultimo_arquivo"], proibidas: RN },
  { id: "pdf-que-enviei", texto: "Lê o PDF que eu acabei de te enviar e me fala o valor total", aceitas: ["ler_ultimo_arquivo"], proibidas: RN },

  // Casa e contas
  { id: "boleto-internet", texto: "Preciso pagar o boleto da internet de novembro", aceitas: ["buscar_no_app", "consultar_casa", "consultar_financas", "documentos_recentes", "contas_a_pagar"], proibidas: RN },
  { id: "contrato-aluguel", texto: "Onde está guardado o contrato do aluguel?", aceitas: ["buscar_no_app", "consultar_casa"], proibidas: RN },
  { id: "lista-compras", texto: "O que tem na lista de compras?", aceitas: ["consultar_casa"], proibidas: R },
  { id: "tarefas-da-casa", texto: "Quais tarefas da casa estão pendentes essa semana?", aceitas: ["consultar_casa"], proibidas: R },

  // Pet
  { id: "vacina-do-cachorro", texto: "Quando é a próxima vacina do cachorro?", aceitas: ["consultar_pet"], proibidas: RN },
  { id: "racao-do-cachorro", texto: "Quanto de ração o cachorro come por dia?", aceitas: ["consultar_pet"], proibidas: R },

  // Agenda
  { id: "evento-comum", texto: "Coloca na agenda o aniversário da Ana no sábado às 15h", aceitas: ["criar_evento", NENHUMA], ferramentasProibidas: ["criar_consulta"], proibidas: R },
  { id: "agenda-da-semana", texto: "O que tenho na agenda essa semana?", aceitas: ["agenda_periodo"], proibidas: R },

  // Memória
  { id: "a-partir-de-agora", texto: "A partir de agora, sempre fala os valores sem os centavos", aceitas: ["salvar_memoria"], proibidas: R },
  { id: "prefiro", texto: "Prefiro que você me chame de chefe, guarda isso", aceitas: ["salvar_memoria"], proibidas: R },
  { id: "o-que-eu-pedi", texto: "O que foi que eu te pedi sobre a viagem de férias?", aceitas: ["consultar_memoria", "buscar_conversa"], proibidas: [...R, NAO_LEMBRO] },
  { id: "combinado", texto: "Você lembra o que a gente combinou sobre a mesada?", aceitas: ["consultar_memoria", "buscar_conversa"], proibidas: [...R, NAO_LEMBRO] },

  // Limites reais: lançamento do banco não é apagado pelo Oli
  {
    id: "apagar-lancamento-do-banco",
    texto: "Apaga aquele lançamento de 50 reais do Uber que veio do banco",
    aceitas: [NENHUMA, "consultar_financas", "ultimos_lancamentos"],
    ferramentasProibidas: ["alterar_financas"],
    proibidas: [],
    exigidas: [/não (posso|consigo|dá|é possível)|open finance|banco|tela de finanças/i],
  },

  // Análise e economia
  { id: "onde-economizar", texto: "Onde eu posso economizar nos gastos da casa?", aceitas: ["analisar"], proibidas: R },
  { id: "comparar-meses", texto: "Compara meus gastos de outubro com os de novembro e me diz o que mudou", aceitas: ["analisar", "consultar_financas"], proibidas: R },
];
