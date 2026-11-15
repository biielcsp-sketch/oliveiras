/**
 * Exames de laboratório: catálogo de biomarcadores e normalização do nome que vem do laboratório.
 * Funções puras (servidor e navegador). O nome vindo do PDF é DADO não confiável: aqui ele só vira uma chave
 * conhecida do catálogo ou um slug seguro; nunca decide nada além disso.
 */

/** Mesmas categorias do check da tabela health_lab_results (0025). */
export const LAB_CATEGORIES = [
  "cardiovascular",
  "metabolismo",
  "rins",
  "sangue",
  "tireoide",
  "imunidade",
  "vitaminas_minerais",
  "hormonios",
  "figado",
  "urina",
  "outros",
] as const;
export type LabCategory = (typeof LAB_CATEGORIES)[number];

export const LAB_CATEGORY_LABEL: Record<LabCategory, string> = {
  cardiovascular: "Cardiovascular",
  metabolismo: "Metabolismo",
  rins: "Rins",
  sangue: "Sangue",
  tireoide: "Tireoide",
  imunidade: "Imunidade",
  vitaminas_minerais: "Vitaminas e minerais",
  hormonios: "Hormônios",
  figado: "Fígado",
  urina: "Urina",
  outros: "Outros",
};

export const isLabCategory = (v: unknown): v is LabCategory => (LAB_CATEGORIES as readonly unknown[]).includes(v);

export type Biomarker = { key: string; name: string; category: LabCategory; aliases: string[] };

const b = (key: string, name: string, category: LabCategory, ...aliases: string[]): Biomarker => ({ key, name, category, aliases });

