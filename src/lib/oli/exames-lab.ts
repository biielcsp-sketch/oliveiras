/**
 * Oli: leitura dos exames de laboratório (consultar_exames_lab). Funções puras sobre as linhas do banco (já
 * filtradas pelo RLS da sessão); status, faixa e tendência vêm da MESMA lógica das telas (src/lib/saude/labs).
 * O Oli só relata o que o laudo e as faixas do laboratório mostram: sem diagnóstico, sem remédio, sem dose.
 */
import { brDate } from "@/lib/agenda/dates";
import { normalizeBiomarker, normalizeText } from "@/lib/saude/labs/catalog";
import { STATUS_LABEL, TREND_LABEL, valueLabel, type LabStatus } from "@/lib/saude/labs/status";
import {
  buildOrientations,
  buildSummary,
  indexByMember,
  monthYearShort,
  ORIENTATION_NOTICE,
  trendSentence,
  buildSeries,
  type LabReport,
  type LabResult,
} from "@/lib/saude/labs/summary";
import { consulta, det, grupo, item, type ConsultaData, type ConsultaItem } from "./consultas";

export const MAX_EXAMES_LAB = 60;
const ORDER: Record<LabStatus, number> = { fora: 0, atencao: 1, dentro: 2, sem_faixa: 3 };

export type ExamesLabArgs = { pessoa?: string; biomarcador?: string; de?: string; ate?: string };

/** O exame pedido (texto livre) bate com o resultado: pela chave do catálogo ou pelo nome (sem acento/caixa). */
export function matchesBiomarker(query: string, r: Pick<LabResult, "biomarker_key" | "name">): boolean {
  const n = normalizeBiomarker(query);
  if (n?.known && n.key === r.biomarker_key) return true;
  const q = normalizeText(query);
  return q.length > 0 && (normalizeText(r.name).includes(q) || r.biomarker_key.includes(q.replace(/ /g, "-")));
}

export function buildExamesLab(
  reportsAll: LabReport[],
  resultsAll: LabResult[],
  names: Map<string, string>,
  opts: { memberId?: string | null; pessoa?: string | null; biomarcador?: string; de?: string; ate?: string },
): ConsultaData {
  // Período: só as coletas dentro dele entram (a tendência é entre as coletas do período).
  const reports = reportsAll.filter((r) => (!opts.memberId || r.member_id === opts.memberId) && (!opts.de || r.collected_on >= opts.de) && (!opts.ate || r.collected_on <= opts.ate));
  const ids = new Set(reports.map((r) => r.id));
  const results = resultsAll.filter((r) => ids.has(r.report_id));
  const periodo = opts.de || opts.ate ? `${opts.de ? brDate(opts.de) : "início"} a ${opts.ate ? brDate(opts.ate) : "hoje"}` : null;
  const sufixo = opts.pessoa ? ` de ${opts.pessoa}` : "";
  if (reports.length === 0) {
    return consulta("saude", "exames_lab", `Exames de laboratório${sufixo}`, [], { periodo, aviso: "Nenhum exame de laboratório guardado no app" + (periodo ? " nesse período." : ".") });
  }

  const idx = indexByMember(reports, results);
  const itens: { it: ConsultaItem; st: LabStatus }[] = [];
  for (const [memberId, m] of idx) {
    const pessoa = names.get(memberId) ?? null;
    for (const [key, list] of m.byKey) {
      const cur = list[list.length - 1].result;
      if (opts.biomarcador && !matchesBiomarker(opts.biomarcador, cur)) continue;
      const s = buildSeries(reports, results, memberId, key);
      if (!s?.latest) continue;
      const coletas = list.map((p) => `${monthYearShort(p.report.collected_on)}: ${valueLabel(p.result)}`).join("; ");
      const trend = s.trend && s.prevDate ? trendSentence(s) : null;
      itens.push({
        st: s.latest.status,
        it: item(cur.name, {
          data: s.latest.date,
          pessoa,
          status: STATUS_LABEL[s.latest.status],
          valor: s.latest.num,
          detalhes: [
            `Resultado: ${s.latest.value}${cur.unit ? ` ${cur.unit}` : ""} (coleta de ${brDate(s.latest.date)})`,
            det("Faixa do laboratório", s.latest.range),
            trend ? `Tendência: ${trend}` : s.trend ? `Tendência: ${TREND_LABEL[s.trend.dir]}` : null,
            list.length > 1 ? `Coletas: ${coletas}` : null,
          ],
        }),
      });
    }
  }
  itens.sort((a, b) => ORDER[a.st] - ORDER[b.st] || (a.it.pessoa ?? "").localeCompare(b.it.pessoa ?? "") || a.it.titulo.localeCompare(b.it.titulo, "pt-BR"));
  const lista = itens.map((i) => i.it);
  if (lista.length === 0) {
    return consulta("saude", "exames_lab", `Exames de laboratório${sufixo}`, [], { periodo, aviso: `Nenhum resultado encontrado para “${opts.biomarcador}”.` });
  }

  const grupos = [];
  if (!opts.biomarcador) {
    const sm = buildSummary(reports, results, opts.memberId ?? null);
    const linhas = [
      sm.scorePct !== null ? `${sm.scorePct}% dentro do padrão (${sm.counts.dentro} de ${sm.counts.analisados} com faixa)` : "Nenhum resultado com faixa de referência",
      `Fora do padrão: ${sm.counts.fora}; perto do limite: ${sm.counts.atencao}`,
      sm.collectedOn ? `Última coleta: ${brDate(sm.collectedOn)}` : null,
    ];
    grupos.push(grupo("Resumo", [item("Resumo dos exames", { data: sm.collectedOn, detalhes: linhas })], 1));
    const o = buildOrientations(reports, results, opts.memberId ?? null, names);
    const ori = o.grupos.flatMap((g) => g.itens.map((i) => item(i.titulo, { status: g.titulo, detalhes: [i.texto] })));
    if (ori.length) grupos.push(grupo("Orientações gerais", ori, MAX_EXAMES_LAB));
  }
  grupos.push(grupo("Resultados (mais recentes primeiro os fora do padrão)", lista, MAX_EXAMES_LAB));
  const cortado = lista.length > MAX_EXAMES_LAB ? ` Mostrando ${MAX_EXAMES_LAB} de ${lista.length}; peça um exame ou período específico.` : "";
  return consulta("saude", "exames_lab", `Exames de laboratório${sufixo}`, grupos, { periodo, aviso: `${ORIENTATION_NOTICE}${cortado}` });
}
