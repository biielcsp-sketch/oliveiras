// Edge Function: envia notificações push da Saúde (medicamentos e vacinas) e do Pet da Casa (próxima dose).
// Chamada a cada minuto pelo pg_cron com o header x-dispatch-secret. verify_jwt = false.
// A chave service_role só existe aqui (env automática do Edge Function): nunca retornar nem logar.
// Nunca logar/retornar endpoints, chaves, nomes ou conteúdo de aviso.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";
import { computeDueNotices, isAllowedPushEndpoint, type MedicationRow, type PetHealthRow, type VaccineRow } from "./due.ts";

const MAX_NOTICES = 200;
const LOG_RETENTION_DAYS = 7;
const TTL_SECONDS = { medicamento: 3600, vacina: 6 * 3600, pet: 6 * 3600 } as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

// Compara digests de tamanho fixo, sem curto-circuito.
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
  return diff === 0;
}

function genericError(stage: string): void {
  console.error(`push-dispatch: falha em ${stage}`);
}

type Subscription = { id: string; endpoint: string; p256dh: string; auth: string };

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const expected = Deno.env.get("PUSH_DISPATCH_SECRET");
  if (!expected) return json({ error: "not_configured" }, 500);
  const provided = req.headers.get("x-dispatch-secret") ?? "";
  if (!(await safeEqual(provided, expected))) return json({ error: "unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  if (!supabaseUrl || !serviceKey || !vapidPublic || !vapidPrivate || !vapidSubject) {
    return json({ error: "not_configured" }, 500);
  }

  try {
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
  } catch {
    genericError("vapid");
    return json({ error: "not_configured" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date();
  const counters = { avisos: 0, enviados: 0, falhas: 0, removidas: 0 };

  const [meds, vacs, pets] = await Promise.all([
    supabase
      .from("health_medications")
      .select("id, household_id, name, dosage, active, started_on, ended_on, reminder_times, members(name)")
      .eq("active", true),
    supabase
      .from("health_vaccines")
      .select("id, household_id, name, dose_label, next_dose_on, members(name)")
      .not("next_dose_on", "is", null),
    supabase
      .from("casa_pet_health")
      // Sem filtro de next_due_on: a dose mais recente (às vezes sem próxima data) silencia as antigas.
      .select("id, household_id, pet_id, kind, name, dose, applied_on, next_due_on, created_at, casa_pets(name)"),
  ]);
  if (meds.error || vacs.error || pets.error) {
    genericError("consulta");
    return json({ error: "query_failed" }, 500);
  }

  const memberName = (m: unknown): string | null => {
    const rel = Array.isArray(m) ? m[0] : m;
    const name = (rel as { name?: unknown } | null | undefined)?.name;
    return typeof name === "string" ? name : null;
  };

  const medications: MedicationRow[] = (meds.data ?? []).map((r) => ({
    id: r.id,
    household_id: r.household_id,
    name: r.name,
    dosage: r.dosage ?? null,
    active: r.active,
    started_on: r.started_on ?? null,
    ended_on: r.ended_on ?? null,
    reminder_times: r.reminder_times ?? null,
    member_name: memberName(r.members),
  }));
  const vaccines: VaccineRow[] = (vacs.data ?? []).map((r) => ({
    id: r.id,
    household_id: r.household_id,
    name: r.name,
    dose_label: r.dose_label ?? null,
    next_dose_on: r.next_dose_on ?? null,
    member_name: memberName(r.members),
  }));

  const petHealth: PetHealthRow[] = (pets.data ?? []).map((r) => ({
    id: r.id,
    household_id: r.household_id,
    pet_id: r.pet_id,
    kind: r.kind,
    name: r.name,
    dose: r.dose ?? null,
    applied_on: r.applied_on ?? null,
    next_due_on: r.next_due_on ?? null,
    created_at: r.created_at,
    pet_name: memberName(r.casa_pets),
  }));

  const due = computeDueNotices(now, medications, vaccines, petHealth).slice(0, MAX_NOTICES);

  for (const notice of due) {
    // Idempotência: só quem conseguir inserir a key envia.
    const { error: logError } = await supabase.from("push_dispatch_log").insert({ key: notice.key });
    if (logError) {
      if (logError.code !== "23505") {
        genericError("registro");
        counters.falhas++;
      }
      continue;
    }
    counters.avisos++;

    const { data: subs, error: subsError } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("household_id", notice.householdId);
    if (subsError) {
      genericError("assinaturas");
      counters.falhas++;
      await supabase.from("push_dispatch_log").delete().eq("key", notice.key);
      continue;
    }

    const payload = JSON.stringify({
      title: notice.title,
      body: notice.body,
      url: notice.url,
      tag: notice.tag,
    });
    const options = {
      TTL: TTL_SECONDS[notice.kind],
      urgency: notice.kind === "medicamento" ? ("high" as const) : ("normal" as const),
    };

    let sent = 0;
    let transient = 0;
    const gone: string[] = [];
    await Promise.all(
      ((subs ?? []) as Subscription[]).map(async (sub) => {
        // Anti-SSRF: endpoint fora da allowlist é apagado sem nenhuma requisição.
        if (!isAllowedPushEndpoint(sub.endpoint)) {
          gone.push(sub.id);
          return;
        }
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            options,
          );
          sent++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) gone.push(sub.id);
          else transient++;
        }
      }),
    );

    counters.enviados += sent;
    counters.falhas += transient;
    if (gone.length > 0) {
      const { error } = await supabase.from("push_subscriptions").delete().in("id", gone);
      if (error) genericError("remocao");
      else counters.removidas += gone.length;
    }
    // Falha transitória total: libera a key para nova tentativa dentro da janela.
    if (sent === 0 && transient > 0) {
      await supabase.from("push_dispatch_log").delete().eq("key", notice.key);
    }
  }

  const cutoff = new Date(now.getTime() - LOG_RETENTION_DAYS * 86_400_000).toISOString();
  const { error: cleanError } = await supabase.from("push_dispatch_log").delete().lt("sent_at", cutoff);
  if (cleanError) genericError("limpeza");

  return json(counters);
});