export const BIOMARKERS: Biomarker[] = [
  // Cardiovascular
  b("colesterol-total", "Colesterol total", "cardiovascular", "colesterol", "colesterol total e fracoes", "colesterolemia total"),
  b("colesterol-hdl", "Colesterol HDL", "cardiovascular", "hdl", "hdl colesterol", "colesterol hdl", "hdl-c", "colesterol da hdl"),
  b("colesterol-ldl", "Colesterol LDL", "cardiovascular", "ldl", "ldl colesterol", "colesterol ldl", "ldl-c", "colesterol da ldl", "ldl calculado", "colesterol ldl calculado"),
  b("colesterol-vldl", "Colesterol VLDL", "cardiovascular", "vldl", "vldl colesterol", "colesterol vldl", "vldl-c"),
  b("colesterol-nao-hdl", "Colesterol não HDL", "cardiovascular", "colesterol nao hdl", "nao hdl", "nao-hdl colesterol"),
  b("triglicerides", "Triglicérides", "cardiovascular", "triglicerideos", "triglicerides", "triglicerídeos", "triglicerides total"),
  // Metabolismo
  b("glicose-jejum", "Glicose em jejum", "metabolismo", "glicose", "glicemia", "glicemia de jejum", "glicose jejum", "glicose de jejum", "glicose em jejum"),
  b("hemoglobina-glicada", "Hemoglobina glicada", "metabolismo", "hba1c", "hemoglobina glicosilada", "hemoglobina glicada a1c", "hemoglobina a1c", "a1c"),
  b("insulina-jejum", "Insulina em jejum", "metabolismo", "insulina", "insulina basal", "insulina de jejum", "insulina jejum"),
  b("homa-ir", "HOMA-IR", "metabolismo", "homa ir", "homa-ir", "indice homa"),
  b("acido-urico", "Ácido úrico", "metabolismo", "acido urico", "uricemia"),
  // Rins
  b("creatinina", "Creatinina", "rins", "creatinina serica", "creatinina sanguinea"),
  b("ureia", "Ureia", "rins", "ureia serica", "ureia sanguinea", "ureia plasmatica"),
  b("tfg", "Taxa de filtração glomerular", "rins", "tfg", "taxa de filtracao glomerular", "filtracao glomerular", "egfr", "clearance de creatinina estimado"),
  // Sangue
  b("hemoglobina", "Hemoglobina", "sangue", "hb", "hemoglobina total"),
  b("hematocrito", "Hematócrito", "sangue", "ht", "hematocrito"),
  b("eritrocitos", "Eritrócitos", "sangue", "hemacias", "eritrocitos", "contagem de hemacias", "numero de hemacias"),
  b("leucocitos", "Leucócitos", "sangue", "leucocitos totais", "global de leucocitos", "contagem de leucocitos", "leucograma leucocitos"),
  b("plaquetas", "Plaquetas", "sangue", "contagem de plaquetas", "numero de plaquetas"),
  b("vcm", "VCM", "sangue", "vcm", "volume corpuscular medio"),
  b("hcm", "HCM", "sangue", "hcm", "hemoglobina corpuscular media"),
  b("chcm", "CHCM", "sangue", "chcm", "concentracao de hemoglobina corpuscular media"),
  b("rdw", "RDW", "sangue", "rdw", "rdw-cv", "indice de anisocitose"),
  b("ferro", "Ferro sérico", "sangue", "ferro", "ferro serico", "ferro sanguineo"),
  b("ferritina", "Ferritina", "sangue", "ferritina serica"),
  b("transferrina-saturacao", "Saturação da transferrina", "sangue", "saturacao de transferrina", "indice de saturacao da transferrina", "saturacao da transferrina"),
  // Tireoide
  b("tsh", "TSH", "tireoide", "tsh", "hormonio tireoestimulante", "tireotrofina", "tsh ultrassensivel"),
  b("t4-livre", "T4 livre", "tireoide", "t4 livre", "t4l", "tiroxina livre"),
  b("t3", "T3", "tireoide", "t3", "t3 total", "triiodotironina"),
  // Imunidade
  b("pcr", "Proteína C reativa", "imunidade", "pcr", "proteina c reativa", "pcr ultrassensivel", "proteina c reativa ultrassensivel", "pcr-us"),
  b("vhs", "VHS", "imunidade", "vhs", "velocidade de hemossedimentacao", "velocidade de sedimentacao globular"),
  b("neutrofilos", "Neutrófilos", "imunidade", "neutrofilos", "neutrofilos totais", "segmentados"),
  b("linfocitos", "Linfócitos", "imunidade", "linfocitos", "linfocitos totais", "linfocitos tipicos"),
  b("monocitos", "Monócitos", "imunidade", "monocitos"),
  b("eosinofilos", "Eosinófilos", "imunidade", "eosinofilos"),
  b("basofilos", "Basófilos", "imunidade", "basofilos"),
  // Vitaminas e minerais
  b("vitamina-d", "Vitamina D", "vitaminas_minerais", "vitamina d", "25 hidroxivitamina d", "25-oh vitamina d", "25 oh vitamina d", "vitamina d 25 hidroxi", "vitamina d3", "25(oh) vitamina d"),
  b("vitamina-b12", "Vitamina B12", "vitaminas_minerais", "vitamina b12", "b12", "cobalamina"),
  b("acido-folico", "Ácido fólico", "vitaminas_minerais", "acido folico", "folato", "vitamina b9"),
  b("calcio", "Cálcio", "vitaminas_minerais", "calcio", "calcio total", "calcio serico"),
  b("magnesio", "Magnésio", "vitaminas_minerais", "magnesio", "magnesio serico"),
  b("zinco", "Zinco", "vitaminas_minerais", "zinco", "zinco serico"),
  b("sodio", "Sódio", "vitaminas_minerais", "sodio", "sodio serico"),
  b("potassio", "Potássio", "vitaminas_minerais", "potassio", "potassio serico"),
  b("fosforo", "Fósforo", "vitaminas_minerais", "fosforo", "fosforo serico"),
  // Hormônios
  b("testosterona-total", "Testosterona total", "hormonios", "testosterona", "testosterona total"),
  b("testosterona-livre", "Testosterona livre", "hormonios", "testosterona livre"),
  b("cortisol", "Cortisol", "hormonios", "cortisol", "cortisol basal", "cortisol serico"),
  b("prolactina", "Prolactina", "hormonios", "prolactina"),
  b("estradiol", "Estradiol", "hormonios", "estradiol", "estradiol e2", "17 beta estradiol"),
  b("progesterona", "Progesterona", "hormonios", "progesterona"),
  b("fsh", "FSH", "hormonios", "fsh", "hormonio foliculo estimulante"),
  b("lh", "LH", "hormonios", "lh", "hormonio luteinizante"),
  // Fígado
  b("tgo", "TGO (AST)", "figado", "tgo", "ast", "tgo ast", "ast tgo", "transaminase oxalacetica", "transaminase glutamico oxalacetica", "aspartato aminotransferase"),
  b("tgp", "TGP (ALT)", "figado", "tgp", "alt", "tgp alt", "alt tgp", "transaminase piruvica", "transaminase glutamico piruvica", "alanina aminotransferase"),
  b("gama-gt", "Gama GT", "figado", "gama gt", "gama-gt", "ggt", "gama glutamil transferase", "gama glutamiltransferase"),
  b("fosfatase-alcalina", "Fosfatase alcalina", "figado", "fosfatase alcalina", "fa"),
  b("bilirrubina-total", "Bilirrubina total", "figado", "bilirrubina total", "bilirrubinas totais"),
  b("bilirrubina-direta", "Bilirrubina direta", "figado", "bilirrubina direta", "bilirrubina conjugada"),
  b("albumina", "Albumina", "figado", "albumina", "albumina serica"),
  // Urina
  b("urina-densidade", "Densidade da urina", "urina", "urina densidade", "densidade urinaria", "densidade da urina", "densidade urina"),
  b("urina-ph", "pH da urina", "urina", "urina ph", "ph urinario", "ph da urina", "ph urina"),
  b("urina-proteinas", "Proteínas na urina", "urina", "proteinas urina", "urina proteinas", "proteinas na urina", "proteinuria"),
  b("urina-glicose", "Glicose na urina", "urina", "glicose urina", "urina glicose", "glicose na urina", "glicosuria"),
  b("urina-leucocitos", "Leucócitos na urina", "urina", "leucocitos urina", "urina leucocitos", "leucocitos na urina"),
  b("urina-hemacias", "Hemácias na urina", "urina", "hemacias urina", "urina hemacias", "hemacias na urina"),
];

