"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Check, Info, MoreHorizontal, Sparkles } from "lucide-react";
import { FileButtons } from "@/components/file-buttons";
import { Modal } from "@/components/modal";
import { Button, Card, Field, FormError, Input, Select } from "@/components/ui";
import { normalizeBiomarker } from "@/lib/saude/labs/catalog";
import { LAB_LIMITS, LAB_MAX_FILE_BYTES, type DraftRow } from "@/lib/saude/labs/extraction";
import { parseNumberInput } from "@/lib/saude/labs/input";
import { rangeLabel, statusOf, type LabStatus } from "@/lib/saude/labs/status";
import { extractLabFile, saveLabReport, type LabDraft } from "../../exames-lab/actions";
import type { Person } from "../shared";
import { LabTop, STATUS_TEXT } from "./lab-ui";

const PREVIEW_ROWS = 8;

function rowStatus(r: DraftRow): LabStatus {
  const num = parseNumberInput(r.value);
  return statusOf({
    value_num: num,
    value_text: num === null ? r.value : null,
    ref_min: parseNumberInput(r.ref_min),
    ref_max: parseNumberInput(r.ref_max),
    ref_text: r.ref_text || null,
  });
}

const refOf = (r: DraftRow) =>
  rangeLabel({ ref_min: parseNumberInput(r.ref_min), ref_max: parseNumberInput(r.ref_max), ref_text: r.ref_text || null }, (n) => String(n).replace(".", ",")) ?? "–";

/** Nome trocado → chave e categoria novas pelo catálogo (sem repetir a chave de outra linha). */
function renamed(old: DraftRow, next: DraftRow, list: DraftRow[]): DraftRow {
  if (old.name === next.name) return next;
  const n = normalizeBiomarker(next.name);
  if (!n) return next;
  const taken = new Set(list.filter((x) => x.key !== old.key).map((x) => x.biomarker_key));
  let key = n.key;
  for (let i = 2; taken.has(key); i++) key = `${n.key.slice(0, 76)}-${i}`;
  return { ...next, biomarker_key: key, category: n.category };
}

function RowForm({ row, onSave, onRemove }: { row: DraftRow; onSave: (r: DraftRow) => void; onRemove: () => void }) {
  const [v, setV] = useState(row);
  const set = (k: keyof DraftRow) => (e: ChangeEvent<HTMLInputElement>) => setV((p) => ({ ...p, [k]: e.target.value }));
  const [asking, setAsking] = useState(false);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!v.name.trim() || !v.value.trim()) return;
        onSave({ ...v, name: v.name.trim(), value: v.value.trim() });
      }}
    >
      <Field label="Exame">
        <Input value={v.name} onChange={set("name")} maxLength={LAB_LIMITS.name} required autoComplete="off" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor">
          <Input value={v.value} onChange={set("value")} maxLength={LAB_LIMITS.valueText} required autoComplete="off" inputMode="decimal" />
        </Field>
        <Field label="Unidade">
          <Input value={v.unit} onChange={set("unit")} maxLength={LAB_LIMITS.unit} autoComplete="off" />
        </Field>
        <Field label="Referência mínima">
          <Input value={v.ref_min} onChange={set("ref_min")} maxLength={20} autoComplete="off" inputMode="decimal" />
        </Field>
        <Field label="Referência máxima">
          <Input value={v.ref_max} onChange={set("ref_max")} maxLength={20} autoComplete="off" inputMode="decimal" />
        </Field>
      </div>
      <Field label="Referência em texto (opcional)">
        <Input value={v.ref_text} onChange={set("ref_text")} maxLength={LAB_LIMITS.refText} autoComplete="off" />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="md">
          Salvar linha
        </Button>
        {!asking ? (
          <Button type="button" variant="danger" size="md" onClick={() => setAsking(true)}>
            Remover linha
          </Button>
        ) : (
          <span role="group" aria-label="Confirmar remoção" className="inline-flex items-center gap-2">
            <Button type="button" variant="danger" size="md" onClick={onRemove}>
              Remover mesmo
            </Button>
            <Button type="button" variant="ghost" size="md" onClick={() => setAsking(false)}>
              Não
            </Button>
          </span>
        )}
      </div>
    </form>
  );
}

