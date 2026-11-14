"use client";

import { useRef, useState, type RefObject } from "react";
import { BookOpenCheck, HelpCircle, ListChecks, NotebookPen, Send, Sparkles } from "lucide-react";
import { Button, FormError, Input, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { NOTES_MAX } from "@/lib/igreja/notes-markup";
import { STUDY_QUESTION_MAX, type StudyMode } from "@/lib/igreja/summary";
import { studyWithOli } from "../carisma-actions";
import type { NotebookApi } from "./notes-editor";
import { Multiline } from "./shared";

const ACTIONS: { mode: Exclude<StudyMode, "pergunta">; label: string; title: string; icon: typeof Sparkles }[] = [
  { mode: "resumo", label: "Resumir a aula", title: "Resumo da aula", icon: BookOpenCheck },
  { mode: "reflexao", label: "Perguntas de reflexão", title: "Perguntas de reflexão", icon: HelpCircle },
  { mode: "quiz", label: "Fazer um teste", title: "Teste (quiz)", icon: ListChecks },
];

type Answer = { title: string; text: string; aviso?: string };

/**
 * "Estudar com o Oli": o Oli lê as anotações e os arquivos da aula (no servidor) e responde. Nada é gravado sozinho:
 * "Anotar no caderno" mostra o texto proposto (editável) e só entra no caderno com o toque em "Confirmar e anotar".
 */
export function StudyPanel({ lessonId, notebook }: { lessonId: string; notebook: RefObject<NotebookApi | null> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [proposal, setProposal] = useState<string | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const busyRef = useRef(false);

  async function ask(mode: StudyMode, title: string, q?: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(title);
    setError(null);
    setProposal(null);
    setDone(false);
    try {
      // O que está na tela do caderno vai para o banco antes de o Oli ler.
      if (notebook.current && !(await notebook.current.flush())) {
        setError("Não consegui salvar o caderno antes. Tente de novo.");
        return;
      }
      const r = await studyWithOli(lessonId, mode, q);
      if (!r.ok) setError(r.erro);
      else setAnswer({ title, text: r.text, aviso: r.aviso });
    } catch {
      setError("Não foi possível falar com o servidor. Tente de novo.");
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const proposed = (a: Answer) => `${a.title} (Oli)\n${a.text}`;

  return (
    <>
      <Button type="button" size="md" variant="ghost" className="w-fit" onClick={() => setOpen(true)}>
        <Sparkles size={16} aria-hidden className="text-primary" /> Estudar com o Oli
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Estudar com o Oli">
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-muted">O Oli lê as suas anotações e os arquivos desta aula. Ele só responde: nada vai para o caderno sem você confirmar.</p>
          <div className="flex flex-col gap-2">
            {ACTIONS.map((a) => (
              <Button key={a.mode} type="button" size="md" variant="ghost" className="justify-start" disabled={busy !== null} onClick={() => ask(a.mode, a.title)}>
                <a.icon size={16} aria-hidden className="text-primary" /> {a.label}
              </Button>
            ))}
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void ask("pergunta", "Pergunta", question);
            }}
          >
            <Input aria-label="Pergunta sobre a aula" value={question} maxLength={STUDY_QUESTION_MAX} onChange={(e) => setQuestion(e.target.value)} placeholder="Pergunte algo sobre a aula…" autoComplete="off" />
            <Button type="submit" size="md" className="shrink-0" disabled={busy !== null || !question.trim()} aria-label="Enviar pergunta">
              <Send size={16} aria-hidden />
            </Button>
          </form>
          {busy && (
            <p role="status" aria-live="polite" className="text-sm text-muted">
              O Oli está lendo a aula… ({busy})
            </p>
          )}
          <FormError message={error} />
          {answer && !busy && (
            <section aria-label="Resposta do Oli" className="flex flex-col gap-3">
              <h4 className="text-[15px] font-semibold">{answer.title}</h4>
              <div data-testid="oli-resposta" className="rounded-[14px] border border-line bg-surface-solid p-3.5">
                <Multiline text={answer.text} className="text-[15px]" />
              </div>
              {answer.aviso && <p className="text-[13px] text-muted">{answer.aviso}</p>}
              {proposal === null && !done && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="w-fit"
                  onClick={() => {
                    setProposalError(null);
                    setProposal(proposed(answer));
                  }}
                >
                  <NotebookPen size={15} aria-hidden /> Anotar no caderno
                </Button>
              )}
              {done && (
                <p role="status" className="text-sm text-primary">
                  Anotado no caderno.
                </p>
              )}
              {proposal !== null && (
                <div role="group" aria-label="Confirmar anotação no caderno" className="flex flex-col gap-2 rounded-[14px] border border-line p-3">
                  <p className="text-[13px] font-medium">Este texto será acrescentado ao fim do seu caderno. Confira e edite se quiser:</p>
                  <Textarea aria-label="Texto proposto para o caderno" rows={8} maxLength={NOTES_MAX} value={proposal} onChange={(e) => setProposal(e.target.value)} />
                  <FormError message={proposalError} />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={!proposal.trim()}
                      onClick={async () => {
                        const r = await notebook.current?.append(proposal);
                        if (!r || !r.ok) {
                          setProposalError(r ? r.erro : "O caderno não está disponível.");
                          return;
                        }
                        setProposal(null);
                        setDone(true);
                      }}
                    >
                      Confirmar e anotar
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setProposal(null)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </Modal>
    </>
  );
}