/** Palavras que não distinguem um exame do outro (ex.: "Ferro sérico" = "Ferro"). */
const NOISE = new Set(["de", "da", "do", "dos", "das", "e", "no", "na", "em", "soro", "sangue", "serico", "serica", "plasma", "dosagem", "exame", "resultado", "total", "calculado", "calculada"]);

/** Minúsculas, sem acento, só letras e números separados por um espaço. */
export function normalizeText(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // "(mg/dL)", "(Soro)"
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Tokens ordenados e sem ruído: "COLESTEROL - LDL" e "LDL Colesterol" dão a mesma assinatura. */
function signature(v: unknown): string {
  const tokens = normalizeText(v)
    .split(" ")
    .filter((t) => t && !NOISE.has(t));
  return [...new Set(tokens)].sort().join(" ");
}

/**
 * Assinatura → exame. "total" é ruído, então "colesterol total" e "colesterol" colidem de propósito:
 * a PRIMEIRA entrada do catálogo com a assinatura vence (colesterol-total vem antes de qualquer outra).
 * Aliases que também aparecem como assinatura de outro exame não são aceitos (ver teste do catálogo).
 */
const BY_SIGNATURE = new Map<string, Biomarker>();
const BY_KEY = new Map<string, Biomarker>();
for (const m of BIOMARKERS) {
  BY_KEY.set(m.key, m);
  for (const a of [m.name, ...m.aliases]) {
    const s = signature(a);
    if (s && !BY_SIGNATURE.has(s)) BY_SIGNATURE.set(s, m);
  }
}

export const biomarkerByKey = (key: string): Biomarker | null => BY_KEY.get(key) ?? null;

/** Slug seguro (a-z, 0-9, hífen) de até 80 letras para exame fora do catálogo. */
export function slugify(v: unknown): string {
  return normalizeText(v).replace(/ /g, "-").slice(0, 80).replace(/-+$/g, "");
}

export type Normalized = { key: string; name: string; category: LabCategory; known: boolean };

/** Nome do laboratório → chave. Exame desconhecido vira "outros" com slug do próprio nome (sem inventar categoria). */
export function normalizeBiomarker(rawName: unknown): Normalized | null {
  const sig = signature(rawName);
  const hit = sig ? BY_SIGNATURE.get(sig) : undefined;
  if (hit) return { key: hit.key, name: hit.name, category: hit.category, known: true };
  const slug = slugify(rawName);
  if (!slug) return null;
  const name = typeof rawName === "string" ? rawName.replace(/\s+/g, " ").trim().slice(0, 160) : slug;
  return { key: slug, name, category: "outros", known: false };
}