export function UploadFlow({ people, defaultMember }: { people: Person[]; defaultMember: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<LabDraft | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [date, setDate] = useState("");
  const [lab, setLab] = useState("");
  const [member, setMember] = useState(defaultMember);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  const editingRow = rows.find((r) => r.key === editing) ?? null;
  const shown = all ? rows : rows.slice(0, PREVIEW_ROWS);
  const statuses = useMemo(() => new Map(rows.map((r) => [r.key, rowStatus(r)])), [rows]);

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > LAB_MAX_FILE_BYTES) return setError("O arquivo passa de 5 MB.");
    setError(null);
    setBusy(true);
    const form = new FormData();
    form.set("file", f);
    const r = await extractLabFile(form).catch(() => ({ ok: false as const, erro: "Não consegui ler o arquivo agora. Tente de novo." }));
    setBusy(false);
    if (!r.ok) return setError(r.erro);
    setFile(f);
    setDraft(r.draft);
    setRows(r.draft.rows);
    setDate(r.draft.collected_on ?? "");
    setLab(r.draft.lab ?? "");
  }

  async function save() {
    if (!file) return;
    setError(null);
    setBusy(true);
    const form = new FormData();
    form.set("file", file);
    form.set("member_id", member);
    form.set("collected_on", date);
    form.set("lab", lab);
    form.set("rows", JSON.stringify(rows.map(({ biomarker_key, name, category, value, unit, ref_min, ref_max, ref_text }) => ({ biomarker_key, name, category, value, unit, ref_min, ref_max, ref_text }))));
    const r = await saveLabReport(form).catch(() => ({ ok: false as const, erro: "Não foi possível salvar. Tente de novo." }));
    setBusy(false);
    if (!r.ok) return setError(r.erro);
    router.push(`/saude${people.length > 1 ? `?pessoa=${r.member_id}` : ""}`);
    router.refresh();
  }

  function cancel() {
    setDraft(null);
    setFile(null);
    setRows([]);
    setError(null);
  }

  if (!draft) {
    return (
      <div className="flex flex-col gap-3">
        <LabTop title="Enviar exames" back={{ href: "/saude", label: "Resumo" }} note="Passo 1 de 2" />
        <Card className="flex gap-2.5 !px-3.5 !py-3">
          <Sparkles size={20} className="mt-0.5 shrink-0 text-primary" aria-hidden />
          <p className="text-[13px] leading-normal">Escolha o PDF (ou foto) do laudo do laboratório. O Oli lê os resultados e você confere tudo antes de salvar.</p>
        </Card>
        <Card className="flex flex-col gap-3 !px-3.5 !py-3.5">
          {people.length > 1 && (
            <Field label="De quem é o exame">
              <Select value={member} onChange={(e) => setMember(e.target.value)} aria-label="De quem é o exame">
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <FileButtons label="Laudo (PDF ou JPG, até 5 MB)" onPick={onPick} disabled={busy} />
          {busy && (
            <p role="status" className="text-[13px] text-muted">
              Lendo o laudo… isso pode levar até 30 segundos.
            </p>
          )}
          <FormError message={error} />
        </Card>
        <p className="text-[11.5px] text-muted">Quem vê: toda a família vê. O arquivo fica guardado no app, só para a família.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <LabTop title="Enviar exames" back={{ href: "/saude", label: "Resumo" }} note="Passo 2 de 2" />
      <Card className="flex gap-2.5 !px-3.5 !py-3">
        <Info size={20} className="mt-0.5 shrink-0 text-primary" aria-hidden />
        <p className="text-[13px] leading-normal" data-testid="lab-leitura">
          O Oli leu <b>{rows.length} {rows.length === 1 ? "resultado" : "resultados"}</b> do arquivo. Confira os valores antes de salvar: leitura automática pode errar.
          {draft.truncated && " O laudo tinha mais resultados do que o limite; só os primeiros foram lidos."}
        </p>
      </Card>
      <Card className="flex flex-col gap-3 !px-3.5 !py-3.5">
        {people.length > 1 && (
          <Field label="De quem é o exame">
            <Select value={member} onChange={(e) => setMember(e.target.value)}>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data da coleta">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Laboratório">
            <Input value={lab} onChange={(e) => setLab(e.target.value)} maxLength={LAB_LIMITS.lab} autoComplete="off" />
          </Field>
        </div>
      </Card>
      <Card className="!px-3.5 !py-1.5" data-testid="lab-conferir">
        <div className="grid h-[30px] grid-cols-[minmax(0,1fr)_52px_72px_44px] items-center gap-1 text-[11.5px] font-semibold text-muted">
          <span>Exame</span>
          <span className="text-right">Valor</span>
          <span>Referência</span>
          <span />
        </div>
        {shown.map((r) => (
          <div key={r.key} data-testid="lab-linha" className="grid min-h-11 grid-cols-[minmax(0,1fr)_52px_72px_44px] items-center gap-1 border-t border-line text-[12.5px]">
            <span className="truncate font-medium">
              {r.name}
              {r.unit && <span className="block text-[11px] font-normal text-muted">{r.unit}</span>}
            </span>
            <b className={clsx("truncate text-right", STATUS_TEXT[statuses.get(r.key) ?? "sem_faixa"])}>{r.value}</b>
            <span className="truncate text-[11.5px] text-muted">{refOf(r)}</span>
            <button
              type="button"
              aria-label={`Corrigir ou remover ${r.name}`}
              onClick={() => setEditing(r.key)}
              className="grid size-11 place-items-center rounded-full text-muted hover:bg-accent-soft"
            >
              <MoreHorizontal size={18} aria-hidden />
            </button>
          </div>
        ))}
        {rows.length > PREVIEW_ROWS && (
          <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="min-h-11 w-full border-t border-line text-left text-[12.5px] font-medium text-link">
            {all ? "Mostrar menos" : `+ ${rows.length - PREVIEW_ROWS} resultados · Ver todos`}
          </button>
        )}
        <p className="border-t border-line py-2 text-[12px] text-muted">Toque em “⋯” para corrigir ou remover.</p>
      </Card>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button className="flex-1" size="md" onClick={save} disabled={busy || rows.length === 0 || !date} aria-busy={busy || undefined}>
          <Check size={16} aria-hidden /> {busy ? "Salvando…" : "Confirmar e salvar"}
        </Button>
        <Button variant="ghost" size="md" onClick={cancel} disabled={busy}>
          Cancelar
        </Button>
      </div>
      <p className="text-[11.5px] text-muted">Quem vê: toda a família vê. O arquivo fica guardado no app, só para a família.</p>
      <Modal open={editingRow !== null} onClose={() => setEditing(null)} title="Corrigir resultado">
        {editingRow && (
          <RowForm
            row={editingRow}
            onSave={(r) => {
              setRows((list) => list.map((x) => (x.key === r.key ? renamed(x, r, list) : x)));
              setEditing(null);
            }}
            onRemove={() => {
              setRows((list) => list.filter((x) => x.key !== editingRow.key));
              setEditing(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
